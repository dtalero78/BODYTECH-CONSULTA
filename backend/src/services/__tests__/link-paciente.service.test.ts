// ============================================================================
// Los helpers puros del link del paciente.
//
// Acá está el grueso del valor de la suite, porque estas cuatro funciones son
// las que deciden QUÉ texto y QUÉ número recibe una persona real. Un error en
// cualquiera de ellas no rompe nada visible en el servidor: simplemente le
// llega la hora equivocada a un paciente, o no le llega nada.
// ============================================================================

// El módulo importa los servicios de envío, y varios de ellos construyen su
// cliente (Twilio, axios) al cargarse. Nada de eso se ejercita acá: estas
// funciones son puras. Se mockean para que la suite no necesite credenciales.
jest.mock('../whatsapp.service', () => ({
  __esModule: true,
  default: { sendTemplateMessage: jest.fn(), sendContentTemplate: jest.fn() },
}));
jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn(), registrarMensajeSaliente: jest.fn() },
}));
jest.mock('../trepsi-webhook.service', () => ({
  __esModule: true,
  default: { enqueueLink: jest.fn() },
}));
jest.mock('../bsl-plataforma-chat.service', () => ({
  __esModule: true,
  default: { enviarPlantilla: jest.fn() },
}));

import {
  formatHoraCita,
  formatCelularE164,
  buildRoomNameWithParams,
  generateRoomName,
  prepararLinkDeCita,
  enviarLinkPaciente,
  enviarRecordatorioPaciente,
  FilaCitaLink,
} from '../link-paciente.service';
import whatsappService from '../whatsapp.service';
import postgresService from '../postgres.service';
import trepsiWebhookService from '../trepsi-webhook.service';
import bslPlataformaChatService from '../bsl-plataforma-chat.service';

describe('formatHoraCita', () => {
  const casos: [string, string][] = [
    ['15:00', '03:00 p. m.'],
    ['08:00', '08:00 a. m.'],
    ['12:00', '12:00 p. m.'], // mediodía es p.m., no 00
    ['00:30', '12:30 a. m.'], // medianoche es las 12, no las 0
    ['09:05', '09:05 a. m.'],
    ['23:59', '11:59 p. m.'],
    ['7:30', '07:30 a. m.'], // una sola cifra en la hora
  ];

  it.each(casos)('%s → %s', (entrada, esperado) => {
    expect(formatHoraCita(entrada)).toBe(esperado);
  });

  it.each([['basura'], [''], ['25:00'], ['12:99'], ['1500']])(
    'deja pasar lo que no es una hora (%s)',
    (entrada) => {
      expect(formatHoraCita(entrada)).toBe(entrada);
    }
  );

  // El formato no es una preferencia: es el que ya veían los pacientes cuando
  // lo producía el navegador del coach. Este test documenta de dónde salió y
  // avisa si alguna vez deja de coincidir.
  it('coincide con el formato es-CO que usaba el frontend', () => {
    const d = new Date(Date.UTC(2026, 8, 3, 20, 0)); // 15:00 en Bogotá
    const nativo = d.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Bogota',
    });
    // Chrome/ICU a veces usa un espacio angosto (U+202F) o duro (U+00A0)
    // antes del sufijo. Se normalizan con escapes: el carácter literal es
    // invisible en el código y `no-irregular-whitespace` lo rechaza.
    expect(formatHoraCita('15:00')).toBe(nativo.replace(/[\u202f\u00a0]/g, ' '));
  });
});

describe('formatCelularE164', () => {
  const validos: [string, string][] = [
    ['celular colombiano local', '3001234567'],
    ['colombiano con indicativo', '573001234567'],
    ['ya en E.164', '+573001234567'],
    ['con espacios y guiones', '300 123-4567'],
  ];

  it.each(validos)('%s', (_n, entrada) => {
    expect(formatCelularE164(entrada)).toBe('+573001234567');
  });

  // La regresión que documenta el comentario de MedicalPanelPage: recortar el
  // '+' a ciegas con substring(1) se comía el primer dígito del indicativo, y
  // Chile (56, 9 dígitos nacionales) terminaba en un número inválido.
  it.each([
    ['56912345678', '+56912345678'],
    ['+56912345678', '+56912345678'],
    ['5215512345678', '+5215512345678'],
    ['13053334444', '+13053334444'],
    ['50612345678', '+50612345678'],
  ])('conserva el indicativo internacional (%s)', (entrada, esperado) => {
    expect(formatCelularE164(entrada)).toBe(esperado);
  });

  it.each([['0'], [''], ['   '], ['912345678'], ['abc'], ['123']])(
    'devuelve null ante lo que no reconoce (%s)',
    (entrada) => {
      expect(formatCelularE164(entrada)).toBeNull();
    }
  );
});

describe('buildRoomNameWithParams', () => {
  const datos = {
    nombre: 'María José',
    apellido: 'Pérez',
    documento: '1020304050',
    doctor: 'JMENDEZ',
    historiaId: 'hc-1',
  };

  it('codifica tildes y espacios', () => {
    const r = buildRoomNameWithParams('consulta-abc', datos);
    expect(r).toContain('nombre=Mar%C3%ADa+Jos%C3%A9');
    expect(r).toContain('apellido=P%C3%A9rez');
  });

  it('deja exactamente un "?" — la sala es todo lo anterior', () => {
    const r = buildRoomNameWithParams('consulta-abc', datos);
    expect(r.split('?')).toHaveLength(2);
    expect(r.split('?')[0]).toBe('consulta-abc');
  });

  it('incluye el historiaId, que la plantilla usa para el botón Reprogramar', () => {
    expect(buildRoomNameWithParams('c', datos)).toContain('historiaId=hc-1');
  });
});

describe('generateRoomName', () => {
  it('genera salas distintas con el prefijo esperado', () => {
    const a = generateRoomName();
    expect(a).toMatch(/^consulta-[a-z0-9]+-[a-z0-9]{5}$/);
    expect(a).not.toBe(generateRoomName());
  });
});

describe('prepararLinkDeCita', () => {
  const base: FilaCitaLink = {
    historiaId: 'hc-1',
    primerNombre: 'Juan',
    primerApellido: 'Pérez',
    numeroId: '1020304050',
    celular: '3001234567',
    medico: 'JMENDEZ',
    videoRoomName: null,
    horaBogota: '15:00',
    medicoValido: true,
  };

  it('arma el envío completo desde una fila válida', () => {
    const r = prepararLinkDeCita(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.phoneE164).toBe('+573001234567');
    expect(r.data.patientName).toBe('Juan');
    expect(r.data.appointmentTime).toBe('03:00 p. m.');
    expect(r.data.linkPaciente).toContain('/panel-medico/patient/');
  });

  // Reusar la sala es lo que hace que "Atender" caiga donde está el paciente.
  it('reusa la sala persistida cuando existe', () => {
    const r = prepararLinkDeCita({ ...base, videoRoomName: 'consulta-vieja' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.roomName).toBe('consulta-vieja');
    expect(r.data.roomNameReusada).toBe(true);
  });

  it('genera sala nueva cuando la cita no tiene ninguna', () => {
    const r = prepararLinkDeCita(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.roomNameReusada).toBe(false);
    expect(r.data.roomName).toMatch(/^consulta-/);
  });

  it.each([
    ['SIN_MEDICO', { medico: null }],
    ['SIN_MEDICO', { medico: '   ' }],
    ['SIN_NOMBRE', { primerNombre: '' }],
    ['SIN_CELULAR', { celular: null }],
    ['CELULAR_NO_RECONOCIDO', { celular: '0' }],
    ['SIN_HORA', { horaBogota: null }],
  ])('omite con motivo %s', (motivo, parche) => {
    const r = prepararLinkDeCita({ ...base, ...(parche as Partial<FilaCitaLink>) });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe(motivo);
  });

  // mybodytech guarda en `medico` el NOMBRE del profesional, no su código. El
  // link saldría con doctor=PAULA ANDREA MORA PINZON: nadie recibe el aviso de
  // que el paciente entró, y la cita no aparece en el panel de ninguna coach.
  describe('médico que no existe en `profesionales`', () => {
    it('omite cuando se exige profesional conocido', () => {
      const r = prepararLinkDeCita(
        { ...base, medico: 'PAULA ANDREA MORA PINZON', medicoValido: false },
        { exigirProfesional: true }
      );
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('MEDICO_DESCONOCIDO');
    });

    it('deja pasar si no se exige (comportamiento por defecto)', () => {
      const r = prepararLinkDeCita({ ...base, medicoValido: false });
      expect(r.ok).toBe(true);
    });
  });

  describe('lista blanca (modo observación del despliegue)', () => {
    it('deja pasar al celular autorizado', () => {
      expect(prepararLinkDeCita(base, { allowlist: ['+573001234567'] }).ok).toBe(true);
    });

    it('omite a todos los demás', () => {
      const r = prepararLinkDeCita(base, { allowlist: ['+573009999999'] });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.motivo).toBe('FUERA_DE_ALLOWLIST');
    });
  });
});

// ===========================================================================
// El envío y sus rastros.
//
// Esta parte se extrajo del controller para que la compartan el botón
// "Contactar" y el worker automático. La extracción es justo donde se puede
// perder un efecto sin que nada falle: el paciente recibiría su mensaje igual,
// y el rastro faltante recién se notaría semanas después, en un indicador que
// no cuadra o en una sala que no coincide.
// ===========================================================================

describe('enviarLinkPaciente', () => {
  const enviarPlantilla = bslPlataformaChatService.enviarPlantilla as jest.Mock;
  const sendTemplate = whatsappService.sendTemplateMessage as jest.Mock;
  const query = postgresService.query as jest.Mock;
  const registrarMensaje = postgresService.registrarMensajeSaliente as jest.Mock;
  const enqueueLink = trepsiWebhookService.enqueueLink as jest.Mock;

  const input = {
    historiaId: 'hc-1',
    phone: '573001234567',
    patientName: 'Juan',
    appointmentTime: '03:00 p. m.',
    roomNameWithParams: 'consulta-abc?nombre=Juan&doctor=JMENDEZ',
    origen: 'manual' as const,
    esperarEfectos: true,
  };

  beforeEach(() => {
    query.mockResolvedValue([]);
    registrarMensaje.mockResolvedValue(undefined);
    enqueueLink.mockResolvedValue({ enqueued: false, reason: 'NOT_TREPSI' });
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.restoreAllMocks());

  it('prefiere la plataforma, para que el mensaje quede en el hilo del chat', async () => {
    enviarPlantilla.mockResolvedValue(true);

    const r = await enviarLinkPaciente(input);

    expect(r).toMatchObject({ success: true, via: 'plataforma' });
    expect(sendTemplate).not.toHaveBeenCalled();
    // El celular le va a la plataforma en E.164.
    expect(enviarPlantilla.mock.calls[0][0]).toBe('+573001234567');
    // Las 4 variables de la plantilla, en orden.
    expect(enviarPlantilla.mock.calls[0][2]).toEqual({
      '1': 'Juan',
      '2': '03:00 p. m.',
      '3': 'consulta-abc?nombre=Juan&doctor=JMENDEZ',
      '4': 'hc-1',
    });
  });

  it('cae a Twilio si la plataforma no lo tomó — el paciente igual recibe', async () => {
    enviarPlantilla.mockResolvedValue(false);
    sendTemplate.mockResolvedValue({ success: true, messageSid: 'SM1' });

    const r = await enviarLinkPaciente(input);

    expect(r).toMatchObject({ success: true, via: 'twilio', messageSid: 'SM1' });
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('salta la plataforma cuando el worker ya la vio caída', async () => {
    sendTemplate.mockResolvedValue({ success: true, messageSid: 'SM1' });

    await enviarLinkPaciente({ ...input, usarPlataforma: false });

    expect(enviarPlantilla).not.toHaveBeenCalled();
    expect(sendTemplate).toHaveBeenCalledTimes(1);
  });

  it('deja los 4 rastros del envío exitoso', async () => {
    enviarPlantilla.mockResolvedValue(true);

    await enviarLinkPaciente(input);

    // 1. La marca de contacto, con quién lo envió y solo si es el primer envío.
    const marca = query.mock.calls[0];
    expect(marca[0]).toContain('"link_enviado_at" = NOW()');
    expect(marca[0]).toContain('"link_enviado_at" IS NULL');
    expect(marca[1]).toEqual(['hc-1', 'manual']);

    // 2. La sala, SIN los query params: es lo que lee "Atender".
    const sala = query.mock.calls[1];
    expect(sala[0]).toContain('"video_room_name"');
    expect(sala[1]).toEqual(['consulta-abc', 'hc-1']);

    // 3. El mensaje en el hilo del chat.
    expect(registrarMensaje).toHaveBeenCalledTimes(1);
    expect(registrarMensaje.mock.calls[0][0]).toBe('+573001234567');

    // 4. El aviso a Trepsi (no-op si la cita no es de ellos).
    expect(enqueueLink).toHaveBeenCalledWith(
      'hc-1',
      expect.stringContaining('/panel-medico/patient/consulta-abc?'),
      '+573001234567'
    );
  });

  it("el worker marca 'auto', que es lo que preserva el indicador de gestión", async () => {
    enviarPlantilla.mockResolvedValue(true);

    await enviarLinkPaciente({ ...input, origen: 'auto' });

    expect(query.mock.calls[0][1]).toEqual(['hc-1', 'auto']);
  });

  it('un envío fallido no deja NINGÚN rastro: la cita sigue sin contactar', async () => {
    enviarPlantilla.mockResolvedValue(false);
    sendTemplate.mockResolvedValue({ success: false, error: 'Twilio 21211' });

    const r = await enviarLinkPaciente(input);

    expect(r).toMatchObject({ success: false, via: 'ninguno' });
    expect(query).not.toHaveBeenCalled();
    expect(registrarMensaje).not.toHaveBeenCalled();
    expect(enqueueLink).not.toHaveBeenCalled();
  });

  // Los rastros son secundarios: el paciente ya recibió el mensaje. Que falle
  // uno no puede convertir un envío exitoso en fallido.
  it('un rastro que falla no vuelve fallido un envío que sí salió', async () => {
    enviarPlantilla.mockResolvedValue(true);
    query.mockRejectedValue(new Error('BD caída'));
    registrarMensaje.mockRejectedValue(new Error('BD caída'));
    enqueueLink.mockRejectedValue(new Error('BD caída'));

    await expect(enviarLinkPaciente(input)).resolves.toMatchObject({ success: true });
  });
});

// ===========================================================================
// El recordatorio de la mañana: otro mensaje, sin link, sin rastros de link.
// ===========================================================================

describe('enviarRecordatorioPaciente', () => {
  const enviarPlantilla = bslPlataformaChatService.enviarPlantilla as jest.Mock;
  const sendContent = whatsappService.sendContentTemplate as jest.Mock;
  const query = postgresService.query as jest.Mock;
  const registrarMensaje = postgresService.registrarMensajeSaliente as jest.Mock;
  const enqueueLink = trepsiWebhookService.enqueueLink as jest.Mock;

  const input = { historiaId: 'hc-1', phone: '573001234567', patientName: 'Juan', appointmentTime: '03:00 p. m.' };
  const envOriginal = process.env;

  beforeEach(() => {
    process.env = { ...envOriginal, TWILIO_WHATSAPP_RECORDATORIO_TEMPLATE_SID: 'HXrecordatorio' };
    registrarMensaje.mockResolvedValue(undefined);
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  it('sin plantilla configurada no manda nada y lo dice', async () => {
    delete process.env.TWILIO_WHATSAPP_RECORDATORIO_TEMPLATE_SID;
    const r = await enviarRecordatorioPaciente(input);
    expect(r).toMatchObject({ success: false, error: 'RECORDATORIO_TEMPLATE_NO_CONFIGURADO' });
    expect(enviarPlantilla).not.toHaveBeenCalled();
    expect(sendContent).not.toHaveBeenCalled();
  });

  it('usa la plantilla de recordatorio con nombre, hora e historia (botón Reprogramar)', async () => {
    enviarPlantilla.mockResolvedValue(true);
    const r = await enviarRecordatorioPaciente(input);
    expect(r).toMatchObject({ success: true, via: 'plataforma' });
    expect(enviarPlantilla.mock.calls[0][1]).toBe('HXrecordatorio');
    expect(enviarPlantilla.mock.calls[0][2]).toEqual({ '1': 'Juan', '2': '03:00 p. m.', '3': 'hc-1' });
  });

  it('cae a Twilio con la MISMA plantilla si la plataforma no lo tomó', async () => {
    enviarPlantilla.mockResolvedValue(false);
    sendContent.mockResolvedValue({ success: true, messageSid: 'SM2' });
    const r = await enviarRecordatorioPaciente(input);
    expect(r).toMatchObject({ success: true, via: 'twilio', messageSid: 'SM2' });
    expect(sendContent.mock.calls[0][1]).toBe('HXrecordatorio');
  });

  // Es lo que lo distingue del link: no es "contacto", no es la sala, no es Trepsi.
  it('NO deja rastros de link: ni link_enviado_at, ni sala, ni webhook a Trepsi', async () => {
    enviarPlantilla.mockResolvedValue(true);
    await enviarRecordatorioPaciente(input);
    expect(query).not.toHaveBeenCalled();
    expect(enqueueLink).not.toHaveBeenCalled();
    // Pero sí queda en el hilo del chat.
    expect(registrarMensaje).toHaveBeenCalledTimes(1);
    expect(registrarMensaje.mock.calls[0][0]).toBe('+573001234567');
  });
});

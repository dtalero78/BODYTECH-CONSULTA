// ============================================================================
// El worker que le manda el link a los pacientes solo.
//
// Lo que se prueba acá no es "que envíe": es CUÁNDO NO ENVÍA. Un worker que
// manda de más le escribe dos veces a una persona real; uno que manda cuando
// no debe (apagado, fuera de horario, sobre una cita ya reclamada) no tiene
// vuelta atrás. Por eso casi todos los casos son negativos.
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
// `requireActual` de link-paciente arrastra los clientes de envío, que se
// construyen al cargar el módulo y exigen credenciales. Acá no se ejercitan.
jest.mock('../whatsapp.service', () => ({ __esModule: true, default: {} }));
jest.mock('../trepsi-webhook.service', () => ({ __esModule: true, default: {} }));
jest.mock('../bsl-plataforma-chat.service', () => ({ __esModule: true, default: {} }));
jest.mock('../link-paciente.service', () => {
  const real = jest.requireActual('../link-paciente.service');
  // Las funciones puras (preparar, formatear) se usan de verdad: son parte de
  // la decisión que queremos probar. Solo se intercepta el envío.
  return { __esModule: true, ...real, enviarLinkPaciente: jest.fn() };
});

import linkAutoService from '../link-auto.service';
import postgresService from '../postgres.service';
import { enviarLinkPaciente } from '../link-paciente.service';

const query = postgresService.query as jest.Mock;
const enviar = enviarLinkPaciente as jest.Mock;

/** Una fila de cita como la devuelve la query de candidatas. */
function cita(over: Record<string, unknown> = {}) {
  return {
    historia_id: 'hc-1',
    primer_nombre: 'Juan',
    primer_apellido: 'Pérez',
    numero_id: '1020304050',
    celular: '3001234567',
    medico: 'JMENDEZ',
    video_room_name: 'consulta-abc',
    sede_id: 'bsl',
    hora_bogota: '15:00',
    medico_valido: true,
    ...over,
  };
}

const ENV_BASE = {
  LINK_AUTO_ENABLED: 'true',
  LINK_AUTO_HORA: '07:00',
  LINK_AUTO_HORA_FIN: '19:00',
  LINK_AUTO_PAUSA_MS: '1',
};

describe('link-auto worker', () => {
  const envOriginal = process.env;

  beforeEach(() => {
    process.env = { ...envOriginal, ...ENV_BASE };
    query.mockReset();
    enviar.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Cuándo NO corre
  // -------------------------------------------------------------------------

  describe('maybeDispatch no hace nada', () => {
    // 12:05 UTC = 07:05 en Bogotá: dentro de la ventana.
    const dentroDeVentana = new Date('2026-09-03T12:05:00Z');

    it('si el flag está apagado — ni siquiera consulta la base', async () => {
      jest.useFakeTimers({ advanceTimers: true }).setSystemTime(dentroDeVentana);
      process.env.LINK_AUTO_ENABLED = 'false';
      await linkAutoService.maybeDispatch();
      expect(query).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('si el flag no está definido (el default es apagado)', async () => {
      jest.useFakeTimers({ advanceTimers: true }).setSystemTime(dentroDeVentana);
      delete process.env.LINK_AUTO_ENABLED;
      await linkAutoService.maybeDispatch();
      expect(query).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('antes de la hora de inicio', async () => {
      // 11:00 UTC = 06:00 en Bogotá.
      jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date('2026-09-03T11:00:00Z'));
      await linkAutoService.maybeDispatch();
      expect(query).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    // Sin tope superior, una cita cargada tarde dispararía un WhatsApp a
    // medianoche.
    it('después de la hora de fin', async () => {
      // 01:00 UTC = 20:00 del día anterior en Bogotá.
      jest.useFakeTimers({ advanceTimers: true }).setSystemTime(new Date('2026-09-04T01:00:00Z'));
      await linkAutoService.maybeDispatch();
      expect(query).not.toHaveBeenCalled();
      jest.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // La pasada
  // -------------------------------------------------------------------------

  describe('dispatch', () => {
    it('envía y deja la bitácora en "enviado"', async () => {
      query
        .mockResolvedValueOnce([cita()]) // candidatas
        .mockResolvedValueOnce([{ historia_id: 'hc-1' }]) // claim
        .mockResolvedValueOnce([]); // marcarEnviada
      enviar.mockResolvedValue({ success: true, messageSid: 'SM1', via: 'plataforma' });

      const r = await linkAutoService.dispatch('2026-09-03');

      expect(r.enviadas).toBe(1);
      expect(r.fallidas).toBe(0);
      expect(enviar).toHaveBeenCalledTimes(1);

      // El origen 'auto' es lo que preserva el indicador "No contactó".
      expect(enviar.mock.calls[0][0]).toMatchObject({
        historiaId: 'hc-1',
        origen: 'auto',
        esperarEfectos: true,
        appointmentTime: '03:00 p. m.', // la hora de la CITA, no la de ahora
      });

      const marcado = query.mock.calls[2];
      expect(marcado[0]).toContain("estado = 'enviado'");
    });

    // Si el claim no devuelve fila, otra pasada (u otra instancia) ya la tiene.
    it('NO envía si el claim no devuelve la cita', async () => {
      query
        .mockResolvedValueOnce([cita()])
        .mockResolvedValueOnce([]); // claim vacío
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(enviar).not.toHaveBeenCalled();
      expect(r.yaReclamadas).toBe(1);
      expect(r.enviadas).toBe(0);
    });

    it('un envío fallido queda en "error" con backoff, y no se marca enviado', async () => {
      query
        .mockResolvedValueOnce([cita()])
        .mockResolvedValueOnce([{ historia_id: 'hc-1' }])
        .mockResolvedValueOnce([]); // marcarError
      enviar.mockResolvedValue({ success: false, error: 'Twilio 21211', via: 'ninguno' });

      const r = await linkAutoService.dispatch('2026-09-03');

      expect(r.fallidas).toBe(1);
      expect(r.enviadas).toBe(0);
      const sql = query.mock.calls[2][0];
      expect(sql).toContain("estado = 'error'");
      expect(sql).toContain('next_try_at');
    });

    // Un error de base devuelve null, no []. Sin distinguirlos, el worker leería
    // "hoy no hay citas" y callaría todos los días.
    it('aborta si la query de candidatas falla, en vez de leerlo como "sin citas"', async () => {
      query.mockResolvedValueOnce(null);
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(r.abortado).toBe('DB_ERROR');
      expect(enviar).not.toHaveBeenCalled();
    });

    // 3.000 WhatsApps no se deshacen.
    it('no envía nada si aparecen más candidatas de las que puede ser una agenda', async () => {
      query.mockResolvedValueOnce(
        Array.from({ length: 250 }, (_, i) => cita({ historia_id: `hc-${i}` }))
      );
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(r.abortado).toBe('TOPE_CORDURA');
      expect(enviar).not.toHaveBeenCalled();
    });

    it('omite (sin reclamar ni enviar) una cita sin médico', async () => {
      query
        .mockResolvedValueOnce([cita({ medico: null })])
        .mockResolvedValueOnce([]); // marcarOmitida
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(enviar).not.toHaveBeenCalled();
      expect(r.omitidas).toBe(1);
      expect(r.items[0].motivo).toBe('SIN_MEDICO');
      expect(query.mock.calls[1][0]).toContain("'omitido'");
    });

    it('omite, sin ocultarla, la cita cuyo médico no está en `profesionales`', async () => {
      process.env.LINK_AUTO_EXIGIR_PROFESIONAL = 'true';
      query
        .mockResolvedValueOnce([cita({ medico: 'PAULA ANDREA MORA PINZON', medico_valido: false })])
        .mockResolvedValueOnce([]); // marcarOmitida
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(enviar).not.toHaveBeenCalled();
      expect(r.items[0].motivo).toBe('MEDICO_DESCONOCIDO');
      // Queda en la bitácora: es como se destapan las citas huérfanas.
      expect(query.mock.calls[1][0]).toContain("'omitido'");
    });

    it('respeta la lista blanca de celulares', async () => {
      process.env.LINK_AUTO_SOLO_CELULARES = '+573009999999';
      query.mockResolvedValueOnce([cita()]).mockResolvedValueOnce([]);
      const r = await linkAutoService.dispatch('2026-09-03');

      expect(enviar).not.toHaveBeenCalled();
      expect(r.items[0].motivo).toBe('FUERA_DE_ALLOWLIST');
    });

    it('acota por sede cuando LINK_AUTO_SEDES está configurado', async () => {
      process.env.LINK_AUTO_SEDES = 'bsl,bdt-nutricion';
      query.mockResolvedValueOnce([]);
      await linkAutoService.dispatch('2026-09-03');

      expect(query.mock.calls[0][0]).toContain('"sede_id" = ANY');
      expect(query.mock.calls[0][1]).toContainEqual(['bsl', 'bdt-nutricion']);
    });

    it('la ventana del día se calcula en hora Colombia (UTC-5)', async () => {
      query.mockResolvedValueOnce([]);
      await linkAutoService.dispatch('2026-09-03');

      const params = query.mock.calls[0][1];
      expect(params[0]).toBe('2026-09-03T05:00:00.000Z');
      expect(params[1]).toBe('2026-09-04T05:00:00.000Z');
    });
  });

  // -------------------------------------------------------------------------
  // Dry-run
  // -------------------------------------------------------------------------

  describe('dry-run', () => {
    it('no envía ni escribe nada, pero dice a quién le llegaría', async () => {
      query.mockResolvedValueOnce([cita()]);
      const r = await linkAutoService.dispatch('2026-09-03', { dryRun: true });

      expect(enviar).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1); // solo la lectura de candidatas
      expect(r.items[0]).toMatchObject({
        accion: 'ENVIARIA',
        celular: '+573001234567',
        appointmentTime: '03:00 p. m.',
        roomName: 'consulta-abc',
        roomNameReusada: true,
      });
      expect(r.items[0].linkPaciente).toContain('/panel-medico/patient/consulta-abc?');
    });

    it('marca las que omitiría, con el motivo', async () => {
      query.mockResolvedValueOnce([cita({ celular: '0' })]);
      const r = await linkAutoService.dispatch('2026-09-03', { dryRun: true });

      expect(query).toHaveBeenCalledTimes(1);
      expect(r.items[0]).toMatchObject({
        accion: 'OMITIRIA',
        motivo: 'CELULAR_NO_RECONOCIDO',
      });
    });
  });
});

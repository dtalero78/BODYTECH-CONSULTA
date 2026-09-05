// ============================================================================
// link-paciente.service — el link de la videollamada que recibe el paciente.
//
// Hasta ahora este flujo vivía repartido en dos mitades que no se podían
// reutilizar: el NAVEGADOR sabía armar el link (resolver la sala, construir los
// query params, formatear el teléfono) y el CONTROLLER sabía enviarlo y dejar
// los rastros. Un worker en el servidor no podía hacer ni la primera mitad ni
// llamar a la segunda (está detrás de `requireRole('clinico')`).
//
// Acá viven las dos, en tres capas:
//
//   1. Helpers PUROS (sin BD ni red) — formato de hora, teléfono, sala, URL.
//   2. `prepararLinkDeCita()` — de una fila de HistoriaClinica a un envío listo.
//      También pura: es lo que hace posible el dry-run del worker, que corre
//      exactamente el mismo código sin escribir nada.
//   3. `enviarLinkPaciente()` — envía y deja los 4 rastros. La comparten el
//      botón "Contactar" del panel y el worker automático.
//
// El botón manual y el worker difieren en UNA cosa deliberada: el manual arma
// el link con el código del coach LOGUEADO (que legítimamente puede no ser el
// `medico` de la cita — un coordinador contactando por otro), así que la capa 2
// es solo para el worker. La capa 3 la comparten tal cual.
// ============================================================================

import whatsappService from './whatsapp.service';
import postgresService from './postgres.service';
import trepsiWebhookService from './trepsi-webhook.service';
import bslPlataformaChatService from './bsl-plataforma-chat.service';

/** SID por defecto de la plantilla de cita (bodytech_cita_v2, 2 botones). */
const TEMPLATE_CITA_FALLBACK = 'HX83c2dd7da8954757ee34a310d4f17e62';

/**
 * Indicativos internacionales que reconocemos en un celular ya escrito con
 * código de país. Los de 3 dígitos van PRIMERO para que el regex no los corte
 * con un prefijo de 2. `\d{8,}` tolera longitudes nacionales variables
 * (Chile 9, Colombia 10). Réplica de MedicalPanelPage.formatPhoneNumber.
 */
const INDICATIVOS =
  /^(502|503|504|505|506|507|591|593|595|598|1|33|34|44|49|51|52|53|54|55|56|57|58)\d{8,}/;

// ---------------------------------------------------------------------------
// 1. Helpers puros
// ---------------------------------------------------------------------------

/** Nombre de sala nuevo. Mismo formato que el frontend (linkGenerator.ts). */
export function generateRoomName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 7);
  return `consulta-${timestamp}-${random}`;
}

/**
 * "15:00" → "03:00 p. m." — el formato que ve el paciente en la variable {{2}}.
 *
 * A propósito NO usa `toLocaleTimeString('es-CO', …)`, aunque sea lo obvio: si
 * el contenedor llegara a correr con un Node compilado con `small-icu`, `es-CO`
 * degrada EN SILENCIO a `en-US` y saldría "03:00 PM" en un mensaje a pacientes
 * —con los tests locales pasando igual, porque el Node de desarrollo sí trae
 * ICU completo. Una función pura es determinista y no depende del build.
 */
export function formatHoraCita(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return hhmm;
  const h24 = Number(m[1]);
  if (h24 > 23 || Number(m[2]) > 59) return hhmm;
  const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${m[2]} ${sufijo}`;
}

/**
 * Celular en E.164 (`+57...`), o `null` si no lo reconocemos.
 *
 * Réplica de `formatPhoneNumber` del panel, con UNA diferencia deliberada:
 * el frontend, ante un formato desconocido, devuelve el número crudo y loguea
 * un warning que un humano puede ver. Un worker no supervisado no tiene ese
 * humano, y mandarle a Twilio algo no reconocido produce errores 21211 en masa.
 * Acá preferimos omitir la cita y dejarla registrada en la bitácora.
 */
export function formatCelularE164(celular: string): string | null {
  const cleaned = (celular || '').replace(/[\s()-]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) {
    return /^\+\d{10,15}$/.test(cleaned) ? cleaned : null;
  }
  // Ya trae indicativo de país: solo le falta el '+'.
  if (INDICATIVOS.test(cleaned)) return `+${cleaned}`;
  // Celular local colombiano (10 dígitos que empiezan con 3).
  if (/^3\d{9}$/.test(cleaned)) return `+57${cleaned}`;

  return null;
}

/**
 * La variable {{3}} de la plantilla: la sala más los datos que el paciente
 * necesita llevar a la sala. El botón del template la pega detrás de
 * `{BASE_URL}/panel-medico/patient/`.
 */
export function buildRoomNameWithParams(
  roomName: string,
  p: {
    nombre: string;
    apellido: string;
    documento: string;
    doctor: string;
    historiaId: string;
  }
): string {
  const params = new URLSearchParams({
    nombre: p.nombre,
    apellido: p.apellido,
    documento: p.documento,
    doctor: p.doctor,
    historiaId: p.historiaId,
  });
  return `${roomName}?${params.toString()}`;
}

/** URL absoluta que abre el paciente. Es la que se le manda a Trepsi. */
export function buildLinkPaciente(roomNameWithParams: string): string {
  const baseUrl = process.env.BASE_URL || 'https://bodytech.app';
  return `${baseUrl}/panel-medico/patient/${roomNameWithParams}`;
}

// ---------------------------------------------------------------------------
// 2. De una fila de HistoriaClinica a un envío listo (solo worker)
// ---------------------------------------------------------------------------

export interface FilaCitaLink {
  historiaId: string;
  primerNombre: string | null;
  primerApellido: string | null;
  numeroId: string | null;
  celular: string | null;
  medico: string | null;
  /** `HistoriaClinica.video_room_name` — la sala que ya conoce el sistema. */
  videoRoomName: string | null;
  /** "HH:MM" en hora de Bogotá, ya convertida por la query. */
  horaBogota: string | null;
  /**
   * ¿`medico` corresponde a un profesional activo de la tabla `profesionales`?
   * Lo resuelve la query, para que esta función siga siendo pura. No siempre es
   * cierto: mybodytech guarda en `medico` el NOMBRE del profesional, no su
   * código (mybodytech.service.ts:203), y con un nombre ahí nadie ve la cita.
   */
  medicoValido: boolean;
}

export interface LinkPreparado {
  historiaId: string;
  phoneE164: string;
  patientName: string; // {{1}}
  appointmentTime: string; // {{2}}
  roomName: string;
  /** true = venía de `video_room_name`; false = se generó recién. */
  roomNameReusada: boolean;
  roomNameWithParams: string; // {{3}}
  linkPaciente: string;
  horaCita: string;
}

export type MotivoOmision =
  | 'SIN_MEDICO'
  | 'MEDICO_DESCONOCIDO'
  | 'SIN_CELULAR'
  | 'CELULAR_NO_RECONOCIDO'
  | 'SIN_NOMBRE'
  | 'SIN_HORA'
  | 'FUERA_DE_ALLOWLIST';

export type ResultadoPreparacion =
  | { ok: true; data: LinkPreparado }
  | { ok: false; motivo: MotivoOmision };

/**
 * PURA: no toca BD ni red. Por eso el dry-run del worker puede correr esto
 * mismo y mostrar exactamente lo que se enviaría.
 *
 * Sobre `medico`: sin código de profesional el link sale sin `doctor=`, y eso
 * no es cosmético — la cadena `doctor=` → PatientPage → useVideoRoom →
 * session-tracker → `io.to('doctor-' + codigo)` es la que hace que a la coach
 * le suene que el paciente entró. Sin código, nadie se entera; y como
 * `getPendingPatients` filtra por `medico`, la cita tampoco le aparece a nadie.
 * Invitar a un paciente a una sala que nadie va a atender es peor que no
 * invitarlo, así que se omite (y queda en la bitácora, que es como se destapan
 * las citas huérfanas).
 *
 * `opts.allowlist`, cuando tiene elementos, restringe el envío a esos celulares
 * (en E.164). Es el modo observación del despliegue.
 */
export function prepararLinkDeCita(
  fila: FilaCitaLink,
  opts: { allowlist?: string[]; exigirProfesional?: boolean } = {}
): ResultadoPreparacion {
  const allowlist = opts.allowlist ?? [];

  const medico = (fila.medico || '').trim();
  if (!medico) return { ok: false, motivo: 'SIN_MEDICO' };

  // Un `medico` que no existe en `profesionales` tiene el mismo efecto que no
  // tenerlo: el socket 'doctor-<codigo>' no le llega a nadie y la cita tampoco
  // aparece en el panel de ninguna coach. Se omite REGISTRANDO el motivo —
  // filtrarlo en el SQL lo escondería, y estas citas huérfanas hay que verlas.
  if (opts.exigirProfesional && !fila.medicoValido) {
    return { ok: false, motivo: 'MEDICO_DESCONOCIDO' };
  }

  const nombre = (fila.primerNombre || '').trim();
  if (!nombre) return { ok: false, motivo: 'SIN_NOMBRE' };

  const celularCrudo = (fila.celular || '').trim();
  if (!celularCrudo) return { ok: false, motivo: 'SIN_CELULAR' };

  const phoneE164 = formatCelularE164(celularCrudo);
  if (!phoneE164) return { ok: false, motivo: 'CELULAR_NO_RECONOCIDO' };

  if (allowlist.length > 0 && !allowlist.includes(phoneE164)) {
    return { ok: false, motivo: 'FUERA_DE_ALLOWLIST' };
  }

  const horaCita = (fila.horaBogota || '').trim();
  if (!horaCita) return { ok: false, motivo: 'SIN_HORA' };

  const roomNameGuardada = (fila.videoRoomName || '').trim();
  const roomNameReusada = roomNameGuardada.length > 0;
  const roomName = roomNameReusada ? roomNameGuardada : generateRoomName();

  const roomNameWithParams = buildRoomNameWithParams(roomName, {
    nombre,
    apellido: (fila.primerApellido || '').trim(),
    documento: (fila.numeroId || '').trim(),
    doctor: medico,
    historiaId: fila.historiaId,
  });

  return {
    ok: true,
    data: {
      historiaId: fila.historiaId,
      phoneE164,
      patientName: nombre,
      appointmentTime: formatHoraCita(horaCita),
      roomName,
      roomNameReusada,
      roomNameWithParams,
      linkPaciente: buildLinkPaciente(roomNameWithParams),
      horaCita,
    },
  };
}

// ---------------------------------------------------------------------------
// 3. Envío + rastros (compartida por el botón manual y el worker)
// ---------------------------------------------------------------------------

export type OrigenEnvio = 'manual' | 'auto';

export interface EnviarLinkInput {
  historiaId: string;
  /** Con o sin '+'. */
  phone: string;
  patientName: string;
  appointmentTime: string;
  roomNameWithParams: string;
  origen: OrigenEnvio;
  /**
   * true → espera los 4 efectos antes de resolver. Lo necesita el worker, que
   * reporta el resultado y no debe dejar promesas colgando entre pasadas.
   * false (default) → fire-and-forget, EXACTAMENTE el timing que hoy percibe
   * el coach al apretar "Contactar".
   */
  esperarEfectos?: boolean;
  /**
   * Si es false, se salta la plataforma y va directo a Twilio. El worker lo usa
   * como cortocircuito: si la plataforma ya falló una vez en la corrida, no
   * tiene sentido comerse 15 s de timeout por cada paciente restante.
   */
  usarPlataforma?: boolean;
}

export interface EnviarLinkResult {
  success: boolean;
  error?: string;
  messageSid?: string;
  via: 'plataforma' | 'twilio' | 'ninguno';
}

export async function enviarLinkPaciente(i: EnviarLinkInput): Promise<EnviarLinkResult> {
  const {
    historiaId,
    phone,
    patientName,
    appointmentTime,
    roomNameWithParams,
    origen,
    esperarEfectos = false,
    usarPlataforma = true,
  } = i;

  // Se intenta primero POR la plataforma (mismo Twilio del tenant BODYTECH →
  // +5716284820) para que el mensaje quede en el hilo del chat. Si la
  // plataforma falla, cae al envío directo por Twilio: el paciente igual
  // recibe, aunque no quede registrado en el chat.
  const templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID || TEMPLATE_CITA_FALLBACK;
  const variables: Record<string, string> = {
    '1': patientName,
    '2': appointmentTime,
    '3': roomNameWithParams,
    '4': historiaId,
  };
  const phoneWithPlus = phone.startsWith('+') ? phone : `+${phone}`;

  let result: EnviarLinkResult;
  const viaPlataforma = usarPlataforma
    ? await bslPlataformaChatService.enviarPlantilla(phoneWithPlus, templateSid, variables)
    : false;

  if (viaPlataforma) {
    result = { success: true, via: 'plataforma' };
  } else {
    const r = await whatsappService.sendTemplateMessage(
      phone,
      roomNameWithParams,
      patientName,
      appointmentTime,
      historiaId
    );
    result = { ...r, via: r.success ? 'twilio' : 'ninguno' };
  }

  if (!result.success) return result;

  const efectos = registrarEnvio({
    historiaId,
    phoneWithPlus,
    patientName,
    appointmentTime,
    roomNameWithParams,
    messageSid: result.messageSid,
    origen,
  });

  if (esperarEfectos) await efectos;
  return result;
}

// ---------------------------------------------------------------------------
// 4. Recordatorio de la mañana (sin link)
// ---------------------------------------------------------------------------

/**
 * El WhatsApp de las 07:00: "hoy tienes consulta a las {{2}}" + botón
 * Reprogramar. A propósito NO lleva "Conectarme": a esa hora no hay coach en
 * la sala, y un paciente que entra a las 7 de la mañana no encuentra a nadie.
 * El link sale aparte, minutos antes de la cita (ver enviarLinkPaciente).
 *
 * Por eso tampoco deja los rastros del link: no toca link_enviado_at ni la
 * sala, ni le avisa a Trepsi. Solo el mensaje en el hilo del chat.
 */
export async function enviarRecordatorioPaciente(i: {
  historiaId: string;
  phone: string;
  patientName: string;
  appointmentTime: string;
  usarPlataforma?: boolean;
}): Promise<EnviarLinkResult> {
  const templateSid = process.env.TWILIO_WHATSAPP_RECORDATORIO_TEMPLATE_SID || '';
  if (!templateSid) {
    return { success: false, error: 'RECORDATORIO_TEMPLATE_NO_CONFIGURADO', via: 'ninguno' };
  }
  const variables: Record<string, string> = {
    '1': i.patientName,
    '2': i.appointmentTime,
    '3': i.historiaId, // botón Reprogramar → /reprogramar/{{3}}
  };
  const phoneWithPlus = i.phone.startsWith('+') ? i.phone : `+${i.phone}`;

  let result: EnviarLinkResult;
  const viaPlataforma =
    i.usarPlataforma === false
      ? false
      : await bslPlataformaChatService.enviarPlantilla(phoneWithPlus, templateSid, variables);
  if (viaPlataforma) {
    result = { success: true, via: 'plataforma' };
  } else {
    const r = await whatsappService.sendContentTemplate(i.phone, templateSid, variables);
    result = { ...r, via: r.success ? 'twilio' : 'ninguno' };
  }
  if (!result.success) return result;

  try {
    const cuerpo = `Hola ${i.patientName},\n\nTe recordamos que hoy tienes tu consulta virtual a las ${i.appointmentTime}.\n\nUnos minutos antes de la hora te enviaremos el enlace para conectarte.`;
    await postgresService.registrarMensajeSaliente(phoneWithPlus, cuerpo, result.messageSid || '', i.patientName);
  } catch (e) {
    console.error('⚠️ Error registrando recordatorio en el chat:', e);
  }
  return result;
}

/**
 * Los 4 rastros que deja un envío exitoso. Ninguno es crítico para el paciente
 * (que ya recibió el mensaje), así que cada uno se traga su propio error: un
 * fallo acá no puede volver "fallido" un envío que sí salió.
 */
async function registrarEnvio(p: {
  historiaId: string;
  phoneWithPlus: string;
  patientName: string;
  appointmentTime: string;
  roomNameWithParams: string;
  messageSid?: string;
  origen: OrigenEnvio;
}): Promise<void> {
  const { historiaId, phoneWithPlus, patientName, appointmentTime, roomNameWithParams } = p;

  // 1. Marca de "link enviado" + quién lo envió. Alimenta el indicador
  //    "No contactó", que mide gestión DEL COACH: por eso importa distinguir
  //    'manual' de 'auto'. Solo el PRIMER envío (link_enviado_at IS NULL).
  await postgresService
    .query(
      `UPDATE "HistoriaClinica" SET "link_enviado_at" = NOW(), "link_enviado_por" = $2
         WHERE "_id" = $1 AND "link_enviado_at" IS NULL`,
      [historiaId, p.origen]
    )
    .catch((e) => console.error('⚠️ Error marcando link_enviado_at:', e?.message ?? e));

  // 2. La SALA, en el servidor. Es la fuente de verdad: antes vivía solo en la
  //    memoria del navegador del coach, así que al recargar la página "Atender"
  //    generaba una sala nueva distinta a la del paciente.
  const videoRoomName = roomNameWithParams.split('?')[0];
  if (videoRoomName) {
    await postgresService
      .query(`UPDATE "HistoriaClinica" SET "video_room_name" = $1 WHERE "_id" = $2`, [
        videoRoomName,
        historiaId,
      ])
      .catch((e) => console.error('⚠️ Error guardando video_room_name:', e?.message ?? e));
  }

  // 3. El mensaje en el hilo del chat.
  const videoCallUrl = buildLinkPaciente(roomNameWithParams);
  try {
    const messageBody = `Hola ${patientName},\n\nTe saludamos de VIP Salud Ocupacional.\n\nTienes una consulta médica a las ${appointmentTime}.\n\nPara ingresar haz clic en el siguiente enlace:\n${videoCallUrl}`;
    await postgresService.registrarMensajeSaliente(
      phoneWithPlus,
      messageBody,
      p.messageSid || '',
      patientName
    );
  } catch (e) {
    console.error('⚠️ Error registrando mensaje en PostgreSQL:', e);
  }

  // 4. Si la cita vino de Trepsi, les mandamos el link por webhook para que
  //    puedan mostrárselo al paciente en su app. Si no es de Trepsi, no-op.
  try {
    const r = await trepsiWebhookService.enqueueLink(historiaId, videoCallUrl, phoneWithPlus);
    if (r.enqueued) {
      console.log(`📨 [Trepsi-Webhook] Link encolado para historia ${historiaId}`);
    } else if (r.reason && r.reason !== 'NOT_TREPSI') {
      console.log(`ℹ️  [Trepsi-Webhook] Link no encolado: ${r.reason}`);
    }
  } catch (e: any) {
    console.error(`⚠️  [Trepsi-Webhook] Error encolando link: ${e?.message ?? e}`);
  }
}

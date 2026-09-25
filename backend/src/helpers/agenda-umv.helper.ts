// ============================================================================
// agenda-umv.helper — el afiliado nuevo de MyBodytech agenda SU consulta.
//
// Hasta el 25-sep-2026 MyBodytech mandaba cada orden con fecha, hora y el
// nombre del profesional ya puestos, y la cita se guardaba así: con un nombre
// escrito a mano en `medico` que no tiene agenda. De ~1.100 citas en 30 días se
// atendió una. Ahora (decisión de Daniel, 25-sep-2026) la orden entra "por
// agendar": al afiliado le llega un WhatsApp con un botón, elige un cupo libre
// del equipo de la Unidad Médica Virtual, y la plataforma se lo asigna a un
// profesional real. La fecha/hora de MyBodytech se ignora (queda en el payload).
//
// Funciones PURAS. La lectura/escritura vive en agenda-umv.service.ts.
// ============================================================================

/** ¿Está prendido el flujo nuevo? Los dos juntos o no: sin plantilla, nadie recibiría el botón. */
export function agendaUmvActiva(env: NodeJS.ProcessEnv = process.env): boolean {
  const on = env.UMV_AGENDA_ENABLED === 'true' || env.UMV_AGENDA_ENABLED === '1';
  return on && Boolean((env.TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID || '').trim());
}

/**
 * Los códigos del equipo UMV fijados por variable (`UMV_AGENDA_PROFESIONALES`,
 * CSV). Vacío = se usa la regla por defecto (fichas activas de la unidad `bsl`
 * con rol medico que no sean de prueba), que vive en el SQL del servicio.
 */
export function codigosEquipoUmv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.UMV_AGENDA_PROFESIONALES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Horario de envío de la invitación, en hora Colombia. Una orden que entra a
 * las 23:00 no despierta al afiliado: la invitación sale en la mañana.
 */
export function dentroDeHorarioEnvio(
  minutosColombia: number,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const aMin = (s: string | undefined, def: string): number => {
    const m = /^(\d{1,2}):(\d{2})$/.exec((s || def).trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : aMin(def, def);
  };
  const desde = aMin(env.UMV_AGENDA_HORA_DESDE, '07:00');
  const hasta = aMin(env.UMV_AGENDA_HORA_HASTA, '20:00');
  return minutosColombia >= desde && minutosColombia < hasta;
}

export interface CuposProfesional {
  codigo: string;
  /** Horas libres ("HH:MM") de ese día. */
  libres: string[];
}

/**
 * Los cupos de todo el equipo en UNA lista: al afiliado no le importa con quién,
 * sino a qué hora. Una hora aparece si al menos un profesional la tiene libre.
 */
export function unirCupos(porProfesional: CuposProfesional[]): string[] {
  const horas = new Set<string>();
  for (const p of porProfesional) for (const h of p.libres) horas.add(h);
  return [...horas].sort();
}

export interface Candidato {
  codigo: string;
  /** Citas pendientes que ya tiene ese día: se reparte la carga. */
  citasDelDia: number;
}

/**
 * A quién le toca: el que menos citas tiene ese día, para que el equipo se
 * reparta parejo. El empate se rompe por código, así el resultado es estable
 * (dos pasadas con los mismos datos eligen lo mismo).
 */
export function elegirProfesional(candidatos: Candidato[]): string | null {
  if (candidatos.length === 0) return null;
  const orden = [...candidatos].sort(
    (a, b) => a.citasDelDia - b.citasDelDia || a.codigo.localeCompare(b.codigo)
  );
  return orden[0].codigo;
}

/**
 * El texto de la plantilla con el nombre puesto. Es lo que queda en el hilo del
 * chat del panel, así que tiene que decir lo mismo que recibió el afiliado. Debe
 * coincidir con el cuerpo de scripts/twilio-create-template-umv-agendar.cjs.
 */
export function textoInvitacionUmv(p: { nombre: string; link: string }): string {
  return (
    `¡Hola ${p.nombre}! Ahora eres parte de Bodytech.\n\n` +
    'Como parte de tu proceso, te invitamos a agendar tu consulta virtual por fisioterapia. ' +
    'Esta consulta no toma más de 15 minutos y es muy importante para tu proceso.\n\n' +
    'Para agendarla haz clic en el botón.\n\n' +
    `Agendar mi consulta: ${p.link}`
  );
}

/**
 * El texto de la confirmación (`bodytech_umv_confirmacion_v1`), que sale apenas
 * el afiliado elige su cupo. Debe coincidir con el cuerpo de
 * scripts/twilio-create-template-umv-confirmacion.cjs.
 */
export function textoConfirmacionUmv(p: {
  nombre: string;
  fecha: string;
  hora: string;
  linkReprogramar: string;
}): string {
  return (
    `¡Listo, ${p.nombre}! Tu consulta virtual de fisioterapia quedó agendada. ✅\n\n` +
    `📅 Fecha: ${p.fecha}\n🕐 Hora: ${p.hora}\n\n` +
    'A la hora de tu consulta te enviaremos por este medio el enlace para ingresar a la videollamada.\n\n' +
    'Si necesitas cambiar el horario, selecciona “Reprogramar”.\n\n' +
    'Unidad Médica Virtual\n\n' +
    `Reprogramar: ${p.linkReprogramar}`
  );
}

/** Solo dígitos, con el 57 puesto a un celular colombiano local. */
function normalizarCelular(c: string): string {
  const d = (c || '').replace(/\D/g, '');
  return /^3\d{9}$/.test(d) ? `57${d}` : d;
}

/**
 * MODO PRUEBAS (Daniel, 25-sep-2026: "estamos en pruebas, no debemos enviar
 * ningún mensaje a los pacientes reales"). `UMV_SOLO_CELULARES` es la lista de
 * celulares que SÍ entran al flujo nuevo de la UMV: la bienvenida, el
 * agendamiento, la confirmación y la plantilla nueva del link. Cualquier otro
 * paciente sigue exactamente como antes.
 *
 * Falla cerrado: VACÍA = NADIE. Para abrirlo a todos hay que escribir `*` a
 * propósito; olvidarse de la variable nunca le escribe a un paciente real.
 */
export function celularHabilitadoUmv(celular: string | null | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  const lista = (env.UMV_SOLO_CELULARES || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (lista.includes('*')) return true;
  const n = normalizarCelular(celular || '');
  if (!n) return false;
  return lista.some((c) => normalizarCelular(c) === n);
}

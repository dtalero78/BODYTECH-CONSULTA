// ============================================================================
// unidad-envio.helper — el link de un paciente de la Unidad Médica Virtual.
//
// El link de la videollamada sale con UNA plantilla para todos, escrita para
// las coaches de nutrición de Trepsi ("tu valoración de nutrición virtual"). Al
// paciente de la UMV lo atiende fisioterapia, así que ese texto le decía otra
// cosa. Su plantilla es otra (`bodytech_umv_link_v2`, pedida el 24-sep-2026; la
// v1 salió aprobada como MARKETING por un párrafo promocional que la v2 quita):
// dice con quién es la consulta, trae la FECHA además de la hora, y firma
// "Unidad Médica Virtual". Los botones son los mismos (sala + Reprogramar).
//
// Funciones PURAS. La lectura de la cita vive en unidad-envio.service.ts.
// ============================================================================

/**
 * ¿La cita es de la UMV? Mismo criterio que `programa-scope`: la UMV casi no
 * tiene citas con `origen='umv'` — le llegan por la integración de MyBodytech.
 */
export function esCitaUmv(origen: string | null | undefined): boolean {
  const o = (origen || '').trim().toLowerCase();
  return o === 'umv' || o === 'mybodytech';
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * "2026-09-25" (ya en hora de Bogotá) → "jueves 25 de septiembre".
 *
 * Sin `toLocaleDateString('es-CO')` por lo mismo que `formatHoraCita`: con un
 * Node de ICU reducido degrada en silencio a inglés. El día de la semana se
 * calcula en UTC sobre la fecha sola, así que no depende de la zona del server.
 */
export function formatFechaCita(yyyymmdd: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((yyyymmdd || '').trim());
  if (!m) return null;
  const [y, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(y, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return `${DIAS[d.getUTCDay()]} ${dia} de ${MESES[mes - 1]}`;
}

/**
 * El texto de la plantilla con las variables puestas. Es lo que queda en el
 * hilo del chat del panel, así que tiene que decir lo mismo que recibió el
 * paciente. El link va al final porque en WhatsApp es un botón.
 */
export function textoLinkUmv(p: { nombre: string; fecha: string; hora: string; link: string }): string {
  return (
    `Hola, ${p.nombre} 👋\n\n` +
    'Tienes programada una consulta virtual con un profesional de fisioterapia. 🧑‍⚕️\n\n' +
    `📅 Fecha: ${p.fecha}\n🕐 Hora: ${p.hora}\n\n` +
    'Para ingresar a la videollamada, selecciona “Contáctame”.\n\n' +
    'Si necesitas cambiar el horario, selecciona “Reprogramar”.\n\n' +
    '¡Te esperamos!\nUnidad Médica Virtual\n\n' +
    `Contáctame: ${p.link}`
  );
}

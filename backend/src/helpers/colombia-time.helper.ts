// ============================================================================
// colombia-time.helper — la hora de Colombia, en un solo lugar.
//
// El servidor de producción corre en UTC, así que `new Date()` NO es "hoy" para
// nadie del equipo: entre las 19:00 y la medianoche de Bogotá el servidor ya
// pasó de día. Todo lo que dependa del calendario (qué citas son de hoy, a qué
// hora dispara un worker) tiene que convertirse a UTC-5 primero.
//
// Colombia no tiene horario de verano, así que el offset fijo de -5 es exacto y
// no hace falta una librería de zonas horarias.
// ============================================================================

const OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Instante actual visto desde Colombia: la fecha del calendario (YYYY-MM-DD) y
 * los minutos transcurridos del día. Los minutos permiten comparar contra una
 * hora objetivo ("¿ya pasaron las 07:00?") sin construir otro Date.
 */
export function nowColombia(): { fecha: string; minutos: number } {
  const c = new Date(Date.now() - OFFSET_MS);
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, '0');
  const d = String(c.getUTCDate()).padStart(2, '0');
  return { fecha: `${y}-${m}-${d}`, minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
}

/**
 * Los dos instantes UTC que delimitan un día de Colombia: `[inicio, fin)`.
 * Medio abierto a propósito — con `< fin` no hay que preocuparse por los
 * milisegundos del último segundo del día.
 *
 * 2026-09-03 en Bogotá → ['2026-09-03T05:00:00.000Z', '2026-09-04T05:00:00.000Z')
 */
export function rangoDiaColombia(fecha: string): { inicioUtc: string; finUtc: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!m) throw new Error(`Fecha inválida (se esperaba YYYY-MM-DD): ${fecha}`);
  const [, y, mo, d] = m;
  const inicio = Date.UTC(Number(y), Number(mo) - 1, Number(d), 5, 0, 0, 0);
  return {
    inicioUtc: new Date(inicio).toISOString(),
    finUtc: new Date(inicio + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** "07:00" → 420. Devuelve `porDefecto` si el texto no es una hora válida. */
export function horaAMinutos(hhmm: string, porDefecto: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return porDefecto;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return porDefecto;
  return h * 60 + min;
}

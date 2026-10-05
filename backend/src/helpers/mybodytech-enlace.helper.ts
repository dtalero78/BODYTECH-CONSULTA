// ============================================================================
// Reglas del enlace orden MyBodytech ↔ cita de Trepsi (5-oct-2026).
//
// La persona recibe su orden por MyBodytech (crea una historia acá) y después
// agenda la consulta desde Trepsi (crea OTRA historia). El coach atiende y
// cierra la de Trepsi, y el RIPS —que solo buscaba la historia de MyBodytech—
// nunca salía. El enlace une las dos por cédula para que, al cerrar la de
// Trepsi, el RIPS salga con los datos de la orden de MyBodytech.
// ============================================================================

/**
 * Documento comparable: mayúsculas y solo letras/dígitos. Trepsi y MyBodytech
 * no escriben la cédula igual ("1.020.304", "1020304 ", "pa-123").
 */
export function normalizarDocumento(doc: string | null | undefined): string {
  return String(doc ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** La misma normalización en SQL, para comparar contra una columna. */
export function documentoSql(columna: string): string {
  return `regexp_replace(upper(COALESCE(${columna}, '')), '[^0-9A-Z]', '', 'g')`;
}

/**
 * Hasta cuántos días atrás se buscan órdenes/citas para enlazar. Una orden
 * vieja no se le cobra a una consulta que no tiene nada que ver.
 */
export function diasVentanaEnlace(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseInt(String(env.MYBODYTECH_ENLACE_DIAS ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/** Un documento demasiado corto enlazaría a cualquiera: no se intenta. */
export function documentoEnlazable(doc: string): boolean {
  return doc.length >= 5;
}

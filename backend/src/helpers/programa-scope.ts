// ============================================================================
// programa-scope — que la marca de programa filtre de verdad.
//
// `usuarios.programas` (trepsi / umv / corporativo / mybodytech / nativa) existe
// desde que cada cita lleva su `origen`, y la pantalla de Team deja marcarlo…
// pero hasta hoy no acotaba NADA: lo único que hacía era abrirle Digitalizar a
// un médico de la UMV. Por eso una coordinación externa marcada "Trepsi" veía
// también la agenda de la Unidad Médica Virtual y las valoraciones del médico
// corporativo (23-sep-2026, cuenta de Trepsi).
//
// Ahora es un filtro, con la misma forma que `sedeFilter`:
//
//   programas === undefined / []  → SIN filtro. Es el caso de casi todo el
//                                   mundo y hay que dejarlo así: una lista
//                                   vacía significa "no se le puso límite",
//                                   nunca "no ve nada".
//   programas === [..]            → solo las citas de esos programas.
//
// COALESCE a 'nativa' porque las filas viejas no tienen `origen`: una cita sin
// origen es de la agenda propia, que es de donde salían todas antes de que la
// columna existiera.
// ============================================================================

/** Los programas que existen. Mismo vocabulario que el `origen` de las citas. */
export const PROGRAMAS_VALIDOS = ['trepsi', 'umv', 'corporativo', 'mybodytech', 'nativa'] as const;

/**
 * Dos nombres para el mismo departamento. Las citas de la **Unidad Médica
 * Virtual** no llegan con `origen='umv'` —hay UNA en toda la base— sino por la
 * integración de MyBodytech, que escribe `origen='mybodytech'` (1.210 citas
 * desde el 1-sep-2026). Marcar "UMV" y no ver nada sería la forma más rápida de
 * que este filtro se desactive a los dos días.
 */
const EQUIVALENTES: Record<string, string[]> = {
  umv: ['umv', 'mybodytech'],
  mybodytech: ['mybodytech', 'umv'],
};

/**
 * Deja la lista en minúsculas y sin valores desconocidos. Devuelve `undefined`
 * cuando no queda ninguno — que es "sin límite", no "sin acceso".
 */
export function normalizarProgramas(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const limpios = raw
    .map((p) => String(p ?? '').trim().toLowerCase())
    .filter((p): p is string => (PROGRAMAS_VALIDOS as readonly string[]).includes(p));
  if (limpios.length === 0) return undefined;
  const conEquivalentes = limpios.flatMap((p) => EQUIVALENTES[p] ?? [p]);
  return Array.from(new Set(conEquivalentes));
}

/**
 * Cláusula SQL para acotar por programa. Hace push del array a `params` y
 * devuelve la cláusula ya con el índice correcto, igual que `sedeFilter`.
 */
export function programaFilter(
  programas: string[] | undefined,
  col: string,
  params: unknown[]
): string {
  const limpios = normalizarProgramas(programas);
  if (!limpios) return '';
  params.push(limpios);
  return ` AND LOWER(COALESCE(${col}, 'nativa')) = ANY($${params.length}::text[])`;
}

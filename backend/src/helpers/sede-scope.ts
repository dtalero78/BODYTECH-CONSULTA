// ============================================================================
// sede-scope — Filtro SQL de aislamiento por sede (multi-tenant) para PHI.
//
// Uso: el controller obtiene las sedes efectivas del actor con
// effectiveSedes(req) (rbac.middleware) y las pasa al servicio. El servicio
// llama a sedeFilter() para anexar la cláusula al WHERE.
//
//   sedes === undefined  → SIN filtro (admin / es_global ve todas las sedes).
//   sedes === []         → ninguna sede (bloquea todo; fail-safe).
//   sedes === [..]       → COALESCE(col,'bsl') = ANY($n::text[]).
//
// COALESCE con 'bsl' porque las filas legacy tienen sede_id NULL/'bsl'.
// La función hace push del array a `params` y devuelve la cláusula con el
// índice de parámetro correcto.
// ============================================================================

export function sedeFilter(
  sedes: string[] | undefined,
  col: string,
  params: unknown[]
): string {
  if (sedes === undefined) return '';
  params.push(sedes);
  return ` AND COALESCE(${col}, 'bsl') = ANY($${params.length}::text[])`;
}

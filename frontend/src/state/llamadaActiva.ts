// ============================================================================
// llamadaActiva — ¿hay una videollamada en curso en esta pestaña?
//
// Vivía dentro de `TemaBodyVibe`, que es quien la estrenó (para retirar la
// apariencia mientras se atiende). Ahora la consulta también el interceptor que
// cierra la sesión vencida, y ese no puede importar un componente de React sin
// armar un ciclo: componente → servicio → componente.
//
// Así que la bandera queda acá, sin dependencias, y la leen los dos.
// ============================================================================

/**
 * Cuántas videollamadas hay montadas ahora mismo. Es un contador y no un
 * booleano porque durante una transición pueden convivir dos brevemente; con un
 * booleano, la que se desmonta apagaría la bandera de la que sigue viva.
 */
let llamadasActivas = 0;
const suscriptores = new Set<(enLlamada: boolean) => void>();

/** Lo llama `VideoRoom` al montarse y al desmontarse. */
export function marcarLlamadaActiva(activa: boolean): void {
  llamadasActivas = Math.max(0, llamadasActivas + (activa ? 1 : -1));
  const enLlamada = llamadasActivas > 0;
  suscriptores.forEach((f) => f(enLlamada));
}

export function hayLlamadaActiva(): boolean {
  return llamadasActivas > 0;
}

/** Devuelve la función para darse de baja. */
export function suscribirLlamada(fn: (enLlamada: boolean) => void): () => void {
  suscriptores.add(fn);
  return () => {
    suscriptores.delete(fn);
  };
}

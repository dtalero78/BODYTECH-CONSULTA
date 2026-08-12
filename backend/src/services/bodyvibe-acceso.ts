// ============================================================================
// bodyvibe-acceso — Quién puede CONSTRUIR apps.
//
// Distinto de quién puede VERLOS. Ver un app publicado lo decide su audiencia
// (rol + sede). Construirlos, en esta fase, está limitado a una lista corta de
// personas, y la razón es económica antes que técnica: BodyVibeTech usa la
// misma llave de Anthropic que el resto de la plataforma, con un tope de gasto
// compartido. Cada generación consume de ese mismo cupo.
//
// El rol `admin` no alcanza como criterio: puede haber varios administradores y
// bastaría que dos exploraran a la vez para comerse el presupuesto del mes.
//
// La lista vive en `BODYVIBE_CONSTRUCTORES` (correos separados por coma) y no
// en el código: sumar a alguien es cambiar una variable de entorno, no abrir un
// editor y desplegar.
// ============================================================================

/** Si nadie configuró la variable, solo el autor. */
const POR_DEFECTO = ['danieltalero78@gmail.com'];

function lista(): string[] {
  const crudo = process.env.BODYVIBE_CONSTRUCTORES;
  if (!crudo) return POR_DEFECTO;
  const correos = crudo
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // Una variable presente pero vacía no debe abrir la puerta a todos: eso es
  // exactamente el tipo de error de configuración que se descubre con la
  // factura del mes.
  return correos.length > 0 ? correos : POR_DEFECTO;
}

export function puedeConstruir(email: string | null | undefined): boolean {
  if (!email) return false;
  return lista().includes(email.trim().toLowerCase());
}

export function constructores(): string[] {
  return lista();
}

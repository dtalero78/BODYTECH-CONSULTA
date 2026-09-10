// ============================================================================
// digitalizar-acceso — Quién puede usar "Digitalizar".
//
// Digitalizar muestra nombres, cédulas y teléfonos de afiliados de MyBodytech,
// y es una herramienta de UNA coordinación: la de la UMV. `requireRole('admin',
// 'coordinador')` la abría a todos los coordinadores de todos los programas
// —Trepsi, corporativo, UMV—, que no es lo que se pidió.
//
// El alcance de la sesión es por SEDE, no por programa, así que "coordinador de
// la UMV" no se puede deducir de ella: se nombra. La lista vive en
// `DIGITALIZAR_PERMITIDOS` (correos separados por coma), igual que
// `BODYVIBE_CONSTRUCTORES`: sumar o sacar a alguien es cambiar una variable de
// entorno, no desplegar.
//
// La regla vive SOLO acá. El panel le pregunta al backend
// (`GET /api/digitalizar/acceso`) si dibuja la pestaña, en vez de tener su
// propia copia de la lista: una segunda copia es una copia que se desactualiza.
// ============================================================================

/** Si nadie configuró la variable, solo el autor. Nunca "todos". */
const POR_DEFECTO = ['danieltalero78@gmail.com'];

function lista(): string[] {
  const crudo = process.env.DIGITALIZAR_PERMITIDOS;
  if (!crudo) return POR_DEFECTO;
  const correos = crudo
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // Una variable presente pero vacía no debe abrir la puerta a todos: es un
  // error de configuración, no una decisión.
  return correos.length > 0 ? correos : POR_DEFECTO;
}

export function puedeDigitalizar(email: string | null | undefined): boolean {
  if (!email) return false;
  return lista().includes(email.trim().toLowerCase());
}

// ============================================================================
// digitalizar-acceso — Quién puede usar "Digitalizar".
//
// Digitalizar muestra nombres, cédulas y teléfonos de afiliados de MyBodytech,
// y es una herramienta de la UMV. `requireRole` solo la abriría a todos los
// coordinadores de todos los programas —Trepsi, corporativo, UMV—, que no es lo
// que se pidió. Entran dos grupos:
//
//  1) La coordinación, NOMBRADA. El alcance de la sesión es por SEDE, no por
//     programa, así que "coordinador de la UMV" no se deduce de ella: la lista
//     vive en `DIGITALIZAR_PERMITIDOS` (correos separados por coma), igual que
//     `BODYVIBE_CONSTRUCTORES`. Sumar o sacar a alguien es cambiar una variable
//     de entorno, no desplegar.
//
//  2) Los MÉDICOS del programa UMV, desde su panel de atención (pedido el
//     15-sep-2026). Ahí sí hay de dónde deducirlo: `usuarios.programas`. Se lee
//     de la base y no del token porque la sesión no lo trae, y porque así quitar
//     a alguien del programa le quita el acceso sin esperar a que vuelva a
//     iniciar sesión.
//
// La regla vive SOLO acá. Los paneles le preguntan al backend
// (`GET /api/digitalizar/acceso`) si dibujan el botón, en vez de tener su
// propia copia: una segunda copia es una copia que se desactualiza.
// ============================================================================

import postgresService from './postgres.service';
import type { SessionPayload } from './auth.service';

/** Si nadie configuró la variable, solo el autor. Nunca "todos". */
const POR_DEFECTO = ['danieltalero78@gmail.com'];

/** El programa cuyos médicos usan Digitalizar desde su panel. */
const PROGRAMA_MEDICOS = 'umv';

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

/** ¿Está este correo en la lista de la coordinación? */
export function puedeDigitalizar(email: string | null | undefined): boolean {
  if (!email) return false;
  return lista().includes(email.trim().toLowerCase());
}

/** ¿Un médico con estos programas usa Digitalizar? Puro, para poder probarlo. */
export function esMedicoDelPrograma(rol: string | null | undefined, programas: unknown): boolean {
  if (rol !== 'medico' || !Array.isArray(programas)) return false;
  return programas.some((p) => String(p).trim().toLowerCase() === PROGRAMA_MEDICOS);
}

/**
 * La regla completa para una sesión: la lista de la coordinación, o médico del
 * programa UMV con cuenta activa. Si la base no responde, no: ante la duda no se
 * muestran cédulas.
 */
export async function puedeDigitalizarSesion(session: SessionPayload | undefined): Promise<boolean> {
  if (!session) return false;
  if (puedeDigitalizar(session.email)) return true;
  if (session.role !== 'medico') return false;
  const filas = await postgresService.query(
    'SELECT rol, programas FROM usuarios WHERE id = $1 AND activo = TRUE',
    [session.userId],
  );
  const u = filas?.[0];
  return Boolean(u) && esMedicoDelPrograma(u.rol, u.programas);
}

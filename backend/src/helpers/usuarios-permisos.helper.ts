// ============================================================================
// usuarios-permisos — Quién puede crear, editar y ver a quién.
//
// Vive aparte de la ruta y sin dependencias porque es la parte del panel de
// usuarios que, si se equivoca, se equivoca en silencio: nadie ve un error, un
// coordinador simplemente puede más de lo que debe. Puro y probado.
//
// El modelo es el que ya aplicaba el panel anterior de Consulta, trasladado al
// panel único:
//
//   ADMIN        — todo, en las tres aplicaciones.
//   COORDINADOR  — sólo Consulta, sólo roles no privilegiados (médico, coach,
//                  auxiliar), sólo SUS sedes, nunca «todas las sedes», nunca la
//                  baja de la organización, y sólo sobre personas que ya caen
//                  dentro de ese alcance.
//
// Dos reglas aplican a TODOS, admin incluido, porque no son de privilegio sino
// de que la cuenta sirva: un médico o coach sin ficha de profesional entra y no
// puede agendar, y un usuario de Consulta sin sedes no ve nada.
// ============================================================================

/** Roles que un coordinador puede repartir. Nunca admin ni coordinador. */
export const ROLES_GESTIONABLES_COORD = ['medico', 'coach', 'auxiliar'] as const;

/** Roles de Consulta que exigen ficha de profesional. */
export const ROLES_CLINICOS = ['medico', 'coach'] as const;

export interface Actor {
  role: string;
  email: string;
  sedes: string[];
}

/** La persona sobre la que se actúa, vista desde su acceso a Consulta. */
export interface Destino {
  email: string;
  rolConsulta: string | null;
  sedes: string[];
}

export type Rechazo = {
  code: 'FORBIDDEN' | 'PROFESIONAL_REQUERIDO' | 'SEDES_REQUERIDAS';
  message: string;
};

const no = (code: Rechazo['code'], message: string): Rechazo => ({ code, message });

const esAdmin = (a: Actor | null | undefined): boolean => a?.role === 'admin';

const gestionable = (rol: string | null): boolean =>
  !!rol && (ROLES_GESTIONABLES_COORD as readonly string[]).includes(rol);

const dentroDelAlcance = (actor: Actor | null | undefined, sedes: string[]): boolean =>
  sedes.every((s) => (actor?.sedes ?? []).includes(s));

const mismaPersona = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface Alta {
  app: string;
  rol: string;
  esGlobal?: boolean;
  sedes?: string[];
  profesionalId?: number | null;
}

/** `null` si el alta puede seguir; si no, por qué no. */
export function revisarAlta(actor: Actor | null | undefined, d: Alta): Rechazo | null {
  if (!esAdmin(actor)) {
    if (d.app !== 'consulta')
      return no('FORBIDDEN', 'Sólo un administrador crea usuarios de las otras aplicaciones.');
    if (!gestionable(d.rol)) return no('FORBIDDEN', 'No puedes crear usuarios con ese rol.');
    if (d.esGlobal)
      return no('FORBIDDEN', 'Sólo un administrador puede dar acceso a todas las sedes.');
    if (!dentroDelAlcance(actor, d.sedes ?? []))
      return no('FORBIDDEN', 'No puedes asignar sedes fuera de tu alcance.');
  }
  if (d.app === 'consulta') {
    if ((ROLES_CLINICOS as readonly string[]).includes(d.rol) && d.profesionalId == null)
      return no(
        'PROFESIONAL_REQUERIDO',
        'Un médico o coach debe quedar vinculado a su ficha de profesional.',
      );
    if (!d.esGlobal && (d.sedes ?? []).length === 0)
      return no('SEDES_REQUERIDAS', 'Asigna al menos una sede.');
  }
  return null;
}

export interface Edicion {
  app?: string;
  rol?: string;
  activo?: boolean;
  esGlobal?: boolean;
  sedes?: string[];
}

/** `null` si la edición puede seguir; si no, por qué no. */
export function revisarEdicion(
  actor: Actor | null | undefined,
  destino: Destino,
  d: Edicion,
): Rechazo | null {
  // Aplica a todos: quien se inhabilita a sí mismo queda afuera sin poder volver.
  if (d.activo === false && mismaPersona(actor?.email, destino.email))
    return no('FORBIDDEN', 'No puedes inhabilitar tu propia cuenta.');

  if (esAdmin(actor)) return null;

  if (!gestionable(destino.rolConsulta) || !dentroDelAlcance(actor, destino.sedes))
    return no('FORBIDDEN', 'No puedes gestionar a este usuario.');
  if (d.app && d.app !== 'consulta')
    return no('FORBIDDEN', 'Sólo un administrador toca las otras aplicaciones.');
  if (d.rol && !gestionable(d.rol)) return no('FORBIDDEN', 'No puedes asignar ese rol.');
  if (d.esGlobal)
    return no('FORBIDDEN', 'Sólo un administrador puede dar acceso a todas las sedes.');
  if (!dentroDelAlcance(actor, d.sedes ?? []))
    return no('FORBIDDEN', 'No puedes asignar sedes fuera de tu alcance.');
  return null;
}

/**
 * ¿Esta persona sale en el listado del actor? El directorio completo —quién
 * trabaja en ACC, quién es admin— no es asunto de un coordinador.
 */
export function visibleEnListado(actor: Actor | null | undefined, destino: Destino): boolean {
  if (esAdmin(actor)) return true;
  if (!gestionable(destino.rolConsulta)) return false;
  // Sin sedes no hay forma de saber si cae en su alcance: no se muestra.
  return destino.sedes.length > 0 && dentroDelAlcance(actor, destino.sedes);
}

/** La baja saca de las TRES aplicaciones: es de la organización, no de una sede. */
export function puedeDarDeBaja(actor: Actor | null | undefined): boolean {
  return esAdmin(actor);
}

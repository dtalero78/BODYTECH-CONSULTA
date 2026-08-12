// ============================================================================
// bodyvibe-huella.service — Qué datos toca un app, resumido en una huella.
//
// Es el mecanismo de la decisión 06: los cambios de pura apariencia se
// republican solos, y cualquier cambio en QUÉ DATOS consulta vuelve a
// aprobación.
//
// Sin esto el atajo es evidente y no hace falta mala fe para tomarlo: se aprueba
// un tablero inofensivo, al día siguiente alguien le pide "y ahora mostrame
// también los teléfonos", y eso queda publicado sin que nadie lo mire.
//
// La huella resume dos cosas del código:
//
//   · Qué estantes menciona (`bv_citas`, `bv_cobertura`, …).
//   · Qué consultas hace — el texto de cada SQL, normalizado.
//
// Cambiar un color, un título o el orden de las columnas en pantalla no mueve
// la huella. Agregar una columna al SELECT, cambiar un filtro o tocar otro
// estante, sí.
//
// LÍMITE CONOCIDO Y ACEPTADO: la huella se calcula leyendo el texto del código,
// no ejecutándolo. Un app que arme el SQL concatenando pedazos en tiempo de
// ejecución puede cambiar lo que consulta sin mover la huella. No es una
// defensa contra alguien decidido a engañarla — es una red contra el descuido,
// que es de lo que se trata el 99% de los casos. La defensa dura contra el
// acceso indebido son los GRANT del rol de solo lectura: aunque un app cambie
// su SQL, no puede leer nada que no esté en los estantes.
// ============================================================================

import crypto from 'crypto';

export interface HuellaDatos {
  /** Estantes que el código menciona, ordenados y sin repetir. */
  estantes: string[];
  /** Las consultas que el código trae escritas, normalizadas. */
  sqls: string[];
  /** Resumen estable de estantes + consultas. */
  huella: string;
}

/**
 * Normaliza una consulta para que un cambio de sangría o de saltos de línea no
 * cuente como un cambio de datos. Lo que importa es qué pide, no cómo se ve.
 */
function normalizarSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Normaliza igual que la huella, para comparar una consulta entrante contra las
 * que el app traía escritas cuando se aprobó.
 */
export function normalizarParaComparar(sql: string): string {
  return normalizarSql(sql);
}

export function calcularHuella(codigo: string): HuellaDatos {
  // Estantes mencionados en cualquier parte del código.
  const estantes = [...new Set([...codigo.matchAll(/\bbv_[a-z_]+\b/g)].map((m) => m[0]))].sort();

  // Literales de texto que parecen consultas. Se cubren las tres formas de
  // escribir una cadena en JavaScript, incluida la plantilla, que es la que el
  // modelo usa casi siempre para un SQL de varias líneas.
  const literales = [
    ...codigo.matchAll(/`((?:[^`\\]|\\.)*)`/g),
    ...codigo.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
    ...codigo.matchAll(/"((?:[^"\\\n]|\\.)*)"/g),
  ]
    .map((m) => m[1])
    .filter((t) => /\bselect\b/i.test(t) && /\bfrom\b/i.test(t))
    .map(normalizarSql)
    .sort();

  const huella = crypto
    .createHash('sha256')
    .update(estantes.join('|'))
    .update('\n--\n')
    .update(literales.join('\n'))
    .digest('hex')
    .slice(0, 32);

  return { estantes, sqls: literales, huella };
}

/**
 * ¿Este cambio necesita volver a aprobación?
 *
 * Sí cuando cambia lo que consulta o a quién se le muestra. No cuando solo
 * cambió cómo se ve — que es lo que más se itera y lo que menos riesgo tiene.
 */
export function requiereAprobacion(
  aprobada: {
    huella: string | null;
    alcance: string;
    roles: string[];
    sedes: string[];
    anclaje?: string | null;
  } | null,
  nueva: {
    huella: string;
    alcance: string;
    roles: string[];
    sedes: string[];
    anclaje?: string | null;
  }
): { requiere: boolean; motivo: string | null } {
  if (!aprobada || !aprobada.huella) {
    return { requiere: true, motivo: 'Es la primera publicación de este app.' };
  }
  if (aprobada.huella !== nueva.huella) {
    return { requiere: true, motivo: 'Cambió qué datos consulta.' };
  }
  if (aprobada.alcance !== nueva.alcance) {
    return { requiere: true, motivo: 'Cambió el alcance de publicación.' };
  }

  const igual = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

  if (!igual(aprobada.roles, nueva.roles) || !igual(aprobada.sedes, nueva.sedes)) {
    return { requiere: true, motivo: 'Cambió quién puede verlo.' };
  }

  // Mover un app de una pantalla a otra cambia quién se lo encuentra de frente,
  // aunque el rol y la sede sean los mismos. Un tablero aprobado para vivir al
  // pie de Indicadores no está aprobado para aparecer dentro del panel médico.
  if ((aprobada.anclaje ?? null) !== (nueva.anclaje ?? null)) {
    return { requiere: true, motivo: 'Cambió en qué pantalla aparece.' };
  }

  return { requiere: false, motivo: null };
}

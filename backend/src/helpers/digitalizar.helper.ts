// ============================================================================
// digitalizar.helper — Limpieza y cruce de lo que los modelos leen de un
// pantallazo de "Citas asignadas" de MyBodytech. Todo puro, sin red ni base:
// lo que devuelve un modelo no se escribe en la base sin pasar por acá.
//
// Dos problemas distintos:
//  1) Formato. El modelo devuelve la hora como "08:06 AM", la cédula con
//     puntos, el teléfono con el prefijo "N. Teléfono" → `limpiarFilas`.
//  2) Dígitos. Aun con la imagen sin reducir, un modelo cambia un dígito de
//     vez en cuando, y una cédula con un dígito cambiado abre la ficha de OTRA
//     persona. Por eso cada franja la leen dos modelos y se cruzan →
//     `consolidarLecturas`. Donde coinciden, la fila es confiable; donde no,
//     queda marcada para que el coordinador la verifique.
// ============================================================================

import { normalizarDocumento, normalizarNombre } from './padron.helper';

/**
 * La ficha del afiliado en MyBodytech. Es la misma URL a la que llega el
 * buscador de "Afiliados" por documento — sólo cambia lo que va después del
 * `filter=`. Se verificó en vivo con Karen Ariza el 10-sep-2026.
 */
const MYBODYTECH_FICHA = 'https://mybodytech.co/general-list?page=1&filter=';

export function urlMyBodytech(numeroId: string): string {
  return MYBODYTECH_FICHA + encodeURIComponent(numeroId);
}

export interface CitaLeida {
  hora: string | null;
  sede: string | null;
  tipo: string | null;
  nombre: string;
  numeroId: string;
  telefono: string | null;
  modalidad: string | null;
  estado: string | null;
}

export type CampoDudoso = 'numeroId' | 'telefono';

export interface CitaConsolidada extends CitaLeida {
  /** Campos en los que las lecturas no coincidieron (o sólo hubo una). */
  dudas: CampoDudoso[];
  /** Las otras lecturas de esos campos, para mostrarlas al lado. */
  alternativas: Partial<Record<CampoDudoso, string[]>>;
}

/**
 * "08:06 AM", "8:06 a. m.", "02:40 PM", "14:40" → "HH:MM" en 24 h.
 * `null` si no es una hora: mejor una celda vacía que una hora inventada.
 */
export function normalizarHora(raw: unknown): string | null {
  const s = String(raw ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const m = s.match(/^(\d{1,2})[:.h](\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const sufijo = m[3]?.replace(/[\s.]/g, '');
  if (sufijo === 'pm' && h < 12) h += 12;
  if (sufijo === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** Sólo dígitos. Un teléfono de menos de 7 no es un teléfono: se descarta. */
export function normalizarTelefono(raw: unknown): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length >= 7 ? d : null;
}

function texto(raw: unknown, max = 200): string | null {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Una cédula colombiana tiene entre 5 y 11 dígitos (las TI y los pasaportes
 * numéricos caen en el mismo rango). Fuera de eso es casi seguro un mal
 * leído — p. ej. la hora o el teléfono puestos en la columna equivocada.
 */
const DOC_MIN = 5;
const DOC_MAX = 11;

/**
 * Del JSON crudo de UN modelo a filas que se pueden guardar.
 *
 * Descarta —y cuenta— las filas sin cédula válida o sin nombre: sin cédula no
 * hay a dónde llevar al coordinador en MyBodytech, que es para lo que existe
 * esta pantalla. Si la misma cédula aparece dos veces se queda la primera.
 */
export function limpiarFilas(raw: unknown): { filas: CitaLeida[]; descartadas: number } {
  const lista =
    raw && typeof raw === 'object' && Array.isArray((raw as { citas?: unknown }).citas)
      ? ((raw as { citas: unknown[] }).citas)
      : [];

  const filas: CitaLeida[] = [];
  const vistas = new Set<string>();
  let descartadas = 0;

  for (const item of lista) {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const numeroId = normalizarDocumento(String(r.numero_id ?? ''));
    const nombre = texto(r.nombre);
    if (!nombre || numeroId.length < DOC_MIN || numeroId.length > DOC_MAX) {
      descartadas++;
      continue;
    }
    if (vistas.has(numeroId)) continue;
    vistas.add(numeroId);
    filas.push({
      hora: normalizarHora(r.hora),
      sede: texto(r.sede, 120),
      tipo: texto(r.tipo, 80),
      nombre,
      numeroId,
      telefono: normalizarTelefono(r.telefono),
      modalidad: texto(r.modalidad, 40)?.toLowerCase() ?? null,
      estado: texto(r.estado, 40),
    });
  }
  return { filas, descartadas };
}

// ----------------------------------------------------------------------------
// Cruce de lecturas
// ----------------------------------------------------------------------------

/** Lo que leyó un modelo de una franja. `prioridad` 0 es el modelo preferido. */
export interface Lectura {
  prioridad: number;
  filas: CitaLeida[];
}

type Fila = CitaLeida & { prioridad: number; tk: Set<string> };

function tokens(nombre: string): Set<string> {
  return new Set(normalizarNombre(nombre).split(' ').filter(Boolean));
}

/** Dos lecturas del mismo nombre: comparten al menos dos palabras (o todas, si es más corto). */
function comparten(a: Set<string>, b: Set<string>): boolean {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n > 0 && n >= Math.min(2, a.size, b.size);
}

function contiene(grande: Set<string>, chico: Set<string>): boolean {
  for (const t of chico) if (!grande.has(t)) return false;
  return true;
}

/** El valor más leído; en empate, el del modelo preferido (llegan en ese orden). */
function votar(valores: Array<string | null>): { ganador: string | null; votos: number; otros: string[] } {
  const conteo = new Map<string, number>();
  for (const v of valores) if (v) conteo.set(v, (conteo.get(v) ?? 0) + 1);
  const orden = [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  return {
    ganador: orden[0]?.[0] ?? null,
    votos: orden[0]?.[1] ?? 0,
    otros: orden.slice(1).map(([v]) => v),
  };
}

function consolidarGrupo(grupo: Fila[]): CitaConsolidada {
  // La fila cortada por el borde de una franja trae el nombre a medias y la
  // cédula incompleta. No vota: votan sólo las lecturas del nombre completo.
  const ordenadas = [...grupo].sort((a, b) => b.tk.size - a.tk.size || a.prioridad - b.prioridad);
  const completas = ordenadas.filter((f) => f.tk.size === ordenadas[0].tk.size);

  const doc = votar(completas.map((f) => f.numeroId));
  const tel = votar(completas.map((f) => f.telefono));
  const dudas: CampoDudoso[] = [];
  const alternativas: CitaConsolidada['alternativas'] = {};
  // Una sola lectura no alcanza para confiar: nadie la corroboró.
  if (doc.otros.length > 0 || doc.votos < 2) {
    dudas.push('numeroId');
    if (doc.otros.length > 0) alternativas.numeroId = doc.otros;
  }
  if (tel.ganador && (tel.otros.length > 0 || tel.votos < 2)) {
    dudas.push('telefono');
    if (tel.otros.length > 0) alternativas.telefono = tel.otros;
  }

  const primero = (k: 'sede' | 'tipo' | 'modalidad' | 'estado'): string | null =>
    completas.find((f) => f[k] !== null)?.[k] ?? null;

  return {
    hora: votar(completas.map((f) => f.hora)).ganador,
    sede: primero('sede'),
    tipo: primero('tipo'),
    nombre: completas[0].nombre,
    numeroId: doc.ganador as string,
    telefono: tel.ganador,
    modalidad: primero('modalidad'),
    estado: primero('estado'),
    dudas,
    alternativas,
  };
}

/**
 * Junta las lecturas de todas las franjas y todos los modelos de UN pantallazo
 * en una fila por persona.
 *
 * Dos lecturas son la misma persona si traen la misma cédula, o la misma hora
 * y el mismo nombre (aunque el modelo haya escrito "yosmin" por "yasmin"). Una
 * fila cortada que perdió la hora se pega al único grupo que contiene su nombre;
 * si hay más de uno, se deja sola antes que juntar a dos personas.
 */
export function consolidarLecturas(lecturas: Lectura[]): CitaConsolidada[] {
  const filas: Fila[] = lecturas.flatMap((l) =>
    l.filas.map((f) => ({ ...f, prioridad: l.prioridad, tk: tokens(f.nombre) })),
  );
  const padre = filas.map((_, i) => i);
  const raiz = (i: number): number => (padre[i] === i ? i : (padre[i] = raiz(padre[i])));
  const unir = (a: number, b: number): void => {
    padre[raiz(a)] = raiz(b);
  };

  for (let i = 0; i < filas.length; i++) {
    for (let j = i + 1; j < filas.length; j++) {
      const a = filas[i];
      const b = filas[j];
      if (a.numeroId === b.numeroId || (a.hora !== null && a.hora === b.hora && comparten(a.tk, b.tk))) {
        unir(i, j);
      }
    }
  }

  for (let i = 0; i < filas.length; i++) {
    const a = filas[i];
    if (a.hora !== null || a.tk.size < 2) continue;
    if (filas.some((_, j) => j !== i && raiz(j) === raiz(i))) continue;
    const candidatos = new Set<number>();
    filas.forEach((b, j) => {
      if (raiz(j) !== raiz(i) && contiene(b.tk, a.tk)) candidatos.add(raiz(j));
    });
    if (candidatos.size === 1) unir(i, [...candidatos][0]);
  }

  const grupos = new Map<number, Fila[]>();
  filas.forEach((f, i) => {
    const r = raiz(i);
    const g = grupos.get(r);
    if (g) g.push(f);
    else grupos.set(r, [f]);
  });

  return [...grupos.values()]
    .map(consolidarGrupo)
    .sort((a, b) => (a.hora ?? '99').localeCompare(b.hora ?? '99') || a.nombre.localeCompare(b.nombre));
}

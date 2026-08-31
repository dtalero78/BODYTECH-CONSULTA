import type { MedicalHistoryFull } from '../types';

/**
 * Un campo que cuenta para la completitud de una sección.
 *
 * `opcional` marca los que el equipo médico declaró que muchas veces no se
 * diligencian a propósito (saturación de oxígeno, frecuencia respiratoria,
 * perímetro abdominal). Siguen apareciendo en el formulario, pero no engordan
 * el denominador: antes una historia bien hecha se veía incompleta para siempre
 * porque el contador exigía campos que nadie iba a llenar.
 */
export interface CampoCompletitud {
  label: string;
  value: unknown;
  opcional?: boolean;
}

export interface ResumenCompletitud {
  /** Campos obligatorios diligenciados. */
  llenos: number;
  /** Total de campos obligatorios. */
  total: number;
  /** Etiquetas de los obligatorios que faltan, en el orden del formulario. */
  faltantes: string[];
  pct: number;
}

/**
 * `true` cuando el campo tiene un valor real. Un booleano en `false` cuenta como
 * diligenciado (es una respuesta: "niega"); `null`/`undefined` no, porque
 * significa que nadie lo respondió todavía.
 */
export function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

export function resumirCompletitud(campos: ReadonlyArray<CampoCompletitud>): ResumenCompletitud {
  const obligatorios = campos.filter((c) => !c.opcional);
  const faltantes = obligatorios.filter((c) => !tieneValor(c.value)).map((c) => c.label);
  const total = obligatorios.length;
  const llenos = total - faltantes.length;
  return { llenos, total, faltantes, pct: total === 0 ? 100 : Math.round((llenos / total) * 100) };
}

/**
 * Texto para el subtítulo de un Card: dice CUÁLES faltan, no sólo cuántos.
 * El equipo médico reportó que veía una sección incompleta sin forma de saber
 * qué le faltaba por diligenciar.
 */
export function textoFaltantes(r: ResumenCompletitud, vacio = 'Sin información'): string {
  if (r.total === 0) return vacio;
  if (r.faltantes.length === 0) return 'Completo';
  if (r.llenos === 0) return vacio;
  const max = 3;
  const lista = r.faltantes.slice(0, max).join(', ');
  const resto = r.faltantes.length - max;
  return resto > 0 ? `Falta: ${lista} y ${resto} más` : `Falta: ${lista}`;
}

export type { MedicalHistoryFull };

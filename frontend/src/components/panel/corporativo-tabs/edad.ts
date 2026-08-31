import type { MedicalHistoryFull } from '../types';

/** Edad en años cumplidos a partir de una fecha de nacimiento. */
export function calcularEdad(fecha: unknown): number | null {
  if (!fecha) return null;
  const d = fecha instanceof Date ? fecha : new Date(String(fecha));
  if (isNaN(d.getTime())) return null;
  const hoy = new Date();
  let edad = hoy.getFullYear() - d.getFullYear();
  const m = hoy.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < d.getDate())) edad--;
  return edad >= 0 && edad < 130 ? edad : null;
}

/**
 * Edad efectiva del afiliado: la derivada de la fecha de nacimiento diligenciada
 * en Identificación y, sólo si no hay fecha, la que traiga la ficha.
 *
 * Vive aquí porque la usan dos tabs: Identificación (la muestra) y Examen
 * físico (la necesita para la FC predicha de Tanaka). Antes el examen leía solo
 * `data.edad`, así que en historias sin ese campo la FC predicha quedaba vacía
 * sin que se entendiera por qué.
 */
export function edadEfectiva(data: MedicalHistoryFull | null): number | null {
  // La fecha de nacimiento manda sobre `data.edad`: `edad` viene de la ficha del
  // afiliado y es un dato congelado, mientras que la fecha es el campo que el
  // médico edita en Identificación. Con la precedencia al revés, corregir la
  // fecha no movía la edad mostrada — que es justo lo que reportó el equipo.
  const derivada = calcularEdad(data?.fechaNacimiento);
  if (derivada !== null) return derivada;
  if (typeof data?.edad === 'number' && !isNaN(data.edad)) return data.edad;
  return null;
}

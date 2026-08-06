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
 * Edad efectiva del afiliado: la que trae la ficha si existe, o la derivada de
 * la fecha de nacimiento diligenciada en Identificación.
 *
 * Vive aquí porque la usan dos tabs: Identificación (la muestra) y Examen
 * físico (la necesita para la FC predicha de Tanaka). Antes el examen leía solo
 * `data.edad`, así que en historias sin ese campo la FC predicha quedaba vacía
 * sin que se entendiera por qué.
 */
export function edadEfectiva(data: MedicalHistoryFull | null): number | null {
  if (typeof data?.edad === 'number' && !isNaN(data.edad)) return data.edad;
  return calcularEdad(data?.fechaNacimiento);
}

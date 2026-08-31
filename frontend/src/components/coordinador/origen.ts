/**
 * Departamento / vía de entrada de una cita u orden.
 *
 * Sale de la columna `origen` de `HistoriaClinica`, que cada vía escribe al crear
 * la historia (la API de Trepsi, la de MyBodytech, y el agendamiento propio).
 *
 * Antes cada vista lo deducía por su cuenta y con reglas distintas: Afiliados
 * miraba el prefijo del `_id` (`trepsi_`) y el calendario miraba `sede_id`. Las
 * dos divergieron — las historias de MyBodytech llevan prefijo `mbt_`, así que
 * Afiliados las mostraba como "Nativa", indistinguibles de las propias.
 *
 * Vive en su propio módulo (y no dentro de una vista) porque lo consumen tanto
 * el calendario como Afiliados.
 */
export type Origen = 'trepsi' | 'umv' | 'mybodytech' | 'nativa';

const VALIDOS: ReadonlyArray<Origen> = ['trepsi', 'umv', 'mybodytech', 'nativa'];

/**
 * Resuelve el origen de una fila. Manda la columna `origen`; el prefijo del
 * `_id` queda sólo como respaldo para filas anteriores al backfill.
 */
export function resolverOrigen(origen: string | null | undefined, id: string | null | undefined): Origen {
  const v = (origen ?? '').toLowerCase() as Origen;
  if (VALIDOS.includes(v)) return v;
  if (typeof id === 'string' && id.startsWith('trepsi_')) return 'trepsi';
  if (typeof id === 'string' && id.startsWith('mbt_')) return 'mybodytech';
  return 'nativa';
}

/**
 * Etiqueta y colores del chip por origen. `nativa` va sin chip: es el caso por
 * defecto y marcarlo sólo agregaría ruido a la mayoría de las filas.
 */
export const ORIGEN_META: Record<Origen, { label: string; cls: string } | null> = {
  trepsi: { label: 'Trepsi', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  umv: { label: 'UMV', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  mybodytech: { label: 'MyBodytech', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  nativa: null,
};

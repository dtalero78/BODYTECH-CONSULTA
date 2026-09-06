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
/**
 * UMV y Médico Corporativo son departamentos DISTINTOS, aunque durante un
 * tiempo compartieron el valor 'umv': el origen se deducía de la especialidad
 * de quien atendía, así que una cita quedaba marcada como UMV justamente
 * cuando la atendía un médico corporativo. El directorio compartido de la
 * cadena ya los separa por `ambito` ('virtual' vs 'corporativo').
 *
 * UMV        → teleconsulta de la Unidad Médica Virtual.
 * corporativo → examen ocupacional presencial del Médico Corporativo.
 */
export type Origen = 'trepsi' | 'umv' | 'corporativo' | 'mybodytech' | 'nativa';

const VALIDOS: ReadonlyArray<Origen> = ['trepsi', 'umv', 'corporativo', 'mybodytech', 'nativa'];

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
  corporativo: { label: 'Corporativo', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  mybodytech: { label: 'MyBodytech', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  nativa: null,
};

/**
 * Departamentos que el formulario de agendamiento puede elegir. Espeja
 * `ORIGENES_AGENDABLES` del backend: 'trepsi' y 'mybodytech' quedan fuera
 * porque los escribe cada integración al recibir la cita por su propia API.
 */
export const ORIGENES_AGENDABLES: ReadonlyArray<{ value: Exclude<Origen, 'trepsi' | 'mybodytech'>; label: string }> = [
  { value: 'nativa', label: 'Agenda propia' },
  { value: 'umv', label: 'UMV · Unidad Médica Virtual' },
  { value: 'corporativo', label: 'Médico Corporativo' },
];

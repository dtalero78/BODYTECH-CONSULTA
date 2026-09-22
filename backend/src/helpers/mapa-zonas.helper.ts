// ============================================================================
// mapa-zonas.helper — ¿en qué local del Mapa de Rutas cae una consulta?
//
// El mapa dibuja la sección SERVICIOS MÉDICOS del edificio Bodytech con dos
// áreas (boceto de Daniel, 21-sep-2026):
//
//   Servicios complementarios → Coach Nutrición Trepsi · Nutrición presencial · ACC
//   Servicios deportivos      → Unidad Médica Virtual · Médico Corporativo
//
// Solo tres de esos cinco locales tienen conteo desde esta base:
//   · Nutrición presencial no se distingue en los datos de una cita de Trepsi.
//   · ACC vive en otra app, con su propia base.
//
// Una sola regla para las dos fuentes del mapa (la sala de video en curso y los
// conteos del día), para que "ahora" y "hoy" nunca clasifiquen distinto.
// Función PURA: el servicio le pasa lo que leyó de la base.
// ============================================================================

export type ZonaEnVivo = 'nutricion-trepsi' | 'umv' | 'corporativo';

export const ZONAS_EN_VIVO: ReadonlyArray<ZonaEnVivo> = ['nutricion-trepsi', 'umv', 'corporativo'];

export interface DatosZona {
  /** Hay fila en `trepsi_appointments` para la historia. */
  esTrepsi: boolean;
  /** `HistoriaClinica.origen`, tal cual. */
  origen?: string | null;
  /** `profesionales.rol` de quien atiende ('coach' | 'medico' | …). */
  rol?: string | null;
  /** `profesionales.especialidad` de quien atiende. */
  especialidad?: string | null;
}

const sinTildes = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function zonaDe(d: DatosZona): ZonaEnVivo {
  const origen = String(d.origen ?? '').trim().toLowerCase();
  if (d.esTrepsi || origen === 'trepsi') return 'nutricion-trepsi';

  // Mismo criterio que `corporativo-sheet.esCorporativa`: manda el origen, y la
  // especialidad solo cubre filas viejas sin origen.
  const esp = sinTildes(String(d.especialidad ?? '').trim().toLowerCase());
  if (origen === 'corporativo' || (!origen && esp === 'medico corporativo')) return 'corporativo';
  if (origen === 'umv') return 'umv';

  // Agenda propia o MyBodytech: el local lo decide quién atiende. Los coaches
  // son los de nutrición; el resto es la unidad médica virtual.
  return d.rol === 'coach' ? 'nutricion-trepsi' : 'umv';
}

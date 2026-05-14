// ============================================================================
// Barrel del módulo `repositories`.
//
// Expone `BaseRepository`, `HistoriaClinicaRepository` y la instancia singleton
// `historiaClinicaRepository` (convención consistente con los services que
// también exportan `new XxxService()` como default).
// ============================================================================

export { BaseRepository } from './base.repository';
export { HistoriaClinicaRepository } from './historia-clinica.repository';

import { HistoriaClinicaRepository } from './historia-clinica.repository';
export const historiaClinicaRepository = new HistoriaClinicaRepository();

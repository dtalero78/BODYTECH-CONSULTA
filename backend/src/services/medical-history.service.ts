// ============================================
// Barrel module.
//
// El service original (~1120 líneas) se partió en tres archivos:
//   - historia-field-coercion.service.ts → whitelist, coerción, helpers
//   - historia-query.service.ts          → lecturas (4 métodos)
//   - historia-mutation.service.ts       → escrituras (updateField,
//                                          updateMedicalHistory)
//
// Este barrel mantiene la API pública previa para que ningún import
// existente se rompa:
//   - `import medicalHistoryService from '../services/medical-history.service'`
//     sigue devolviendo un objeto con los 6 métodos (get*, update*).
//   - `import { EDITABLE_FIELDS } from '../services/medical-history.service'`
//     sigue resolviendo (re-exportado vía `export *`).
// ============================================

export * from './historia-field-coercion.service';
export * from './historia-query.service';
export * from './historia-mutation.service';

import queryService from './historia-query.service';
import mutationService from './historia-mutation.service';

// Default export: shape combinado que `video.controller.ts` y
// `transcription.service.ts` consumen hoy (medicalHistoryService.getXxx /
// .updateXxx). Bind explícito para preservar `this` cuando se invoca como
// método del objeto.
export default {
  getMedicalHistory: queryService.getMedicalHistory.bind(queryService),
  getAtendidos: queryService.getAtendidos.bind(queryService),
  getPreviewHTML: queryService.getPreviewHTML.bind(queryService),
  getPatientHistory: queryService.getPatientHistory.bind(queryService),
  updateField: mutationService.updateField.bind(mutationService),
  updateMedicalHistory: mutationService.updateMedicalHistory.bind(mutationService),
};

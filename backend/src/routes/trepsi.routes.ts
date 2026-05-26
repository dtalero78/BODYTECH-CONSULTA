// ============================================================================
// trepsi.routes — Integración API Trepsi <-> Bodytech.
//
// Base path:  /api/v1/integrations/trepsi
//
// Endpoints (espec v2.1, sección 5):
//   POST   /appointments                       → crear cita + historia clínica
//   POST   /appointments/:citaId/schedule      → reprogramar
//   DELETE /appointments/:citaId               → cancelar
//   GET    /appointments/:citaId               → consultar estado
//
// Todos los endpoints exigen `Authorization: Bearer <TREPSI_API_KEY>`
// (middleware `requireApiKey('TREPSI_API_KEY', 'trepsi')` montado en index.ts).
// ============================================================================

import { Router } from 'express';
import trepsiController from '../controllers/trepsi.controller';

const router = Router();

router.get('/medicos', trepsiController.listMedicos);
router.get('/horarios-disponibles', trepsiController.listHorariosDisponibles);
router.post('/appointments', trepsiController.createAppointment);
router.post('/appointments/:citaId/schedule', trepsiController.reschedule);
router.patch('/appointments/:citaId/historia', trepsiController.patchHistoria);
router.delete('/appointments/:citaId', trepsiController.cancel);
router.get('/appointments/:citaId', trepsiController.get);

// Health check específico de la integración. Comparte el middleware de API
// Key con el resto de las rutas, así Trepsi valida URL + token de una vez.
router.get('/health', (_req, res) => {
  res.status(200).json({
    ok: true,
    integration: 'trepsi',
    version: '2.0',
    timestamp: new Date().toISOString(),
  });
});

export default router;

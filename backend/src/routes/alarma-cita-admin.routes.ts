// ============================================================================
// alarma-cita-admin.routes — /api/admin/alarma-cita
//
// Operación de la alarma "cita sin profesional conectado". El RBAC
// (requireRole 'admin') se aplica en el mount de index.ts.
//
//   POST /dispatch?fecha=&dryRun=1&limit=N → fuerza una pasada
//   GET  /estado?fecha=                    → bitácora del día
//   GET  /grupos                           → grupos de WHAPI con su id
// ============================================================================

import { Router } from 'express';
import alarmaCitaController from '../controllers/alarma-cita.controller';

const router = Router();

router.post('/dispatch', alarmaCitaController.dispatch);
router.get('/estado', alarmaCitaController.estado);
router.get('/grupos', alarmaCitaController.grupos);

export default router;

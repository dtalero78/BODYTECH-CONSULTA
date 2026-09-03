// ============================================================================
// link-auto-admin.routes — /api/admin/link-auto
//
// Operación del envío automático del link de videollamada. El RBAC
// (requireRole 'admin') se aplica en el mount de index.ts.
//
//   POST /dispatch?fecha=&dryRun=1&limit=N&historiaId=  → fuerza una pasada
//   GET  /estado?fecha=                                  → bitácora del día
// ============================================================================

import { Router } from 'express';
import linkAutoController from '../controllers/link-auto.controller';

const router = Router();

router.post('/dispatch', linkAutoController.dispatch);
router.get('/estado', linkAutoController.estado);

export default router;

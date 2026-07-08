// ============================================================================
// gestion-report-admin.routes — /api/admin/gestion-report
//
// Disparo manual del Informe de Gestión por WhatsApp. El RBAC (requireRole
// 'admin') se aplica en el mount de index.ts.
//
//   POST /dispatch?fecha=YYYY-MM-DD  → fuerza el envío (por defecto, hoy)
// ============================================================================

import { Router } from 'express';
import gestionReportController from '../controllers/gestion-report.controller';

const router = Router();

router.post('/dispatch', gestionReportController.dispatch);

export default router;

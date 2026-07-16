import { Router } from 'express';
import auditController from '../controllers/audit.controller';

// /api/admin/audit — bitácora de acciones (audit_log). El gating RBAC
// (admin/coordinador) se aplica al montar en index.ts.
const router = Router();

router.get('/', auditController.list);

export default router;

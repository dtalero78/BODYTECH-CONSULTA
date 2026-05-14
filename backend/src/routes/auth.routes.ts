// ============================================================================
// auth.routes — Run 5 (multi-sede login).
//
// Rutas públicas (sin `requireAuthMiddleware`):
//   POST /api/auth/login   → emite JWT
//   GET  /api/auth/sedes   → lista sedes activas para popular el <select>
// ============================================================================

import { Router } from 'express';
import authController from '../controllers/auth.controller';

const router = Router();

router.post('/login', authController.login);
router.get('/sedes', authController.getSedes);

export default router;

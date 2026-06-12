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
// RBAC — nueva auth por email+contraseña (aditiva; el cutover del frontend
// y la baja del login legacy van en fases posteriores).
router.post('/password-login', authController.passwordLogin);
// Reset de contraseña por email (Resend). Públicos.
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.get('/sedes', authController.getSedes);

export default router;

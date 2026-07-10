// ============================================================================
// torniquete.routes — Control de jornada laboral (entrada/salida).
//
// Base: /api/torniquete
//
// Endpoints:
//   POST /heartbeat  → latido de presencia del profesional (médico/coach).
//                      Identidad derivada del token; sin gating de rol para
//                      aceptar tanto sesión RBAC como token legacy.
//   POST /logout     → cierre explícito de jornada (deslogueo).
//   GET  /board      → tablero del día para el coordinador (RBAC: operativo).
// ============================================================================

import { Router } from 'express';
import torniqueteController from '../controllers/torniquete.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// Presencia: la identidad se resuelve en el controller (sesión o legacy). No se
// añade requireRole para no rechazar el token legacy code+sede (que no lleva
// SessionPayload); los no-profesionales caen a un no-op 204 dentro del controller.
router.post('/heartbeat', torniqueteController.heartbeat);
router.post('/logout', torniqueteController.logout);

// Tablero: solo coordinación.
router.get('/board', requireRole('coordinador', 'admin', 'auxiliar'), torniqueteController.getBoard);

export default router;

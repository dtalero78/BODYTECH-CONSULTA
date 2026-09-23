import { Router } from 'express';
import * as telemedicineController from '../controllers/telemedicine.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// Saber qué salas están abiertas es saber a cuáles se puede entrar: el nombre de
// la sala es lo único que protege una videollamada. Ninguna pantalla llamaba
// estas rutas (el análisis postural va por Socket.io, que es otro camino), así
// que cerrarlas no le quita nada a nadie.
const operacion = requireRole('coordinador', 'admin');

/**
 * GET /api/telemedicine/sessions/:roomName
 * Obtener información de una sesión específica
 */
router.get('/sessions/:roomName', operacion, telemedicineController.getSession);

/**
 * GET /api/telemedicine/sessions/:roomName/validate
 * Validar si una sesión existe y está activa
 */
router.get('/sessions/:roomName/validate', operacion, telemedicineController.validateSession);

/**
 * GET /api/telemedicine/sessions
 * Obtener todas las sesiones activas
 */
router.get('/sessions', operacion, telemedicineController.getActiveSessions);

export default router;

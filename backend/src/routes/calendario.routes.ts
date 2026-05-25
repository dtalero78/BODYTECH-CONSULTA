// ============================================================================
// calendario.routes — Endpoints del calendario del Panel Coordinador.
//
// Base: /api/calendario
// Auth: requiere JWT (montado bajo `requireAuthMiddleware` en index.ts).
//
// Endpoints:
//   GET  /mes?year=&month=&medico=     → conteos por día del mes
//   GET  /dia?fecha=&medico=           → citas del día + resumen por médico
//   GET  /horarios-disponibles?fecha=&profesionalId=&modalidad=
//   POST /reasignar-bulk               → cambiar médico a N citas
// ============================================================================

import { Router } from 'express';
import calendarioController from '../controllers/calendario.controller';

const router = Router();

router.get('/mes', calendarioController.getMes);
router.get('/dia', calendarioController.getDia);
router.get('/horarios-disponibles', calendarioController.getHorariosDisponibles);
router.post('/reasignar-bulk', calendarioController.reasignarBulk);

export default router;

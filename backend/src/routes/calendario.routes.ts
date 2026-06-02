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
//   GET  /disponibilidad-dia?fecha=&modalidad=   → disponibilidad de todos los profesionales ese día
//   GET  /disponibilidad-mes?year=&month=&modalidad= → overrides por día del mes
//   POST /reasignar-bulk               → cambiar médico a N citas
// ============================================================================

import { Router } from 'express';
import calendarioController from '../controllers/calendario.controller';

const router = Router();

router.get('/mes', calendarioController.getMes);
router.get('/dia', calendarioController.getDia);
router.get('/horarios-disponibles', calendarioController.getHorariosDisponibles);
router.get('/disponibilidad-dia', calendarioController.getDisponibilidadDia);
router.get('/disponibilidad-mes', calendarioController.getDisponibilidadMes);
router.post('/reasignar-bulk', calendarioController.reasignarBulk);

export default router;

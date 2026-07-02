// ============================================================================
// calendario.routes — Endpoints del calendario del Panel Coordinador.
//
// Base: /api/calendario
// Auth: RBAC por-ruta (requireRole). El mount en index.ts NO añade guard
//       blanket para poder abrir `horarios-disponibles` a médico/coach.
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
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// RBAC por-ruta. Vistas y reasignación del calendario: coordinador/admin/auxiliar.
// `horarios-disponibles` lo consultan además médico/coach al autoagendar su
// cita desde /panel-medico (el sede se resuelve al alcance del usuario).
const operativo = requireRole('coordinador', 'admin', 'auxiliar');
const horarios = requireRole('coordinador', 'admin', 'auxiliar', 'medico', 'coach');

router.get('/mes', operativo, calendarioController.getMes);
router.get('/dia', operativo, calendarioController.getDia);
router.get('/horarios-disponibles', horarios, calendarioController.getHorariosDisponibles);
router.get('/disponibilidad-dia', operativo, calendarioController.getDisponibilidadDia);
router.get('/disponibilidad-mes', operativo, calendarioController.getDisponibilidadMes);
router.post('/reasignar-bulk', operativo, calendarioController.reasignarBulk);

export default router;

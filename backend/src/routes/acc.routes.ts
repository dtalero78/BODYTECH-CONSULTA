// ============================================================================
// acc.routes — Valoración Corporal ACC.
//
// Base: /api/acc  (todo el grupo exige sesión — nada acá es público)
//
// Dos círculos de permiso:
//   CAPTURA    coach, médico, coordinador, admin — el fisioterapeuta que mide.
//   OPERACIÓN  coordinador, admin — cargar la cohorte de Sol Médica, mover el
//              embudo y volcar al Excel del cliente. Un evaluador no decide
//              quién entra al programa ni qué se le factura al cliente.
// ============================================================================

import { Router } from 'express';
import accController from '../controllers/acc.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

const CAPTURA = requireRole('coach', 'medico', 'coordinador', 'admin');
const OPERACION = requireRole('coordinador', 'admin');

// --- Captura -----------------------------------------------------------------

// Cálculo en vivo mientras se escribe. No persiste.
router.post('/calcular', CAPTURA, accController.calcular);

router.post('/valoraciones', CAPTURA, accController.guardar);
router.get('/valoraciones/:id', CAPTURA, accController.getValoracion);
router.post('/valoraciones/:id/cerrar', CAPTURA, accController.cerrar);
router.get('/valoraciones/:id/informe.pdf', CAPTURA, accController.informe);

// Historial del paciente: habilita comparar contra la valoración anterior.
router.get('/historial/:numeroId', CAPTURA, accController.historial);

// La lista de a quién le toca hoy la necesita el evaluador en el celular.
router.get('/pacientes', CAPTURA, accController.listarPacientes);

// --- Operación ---------------------------------------------------------------

router.post('/pacientes/cargar', OPERACION, accController.cargarCohorte);
router.post('/pacientes/:id/estado', OPERACION, accController.marcarEstado);
router.get('/embudo', OPERACION, accController.embudo);
router.get('/sheets/estado', OPERACION, accController.estadoSheet);
router.post('/sheets/exportar', OPERACION, accController.exportarSheet);

export default router;

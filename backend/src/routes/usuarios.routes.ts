// ============================================================================
// usuarios.routes — Gestión de usuarios (/api/usuarios). Montado con
// requireRole('admin','coordinador'); los límites finos de privilegio (P7) se
// aplican en el controller.
// ============================================================================

import { Router } from 'express';
import usuariosController from '../controllers/usuarios.controller';

const router = Router();

router.get('/', usuariosController.list);
router.post('/', usuariosController.create);
router.patch('/:id', usuariosController.update);
router.post('/:id/password', usuariosController.resetPassword);

export default router;

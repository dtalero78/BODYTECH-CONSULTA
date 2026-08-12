import { Router } from 'express';
import vistasGuardadasController from '../controllers/vistas-guardadas.controller';

// /api/vistas — "Mi vista" de cualquier tabla. Sin RBAC por rol: cada persona
// solo ve y toca las suyas, y eso lo resuelve el servicio filtrando por usuario.
const router = Router();

router.get('/', vistasGuardadasController.listar);
router.post('/', vistasGuardadasController.guardar);
router.delete('/:id', vistasGuardadasController.eliminar);

export default router;

// ============================================================================
// profesionales.routes — Endpoints internos del Panel Coordinador.
//
// Base: /api/profesionales
// Auth: requiere JWT válido (montado bajo `requireAuthMiddleware` en index.ts).
//
// Endpoints:
//   GET    /                           → lista (?rol=&activo=&search=)
//   GET    /:id                        → detalle
//   POST   /                           → crear
//   PUT    /:id                        → actualizar
//   DELETE /:id                        → soft-delete
//   GET    /:id/disponibilidad         → leer (?modalidad=)
//   POST   /:id/disponibilidad         → reemplazar (modalidad + dias en body)
//   DELETE /:id/disponibilidad/:dia    → borrar día (?modalidad=)
// ============================================================================

import { Router } from 'express';
import profesionalesController from '../controllers/profesionales.controller';

const router = Router();

router.get('/', profesionalesController.list);
router.get('/:id', profesionalesController.get);
router.post('/', profesionalesController.create);
router.put('/:id', profesionalesController.update);
router.delete('/:id', profesionalesController.remove);

router.get('/:id/disponibilidad', profesionalesController.getDisponibilidad);
router.post('/:id/disponibilidad', profesionalesController.replaceDisponibilidad);
router.delete('/:id/disponibilidad/:dia', profesionalesController.deleteDiaDisponibilidad);

export default router;

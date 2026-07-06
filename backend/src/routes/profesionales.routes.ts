// ============================================================================
// profesionales.routes — Endpoints internos del Panel Coordinador.
//
// Base: /api/profesionales
// Auth: RBAC por-ruta (requireRole). El mount en index.ts NO añade guard
//       blanket para que el LISTADO pueda abrirse a más roles que la gestión.
//
// Endpoints:
//   GET    /                           → lista (?rol=&activo=&search=)
//   GET    /:id                        → detalle
//   POST   /                           → crear
//   PUT    /:id                        → actualizar
//   DELETE /:id                        → soft-delete
//   POST   /:id/reactivar              → revertir soft-delete (activo = true)
//   GET    /:id/disponibilidad         → leer (?modalidad=)
//   POST   /:id/disponibilidad         → reemplazar (modalidad + dias en body)
//   DELETE /:id/disponibilidad/:dia    → borrar día (?modalidad=)
//   GET    /:id/disponibilidad-fecha   → override de una fecha (?fecha=&modalidad=)
//   PUT    /:id/disponibilidad-fecha   → reemplazar override (fecha/modalidad/bloqueado/rangos)
//   DELETE /:id/disponibilidad-fecha   → borrar override (?fecha=&modalidad=)
// ============================================================================

import { Router } from 'express';
import profesionalesController from '../controllers/profesionales.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// RBAC por-ruta. Gestión (crear/editar/borrar profesionales y su
// disponibilidad): coordinador/admin. El LISTADO lo consultan además auxiliar
// y médico/coach — el `AgendarCitaModal` de /panel-medico necesita resolver su
// propio profesionalId para autoagendar (el listado ya viene acotado a las
// sedes del usuario vía effectiveSedes).
const gestor = requireRole('coordinador', 'admin');
const listado = requireRole('coordinador', 'admin', 'auxiliar', 'medico', 'coach');

router.get('/', listado, profesionalesController.list);
router.get('/:id', gestor, profesionalesController.get);
router.post('/', gestor, profesionalesController.create);
router.put('/:id', gestor, profesionalesController.update);
router.delete('/:id', gestor, profesionalesController.remove);
router.post('/:id/reactivar', gestor, profesionalesController.reactivate);

router.get('/:id/disponibilidad', gestor, profesionalesController.getDisponibilidad);
router.post('/:id/disponibilidad', gestor, profesionalesController.replaceDisponibilidad);
router.delete('/:id/disponibilidad/:dia', gestor, profesionalesController.deleteDiaDisponibilidad);

router.get('/:id/disponibilidad-fecha', gestor, profesionalesController.getDisponibilidadFecha);
router.put('/:id/disponibilidad-fecha', gestor, profesionalesController.replaceDisponibilidadFecha);
router.delete('/:id/disponibilidad-fecha', gestor, profesionalesController.deleteDisponibilidadFecha);

export default router;

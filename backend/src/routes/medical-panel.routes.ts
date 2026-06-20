import { Router } from 'express';
import medicalPanelController from '../controllers/medical-panel.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// RBAC: gating por ruta (los roles difieren dentro del mismo grupo).
//   - Pacientes / stats: atención clínica → medico, coordinador, admin.
//   - Órdenes: gestión operativa → coordinador, admin, auxiliar (NO medico).
// Incluye coach: los coaches atienden pacientes vía el panel nutricional y
// usan los mismos endpoints de búsqueda/listado/historia que los médicos.
const clinico = requireRole('medico', 'coordinador', 'admin', 'coach');
const operativo = requireRole('coordinador', 'admin', 'auxiliar');
// Listado/agenda de órdenes: lo ven tanto los clínicos (médico/coach → SU
// propia agenda, vía ownCodeOrParam) como los operativos (coordinador/admin/
// auxiliar → gestión). Superset de `clinico` ∪ `operativo`.
const agendaLista = requireRole('medico', 'coach', 'coordinador', 'admin', 'auxiliar');

// Estadísticas del día para un médico
router.get('/stats/:medicoCode', clinico, medicalPanelController.getDailyStats);

// Lista paginada de pacientes pendientes
router.get('/patients/pending/:medicoCode', clinico, medicalPanelController.getPendingPatients);

// Búsqueda de paciente por documento
router.get('/patients/search/:documento', clinico, medicalPanelController.searchPatientByDocument);

// Detalles completos de un paciente
router.get('/patients/details/:documento', clinico, medicalPanelController.getPatientDetails);

// Marcar paciente como "No Contesta"
router.patch('/patients/:patientId/no-answer', clinico, medicalPanelController.markAsNoAnswer);

// CRUD de Órdenes.
// El LISTADO (agenda) es `clinico`: médico/coach ven SU propia agenda — el
// controller fuerza su código (ownCodeOrParam) cerrando el IDOR. Las
// escrituras siguen `operativo` (coordinador/admin/auxiliar).
router.get('/ordenes', agendaLista, medicalPanelController.listOrdenes);
router.post('/ordenes', operativo, medicalPanelController.createOrden);
router.patch('/ordenes/:id', operativo, medicalPanelController.updateOrden);
router.delete('/ordenes/:id', operativo, medicalPanelController.deleteOrden);

export default router;

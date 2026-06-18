// Monitor de integración Trepsi. Token simple en query string o header
// `x-monitor-token`. Sin JWT — pensado para uso del owner durante pruebas.
import { Router } from 'express';
import monitorIntegracionController from '../controllers/monitor-integracion.controller';

const router = Router();

router.get('/events', monitorIntegracionController.events);
router.get('/summary', monitorIntegracionController.summary);

export default router;

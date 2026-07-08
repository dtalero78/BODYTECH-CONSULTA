// ============================================================================
// gestion-report-image.routes — /api/public/gestion-report-image
//
// Ruta PÚBLICA (sin auth): sirve el PNG del tablero de gestión por token, para
// que los servidores de Twilio lo tomen como media de la plantilla de WhatsApp.
// ============================================================================

import { Router } from 'express';
import gestionReportImageController from '../controllers/gestion-report-image.controller';

const router = Router();

router.get('/:token', gestionReportImageController.serve);

export default router;

// Rutas del módulo WhatsApp Leads (captura de la "entidad").
// Público: WHAPI llama el webhook sin JWT. Se protege con WHAPI_WEBHOOK_SECRET
// (opcional) validado en el controller.
import { Router } from 'express';
import whatsappLeadsController from '../controllers/whatsapp-leads.controller';

const router = Router();

router.get('/health', whatsappLeadsController.health);
router.post('/webhook', whatsappLeadsController.webhook);

export default router;

// Rutas del chat de WhatsApp del panel médico.
//   - /webhook  → público (Twilio). Twilio postea x-www-form-urlencoded, por eso
//                 se aplica express.urlencoded solo en esta ruta.
//   - /mensajes → protegido (clínicos y operativos que atienden el panel).
import { Router } from 'express';
import whatsappChatController from '../controllers/whatsapp-chat.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

const panel = requireRole('medico', 'coach', 'coordinador', 'admin', 'auxiliar');

// Inbound de Twilio (lo que el paciente escribe). El body form-urlencoded lo
// parsea el express.urlencoded global de index.ts.
router.post('/webhook', whatsappChatController.webhook);

// Lectura del hilo + responder desde el panel.
router.get('/mensajes', panel, whatsappChatController.getMensajes);
router.post('/mensajes', panel, whatsappChatController.sendReply);

export default router;

// Rutas del chat de WhatsApp del panel médico (proxy a bsl-plataforma).
// No hay webhook inbound aquí: Twilio apunta a mediconecta.bodytech.app
// (bsl-plataforma, tenant BODYTECH). Ver whatsapp-chat.controller.
import { Router } from 'express';
import whatsappChatController from '../controllers/whatsapp-chat.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

const panel = requireRole('medico', 'coach', 'coordinador', 'admin', 'auxiliar');

// Lectura del hilo + responder desde el panel.
router.get('/mensajes', panel, whatsappChatController.getMensajes);
router.post('/mensajes', panel, whatsappChatController.sendReply);

export default router;

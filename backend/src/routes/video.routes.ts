import { Router } from 'express';
import videoController from '../controllers/video.controller';

const router = Router();

// Generar token de acceso
router.post('/token', videoController.generateToken);

// Gestión de salas
router.post('/rooms', videoController.createRoom);
router.get('/rooms/:roomName', videoController.getRoom);
router.post('/rooms/:roomName/end', videoController.endRoom);

// Gestión de participantes
router.get('/rooms/:roomName/participants', videoController.listParticipants);
router.post(
  '/rooms/:roomName/participants/:participantSid/disconnect',
  videoController.disconnectParticipant
);

// Tracking de sesiones para reportes
router.post('/events/participant-connected', videoController.trackParticipantConnected);
router.post('/events/participant-disconnected', videoController.trackParticipantDisconnected);
router.get('/events/connected-patients', videoController.getConnectedPatients);

// Phase 3 — Transcripción post-llamada
router.post('/events/session-start', videoController.sessionStart);
router.post('/webhooks/recording-ready', videoController.recordingReadyWebhook);

// WhatsApp
router.post('/whatsapp/send', videoController.sendWhatsApp);

// Medical History
// IMPORTANTE: Las rutas específicas deben ir ANTES de '/:historiaId' para evitar conflictos
router.get('/medical-history/atendidos', videoController.getAtendidos);
router.get('/medical-history/patient/:numeroId', videoController.getPatientHistory);
router.get('/medical-history/:historiaId/preview', videoController.getPreviewHTML);
router.get('/medical-history/:historiaId', videoController.getMedicalHistory);
router.post('/medical-history', videoController.updateMedicalHistory);
// Phase 1 — auto-save por field (PATCH)
router.patch('/medical-history/:historiaId/field', videoController.updateMedicalHistoryField);

// AI Suggestions
router.post('/ai-suggestions', videoController.generateAISuggestions);

export default router;

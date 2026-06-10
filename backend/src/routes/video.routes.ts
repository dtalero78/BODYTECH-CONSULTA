import { Router } from 'express';
import videoController from '../controllers/video.controller';
import { requireAuthMiddleware } from '../middleware/auth.middleware';

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
// Retry/backfill manual: usa el composition_sid ya cargado en HistoriaClinica
// para volver a correr la transcripción si el webhook composition-status no
// llegó o el pipeline falló. Protegido: endpoint de operación (no lo usa el
// paciente) — sin JWT permitiría disparar Whisper/GPT sobre historias arbitrarias.
router.post(
  '/transcribe-historia/:historiaId',
  requireAuthMiddleware,
  videoController.retranscribeHistoria
);

// Phase 4 — Twilio Compositions (se dispara cuando la sala pasa a completed)
router.post('/webhooks/room-completed', videoController.roomCompletedWebhook);
router.post('/webhooks/composition-status', videoController.compositionStatusWebhook);

// WhatsApp — protegido: solo personal autenticado envía links/plantillas
// (evita abuso del template aprobado para phishing / spam con la marca).
router.post('/whatsapp/send', requireAuthMiddleware, videoController.sendWhatsApp);

// Reprogramación de cita (público — abierto desde el botón de WhatsApp)
router.get('/reprogramar/:id', videoController.getReprogramarInfo);
router.post('/reprogramar/:id', videoController.reprogramarCita);

// Medical History — TODAS las rutas exigen JWT: contienen PHI (lectura y
// escritura de historias clínicas). Los pacientes acceden por link de WhatsApp
// SOLO al video (token + eventos), nunca a la historia clínica, así que exigir
// JWT aquí no afecta el flujo del paciente y cierra el acceso anónimo.
// IMPORTANTE: Las rutas específicas deben ir ANTES de '/:historiaId' para evitar conflictos
router.get('/medical-history/atendidos', requireAuthMiddleware, videoController.getAtendidos);
router.get(
  '/medical-history/patient/:numeroId',
  requireAuthMiddleware,
  videoController.getPatientHistory
);
// Run 6 — PDF descarga. Va antes de la ruta genérica para que `:id/pdf` no
// caiga en `:historiaId`. Protegida con JWT (solo médicos autenticados).
router.get('/medical-history/:id/pdf', requireAuthMiddleware, videoController.getHistoriaPdf);
router.get(
  '/medical-history/:historiaId/preview',
  requireAuthMiddleware,
  videoController.getPreviewHTML
);
router.get('/medical-history/:historiaId', requireAuthMiddleware, videoController.getMedicalHistory);
router.post('/medical-history', requireAuthMiddleware, videoController.updateMedicalHistory);
// Phase 1 — auto-save por field (PATCH)
router.patch(
  '/medical-history/:historiaId/field',
  requireAuthMiddleware,
  videoController.updateMedicalHistoryField
);

// AI Suggestions — protegido: invoca OpenAI con datos del paciente.
router.post('/ai-suggestions', requireAuthMiddleware, videoController.generateAISuggestions);

export default router;

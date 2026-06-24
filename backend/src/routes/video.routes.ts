import express, { Router } from 'express';
import videoController from '../controllers/video.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// RBAC: las rutas de historia clínica (PHI), sugerencias IA, WhatsApp y
// transcripción son de personal clínico — medico, coordinador, admin. Los
// pacientes acceden por link SOLO al video (token + eventos), nunca a estas.
const clinico = requireRole('medico', 'coordinador', 'admin', 'coach');

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

// Transcripción EN VIVO — token efímero de OpenAI Realtime (protegido).
router.post('/realtime-token', clinico, videoController.createRealtimeToken);

// Phase 3 — Transcripción post-llamada
router.post('/events/session-start', videoController.sessionStart);
router.post('/webhooks/recording-ready', videoController.recordingReadyWebhook);

// Transcripción client-side (entrada principal): el navegador sube el audio
// crudo de la consulta. express.raw captura el binario (el parser json/urlencoded
// global no toca content-types de audio). Protegido con JWT — maneja PHI.
router.post(
  '/transcribe-consulta/:historiaId',
  clinico,
  express.raw({ type: () => true, limit: '60mb' }),
  videoController.transcribeConsulta
);
// Retry/backfill manual: usa el composition_sid ya cargado en HistoriaClinica
// para volver a correr la transcripción si el webhook composition-status no
// llegó o el pipeline falló. Protegido: endpoint de operación (no lo usa el
// paciente) — sin JWT permitiría disparar Whisper/GPT sobre historias arbitrarias.
router.post(
  '/transcribe-historia/:historiaId',
  clinico,
  videoController.retranscribeHistoria
);

// Phase 4 — Twilio Compositions (se dispara cuando la sala pasa a completed)
router.post('/webhooks/room-completed', videoController.roomCompletedWebhook);
router.post('/webhooks/composition-status', videoController.compositionStatusWebhook);

// WhatsApp — protegido: solo personal autenticado envía links/plantillas
// (evita abuso del template aprobado para phishing / spam con la marca).
router.post('/whatsapp/send', clinico, videoController.sendWhatsApp);

// Reprogramación de cita (público — abierto desde el botón de WhatsApp)
router.get('/reprogramar/:id', videoController.getReprogramarInfo);
router.get('/reprogramar/:id/horarios', videoController.getReprogramarHorarios);
router.post('/reprogramar/:id', videoController.reprogramarCita);

// Medical History — TODAS las rutas exigen JWT: contienen PHI (lectura y
// escritura de historias clínicas). Los pacientes acceden por link de WhatsApp
// SOLO al video (token + eventos), nunca a la historia clínica, así que exigir
// JWT aquí no afecta el flujo del paciente y cierra el acceso anónimo.
// IMPORTANTE: Las rutas específicas deben ir ANTES de '/:historiaId' para evitar conflictos
router.get('/medical-history/atendidos', clinico, videoController.getAtendidos);
router.get(
  '/medical-history/patient/:numeroId',
  clinico,
  videoController.getPatientHistory
);
// Run 6 — PDF descarga. Va antes de la ruta genérica para que `:id/pdf` no
// caiga en `:historiaId`. Protegida con JWT (solo médicos autenticados).
router.get('/medical-history/:id/pdf', clinico, videoController.getHistoriaPdf);
router.get('/medical-history/:historiaId/rips', clinico, videoController.getRipsJson);
router.get(
  '/medical-history/:historiaId/preview',
  clinico,
  videoController.getPreviewHTML
);
router.get('/medical-history/:historiaId', clinico, videoController.getMedicalHistory);
router.post('/medical-history', clinico, videoController.updateMedicalHistory);
// Phase 1 — auto-save por field (PATCH)
router.patch(
  '/medical-history/:historiaId/field',
  clinico,
  videoController.updateMedicalHistoryField
);

// AI Suggestions — protegido: invoca OpenAI con datos del paciente.
router.post('/ai-suggestions', clinico, videoController.generateAISuggestions);

export default router;

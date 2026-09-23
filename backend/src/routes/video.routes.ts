import express, { Router, Request, Response, NextFunction } from 'express';
import videoController from '../controllers/video.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

// RBAC: las rutas de historia clínica (PHI), sugerencias IA, WhatsApp y
// transcripción son de personal clínico — medico, coordinador, admin. Los
// pacientes acceden por link SOLO al video (token + eventos), nunca a estas.
const clinico = requireRole('medico', 'coordinador', 'admin', 'coach');

// El paciente es el único que cruza sin cuenta: su link de WhatsApp no trae
// sesión, así que pedir el token para ENTRAR a su sala tiene que seguir siendo
// público. Entrar como MÉDICO no: sin esto, cualquiera que supiera el nombre de
// una sala pedía un token de médico y se sentaba en el consultorio.
const soloElPacienteEntraSinCuenta = (req: Request, res: Response, next: NextFunction): void => {
  if (req.body?.role !== 'doctor') return next();
  return clinico(req, res, next);
};

// Generar token de acceso (público para el paciente; con sesión para el médico)
router.post('/token', soloElPacienteEntraSinCuenta, videoController.generateToken);

// Sala guardada de una historia (para que "Atender" entre a la misma del
// paciente). Protegida: con el id de una historia devolvía el nombre de la sala,
// que es lo único que hace falta para entrar a la videollamada. La llama el
// panel del profesional, que ya tiene sesión.
router.get('/room/:historiaId', clinico, videoController.getStoredRoom);

// Gestión de salas — cosas del profesional, no del paciente: crear la sala,
// consultarla, cerrarla. El paciente solo se desconecta (el room lo cierra el
// médico, ver VideoRoom.handleLeave).
router.post('/rooms', clinico, videoController.createRoom);
router.get('/rooms/:roomName', clinico, videoController.getRoom);
router.post('/rooms/:roomName/end', clinico, videoController.endRoom);

// Gestión de participantes: quién está en la sala y sacar a alguien. Nunca lo
// llama el paciente.
router.get('/rooms/:roomName/participants', clinico, videoController.listParticipants);
router.post(
  '/rooms/:roomName/participants/:participantSid/disconnect',
  clinico,
  videoController.disconnectParticipant
);

// Tracking de sesiones para reportes
router.post('/events/participant-connected', videoController.trackParticipantConnected);
router.post('/events/participant-disconnected', videoController.trackParticipantDisconnected);
router.get('/events/connected-patients', videoController.getConnectedPatients);

// Diagnóstico del cliente: el navegador reporta señales técnicas de la llamada
// (resolución real del filtro de fondo, si va lento, si se auto-degradó). Sin
// esto la única fuente sería la consola del navegador del coach — y los coaches
// no son técnicos. Público, igual que el resto de /events (lo llama el paciente).
router.post('/events/client-diag', videoController.trackClientDiag);

// Resumen del diagnóstico (qué equipo usa cada quien, a quién se le degrada el
// fondo, de quién es el problema de red). Protegido: es información operativa.
router.get(
  '/events/client-diag/resumen',
  requireRole('coordinador', 'admin'),
  videoController.getClientDiagResumen
);

// Transcripción EN VIVO — token efímero de OpenAI Realtime (protegido).
router.post('/realtime-token', clinico, videoController.createRealtimeToken);
// Extracción de campos desde el transcript acumulado en vivo (IA al finalizar).
router.post('/extract-fields/:historiaId', clinico, videoController.extractFields);

// Phase 3 — Transcripción post-llamada. La dispara el navegador del médico al
// conectarse (ata la sala a la historia), así que exige sesión: escribirla desde
// afuera mandaría la grabación de una consulta a la historia de otra persona.
router.post('/events/session-start', clinico, videoController.sessionStart);
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
// Médico Corporativo — visita anterior del paciente para la fila "Comparación".
// También va antes de la ruta genérica '/:historiaId'.
router.get(
  '/medical-history/:historiaId/corporativo-anterior',
  clinico,
  videoController.getCorporativoVisitaAnterior
);
router.get('/medical-history/:historiaId', clinico, videoController.getMedicalHistory);
router.post('/medical-history', clinico, videoController.updateMedicalHistory);
// Cierre de la consulta. El panel de 7 pestañas auto-guarda campo a campo y no
// tenía cómo marcarla atendida: eso vivía en el botón "Guardar" que el refactor
// eliminó. El nutricional lo conservó, por eso allá sí funcionaba.
router.post(
  '/medical-history/:historiaId/finalizar',
  clinico,
  videoController.finalizarConsulta
);
// Phase 1 — auto-save por field (PATCH)
router.patch(
  '/medical-history/:historiaId/field',
  clinico,
  videoController.updateMedicalHistoryField
);

// AI Suggestions — protegido: invoca OpenAI con datos del paciente.
router.post('/ai-suggestions', clinico, videoController.generateAISuggestions);

export default router;

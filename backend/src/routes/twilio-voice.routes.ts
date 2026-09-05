// ============================================================================
// twilio-voice.routes — /api/twilio
//
// Dos cosas conviven acá, con permisos distintos por ruta (el mount en
// index.ts NO pone middleware, a propósito: los webhooks de Twilio deben
// poder entrar sin JWT):
//
//   · Llamada del coach al paciente (en vivo, grabada) — ver llamadas-voz.
//       GET  /voz/token                token del softphone   clínico
//       POST /llamadas                 iniciar          clínico
//       GET  /llamadas/:id             estado en vivo   clínico (solo la propia)
//       GET  /llamadas?historiaId=     historial        coordinador/admin
//       GET  /llamadas/:id/audio       la grabación     coordinador/admin
//       POST /llamadas/:id/{twiml,aviso,estado,dial-fin,grabacion}
//                                      webhooks Twilio  firma validada
//
//   · Robot legado (audio pregrabado, sin coach). Lo usa "Contactar"; queda
//     protegido por rol — antes cualquiera podía llamar desde el número de
//     Bodytech.
// ============================================================================

import { Router } from 'express';
import twilioVoiceController from '../controllers/twilio-voice.controller';
import llamadasVozController from '../controllers/llamadas-voz.controller';
import { requireRole } from '../middleware/rbac.middleware';

const router = Router();

const clinico = requireRole('medico', 'coordinador', 'admin', 'coach');
const auditoria = requireRole('coordinador', 'admin');

// --- Llamada en vivo ---------------------------------------------------------

router.get('/voz/token', clinico, llamadasVozController.token);
router.post('/llamadas', clinico, llamadasVozController.iniciar);
router.get('/llamadas', auditoria, llamadasVozController.listar);
router.get('/llamadas/:id', clinico, llamadasVozController.get);
router.get('/llamadas/:id/audio', auditoria, llamadasVozController.audio);

// Webhooks (públicos; validan la firma de Twilio adentro). Los dos primeros
// los llama la TwiML App "Bodytech · Llamada del coach" (voice_url y
// status_callback); van ANTES de /:id/… para que "softphone" no se lea como id.
router.post('/llamadas/softphone', llamadasVozController.softphone);
router.post('/llamadas/estado-app', llamadasVozController.estadoApp);
router.post('/llamadas/:id/twiml', llamadasVozController.twiml);
router.post('/llamadas/:id/aviso', llamadasVozController.aviso);
router.post('/llamadas/:id/estado', llamadasVozController.estado);
router.post('/llamadas/:id/dial-fin', llamadasVozController.dialFin);
router.post('/llamadas/:id/grabacion', llamadasVozController.grabacion);

// --- Robot legado ------------------------------------------------------------

router.get('/voice-twiml', twilioVoiceController.voiceTwiml.bind(twilioVoiceController));
router.post('/voice-call', clinico, twilioVoiceController.makeVoiceCall.bind(twilioVoiceController));

export default router;

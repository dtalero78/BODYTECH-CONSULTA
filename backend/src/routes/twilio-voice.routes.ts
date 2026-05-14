import { Router } from 'express';
import twilioVoiceController from '../controllers/twilio-voice.controller';

const router = Router();

// GET /api/twilio/voice-twiml - TwiML webhook que reproduce el audio de bienvenida
router.get('/voice-twiml', twilioVoiceController.voiceTwiml.bind(twilioVoiceController));

// POST /api/twilio/voice-call - Make a voice call
router.post('/voice-call', twilioVoiceController.makeVoiceCall.bind(twilioVoiceController));

export default router;

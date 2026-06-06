// Admin del outbox del webhook BSL → Trepsi. JWT requerido.
import { Router } from 'express';
import trepsiWebhookController from '../controllers/trepsi-webhook.controller';

const router = Router();

router.get('/queue', trepsiWebhookController.list);
router.post('/queue/:id/retry', trepsiWebhookController.retry);
router.post('/dispatch', trepsiWebhookController.dispatch);

export default router;

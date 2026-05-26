// ============================================================================
// bot-trepsi.routes — Endpoint público del chat del bot Trepsi.
//
// Sin auth porque está pensado para que el equipo de Trepsi lo use desde una
// página pública sin necesidad de credenciales. Rate limit por IP en el
// controller mitiga el riesgo de abuse.
//
// Base: /api/bot-trepsi
// ============================================================================

import { Router } from 'express';
import botTrepsiController from '../controllers/bot-trepsi.controller';

const router = Router();

router.post('/chat', botTrepsiController.chat);

export default router;

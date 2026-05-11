/**
 * Router /api/calidad/*
 *
 * Evaluación de calidad de consultas médicas mediante Anthropic Managed Agents.
 *
 * GET  /session/:historiaId          → datos de paciente + compositionSid
 * GET  /video-url/:compositionSid    → URL pre-firmada del MP4 de Twilio
 * POST /evaluar/:historiaId          → dispara evaluación async, responde con evaluacionId
 * GET  /evaluacion/:id               → polling del estado/resultado
 * GET  /historial/:historiaId        → historial de evaluaciones de una historia
 */

import { Router } from 'express';
import calidadController from '../controllers/calidad.controller';

const router = Router();

router.get('/session/:historiaId', calidadController.getSession);
router.get('/video-url/:compositionSid', calidadController.getVideoUrl);
router.post('/evaluar/:historiaId', calidadController.dispararEvaluacion);
router.get('/evaluacion/:id', calidadController.getEvaluacion);
router.get('/historial/:historiaId', calidadController.getHistorial);

export default router;

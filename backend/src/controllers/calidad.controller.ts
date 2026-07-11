/**
 * Controlador de evaluación de calidad de consultas médicas.
 *
 * Todos los métodos son thin wrappers sobre calidadService.
 * La lógica de negocio y el pipeline async viven en calidad.service.ts.
 */

import { Request, Response } from 'express';
import calidadService from '../services/calidad.service';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calidad/session/:historiaId
// ─────────────────────────────────────────────────────────────────────────────

export const getSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const { historiaId } = req.params;
    if (!historiaId) {
      res.status(400).json({ success: false, message: 'historiaId es requerido' });
      return;
    }

    const data = await calidadService.getSession(historiaId);

    if (!data.found) {
      res.status(404).json({ success: false, message: 'Historia clínica no encontrada' });
      return;
    }

    res.json({ success: true, ...data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] GET /session error:', msg);
    res.status(500).json({ success: false, message: 'Error consultando la sesión', error: msg });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calidad/video-url/:compositionSid
// ─────────────────────────────────────────────────────────────────────────────

export const getVideoUrl = async (req: Request, res: Response): Promise<void> => {
  try {
    const { compositionSid } = req.params;
    if (!compositionSid) {
      res.status(400).json({ success: false, message: 'compositionSid es requerido' });
      return;
    }

    const url = await calidadService.getVideoUrl(compositionSid);
    res.json({ success: true, url });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error && 'statusCode' in err
        ? (err as Error & { statusCode: number }).statusCode
        : 502;
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] GET /video-url error:', msg);
    res.status(statusCode).json({ success: false, message: msg });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calidad/preparar/:historiaId
// Crea la composición on-demand (si falta) y devuelve su estado. El frontend
// hace polling hasta status === 'completed'.
// ─────────────────────────────────────────────────────────────────────────────

export const prepararComposicion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { historiaId } = req.params;
    if (!historiaId) {
      res.status(400).json({ success: false, message: 'historiaId es requerido' });
      return;
    }

    const result = await calidadService.ensureComposition(historiaId);
    res.json({ success: true, ...result });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error && 'statusCode' in err
        ? (err as Error & { statusCode: number }).statusCode
        : 502;
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] POST /preparar error:', msg);
    res.status(statusCode).json({ success: false, message: msg });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/calidad/evaluar/:historiaId
// ─────────────────────────────────────────────────────────────────────────────

export const dispararEvaluacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { historiaId } = req.params;
    if (!historiaId) {
      res.status(400).json({ success: false, message: 'historiaId es requerido' });
      return;
    }

    const evaluacionId = await calidadService.dispararEvaluacion(historiaId);

    // Respuesta inmediata — el procesamiento continúa en background
    res.status(201).json({ success: true, evaluacionId });
  } catch (err: unknown) {
    const statusCode =
      err instanceof Error && 'statusCode' in err
        ? (err as Error & { statusCode: number }).statusCode
        : 500;
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] POST /evaluar error:', msg);
    res.status(statusCode).json({ success: false, message: msg });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calidad/evaluacion/:id
// ─────────────────────────────────────────────────────────────────────────────

export const getEvaluacion = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ success: false, message: 'id de evaluación inválido' });
      return;
    }

    const data = await calidadService.getEvaluacion(id);
    if (!data) {
      res.status(404).json({ success: false, message: 'Evaluación no encontrada' });
      return;
    }

    res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] GET /evaluacion/:id error:', msg);
    res.status(500).json({ success: false, message: 'Error consultando evaluación', error: msg });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/calidad/historial/:historiaId
// ─────────────────────────────────────────────────────────────────────────────

export const getHistorial = async (req: Request, res: Response): Promise<void> => {
  try {
    const { historiaId } = req.params;
    if (!historiaId) {
      res.status(400).json({ success: false, message: 'historiaId es requerido' });
      return;
    }

    const data = await calidadService.getHistorial(historiaId);
    res.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[calidad] GET /historial/:historiaId error:', msg);
    res.status(500).json({ success: false, message: 'Error consultando historial', error: msg });
  }
};

export default {
  getSession,
  getVideoUrl,
  prepararComposicion,
  dispararEvaluacion,
  getEvaluacion,
  getHistorial,
};

// ============================================================================
// llamadas-voz.controller — HTTP de la llamada del coach al paciente.
//
// Dos mundos en un mismo router:
//   · lo que usa el PANEL (iniciar, consultar, listar, escuchar) — con JWT y rol.
//   · lo que llama TWILIO (twiml, aviso, estado, dial-fin, grabacion) — público
//     pero con la FIRMA de Twilio validada. Sin firma válida, 403 y nada más.
//
// Los webhooks responden rápido y sin Zod, como los de video: Twilio reintenta
// si tardamos, y un reintento mal manejado duplica estados.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import twilio from 'twilio';
import llamadasVozService, {
  credencialesVoz,
  baseUrlPublica,
  twimlParaCoach,
  twimlAvisoPaciente,
  twimlDialFin,
} from '../services/llamadas-voz.service';
import { getSession } from '../middleware/rbac.middleware';

/**
 * La URL con la que Twilio firmó. Detrás del proxy de DigitalOcean el host que
 * ve Express no es el público: PUBLIC_BASE_URL manda; si no está, se deriva.
 */
function urlFirmada(req: Request): string {
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${(req.headers['x-forwarded-proto'] as string) || req.protocol}://${req.get('host')}`;
  return `${base.replace(/\/+$/, '')}${req.originalUrl}`;
}

/** 403 si la firma no es de Twilio. Devuelve los params ya parseados si sí. */
function validarFirma(req: Request, res: Response): Record<string, string> | null {
  const { authToken } = credencialesVoz();
  const signature = req.header('x-twilio-signature') || '';
  if (!authToken) {
    console.error('[llamadas-voz] Sin token de Twilio: no puedo validar el webhook');
    res.status(500).send();
    return null;
  }
  const params = (req.body ?? {}) as Record<string, string>;
  if (!twilio.validateRequest(authToken, signature, urlFirmada(req), params)) {
    console.warn(`[llamadas-voz] Firma Twilio inválida en ${req.originalUrl}`);
    res.status(403).send();
    return null;
  }
  return params;
}

function idDe(req: Request): number | null {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
}

const xml = (res: Response, body: string) => res.type('text/xml').send(body);

class LlamadasVozController {
  // --- Panel ---------------------------------------------------------------

  /** POST /api/twilio/llamadas  { historiaId } */
  iniciar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = getSession(req);
      const historiaId = typeof req.body?.historiaId === 'string' ? req.body.historiaId.trim() : '';
      if (!session || !historiaId) {
        res.status(400).json({ success: false, error: 'HISTORIA_REQUERIDA' });
        return;
      }
      const r = await llamadasVozService.iniciar(historiaId, session);
      if (!r.ok) {
        const status =
          r.error === 'HISTORIA_NO_ENCONTRADA' ? 404
          : r.error === 'DB_ERROR' ? 502
          : r.error === 'SOFTPHONE_NO_CONFIGURADO' ? 503
          : 409;
        res.status(status).json({ success: false, error: r.error });
        return;
      }
      res.status(201).json({ success: true, llamada: r.llamada });
    } catch (e) {
      next(e);
    }
  };

  /** GET /api/twilio/voz/token — lo que el navegador necesita para conectarse. */
  token = (req: Request, res: Response): void => {
    const session = getSession(req);
    const t = session ? llamadasVozService.tokenVoz(session) : null;
    if (!t) {
      res.status(503).json({ success: false, error: 'SOFTPHONE_NO_CONFIGURADO' });
      return;
    }
    res.json({ success: true, ...t });
  };

  /** GET /api/twilio/llamadas/:id — estado, para que el panel lo siga en vivo. */
  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = getSession(req);
      const id = idDe(req);
      if (!session || !id) {
        res.status(400).json({ success: false, error: 'ID_INVALIDO' });
        return;
      }
      // Antes de responder, cerrar las que quedaron colgadas: así el panel no
      // se queda mostrando "en llamada" para siempre si un webhook se perdió.
      await llamadasVozService.cerrarHuerfanas();
      const llamada = await llamadasVozService.get(id);
      if (!llamada || !llamadasVozService.puedeVer(session, llamada)) {
        res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
        return;
      }
      res.json({ success: true, llamada });
    } catch (e) {
      next(e);
    }
  };

  /** GET /api/twilio/llamadas?historiaId= — coordinador/admin. */
  listar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const historiaId = typeof req.query.historiaId === 'string' ? req.query.historiaId : '';
      if (!historiaId) {
        res.status(400).json({ success: false, error: 'HISTORIA_REQUERIDA' });
        return;
      }
      const llamadas = await llamadasVozService.listarPorHistoria(historiaId);
      if (llamadas === null) {
        res.status(500).json({ success: false, error: 'DB_ERROR' });
        return;
      }
      res.json({ success: true, llamadas });
    } catch (e) {
      next(e);
    }
  };

  /** GET /api/twilio/llamadas/:id/audio — el MP3, solo para quien audita. */
  audio = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = getSession(req);
      const id = idDe(req);
      if (!session || !id || !llamadasVozService.puedeEscuchar(session)) {
        res.status(403).json({ success: false, error: 'FORBIDDEN' });
        return;
      }
      const llamada = await llamadasVozService.get(id);
      if (!llamada) {
        res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
        return;
      }
      const audio = await llamadasVozService.abrirAudio(llamada);
      if (!audio) {
        res.status(409).json({ success: false, error: 'SIN_GRABACION' });
        return;
      }
      res.setHeader('Content-Type', audio.contentType);
      if (audio.contentLength) res.setHeader('Content-Length', audio.contentLength);
      res.setHeader('Cache-Control', 'private, no-store');
      audio.stream.on('error', (e) => {
        console.error(`[llamadas-voz] stream de audio #${id} falló:`, e?.message ?? e);
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      audio.stream.pipe(res);
    } catch (e) {
      next(e);
    }
  };

  // --- Webhooks de Twilio ------------------------------------------------------

  /** POST /:id/twiml — el coach contestó: conectar con el paciente. */
  twiml = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    const id = idDe(req);
    const llamada = id ? await llamadasVozService.get(id) : null;
    if (!llamada) {
      xml(res, `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`);
      return;
    }
    xml(
      res,
      twimlParaCoach({
        llamadaId: llamada.id,
        pacienteNombre: llamada.pacienteNombre || '',
        pacienteCelular: llamada.pacienteCelular,
        base: baseUrlPublica(),
      })
    );
  };

  /**
   * POST /llamadas/softphone — voice_url de la TwiML App. El navegador del coach
   * se conectó; Twilio manda `llamadaId` (parámetro del SDK), `From` (la
   * identidad del token) y `CallSid`. Devuelve el mismo TwiML del <Dial>.
   */
  softphone = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    const id = Number(params.llamadaId);
    const llamada =
      Number.isInteger(id) && id > 0 && params.CallSid
        ? await llamadasVozService.conectarSoftphone(id, params.CallSid, params.From || '')
        : null;
    if (!llamada) {
      xml(
        res,
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-MX">No encontré la llamada.</Say><Hangup/></Response>`
      );
      return;
    }
    xml(
      res,
      twimlParaCoach({
        llamadaId: llamada.id,
        pacienteNombre: llamada.pacienteNombre || '',
        pacienteCelular: llamada.pacienteCelular,
        base: baseUrlPublica(),
      })
    );
  };

  /** POST /llamadas/estado-app — status_callback de la TwiML App (tramo del coach, por CallSid). */
  estadoApp = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    res.status(200).send();
    if (!params.CallSid) return;
    const dur = params.CallDuration != null ? Number(params.CallDuration) : NaN;
    llamadasVozService
      .registrarEstadoPorCallSid(params.CallSid, params.CallStatus || '', Number.isFinite(dur) ? dur : null)
      .catch((e) => console.error('[llamadas-voz] estado-app falló:', e?.message ?? e));
  };

  /** POST /:id/aviso — el paciente contestó: aviso de grabación antes de unir. */
  aviso = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    const id = idDe(req);
    const llamada = id ? await llamadasVozService.get(id) : null;
    xml(res, twimlAvisoPaciente({ pacienteNombre: llamada?.pacienteNombre?.split(' ')[0] || '' }));
  };

  /** POST /:id/estado?leg=coach|paciente — cambios de estado de cada tramo. */
  estado = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    res.status(200).send(); // Twilio quiere el 200 ya; lo demás no lo espera
    const id = idDe(req);
    if (!id) return;
    const leg = req.query.leg === 'paciente' ? 'paciente' : 'coach';
    const dur = params.CallDuration != null ? Number(params.CallDuration) : NaN;
    llamadasVozService
      .registrarEstadoLeg(id, leg, params.CallStatus || '', {
        callSid: params.CallSid,
        duracionSeg: Number.isFinite(dur) ? dur : null,
      })
      .catch((e) => console.error(`[llamadas-voz] estado #${id}/${leg} falló:`, e?.message ?? e));
  };

  /** POST /:id/dial-fin — el <Dial> terminó: decir cómo y colgar. */
  dialFin = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    const id = idDe(req);
    const dialStatus = params.DialCallStatus || '';
    const dur = params.DialCallDuration != null ? Number(params.DialCallDuration) : NaN;
    xml(res, twimlDialFin(dialStatus));
    if (!id) return;
    llamadasVozService
      .registrarDialFin(id, dialStatus, Number.isFinite(dur) ? dur : null)
      .catch((e) => console.error(`[llamadas-voz] dial-fin #${id} falló:`, e?.message ?? e));
  };

  /** POST /:id/grabacion — la grabación quedó lista. */
  grabacion = async (req: Request, res: Response): Promise<void> => {
    const params = validarFirma(req, res);
    if (!params) return;
    res.status(200).send();
    const id = idDe(req);
    if (!id || !params.RecordingSid) return;
    const dur = params.RecordingDuration != null ? Number(params.RecordingDuration) : NaN;
    llamadasVozService
      .registrarGrabacion(id, {
        recordingSid: params.RecordingSid,
        recordingUrl: params.RecordingUrl || '',
        duracionSeg: Number.isFinite(dur) ? dur : null,
        status: params.RecordingStatus || 'completed',
      })
      .catch((e) => console.error(`[llamadas-voz] grabacion #${id} falló:`, e?.message ?? e));
  };
}

export default new LlamadasVozController();

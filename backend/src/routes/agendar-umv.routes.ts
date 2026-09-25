// ============================================================================
// /api/agendar — el afiliado nuevo de MyBodytech agenda su consulta de la UMV.
//
// Público a la fuerza: lo abre el afiliado desde el botón del WhatsApp y no
// tiene cuenta. La única llave es el token del link (aleatorio, 144 bits, uno
// por orden), así que no hay ids que probar. Rate limit por IP igual que
// /reprogramar. Ver agenda-umv.service.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import agendaUmvService from '../services/agenda-umv.service';

const router = Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Demasiados intentos. Espera unos minutos.' },
});

const tokenOk = (t: string) => /^[A-Za-z0-9_-]{20,64}$/.test(t);

const agendarSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hora: z.string().regex(/^\d{2}:\d{2}$/),
});

router.get('/:token', limiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info = tokenOk(req.params.token) ? await agendaUmvService.getInfo(req.params.token) : null;
    if (!info) {
      res.status(404).json({ success: false, error: 'No encontramos tu orden.' });
      return;
    }
    res.json({ success: true, ...info });
  } catch (e) {
    next(e);
  }
});

router.get('/:token/horarios', limiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const info = tokenOk(req.params.token) ? await agendaUmvService.getInfo(req.params.token) : null;
    if (!info) {
      res.status(404).json({ success: false, error: 'No encontramos tu orden.' });
      return;
    }
    const dias = info.estado === 'por_agendar' ? await agendaUmvService.horarios() : [];
    res.json({ success: true, dias });
  } catch (e) {
    next(e);
  }
});

router.post('/:token', limiter, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = agendarSchema.safeParse(req.body);
  if (!parsed.success || !tokenOk(req.params.token)) {
    res.status(400).json({ success: false, error: 'Datos inválidos.' });
    return;
  }
  try {
    const r = await agendaUmvService.agendar(req.params.token, parsed.data.fecha, parsed.data.hora);
    if (!r.ok || !r.data) {
      res.status(r.status).json({ success: false, error: r.error?.code, message: r.error?.message });
      return;
    }
    res.status(201).json({ success: true, ...r.data });
  } catch (e) {
    next(e);
  }
});

export default router;

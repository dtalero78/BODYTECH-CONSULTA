// ============================================================================
// bot-trepsi.controller — HTTP handler para el chat del bot Trepsi.
//
// Endpoint: POST /api/bot-trepsi/chat
// Envelope: { ok, reply | error }
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import botTrepsiService from '../services/bot-trepsi.service';

const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      })
    )
    .min(1)
    .max(40),
});

function zodErrorToDetails(err: ZodError) {
  return err.errors.map((e) => ({
    field: e.path.join('.') || '(root)',
    issue: e.message,
  }));
}

// Rate limit muy básico en memoria (por IP). Para producción seria usar
// upstash / redis, pero para un endpoint de chat de baja-frecuencia esto
// es suficiente para mitigar abuse.
const RATE_LIMIT_MAX = 30; // requests
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 min
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { allowed: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { allowed: true };
}

class BotTrepsiController {
  chat = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const ip = (req.ip || req.headers['x-forwarded-for'] || 'unknown').toString();
      const rl = checkRateLimit(ip);
      if (!rl.allowed) {
        res.status(429).json({
          ok: false,
          error: {
            code: 'RATE_LIMIT',
            message: `Demasiadas peticiones. Reintenta en ${rl.retryAfter}s.`,
          },
        });
        return;
      }

      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Cuerpo inválido.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }

      const result = await botTrepsiService.chat(parsed.data.messages);
      if (!result.ok) {
        res.status(result.status).json({ ok: false, error: result.error });
        return;
      }
      res.status(200).json({ ok: true, reply: result.reply });
    } catch (err) {
      next(err);
    }
  };
}

export default new BotTrepsiController();

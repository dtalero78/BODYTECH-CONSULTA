// ============================================================================
// mybodytech-auth.middleware — Guardia OAuth2 para la integración mybodytech.
//
// Reemplaza al `requireApiKey` (llave fija) por validación de un access_token
// emitido en /oauth/token. Se aplica a TODAS las rutas de negocio; la única
// pública es /oauth/token (donde se obtiene el token).
//
// Convención del header:  Authorization: Bearer <access_token>
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { isConfigured, verifyToken } from '../services/mybodytech-auth.service';

const BEARER_PREFIX = 'Bearer ';

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  return header.slice(BEARER_PREFIX.length).trim() || null;
}

export function requireMybodytechToken(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isConfigured()) {
    console.error(
      '❌ [mybodytech] MYBODYTECH_CLIENT_ID/SECRET no configuradas — endpoint bloqueado.'
    );
    res.status(503).json({
      ok: false,
      error: {
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: 'La integración mybodytech no está habilitada en este ambiente.',
      },
    });
    return;
  }

  const token = extractBearer(req);
  if (!token) {
    res.status(401).json({
      ok: false,
      error: {
        code: 'MISSING_TOKEN',
        message: 'Authorization con Bearer <access_token> es requerido.',
      },
    });
    return;
  }

  try {
    verifyToken(token);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).integration = 'mybodytech';
    next();
  } catch (err: unknown) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TokenExpiredError') {
      res.status(401).json({
        ok: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'El access_token venció. Solicite uno nuevo en /oauth/token.',
        },
      });
      return;
    }
    // Un token con firma/estructura inválida no lo produce el cliente legítimo:
    // suele ser sondeo. Se registra (sin el token) para monitoreo.
    console.warn(`[mybodytech] token rechazado (INVALID_TOKEN) desde IP ${req.ip}`);
    res.status(401).json({
      ok: false,
      error: { code: 'INVALID_TOKEN', message: 'access_token inválido.' },
    });
  }
}

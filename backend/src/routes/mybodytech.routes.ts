// ============================================================================
// mybodytech.routes — Integración API mybodytech <-> Bodytech Consulta.
//
// Base path:  /api/v1/integrations/mybodytech
//
// Flujo acordado (2 fases):
//   Fase 1 (entrada, mybodytech → nosotros): alta del afiliado nuevo +
//     agendamiento de la consulta (el afiliado elige el cupo de nuestra agenda).
//   Fase 2 (salida, nosotros → mybodytech): al cerrar la historia clínica se
//     envían los datos para completar el RIPS (webhook).
//
// Seguridad: OAuth2 client_credentials (mismo esquema que el Validador RIPS de
// Bodytech). mybodytech pide un access_token en POST /oauth/token con su
// client_id + client_secret, y lo usa como `Authorization: Bearer <token>` en
// el resto de endpoints (guardia `requireMybodytechToken`).
//
// Estado: SCAFFOLD inicial. Están activos /oauth/token y /health (este último
// existe para que mybodytech valide URL + token de una vez). Los endpoints de
// negocio (GET /horarios-disponibles, GET /sedes, POST /afiliados,
// GET/DELETE /afiliados/:eventoId) se agregan al cerrar el contrato.
// ============================================================================

import { Router, Request, Response } from 'express';
import {
  isConfigured,
  verifyCredentials,
  issueToken,
} from '../services/mybodytech-auth.service';
import { requireMybodytechToken } from '../middleware/mybodytech-auth.middleware';

const router = Router();

// ---------------------------------------------------------------------------
// PÚBLICO — obtener el access_token (OAuth2 client_credentials).
// Espeja el contrato del validador de ellos: POST JSON con grant_type,
// client_id y client_secret; responde { access_token, token_type, expires_in }.
// ---------------------------------------------------------------------------
router.post('/oauth/token', (req: Request, res: Response) => {
  if (!isConfigured()) {
    return res.status(503).json({
      ok: false,
      error: {
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: 'La integración mybodytech no está habilitada en este ambiente.',
      },
    });
  }

  const { grant_type, client_id, client_secret } = (req.body ?? {}) as Record<
    string,
    unknown
  >;

  if (grant_type !== 'client_credentials') {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'UNSUPPORTED_GRANT_TYPE',
        message: "grant_type debe ser 'client_credentials'.",
      },
    });
  }

  if (!client_id || !client_secret) {
    return res.status(400).json({
      ok: false,
      error: {
        code: 'INVALID_REQUEST',
        message: 'client_id y client_secret son requeridos.',
      },
    });
  }

  if (!verifyCredentials(String(client_id), String(client_secret))) {
    return res.status(401).json({
      ok: false,
      error: { code: 'INVALID_CLIENT', message: 'client_id o client_secret inválidos.' },
    });
  }

  const { accessToken, expiresIn } = issueToken();
  return res.status(200).json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
    scope: null,
  });
});

// ---------------------------------------------------------------------------
// A partir de aquí, TODO exige un access_token válido.
// ---------------------------------------------------------------------------
router.use(requireMybodytechToken);

// Health check de la integración. Sirve para que mybodytech confirme, en un
// solo llamado, que la URL es correcta Y que su token es válido.
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    ok: true,
    integration: 'mybodytech',
    version: '1.0',
    timestamp: new Date().toISOString(),
  });
});

export default router;

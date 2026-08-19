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
import rateLimit from 'express-rate-limit';
import { z, ZodError } from 'zod';
import {
  isConfigured,
  verifyCredentials,
  issueToken,
} from '../services/mybodytech-auth.service';
import { requireMybodytechToken } from '../middleware/mybodytech-auth.middleware';
import mybodytechService from '../services/mybodytech.service';

const router = Router();

// Esquema del payload de alta de afiliado (espejo de lo que envía mybodytech).
const afiliadoSchema = z.object({
  eventoId: z.string().min(1),
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD.'),
  hora: z.string().regex(/^\d{2}:\d{2}$/, 'hora debe ser HH:MM.'),
  professionalName: z.string().min(1),
  afiliado: z.object({
    numeroId: z.string().min(1),
    tipoDocumento: z.string().min(1),
    primerNombre: z.string().min(1),
    segundoNombre: z.string().optional(),
    primerApellido: z.string().min(1),
    segundoApellido: z.string().optional(),
    fechaNacimiento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fechaNacimiento debe ser YYYY-MM-DD.'),
    sexo: z.string().optional(),
    celular: z.string().min(1),
    email: z.string().optional(),
  }),
});

// Rate limit del endpoint de token: es público y valida el client_secret, así
// que lo protegemos contra fuerza bruta / credential stuffing / DoS. El uso
// legítimo pide un token ~cada 10h, así que 30 intentos por IP cada 15 min es
// de sobra para el cliente real y frena a un atacante.
const tokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Demasiados intentos de autenticación. Espera unos minutos.',
    },
  },
});

// ---------------------------------------------------------------------------
// PÚBLICO — obtener el access_token (OAuth2 client_credentials).
// Espeja el contrato del validador de ellos: POST JSON con grant_type,
// client_id y client_secret; responde { access_token, token_type, expires_in }.
// ---------------------------------------------------------------------------
router.post('/oauth/token', tokenLimiter, (req: Request, res: Response) => {
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
    // Auditoría: registrar el intento fallido (IP + client_id truncado) para
    // detectar fuerza bruta. NUNCA se loguea el client_secret.
    console.warn(
      `[mybodytech] auth fallida (INVALID_CLIENT) desde IP ${req.ip} · client_id=${String(
        client_id
      ).slice(0, 40)}`
    );
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

// ---------------------------------------------------------------------------
// Fase 1 — Alta del afiliado + agendamiento de la consulta.
// mybodytech envía fecha/hora + el NOMBRE del profesional (agenda no
// sincronizada). Idempotente por eventoId.
// ---------------------------------------------------------------------------
router.post('/afiliados', async (req: Request, res: Response) => {
  let input;
  try {
    input = afiliadoSchema.parse(req.body);
  } catch (e) {
    if (e instanceof ZodError) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: e.errors.map((x) => `${x.path.join('.')}: ${x.message}`).join('; '),
        },
      });
    }
    throw e;
  }

  const result = await mybodytechService.createAfiliado(input);
  if (!result.ok || !result.data) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  const d = result.data;
  return res.status(result.status).json({
    ok: true,
    afiliadoId: d.afiliadoId,
    cita: {
      eventoId: d.eventoId,
      estado: d.estado,
      fechaAtencion: d.fechaAtencion,
      professionalName: d.professionalName,
    },
  });
});

// Consultar el estado de un afiliado/cita por eventoId.
router.get('/afiliados/:eventoId', async (req: Request, res: Response) => {
  const result = await mybodytechService.getAfiliado(req.params.eventoId);
  if (!result.ok || !result.data) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  const d = result.data;
  return res.status(200).json({
    ok: true,
    afiliadoId: d.afiliadoId,
    cita: {
      eventoId: d.eventoId,
      estado: d.estado,
      fechaAtencion: d.fechaAtencion,
      professionalName: d.professionalName,
    },
  });
});

export default router;

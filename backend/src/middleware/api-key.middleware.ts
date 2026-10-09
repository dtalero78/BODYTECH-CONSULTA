// ============================================================================
// api-key.middleware — Autenticación por API Key para integraciones B2B.
//
// Se usa para autenticar peticiones entrantes desde sistemas externos
// (Trepsi y futuras integraciones) que NO usan el flujo JWT de médicos.
//
// Convención del header:
//   Authorization: Bearer <api_key>
//
// La clave se compara con `TREPSI_API_KEY` (env var). La validación usa
// comparación de tiempo constante (timingSafeEqual) para mitigar ataques
// por tiempo. Si el env var no está configurado, el middleware responde
// 503 — no queremos que un deploy mal configurado deje el endpoint abierto.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';

const BEARER_PREFIX = 'Bearer ';

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  return header.slice(BEARER_PREFIX.length).trim() || null;
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Factory: devuelve un middleware que valida `Authorization: Bearer <key>`
 * contra el env var indicado.
 *
 * Ejemplo:
 *   app.use('/api/v1/integrations/trepsi',
 *     requireApiKey('TREPSI_API_KEY', 'trepsi'),
 *     trepsiRoutes);
 */
/**
 * Llave alterna de PRUEBAS. Quien entre con ella queda marcado
 * (`req.integrationPruebas = true`) y recibe el comportamiento nuevo —el que
 * todavía no está aprobado con el socio— mientras la llave de producción
 * sigue comportándose exactamente como antes.
 *
 * Nace de lo del 8-oct-2026: se prendió el control de cupo para todos sin
 * probarlo y en 17 horas rechazamos 178 citas de Trepsi, con pacientes que no
 * quedaron agendados. Un cambio en una puerta por donde entra el 94% del
 * volumen se prueba primero con una llave aparte.
 *
 * Opcional: sin la variable configurada, nadie puede entrar en modo pruebas.
 */
function envPruebas(envVarName: string): string | undefined {
  const v = process.env[`${envVarName}_PRUEBAS`];
  return v && v.trim().length > 0 ? v : undefined;
}

export function requireApiKey(envVarName: string, integrationName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = process.env[envVarName];

    if (!expected || expected.trim().length === 0) {
      console.error(
        `❌ [api-key] ${envVarName} no está configurada — endpoint protegido bloqueado.`
      );
      res.status(503).json({
        ok: false,
        error: {
          code: 'INTEGRATION_NOT_CONFIGURED',
          message: `La integración ${integrationName} no está habilitada en este ambiente.`,
        },
      });
      return;
    }

    const provided = extractBearer(req);
    if (!provided) {
      res.status(401).json({
        ok: false,
        error: {
          code: 'MISSING_API_KEY',
          message: 'Authorization header con Bearer token es requerido.',
        },
      });
      return;
    }

    const esPruebas = (() => {
      const alterna = envPruebas(envVarName);
      return alterna ? constantTimeEquals(provided, alterna) : false;
    })();

    if (!esPruebas && !constantTimeEquals(provided, expected)) {
      res.status(401).json({
        ok: false,
        error: {
          code: 'INVALID_API_KEY',
          message: 'API Key inválida.',
        },
      });
      return;
    }

    // Marcar el request como autenticado por integración externa.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).integration = integrationName;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).integrationPruebas = esPruebas;
    next();
  };
}

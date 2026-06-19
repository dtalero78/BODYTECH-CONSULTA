// ============================================================================
// monitor-integracion.controller — Eventos de la integración Trepsi para el
// dashboard de monitoreo en vivo (/monitor-integracion).
//
// Protegido por un token simple `MONITOR_TOKEN` (env var). El usuario abre el
// dashboard con `?token=...` y el frontend lo pasa en cada request. Es un
// mecanismo muy ligero — pensado para que el usuario lo use durante las
// pruebas con Trepsi sin pelearse con el sistema RBAC nuevo.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import integrationLogService from '../services/integration-log.service';
import postgresService from '../services/postgres.service';
import trepsiWebhookService from '../services/trepsi-webhook.service';

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function checkToken(req: Request, res: Response): boolean {
  const expected = process.env.MONITOR_TOKEN;
  if (!expected || expected.length === 0) {
    res.status(503).json({
      ok: false,
      error: { code: 'MONITOR_NOT_CONFIGURED', message: 'MONITOR_TOKEN no configurada.' },
    });
    return false;
  }
  const provided =
    (typeof req.query.token === 'string' && req.query.token) ||
    (typeof req.headers['x-monitor-token'] === 'string' && req.headers['x-monitor-token']) ||
    '';
  if (!provided || !constantTimeEquals(provided, expected)) {
    res.status(401).json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Token inválido.' } });
    return false;
  }
  return true;
}

class MonitorIntegracionController {
  /**
   * GET /events?token=...&since=ISO
   * Devuelve eventos creados después de `since` (incluyendo el lado outbound
   * actual del outbox). Si `since` no se pasa, devuelve los últimos 200.
   */
  events = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      // Cursor por id (numérico, monótono). Acepta tanto `?sinceId=N` como
      // `?since=N` por compatibilidad. Si llega un string ISO viejo, se ignora.
      const raw =
        typeof req.query.sinceId === 'string'
          ? req.query.sinceId
          : typeof req.query.since === 'string'
            ? req.query.since
            : null;
      let sinceId: number | null = null;
      if (raw !== null && /^\d+$/.test(raw)) {
        sinceId = Number(raw);
      }
      const limit = Math.min(Number(req.query.limit) || 200, 500);
      const rows = await integrationLogService.listSince(sinceId, limit);
      res.status(200).json({
        ok: true,
        serverTime: new Date().toISOString(),
        count: rows.length,
        events: rows,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /test-webhook?token=...
   * Inserta una fila sintética en trepsi_webhook_outbox y fuerza dispatch
   * inmediato. Útil para verificar que el outbound se registra en el monitor
   * sin tener que pasar por todo el flujo del médico.
   *
   * El payload va con `citaId` y `historiaClinicaId` prefijados con
   * `TEST-MONITOR-...` para que Trepsi pueda ignorarlos (o los rechace con
   * su validación). En cualquier caso, el monitor captura el outbound.
   */
  testWebhook = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const ts = Date.now();
      const citaId = `TEST-MONITOR-${ts}`;
      const historiaId = `hc_test_${ts}`;

      const testPayload = {
        eventType: 'test',
        citaId,
        historiaClinicaId: historiaId,
        fechaConsulta: new Date().toISOString(),
        estado: 'completed',
        medico: { codigo: 'TEST-MED', nombre: 'Test Médico' },
        resultados: {
          motivoConsulta: 'Test de monitor — payload sintético generado desde /api/monitor-integracion/test-webhook',
          diagnosticos: [],
        },
        adjuntos: [],
        firma: null,
        _testInfo: {
          source: 'bodytech-monitor',
          purpose: 'Smoke test del canal outbound. Pueden ignorar este evento.',
        },
        sourceVersion: '2.1',
      };

      // Encolamos directamente en el outbox.
      await postgresService.query(
        `INSERT INTO trepsi_webhook_outbox (cita_id, historia_id, payload)
         VALUES ($1, $2, $3)`,
        [citaId, historiaId, JSON.stringify(testPayload)]
      );

      // Forzamos dispatch inmediato (no esperamos al setInterval de 30s).
      const result = await trepsiWebhookService.dispatchPending();

      res.status(200).json({
        ok: true,
        message: 'Test webhook enviado. Revisa el monitor para ver el evento outbound.',
        dispatchResult: result,
        testPayload: { citaId, historiaClinicaId: historiaId },
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /discard-outbox?token=...
   * Body: { ids: number[] }
   *
   * Marca como 'dead' las filas seleccionadas del outbox para que el worker
   * deje de reintentarlas. Usado para descartar payloads viejos que fallan
   * con formato incorrecto en el receptor (ej. videoCallLink sin required
   * fields antes del fix). Es una operación de housekeeping del operador.
   */
  discardOutbox = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const numIds = ids
        .map((v: unknown) => Number(v))
        .filter((n: number) => Number.isInteger(n) && n > 0);
      const filter = typeof req.body?.filter === 'string' ? req.body.filter : null;

      if (numIds.length === 0 && !filter) {
        res
          .status(400)
          .json({ ok: false, error: { code: 'NO_TARGET', message: 'ids[] o filter requerido.' } });
        return;
      }

      let rows;
      if (numIds.length > 0) {
        rows = await postgresService.query(
          `UPDATE trepsi_webhook_outbox
              SET estado = 'dead',
                  last_error = COALESCE(last_error, '') || ' | descartado por operador (monitor)',
                  updated_at = NOW()
            WHERE id = ANY($1::int[]) AND estado IN ('pending','failed')
            RETURNING id, estado`,
          [numIds]
        );
      } else if (filter === 'stale-video-call-link') {
        // Descarta filas pending/failed cuyo payload tiene eventType
        // 'videoCallLink' pero NO el shape v2.1 (sin fechaConsulta) — son las
        // que quedaron del fix retrocompatible y nunca van a pasar validación.
        rows = await postgresService.query(
          `UPDATE trepsi_webhook_outbox
              SET estado = 'dead',
                  last_error = COALESCE(last_error, '') || ' | descartado: payload viejo videoCallLink sin shape v2.1',
                  updated_at = NOW()
            WHERE estado IN ('pending','failed')
              AND payload->>'eventType' = 'videoCallLink'
              AND payload->>'fechaConsulta' IS NULL
            RETURNING id, estado`,
          []
        );
      } else {
        res
          .status(400)
          .json({ ok: false, error: { code: 'BAD_FILTER', message: 'filter no soportado.' } });
        return;
      }

      res.status(200).json({
        ok: true,
        descartadas: rows?.length ?? 0,
        ids: rows?.map((r: { id: number }) => r.id) ?? [],
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /summary?token=...
   * Resumen agregado: total inbound/outbound, errores, últimos por tipo.
   * Útil para los counters del header del dashboard.
   */
  summary = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const sinceHours = Math.min(Number(req.query.hours) || 24, 168);

      const stats = await postgresService.query(
        `SELECT
           direccion,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ok = TRUE)::int AS ok,
           COUNT(*) FILTER (WHERE ok = FALSE)::int AS errores,
           AVG(latency_ms)::int AS latencia_promedio_ms
         FROM trepsi_integration_log
         WHERE created_at > NOW() - ($1 || ' hours')::interval
         GROUP BY direccion`,
        [String(sinceHours)]
      );

      const porTipo = await postgresService.query(
        `SELECT
           tipo, direccion,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE ok = FALSE)::int AS errores
         FROM trepsi_integration_log
         WHERE created_at > NOW() - ($1 || ' hours')::interval
         GROUP BY tipo, direccion
         ORDER BY total DESC`,
        [String(sinceHours)]
      );

      const outbox = await postgresService.query(
        `SELECT estado, COUNT(*)::int AS total
           FROM trepsi_webhook_outbox
           GROUP BY estado`,
        []
      );

      res.status(200).json({
        ok: true,
        ventanaHoras: sinceHours,
        porDireccion: stats ?? [],
        porTipo: porTipo ?? [],
        outbox: outbox ?? [],
      });
    } catch (err) {
      next(err);
    }
  };
}

export default new MonitorIntegracionController();

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
   * GET /agenda-simultaneidad?token=...&year=YYYY&month=1-12
   *
   * Devuelve estadísticas de la agenda de un mes (por defecto: mes actual en
   * Colombia UTC-5) para ver cuántas consultas simultáneas hay por slot.
   *
   * - `porDia`: citas por día (útil para ver picos)
   * - `porSlot`: citas agrupadas por (fecha, hora) — cada fila = un slot con N
   *   citas simultáneas. Ordenado desc por count.
   * - `porHora`: histograma total por hora del día (para ver bandas ocupadas)
   * - `topSimultaneidad`: los 10 slots con más consultas al mismo tiempo
   * - `totales`: totales del mes (citas, únicos, por sede)
   */
  agendaSimultaneidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      // Ventana en hora Colombia (UTC-5). Un día = [00:00, 24:00) Colombia.
      const now = new Date();
      const colombiaNow = new Date(now.getTime() - 5 * 60 * 60 * 1000);
      const year = Number(req.query.year) || colombiaNow.getUTCFullYear();
      const month = Number(req.query.month) || colombiaNow.getUTCMonth() + 1; // 1-12
      if (month < 1 || month > 12) {
        res.status(400).json({ ok: false, error: { code: 'BAD_MONTH' } });
        return;
      }
      // Inicio y fin del mes en UTC (Colombia = UTC-5 → sumar 5 h para bordes).
      const startUtc = new Date(Date.UTC(year, month - 1, 1, 5, 0, 0)).toISOString();
      const endUtc = new Date(Date.UTC(year, month, 1, 5, 0, 0)).toISOString();

      // Total y por sede
      const totales = await postgresService.query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(DISTINCT "numeroId")::int AS pacientes_unicos,
           COUNT(*) FILTER (WHERE "atendido" = 'REPROGRAMADA')::int AS reprogramadas,
           COUNT(*) FILTER (WHERE "atendido" = 'PENDIENTE')::int AS pendientes,
           COUNT(*) FILTER (WHERE "atendido" = 'ATENDIDO')::int AS atendidas
         FROM "HistoriaClinica"
         WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz`,
        [startUtc, endUtc]
      );

      const porSede = await postgresService.query(
        `SELECT COALESCE("sede_id",'bsl') AS sede, COUNT(*)::int AS total
           FROM "HistoriaClinica"
          WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz
          GROUP BY 1 ORDER BY 2 DESC`,
        [startUtc, endUtc]
      );

      // Por día (fecha Colombia)
      const porDia = await postgresService.query(
        `SELECT to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
                COUNT(*)::int AS total,
                COUNT(DISTINCT "medico")::int AS medicos_distintos
           FROM "HistoriaClinica"
          WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz
          GROUP BY 1 ORDER BY 1`,
        [startUtc, endUtc]
      );

      // Por slot (fecha + hora) — mide simultaneidad exacta
      const porSlot = await postgresService.query(
        `SELECT to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
                COALESCE("horaAtencion",'—') AS hora,
                COUNT(*)::int AS simultaneas,
                COUNT(DISTINCT "medico")::int AS medicos,
                COUNT(DISTINCT COALESCE("sede_id",'bsl'))::int AS sedes,
                ARRAY_AGG(DISTINCT COALESCE("sede_id",'bsl')) AS sedes_list
           FROM "HistoriaClinica"
          WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz
            AND "horaAtencion" IS NOT NULL
          GROUP BY 1, 2
          HAVING COUNT(*) > 1
          ORDER BY simultaneas DESC, fecha, hora
          LIMIT 100`,
        [startUtc, endUtc]
      );

      // Histograma por hora del día (0-23)
      const porHora = await postgresService.query(
        `SELECT SUBSTRING(COALESCE("horaAtencion",''), 1, 2) AS hora,
                COUNT(*)::int AS total
           FROM "HistoriaClinica"
          WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz
            AND "horaAtencion" IS NOT NULL
          GROUP BY 1 ORDER BY 1`,
        [startUtc, endUtc]
      );

      // Simultaneidad global por día (pico del día — máximo de citas al mismo tiempo)
      const picoPorDia = await postgresService.query(
        `SELECT fecha, MAX(simultaneas)::int AS pico_simultaneidad,
                (ARRAY_AGG(hora ORDER BY simultaneas DESC))[1] AS hora_pico
           FROM (
             SELECT to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
                    "horaAtencion" AS hora,
                    COUNT(*)::int AS simultaneas
               FROM "HistoriaClinica"
              WHERE "fechaAtencion"::timestamptz >= $1::timestamptz AND "fechaAtencion"::timestamptz < $2::timestamptz
                AND "horaAtencion" IS NOT NULL
              GROUP BY 1, 2
           ) s
           GROUP BY fecha ORDER BY fecha`,
        [startUtc, endUtc]
      );

      res.status(200).json({
        ok: true,
        ventana: { year, month, startUtc, endUtc },
        totales: totales?.[0] ?? null,
        porSede: porSede ?? [],
        porDia: porDia ?? [],
        porHora: porHora ?? [],
        picoPorDia: picoPorDia ?? [],
        porSlot: porSlot ?? [],
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /revive-cita?token=...
   * Body: { citaId: string, resendReschedule?: boolean }
   *
   * Revive una cita Trepsi marcada como 'cancelled' (la pasa a 'scheduled').
   * Si resendReschedule=true, además dispara un webhook `rescheduled` con la
   * fecha/hora actual de la HC en Bodytech para que Trepsi se entere del
   * cambio retroactivo.
   *
   * Usado para casos donde Trepsi nos canceló la cita por error o por una
   * cascada de errores transitorios, y el paciente ya reprogramó del lado
   * de Bodytech.
   */
  reviveCita = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const citaId = typeof req.body?.citaId === 'string' ? req.body.citaId : '';
      const resendReschedule = req.body?.resendReschedule === true;
      if (!citaId) {
        res.status(400).json({ ok: false, error: { code: 'NO_CITA_ID', message: 'citaId requerido.' } });
        return;
      }

      // 1) Revivir la cita en trepsi_appointments.
      const updated = await postgresService.query(
        `UPDATE trepsi_appointments
            SET estado = 'scheduled', updated_at = NOW()
          WHERE cita_id = $1 AND estado = 'cancelled'
          RETURNING cita_id, historia_id, fecha_atencion`,
        [citaId]
      );
      if (updated === null) {
        res.status(500).json({ ok: false, error: { code: 'DB_ERROR' } });
        return;
      }
      if (updated.length === 0) {
        res.status(404).json({
          ok: false,
          error: { code: 'NOT_CANCELLED', message: 'La cita no está cancelled (o no existe).' },
        });
        return;
      }

      const row = updated[0];
      const historiaId = String(row.historia_id);
      const fechaAtencionAnterior = row.fecha_atencion
        ? new Date(row.fecha_atencion).toISOString()
        : null;

      // 2) Opcionalmente, reenviar el reschedule con la fecha actual de la HC.
      let enqueueResult: { enqueued: boolean; reason?: string } | null = null;
      if (resendReschedule) {
        const hcRows = await postgresService.query(
          'SELECT "fechaAtencion", "horaAtencion" FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1',
          [historiaId]
        );
        if (hcRows && hcRows.length > 0) {
          const hc = hcRows[0];
          const fechaNueva = hc.fechaAtencion ? String(hc.fechaAtencion).slice(0, 10) : '';
          const horaNueva = hc.horaAtencion ? String(hc.horaAtencion) : '';
          if (fechaNueva && horaNueva) {
            enqueueResult = await trepsiWebhookService.enqueueReschedule(
              historiaId,
              fechaAtencionAnterior,
              null,
              fechaNueva,
              horaNueva,
              'patient'
            );
          }
        }
      }

      res.status(200).json({
        ok: true,
        citaId,
        historiaId,
        revived: true,
        enqueueResult,
      });
    } catch (err) {
      next(err);
    }
  };

  /**
   * GET /debug-historia?token=...&id=trepsi_xxx
   * Inspeccionar el estado de una historia: ¿está en HistoriaClinica? ¿está
   * vinculada en trepsi_appointments? Útil para debug del flujo reschedule.
   */
  debugHistoria = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!checkToken(req, res)) return;
    try {
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      if (!id) {
        res.status(400).json({ ok: false, error: { code: 'NO_ID', message: 'id requerido.' } });
        return;
      }
      const hc = await postgresService.query(
        `SELECT "_id", "medico", "primerNombre", "fechaAtencion", "horaAtencion", "atendido",
                COALESCE("sede_id",'bsl') AS sede_id, "datosNutricionales" IS NOT NULL AS tiene_datos_nutri
           FROM "HistoriaClinica" WHERE "_id" = $1`,
        [id]
      );
      const trepsiAppt = await postgresService.query(
        `SELECT cita_id, historia_id, estado, fecha_atencion, medico_codigo, sede_origen
           FROM trepsi_appointments WHERE historia_id = $1`,
        [id]
      );
      const outboxRows = await postgresService.query(
        `SELECT id, estado, intentos, last_status_code, created_at, updated_at,
                payload->>'eventType' AS event_type, payload->>'estado' AS payload_estado
           FROM trepsi_webhook_outbox WHERE historia_id = $1
           ORDER BY id DESC LIMIT 10`,
        [id]
      );
      res.status(200).json({
        ok: true,
        historiaClinica: hc?.[0] ?? null,
        trepsi_appointments: trepsiAppt ?? [],
        outbox_lastRows: outboxRows ?? [],
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

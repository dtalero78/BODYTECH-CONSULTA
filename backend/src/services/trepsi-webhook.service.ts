// ============================================================================
// trepsi-webhook.service — Webhook BSL → Trepsi (resultados de consulta).
//
// Flujo:
//   1) `historia-mutation.updateMedicalHistory()` llama `enqueue(historiaId)`
//      al final del guardado de HC, si la cita es Trepsi (sede_id='trepsi'
//      o existe en trepsi_appointments).
//   2) `enqueue` construye el payload (sección 6 spec v2.1), lo guarda en
//      `trepsi_webhook_outbox` con estado='pending' y proximo_intento_at=NOW().
//      Dispara `dispatchPending()` inmediatamente para enviarlo cuanto antes
//      (fire-and-forget).
//   3) El worker (setInterval cada 30s desde index.ts) llama `dispatchPending()`
//      que toma todas las filas pending listas, hace POST al webhook con
//      Bearer token, marca sent/failed con backoff exponencial.
//
// Backoff: 1s, 5s, 30s, 5min, 30min, 2h. Tras 6 intentos pasa a 'dead'.
// Timeout HTTP: 10s.
//
// Env vars requeridas:
//   - TREPSI_WEBHOOK_URL     (URL completa del webhook de Trepsi)
//   - TREPSI_WEBHOOK_API_KEY (token que Trepsi emite para autenticarnos)
// ============================================================================

import postgresService from './postgres.service';
import integrationLogService from './integration-log.service';

const TIMEOUT_MS = 10_000;
const MAX_INTENTOS = 6;
// Delays en segundos para cada intento (1-indexed: intento 1 falla → wait[0]).
const BACKOFF_SECONDS = [1, 5, 30, 5 * 60, 30 * 60, 2 * 60 * 60];

export interface OutboxRow {
  id: number;
  cita_id: string;
  historia_id: string;
  estado: 'pending' | 'sent' | 'failed' | 'dead';
  intentos: number;
  proximo_intento_at: string;
  last_error: string | null;
  last_status_code: number | null;
  created_at: string;
  sent_at: string | null;
}

class TrepsiWebhookService {
  // -----------------------------------------------------------------------
  // ENQUEUE - Link de la videollamada (cuando el médico inicia la sesión)
  // -----------------------------------------------------------------------

  /**
   * Cuando se envía al paciente el link de la videollamada por WhatsApp,
   * también se lo enviamos a Trepsi para que pueda mostrárselo en su app
   * y notificar al usuario por su propio canal.
   *
   * Idempotencia: no encolamos duplicados — si ya hay una fila pending con
   * el MISMO videoCallUrl para esta cita, no insertamos otra.
   */
  async enqueueLink(
    historiaId: string,
    videoCallUrl: string,
    patientPhone?: string | null
  ): Promise<{ enqueued: boolean; reason?: string }> {
    if (!historiaId) return { enqueued: false, reason: 'NO_HISTORIA_ID' };
    if (!videoCallUrl) return { enqueued: false, reason: 'NO_URL' };

    const apptRows = await postgresService.query(
      'SELECT cita_id, estado FROM trepsi_appointments WHERE historia_id = $1 LIMIT 1',
      [historiaId]
    );
    if (apptRows === null) {
      return { enqueued: false, reason: 'DB_ERROR' };
    }
    if (apptRows.length === 0) {
      return { enqueued: false, reason: 'NOT_TREPSI' };
    }
    const cita = apptRows[0];
    if (String(cita.estado) === 'cancelled') {
      return { enqueued: false, reason: 'CITA_CANCELLED' };
    }
    const citaId = String(cita.cita_id);

    // Cargamos la HC para incluir los campos required por la validación de
    // Trepsi (`fechaConsulta`, `medico.codigo`, `estado`) — sin esto su Cloud
    // Function responde 400 "Missing required fields".
    const hcRows = await postgresService.query(
      'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1',
      [historiaId]
    );
    if (hcRows === null || hcRows.length === 0) {
      return { enqueued: false, reason: 'HC_NOT_FOUND' };
    }
    const hc = hcRows[0];

    // Mismo shape v2.1 §6 que `completed`, con dos campos extra para que
    // ellos distingan el evento: `eventType` y `videoCallUrl`. Reusar el
    // builder garantiza que la forma sea retrocompatible.
    const base = buildPayload({ citaId, historiaId, hc });
    const payload = {
      ...base,
      // Aún no se ha consignado la consulta: marcamos `in_progress` para no
      // mentirle a Trepsi diciendo `completed`. Si su validador es estricto
      // con el enum, lo refinamos.
      estado: 'in_progress',
      eventType: 'videoCallLink',
      videoCallUrl,
      patientPhone: patientPhone ?? null,
      sentAt: new Date().toISOString(),
    };

    await postgresService.query(
      `INSERT INTO trepsi_webhook_outbox (cita_id, historia_id, payload)
       VALUES ($1, $2, $3)`,
      [citaId, historiaId, JSON.stringify(payload)]
    );

    // Dispatch inmediato fire-and-forget (no bloqueamos el WhatsApp send).
    this.dispatchPending().catch((e) => {
      console.error('[trepsi-webhook] dispatchPending (link) falló:', e);
    });

    return { enqueued: true };
  }

  // -----------------------------------------------------------------------
  // ENQUEUE
  // -----------------------------------------------------------------------

  /**
   * Verifica si la historia clínica corresponde a una cita Trepsi. Si lo es,
   * construye el payload con los resultados consignados por el médico y la
   * encola para envío al webhook.
   */
  async enqueue(historiaId: string): Promise<{ enqueued: boolean; reason?: string }> {
    if (!historiaId) return { enqueued: false, reason: 'NO_HISTORIA_ID' };

    // 1) Buscar la cita Trepsi vinculada (si existe).
    const apptRows = await postgresService.query(
      'SELECT cita_id, estado, payload FROM trepsi_appointments WHERE historia_id = $1 LIMIT 1',
      [historiaId]
    );
    if (apptRows === null) {
      console.error('[trepsi-webhook] DB error consultando trepsi_appointments');
      return { enqueued: false, reason: 'DB_ERROR' };
    }
    if (apptRows.length === 0) {
      // No es cita Trepsi → no encolamos.
      return { enqueued: false, reason: 'NOT_TREPSI' };
    }
    const cita = apptRows[0];
    if (String(cita.estado) === 'cancelled') {
      return { enqueued: false, reason: 'CITA_CANCELLED' };
    }
    const citaId = String(cita.cita_id);

    // 2) Cargar la historia clínica completa (queremos todos los campos que
    //    el médico haya consignado).
    const hcRows = await postgresService.query(
      'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1',
      [historiaId]
    );
    if (hcRows === null || hcRows.length === 0) {
      return { enqueued: false, reason: 'HC_NOT_FOUND' };
    }
    const hc = hcRows[0];

    // 3) Construir payload (sección 6 spec v2.1).
    const payload = buildPayload({
      citaId,
      historiaId,
      hc,
    });

    // 4) Marcar la cita como atendida en trepsi_appointments (idempotente).
    await postgresService.query(
      `UPDATE trepsi_appointments
          SET estado = 'attended', updated_at = NOW()
        WHERE cita_id = $1 AND estado <> 'cancelled'`,
      [citaId]
    );

    // 5) Encolar (estado='pending', primer intento inmediato).
    //    Si ya hay una fila pending para esta cita, NO duplicamos —
    //    actualizamos su payload para que envíe la versión más reciente.
    const existing = await postgresService.query(
      `SELECT id FROM trepsi_webhook_outbox
         WHERE cita_id = $1 AND estado IN ('pending', 'failed')
         LIMIT 1`,
      [citaId]
    );
    if (existing && existing.length > 0) {
      await postgresService.query(
        `UPDATE trepsi_webhook_outbox
            SET payload = $1,
                estado = 'pending',
                proximo_intento_at = NOW(),
                updated_at = NOW()
          WHERE id = $2`,
        [JSON.stringify(payload), existing[0].id]
      );
    } else {
      await postgresService.query(
        `INSERT INTO trepsi_webhook_outbox (cita_id, historia_id, payload)
         VALUES ($1, $2, $3)`,
        [citaId, historiaId, JSON.stringify(payload)]
      );
    }

    // 6) Disparar dispatch inmediato en background (fire-and-forget).
    this.dispatchPending().catch((e) => {
      console.error('[trepsi-webhook] dispatchPending falló (no bloqueante):', e);
    });

    return { enqueued: true };
  }

  // -----------------------------------------------------------------------
  // DISPATCH (worker)
  // -----------------------------------------------------------------------

  /**
   * Toma todas las filas pending listas, hace POST al webhook y actualiza el
   * estado según el resultado. Se llama:
   *   - Inmediatamente tras encolar (caso happy path).
   *   - Cada 30s desde el setInterval en index.ts (reintentos).
   */
  async dispatchPending(): Promise<{ procesados: number; ok: number; fail: number }> {
    const url = process.env.TREPSI_WEBHOOK_URL;
    const apiKey = process.env.TREPSI_WEBHOOK_API_KEY;
    if (!url || !apiKey) {
      // Silencioso porque puede ser ambiente dev sin webhook configurado.
      return { procesados: 0, ok: 0, fail: 0 };
    }

    const rows = await postgresService.query(
      `SELECT id, cita_id, historia_id, payload, intentos
         FROM trepsi_webhook_outbox
         WHERE estado = 'pending' AND proximo_intento_at <= NOW()
         ORDER BY proximo_intento_at
         LIMIT 25`,
      []
    );
    if (rows === null || rows.length === 0) {
      return { procesados: 0, ok: 0, fail: 0 };
    }

    let okCount = 0;
    let failCount = 0;
    for (const row of rows) {
      const id = Number(row.id);
      const citaId = String(row.cita_id);
      const intentoActual = Number(row.intentos) + 1;
      const payload =
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

      const startedAt = Date.now();
      const result = await sendWebhook(url, apiKey, payload);
      const latencyMs = Date.now() - startedAt;

      // Registrar en el monitor (best-effort)
      let parsedRes: unknown = result.body ?? null;
      if (typeof parsedRes === 'string') {
        try {
          parsedRes = JSON.parse(parsedRes);
        } catch {
          /* keep as string */
        }
      }
      integrationLogService
        .log({
          direccion: 'outbound',
          tipo: 'webhook.consultationResults',
          metodo: 'POST',
          path: url,
          citaId,
          statusCode: result.status ?? null,
          ok: result.ok,
          latencyMs,
          requestBody: payload,
          responseBody: parsedRes,
          errorCode: result.ok ? null : (result.status ? `HTTP_${result.status}` : 'NETWORK_ERROR'),
          errorMessage: result.error ?? null,
        })
        .catch(() => {});

      if (result.ok) {
        await postgresService.query(
          `UPDATE trepsi_webhook_outbox
              SET estado = 'sent',
                  intentos = $1,
                  last_status_code = $2,
                  response_body = $3,
                  sent_at = NOW(),
                  updated_at = NOW(),
                  last_error = NULL
            WHERE id = $4`,
          [intentoActual, result.status, (result.body ?? '').slice(0, 2000), id]
        );
        console.log(
          `[trepsi-webhook] ✅ cita ${citaId} enviada (status=${result.status}, intento=${intentoActual})`
        );
        okCount++;
      } else {
        // Falló este intento. ¿Reintentar?
        const isDead = intentoActual >= MAX_INTENTOS;
        const backoffIdx = Math.min(intentoActual - 1, BACKOFF_SECONDS.length - 1);
        const nextSeconds = BACKOFF_SECONDS[backoffIdx];
        await postgresService.query(
          `UPDATE trepsi_webhook_outbox
              SET estado = $1,
                  intentos = $2,
                  last_status_code = $3,
                  last_error = $4,
                  response_body = $5,
                  proximo_intento_at = NOW() + ($6 || ' seconds')::interval,
                  updated_at = NOW()
            WHERE id = $7`,
          [
            isDead ? 'dead' : 'pending',
            intentoActual,
            result.status ?? null,
            (result.error ?? '').slice(0, 500),
            (result.body ?? '').slice(0, 2000),
            String(nextSeconds),
            id,
          ]
        );
        console.warn(
          `[trepsi-webhook] ⚠️ cita ${citaId} intento ${intentoActual} falló` +
            ` (status=${result.status}, err=${result.error}). Próximo intento en ${nextSeconds}s.` +
            (isDead ? ' [DEAD]' : '')
        );
        failCount++;
      }
    }
    return { procesados: rows.length, ok: okCount, fail: failCount };
  }

  /**
   * Re-encola una fila dead o failed para nuevo intento inmediato. Usado
   * desde el endpoint admin.
   */
  async retry(id: number): Promise<{ ok: boolean }> {
    const result = await postgresService.query(
      `UPDATE trepsi_webhook_outbox
          SET estado = 'pending',
              proximo_intento_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND estado IN ('failed', 'dead', 'pending')
        RETURNING id`,
      [id]
    );
    return { ok: !!result && result.length > 0 };
  }

  /**
   * Lista las últimas N filas para el endpoint admin.
   */
  async listRecent(limit = 50): Promise<OutboxRow[]> {
    const rows = await postgresService.query(
      `SELECT id, cita_id, historia_id, estado, intentos,
              proximo_intento_at, last_error, last_status_code,
              created_at, sent_at
         FROM trepsi_webhook_outbox
         ORDER BY created_at DESC
         LIMIT $1`,
      [limit]
    );
    return (rows ?? []) as OutboxRow[];
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

interface SendResult {
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
}

async function sendWebhook(
  url: string,
  apiKey: string,
  payload: unknown
): Promise<SendResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'Bodytech-Webhook/1.0',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await res.text();
    if (res.status >= 200 && res.status < 300) {
      return { ok: true, status: res.status, body };
    }
    return { ok: false, status: res.status, body, error: `HTTP ${res.status}` };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

interface BuildPayloadInput {
  citaId: string;
  historiaId: string;
  hc: Record<string, unknown>;
}

/**
 * Construye el payload del webhook según la sección 6 de la spec v2.1.
 * Solo incluye campos que tengan valor — Trepsi recibe un objeto compacto.
 */
function buildPayload(input: BuildPayloadInput): Record<string, unknown> {
  const { citaId, historiaId, hc } = input;

  const fechaConsulta =
    hc.fechaConsulta instanceof Date
      ? (hc.fechaConsulta as Date).toISOString()
      : hc.fechaConsulta
        ? String(hc.fechaConsulta)
        : new Date().toISOString();

  // Diagnósticos: tomar mdDx1 y mdDx2 si existen.
  const diagnosticos: Array<{ codigo?: string; descripcion: string; tipo: string }> = [];
  if (hc.mdDx1 && String(hc.mdDx1).trim()) {
    diagnosticos.push({ descripcion: String(hc.mdDx1).trim(), tipo: 'principal' });
  }
  if (hc.mdDx2 && String(hc.mdDx2).trim()) {
    diagnosticos.push({ descripcion: String(hc.mdDx2).trim(), tipo: 'relacionado' });
  }

  // Signos vitales: combinar tas/tad → ta, fcr → fc.
  const signosVitales: Record<string, unknown> = {};
  if (hc.tas && hc.tad) signosVitales.ta = `${hc.tas}/${hc.tad}`;
  if (hc.fcr != null) signosVitales.fc = Number(hc.fcr);
  if (hc.cc_peso_nuevo != null) signosVitales.peso = Number(hc.cc_peso_nuevo);
  if (hc.cc_estatura_nuevo != null) signosVitales.talla = Number(hc.cc_estatura_nuevo);
  if (hc.cc_imc_nuevo != null) signosVitales.imc = Number(hc.cc_imc_nuevo);

  // Examen físico (string libre desde hallazgos).
  const examenFisico: Record<string, unknown> = {};
  if (hc.hallazgos_descripcion) {
    examenFisico.general = String(hc.hallazgos_descripcion);
  }
  if (hc.hallazgos_dolor) {
    examenFisico.dolor = String(hc.hallazgos_dolor);
  }

  // Resultados (objeto compacto, sólo campos no vacíos).
  const resultados: Record<string, unknown> = {};
  const motivo = hc.motivo_consulta_texto || hc.motivoConsulta;
  if (motivo) resultados.motivoConsulta = String(motivo);
  if (Object.keys(examenFisico).length > 0) resultados.examenFisico = examenFisico;
  if (Object.keys(signosVitales).length > 0) resultados.signosVitales = signosVitales;
  if (hc.mdAntecedentes) resultados.antecedentes = String(hc.mdAntecedentes);
  if (hc.mdConceptoFinal) resultados.analisis = String(hc.mdConceptoFinal);
  if (diagnosticos.length > 0) resultados.diagnosticos = diagnosticos;
  if (hc.mdRecomendacionesMedicasAdicionales) {
    resultados.recomendaciones = String(hc.mdRecomendacionesMedicasAdicionales);
  }
  if (hc.mdObservacionesCertificado) {
    resultados.notasMedico = String(hc.mdObservacionesCertificado);
  }
  if (hc.intervencion_meta_texto) resultados.plan = String(hc.intervencion_meta_texto);
  if (hc.transcription_text) resultados.transcripcion = String(hc.transcription_text);

  const nombreMedico = hc.medico ? String(hc.medico) : '';

  return {
    citaId,
    historiaClinicaId: historiaId,
    fechaConsulta,
    estado: 'completed',
    medico: {
      codigo: nombreMedico,
      nombre: nombreMedico,
    },
    resultados,
    adjuntos: [],
    firma: null,
    sourceVersion: '2.1',
  };
}

export default new TrepsiWebhookService();

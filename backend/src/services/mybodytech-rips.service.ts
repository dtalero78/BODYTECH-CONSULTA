// ============================================================================
// mybodytech-rips.service — Fase 2 (salida): envío del RIPS al validador de
// mybodytech cuando el profesional cierra la historia clínica.
//
// Flujo:
//   1) historia-mutation.updateMedicalHistory() llama enviarRips(historiaId)
//      fire-and-forget al guardar la HC (atendido='ATENDIDO').
//   2) Si la HC corresponde a un afiliado mybodytech, se autentica en su OAuth
//      y hace POST a external-rips con:
//        headers: Authorization Bearer + x-bodytech-brand + x-bodytech-organization
//        body: { ref_invoice=eventoId, user_document_type, user_document_number }
//   3) Se guarda rips_estado y se registra el evento outbound en el monitor.
//
// Env vars:
//   MYBODYTECH_RIPS_OAUTH_URL     (ej. https://pre-oauth-pub.mybodytech.co/oauth/token)
//   MYBODYTECH_RIPS_API_URL       (ej. https://pre-apirips-pub.mybodytech.co/api/rips/external-rips)
//   MYBODYTECH_RIPS_CLIENT_ID
//   MYBODYTECH_RIPS_CLIENT_SECRET
//   MYBODYTECH_RIPS_BRAND         (default '1')
//   MYBODYTECH_RIPS_ORG           (default '1')
// ============================================================================

import postgresService from './postgres.service';
import integrationLogService from './integration-log.service';

function cfg() {
  return {
    oauthUrl: process.env.MYBODYTECH_RIPS_OAUTH_URL || '',
    ripsUrl: process.env.MYBODYTECH_RIPS_API_URL || '',
    clientId: process.env.MYBODYTECH_RIPS_CLIENT_ID || '',
    clientSecret: process.env.MYBODYTECH_RIPS_CLIENT_SECRET || '',
    brand: process.env.MYBODYTECH_RIPS_BRAND || '1',
    org: process.env.MYBODYTECH_RIPS_ORG || '1',
  };
}

function isConfigured(): boolean {
  const c = cfg();
  return Boolean(c.oauthUrl && c.ripsUrl && c.clientId && c.clientSecret);
}

async function getAccessToken(): Promise<string> {
  const c = cfg();
  const res = await fetch(c.oauthUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: c.clientId,
      client_secret: c.clientSecret,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`OAuth mybodytech respondió ${res.status}`);
  const j = (await res.json()) as { access_token?: string };
  if (!j.access_token) throw new Error('OAuth mybodytech no devolvió access_token');
  return j.access_token;
}

export interface EnviarRipsResult {
  sent: boolean;
  reason?: string;
  status?: string;
  httpStatus?: number;
}

class MybodytechRipsService {
  /**
   * Envía el RIPS de una HC recién cerrada. Solo actúa si la HC es de un
   * afiliado mybodytech. Best-effort: nunca lanza hacia arriba (el médico ya
   * guardó la HC); devuelve el resultado para logging.
   */
  async enviarRips(historiaId: string): Promise<EnviarRipsResult> {
    if (!isConfigured()) return { sent: false, reason: 'NOT_CONFIGURED' };

    const rows = await postgresService.query(
      `SELECT evento_id, user_document_type, user_document_number
         FROM mybodytech_afiliados WHERE historia_id = $1`,
      [historiaId]
    );
    if (!rows || rows.length === 0) return { sent: false, reason: 'NOT_MYBODYTECH' };
    const row = rows[0] as {
      evento_id: string;
      user_document_type: string | null;
      user_document_number: string | null;
    };
    if (!row.user_document_number) {
      return { sent: false, reason: 'NO_PROFESSIONAL_DOC' };
    }

    const c = cfg();
    const started = Date.now();
    const requestBody = {
      ref_invoice: String(row.evento_id),
      user_document_type: String(row.user_document_type ?? 'CC'),
      user_document_number: String(row.user_document_number),
    };

    let httpStatus = 0;
    let responseBody: unknown = null;
    let ok = false;
    let errorMessage: string | null = null;
    try {
      const token = await getAccessToken();
      const res = await fetch(c.ripsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'x-bodytech-brand': c.brand,
          'x-bodytech-organization': c.org,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(20000),
      });
      httpStatus = res.status;
      responseBody = await res.json().catch(() => null);
      // Su API responde 200 aún en errores de negocio ("Factura no encontrada"),
      // así que el éxito real se mide por status === 'success' en el body.
      const bodyStatus =
        responseBody && typeof responseBody === 'object'
          ? (responseBody as Record<string, unknown>).status
          : undefined;
      ok = res.ok && bodyStatus === 'success';
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const estado = ok ? 'done' : 'error';
    await postgresService
      .query(
        `UPDATE mybodytech_afiliados SET rips_estado = $1, updated_at = NOW() WHERE historia_id = $2`,
        [estado, historiaId]
      )
      .catch(() => {});

    // Mensaje de error para el log: preferir el de excepción; si no, el
    // `message` del body ("Factura no encontrada", etc.).
    const bodyMsg =
      responseBody && typeof responseBody === 'object'
        ? (responseBody as Record<string, unknown>).message
        : undefined;
    const logErrorMessage = ok
      ? null
      : (errorMessage ?? (typeof bodyMsg === 'string' ? bodyMsg : null));

    // Registrar en el monitor como evento OUTBOUND.
    integrationLogService
      .log({
        integracion: 'mybodytech',
        direccion: 'outbound',
        tipo: 'rips.externalRips',
        metodo: 'POST',
        path: c.ripsUrl,
        citaId: String(row.evento_id),
        statusCode: httpStatus || null,
        ok,
        latencyMs: Date.now() - started,
        requestBody,
        responseBody,
        errorCode: ok ? null : 'RIPS_ERROR',
        errorMessage: logErrorMessage,
      })
      .catch(() => {});

    return { sent: true, status: estado, httpStatus };
  }
}

export default new MybodytechRipsService();

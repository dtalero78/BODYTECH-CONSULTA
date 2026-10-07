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

import { fetch, ProxyAgent, type Dispatcher } from 'undici';
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
    // Profesional que FIRMA todos los RIPS (6-oct-2026, decisión de Daniel:
    // la nutricionista Ingrid Adriana Osorio Martinez, CC 52386116). Si está,
    // reemplaza al documento que manda MyBodytech en cada orden.
    firmaDocType: (process.env.MYBODYTECH_RIPS_FIRMA_DOC_TYPE || 'CC').trim(),
    firmaDoc: (process.env.MYBODYTECH_RIPS_FIRMA_DOC || '').trim(),
  };
}

/** Documento con el que sale el RIPS: el de la firma fija, o el de la orden. */
function documentoFirma(
  c: ReturnType<typeof cfg>,
  row: { user_document_type: string | null; user_document_number: string | null }
): { type: string; number: string | null } {
  if (c.firmaDoc) return { type: c.firmaDocType || 'CC', number: c.firmaDoc };
  return {
    type: String(row.user_document_type ?? 'CC'),
    number: row.user_document_number ? String(row.user_document_number) : null,
  };
}

// Proxy de salida con IP fija (droplet). Si MYBODYTECH_RIPS_PROXY_URL está
// definida, TODAS las llamadas al validador salen por ahí, de modo que mybodytech
// pueda hacer allowlist de una sola IP. Sin la variable, salida directa.
let _dispatcher: Dispatcher | undefined;
let _dispatcherResolved = false;
function ripsDispatcher(): Dispatcher | undefined {
  if (_dispatcherResolved) return _dispatcher;
  _dispatcherResolved = true;
  const p = process.env.MYBODYTECH_RIPS_PROXY_URL;
  if (p) {
    try {
      const u = new URL(p);
      const uri = `${u.protocol}//${u.host}`;
      const token = u.username
        ? `Basic ${Buffer.from(
            `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`
          ).toString('base64')}`
        : undefined;
      _dispatcher = new ProxyAgent(token ? { uri, token } : uri);
    } catch (e) {
      console.error(
        '[mybodytech-rips] MYBODYTECH_RIPS_PROXY_URL inválida:',
        e instanceof Error ? e.message : e
      );
    }
  }
  return _dispatcher;
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
    dispatcher: ripsDispatcher(),
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
   * Lo que se le ENVIARÍA al validador por esta orden, sin enviarlo: la misma
   * URL, cabeceras (el token, oculto) y cuerpo que arma `enviarRips`.
   */
  async previsualizar(eventoId: string): Promise<Record<string, unknown> | null> {
    const rows = await postgresService.query(
      `SELECT m.evento_id, m.historia_id, m.historia_enlazada_id, m.rips_estado,
              m.user_document_type, m.user_document_number, m.professional_name,
              h."fechaConsulta" AS fecha_consulta_trepsi, h."atendido" AS atendido_trepsi
         FROM mybodytech_afiliados m
         LEFT JOIN "HistoriaClinica" h ON h."_id" = m.historia_enlazada_id
        WHERE m.evento_id = $1`,
      [eventoId]
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0];
    const c = cfg();
    const firma = documentoFirma(c, r);
    return {
      orden: {
        eventoId: r.evento_id,
        historiaMybodytech: r.historia_id,
        historiaTrepsiEnlazada: r.historia_enlazada_id,
        consultaTrepsi: { atendido: r.atendido_trepsi, fechaConsulta: r.fecha_consulta_trepsi },
        profesionalSegunMybodytech: r.professional_name,
        ripsEstado: r.rips_estado,
      },
      seEnviaria: {
        metodo: 'POST',
        url: c.ripsUrl,
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer <token de su OAuth, se pide al enviar>',
          'x-bodytech-brand': c.brand,
          'x-bodytech-organization': c.org,
        },
        body: {
          ref_invoice: String(r.evento_id),
          user_document_type: firma.type,
          user_document_number: firma.number,
        },
      },
      firmaFija: Boolean(c.firmaDoc),
      seEnviariaDeVerdad: Boolean(isConfigured() && firma.number && r.rips_estado !== 'done'),
    };
  }

  /**
   * Envía el RIPS de una HC recién cerrada. Solo actúa si la HC es de un
   * afiliado mybodytech. Best-effort: nunca lanza hacia arriba (el médico ya
   * guardó la HC); devuelve el resultado para logging.
   */
  async enviarRips(historiaId: string): Promise<EnviarRipsResult> {
    if (!isConfigured()) return { sent: false, reason: 'NOT_CONFIGURED' };

    // La historia cerrada puede ser la de la orden o la de la cita de Trepsi
    // enlazada a ella (mybodytech-enlace.service). En los dos casos lo que viaja
    // es lo de la ORDEN de MyBodytech: su eventoId y su documento.
    const rows = await postgresService.query(
      `SELECT evento_id, user_document_type, user_document_number, rips_estado,
              COALESCE(historia_id = $1, FALSE) AS propia
         FROM mybodytech_afiliados
        WHERE (historia_id = $1 OR historia_enlazada_id = $1)
          -- La orden creada en el panel (fuente='panel') no es de MyBodytech:
          -- su RIPS no existe allá y mandarlo sería ruido en su sistema.
          AND COALESCE(fuente, 'mybodytech') = 'mybodytech'
        ORDER BY COALESCE(historia_id = $1, FALSE) DESC, created_at
        LIMIT 1`,
      [historiaId]
    );
    if (!rows || rows.length === 0) return { sent: false, reason: 'NOT_MYBODYTECH' };
    const row = rows[0] as {
      evento_id: string;
      user_document_type: string | null;
      user_document_number: string | null;
      rips_estado: string | null;
      propia: boolean;
    };
    // Ya aceptado por su validador: volver a cerrar (o el "Guardar" de nuevo)
    // no lo reenvía. Con el enlace, la orden puede cerrarse por dos historias.
    if (row.rips_estado === 'done') return { sent: false, reason: 'ALREADY_SENT' };
    if (!row.propia) {
      console.log(`🔗 [mybodytech-RIPS] Historia ${historiaId} es la cita de Trepsi enlazada a la orden ${row.evento_id}`);
    }
    const c = cfg();
    const firma = documentoFirma(c, row);
    if (!firma.number) {
      return { sent: false, reason: 'NO_PROFESSIONAL_DOC' };
    }

    const started = Date.now();
    const requestBody = {
      ref_invoice: String(row.evento_id),
      user_document_type: firma.type,
      user_document_number: firma.number,
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
        dispatcher: ripsDispatcher(),
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
        `UPDATE mybodytech_afiliados SET rips_estado = $1, updated_at = NOW() WHERE evento_id = $2`,
        [estado, row.evento_id]
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

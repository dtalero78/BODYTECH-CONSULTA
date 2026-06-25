// ===========================================================================
// WhatsApp Leads — captura de la "entidad"
// ---------------------------------------------------------------------------
// Objetivo: cuando el operador responde por WhatsApp "¿Para qué entidad?", el
// nombre de la entidad que el cliente contesta a continuación queda registrado
// en un Google Sheet, sin trabajo manual.
//
// Flujo:
//   WHAPI (webhook por mensaje)  →  POST /api/whatsapp-leads/webhook
//     · mensaje saliente (from_me) que contiene la pregunta de la entidad
//       → se (re)arma una fila pending para ese chat.
//     · mensajes entrantes posteriores → se acumulan en `buffer` (el cliente
//       suele mandar la sigla y luego el nombre completo en 2 mensajes).
//   Sweeper (cada 30 s, desde index.ts)  →  flushReadyLeads()
//     · tras WHATSAPP_LEAD_GRACE_SECONDS de silencio, vuelca la entidad al
//       Google Sheet (vía Apps Script web app) y borra la fila pending.
//
// La detección de la pregunta requiere que WHAPI entregue también los mensajes
// SALIENTES (from_me=true) al webhook. Ver WHATSAPP_LEADS_ENTIDAD.md.
// ===========================================================================

import postgresService from './postgres.service';

// --- Configuración (env, con defaults sensatos) ---------------------------

// Frases que, dentro de un mensaje saliente, marcan la pregunta de la entidad.
// Se comparan sobre el texto NORMALIZADO (minúsculas, sin acentos). Override
// con WHATSAPP_ENTIDAD_PATTERNS (lista separada por comas).
const DEFAULT_PATTERNS = [
  'para q entidad',
  'para que entidad',
  'que entidad',
  'cual entidad',
  'cual es la entidad',
];

function getQuestionPatterns(): string[] {
  const raw = process.env.WHATSAPP_ENTIDAD_PATTERNS;
  if (!raw) return DEFAULT_PATTERNS;
  return raw
    .split(',')
    .map((p) => normalize(p))
    .filter(Boolean);
}

// Ventana de silencio antes de volcar (permite agrupar "ANI" + nombre completo).
const GRACE_SECONDS = parseInt(process.env.WHATSAPP_LEAD_GRACE_SECONDS || '60', 10);
// Caduca preguntas nunca respondidas para no acumular filas muertas.
const TTL_HOURS = parseInt(process.env.WHATSAPP_LEAD_TTL_HOURS || '24', 10);
// Límite defensivo del buffer acumulado.
const MAX_BUFFER_CHARS = 600;

// --- Helpers ---------------------------------------------------------------

/** minúsculas + sin acentos + espacios colapsados. */
function normalize(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿El texto saliente contiene la pregunta de la entidad? */
function isEntidadQuestion(text: string): boolean {
  const n = normalize(text);
  if (!n) return false;
  return getQuestionPatterns().some((p) => p && n.includes(p));
}

/** "573001234567@s.whatsapp.net" → "573001234567" */
function telefonoFromChatId(chatId: string): string {
  return (chatId || '').split('@')[0] || '';
}

// --- Parseo del payload WHAPI ----------------------------------------------

interface WhapiMessage {
  from_me?: boolean;
  type?: string;
  chat_id?: string;
  from?: string;
  from_name?: string;
  text?: { body?: string };
}

/** Extrae el cuerpo de texto de un mensaje WHAPI (solo type=text). */
function messageText(m: WhapiMessage): string {
  if (m.type && m.type !== 'text') return '';
  return (m.text?.body || '').trim();
}

// --- Lógica principal ------------------------------------------------------

class WhatsappLeadsService {
  /**
   * Procesa un payload de WHAPI. Solo mira `messages[]`; ignora `statuses`,
   * `chats`, etc. No lanza: cualquier error se loguea (el webhook responde 200).
   */
  async handleWhapiWebhook(body: any): Promise<void> {
    const messages: WhapiMessage[] = Array.isArray(body?.messages) ? body.messages : [];
    if (messages.length === 0) return;

    for (const m of messages) {
      try {
        const chatId = m.chat_id || '';
        if (!chatId) continue;
        const text = messageText(m);
        if (!text) continue;

        if (m.from_me === true) {
          // Mensaje del operador → ¿es la pregunta de la entidad?
          if (isEntidadQuestion(text)) {
            await this.armPending(chatId);
          }
        } else {
          // Mensaje entrante → si hay pending armado, acumular como entidad.
          await this.accumulate(chatId, text, m.from_name || '');
        }
      } catch (e: any) {
        console.error('[whatsapp-leads] error procesando mensaje:', e?.message ?? e);
      }
    }
  }

  /** (Re)arma el pending para un chat: limpia buffer y reinicia el reloj. */
  private async armPending(chatId: string): Promise<void> {
    await postgresService.query(
      `
      INSERT INTO whatsapp_lead_pending (chat_id, telefono, asked_at, last_inbound_at, buffer, updated_at)
      VALUES ($1, $2, NOW(), NULL, NULL, NOW())
      ON CONFLICT (chat_id) DO UPDATE
        SET asked_at = NOW(), last_inbound_at = NULL, buffer = NULL, updated_at = NOW()
      `,
      [chatId, telefonoFromChatId(chatId)]
    );
    console.log(`[whatsapp-leads] pregunta de entidad detectada → armado ${chatId}`);
  }

  /**
   * Acumula un mensaje entrante en el buffer del pending (si existe). Si no hay
   * pending para ese chat, es ruido (mensaje fuera del flujo) y se ignora.
   */
  private async accumulate(chatId: string, text: string, fromName: string): Promise<void> {
    const rows = await postgresService.query(
      `SELECT buffer FROM whatsapp_lead_pending WHERE chat_id = $1`,
      [chatId]
    );
    if (!rows || rows.length === 0) return; // sin pregunta previa → ignorar

    const prev: string = rows[0].buffer || '';
    const next = (prev ? `${prev} ${text}` : text).slice(0, MAX_BUFFER_CHARS);

    await postgresService.query(
      `
      UPDATE whatsapp_lead_pending
        SET buffer = $2,
            from_name = COALESCE(NULLIF($3, ''), from_name),
            last_inbound_at = NOW(),
            updated_at = NOW()
      WHERE chat_id = $1
      `,
      [chatId, next, fromName]
    );
  }

  /**
   * Sweeper: vuelca a Google Sheets las entidades cuyo último mensaje llegó hace
   * más de GRACE_SECONDS, y purga preguntas caducadas sin respuesta. Idempotente
   * y seguro de correr cada 30 s.
   */
  async flushReadyLeads(): Promise<void> {
    // 1) Purga preguntas nunca respondidas.
    await postgresService.query(
      `DELETE FROM whatsapp_lead_pending
         WHERE buffer IS NULL AND asked_at < NOW() - ($1 || ' hours')::interval`,
      [String(TTL_HOURS)]
    );

    // 2) Leads listos para volcar (ya pasó la ventana de silencio).
    const ready = await postgresService.query(
      `
      SELECT chat_id, telefono, from_name, buffer
        FROM whatsapp_lead_pending
       WHERE buffer IS NOT NULL
         AND last_inbound_at < NOW() - ($1 || ' seconds')::interval
       ORDER BY last_inbound_at ASC
       LIMIT 50
      `,
      [String(GRACE_SECONDS)]
    );
    if (!ready || ready.length === 0) return;

    for (const lead of ready) {
      const entidad = (lead.buffer || '').trim();
      if (!entidad) {
        await postgresService.query(`DELETE FROM whatsapp_lead_pending WHERE chat_id = $1`, [
          lead.chat_id,
        ]);
        continue;
      }

      const ok = await appendToSheet({
        telefono: lead.telefono || telefonoFromChatId(lead.chat_id),
        nombre: lead.from_name || '',
        entidad,
      });

      if (ok) {
        await postgresService.query(`DELETE FROM whatsapp_lead_pending WHERE chat_id = $1`, [
          lead.chat_id,
        ]);
        console.log(`[whatsapp-leads] ✅ registrado: "${entidad}" (${lead.telefono})`);
      } else {
        // Falló el Sheet → dejar la fila; el próximo sweep reintenta.
        console.warn(`[whatsapp-leads] ⚠️ no se pudo escribir en Sheets, se reintentará: ${lead.chat_id}`);
      }
    }
  }
}

// --- Salida a Google Sheets (Apps Script web app) --------------------------

const SHEET_TIMEOUT_MS = 10_000;

interface SheetRow {
  telefono: string;
  nombre: string;
  entidad: string;
}

/**
 * POST a la Apps Script web app que hace appendRow() en el Sheet. Si
 * GSHEET_WEBAPP_URL no está configurada, no-op (loguea y retorna false para que
 * la fila quede pendiente hasta que se configure).
 */
async function appendToSheet(row: SheetRow): Promise<boolean> {
  const url = process.env.GSHEET_WEBAPP_URL;
  if (!url) {
    console.warn('[whatsapp-leads] GSHEET_WEBAPP_URL no configurada — entidad no volcada');
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEET_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: process.env.GSHEET_WEBAPP_TOKEN || '',
        telefono: row.telefono,
        nombre: row.nombre,
        entidad: row.entidad,
      }),
      signal: controller.signal,
    });
    if (res.status >= 200 && res.status < 300) return true;
    const txt = await res.text().catch(() => '');
    console.error(`[whatsapp-leads] Sheets respondió HTTP ${res.status}: ${txt.slice(0, 200)}`);
    return false;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[whatsapp-leads] error POST a Sheets:', msg);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export default new WhatsappLeadsService();

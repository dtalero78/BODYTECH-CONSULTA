// ============================================================================
// whapi.service — envío de texto por WHAPI (gate.whapi.cloud).
//
// Es el ÚNICO camino de la plataforma para escribirle a un GRUPO de WhatsApp.
// Twilio no sirve para esto: su API de WhatsApp manda a números individuales y
// solo con plantilla aprobada, mientras que las alarmas internas necesitan
// texto libre y un destinatario que es un grupo ('...@g.us').
//
// El canal de WHAPI está COMPARTIDO con otros productos (ver notas de
// operación): acá solo se envía, nunca se toca la configuración del canal.
//
// Apagado por defecto: sin WHAPI_TOKEN, `enviarTexto` devuelve
// { success:false, error:'WHAPI_SIN_TOKEN' } y nadie explota. Quien lo llama
// decide si eso es un fallo o un no-op.
// ============================================================================

const TIMEOUT_MS = 10_000;

export interface WhapiEnvio {
  success: boolean;
  messageId?: string;
  error?: string;
}

function baseUrl(): string {
  return (process.env.WHAPI_BASE_URL || 'https://gate.whapi.cloud').replace(/\/+$/, '');
}

class WhapiService {
  /** true si hay token configurado (lo usan los workers para no-opear). */
  get configurado(): boolean {
    return Boolean(process.env.WHAPI_TOKEN);
  }

  /**
   * Envía un texto a un chat de WHAPI. `to` puede ser un número (E.164 sin '+')
   * o un grupo ('120363xxxxxxxxxxxx@g.us'), que es el caso de las alarmas.
   */
  async enviarTexto(to: string, body: string): Promise<WhapiEnvio> {
    const token = process.env.WHAPI_TOKEN;
    if (!token) return { success: false, error: 'WHAPI_SIN_TOKEN' };
    if (!to) return { success: false, error: 'WHAPI_SIN_DESTINO' };

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(`${baseUrl()}/messages/text`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ to, body }),
        signal: ctrl.signal,
      });

      const texto = await resp.text();
      if (!resp.ok) {
        return { success: false, error: `HTTP ${resp.status}: ${texto.slice(0, 200)}` };
      }
      let messageId: string | undefined;
      try {
        const json = JSON.parse(texto);
        messageId = json?.message?.id ?? json?.id ?? undefined;
      } catch {
        /* WHAPI respondió 2xx con algo que no es JSON: el envío igual salió. */
      }
      return { success: true, messageId };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { success: false, error: msg === 'The operation was aborted.' ? 'TIMEOUT' : msg };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Lista los grupos del canal. No lo usa el worker: existe para averiguar UNA
   * vez el id del grupo al que hay que alarmar y ponerlo en la variable de
   * entorno (los ids de grupo no se pueden adivinar ni escribir a mano).
   */
  async listarGrupos(): Promise<Array<{ id: string; name: string }> | null> {
    const token = process.env.WHAPI_TOKEN;
    if (!token) return null;
    try {
      const resp = await fetch(`${baseUrl()}/groups?count=200`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!resp.ok) return null;
      const json = (await resp.json()) as { groups?: unknown };
      const arr: Record<string, unknown>[] = Array.isArray(json?.groups) ? json.groups : [];
      return arr.map((g: Record<string, unknown>) => ({
        id: String(g.id ?? ''),
        name: String(g.name ?? g.subject ?? ''),
      }));
    } catch {
      return null;
    }
  }
}

export default new WhapiService();

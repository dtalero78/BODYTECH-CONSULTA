// ============================================================================
// emailService — Envío de correos transaccionales vía Resend (HTTP API).
//
// Usa `fetch` directo (Node 20) contra https://api.resend.com/emails para no
// agregar dependencias. El remitente sale de RESEND_FROM; mientras no haya un
// dominio verificado en Resend, debe ser `onboarding@resend.dev` (que solo
// puede enviar al email dueño de la cuenta). Con dominio verificado, cámbialo
// a uno propio (ej. no-reply@bodytech.app).
// ============================================================================

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

class EmailService {
  private get apiKey(): string | undefined {
    return process.env.RESEND_API_KEY;
  }

  private get from(): string {
    return process.env.RESEND_FROM || 'Bodytech <onboarding@resend.dev>';
  }

  /** ¿Está configurado el envío de correo? */
  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.trim().length > 0;
  }

  private async send(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.isConfigured()) {
      console.error('❌ [email] RESEND_API_KEY no configurada — correo no enviado.');
      return false;
    }
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, html }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`❌ [email] Resend respondió ${res.status}: ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('❌ [email] Error enviando con Resend:', e instanceof Error ? e.message : e);
      return false;
    }
  }

  /** Email de "restablece tu contraseña" con el enlace de reset. */
  async sendPasswordReset(to: string, nombre: string, link: string): Promise<boolean> {
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #18181b;">
        <h2 style="font-size: 18px;">Restablece tu contraseña</h2>
        <p style="font-size: 14px; line-height: 1.5;">
          Hola ${escapeHtml(nombre)}, recibimos una solicitud para restablecer la contraseña
          de tu cuenta en la plataforma Bodytech. Haz clic en el botón para crear una nueva:
        </p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${link}" style="background: #1f3a8a; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Restablecer contraseña
          </a>
        </p>
        <p style="font-size: 12px; color: #71717a; line-height: 1.5;">
          El enlace vence en 1 hora. Si no solicitaste esto, ignora este correo: tu contraseña
          no cambiará.
        </p>
      </div>
    `;
    return this.send(to, 'Restablece tu contraseña — Bodytech', html);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default new EmailService();

import twilio from 'twilio';

class WhatsAppService {
  private readonly client: twilio.Twilio;
  private readonly fromNumber: string;
  private readonly templateSid: string;
  private readonly maxRetries = 3;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+15557455529';
    this.templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID || 'HXb3cafc049dcc310e2cfbfffb6e943c4e';

    if (!accountSid || !authToken) {
      console.warn('⚠️  Twilio credentials not configured — WhatsApp service unavailable');
    } else {
      console.log('✅ Twilio WhatsApp Service inicializado');
      console.log(`   From: ${this.fromNumber}`);
      console.log(`   Template SID: ${this.templateSid}`);
    }

    this.client = twilio(accountSid, authToken);
  }

  private formatPhoneNumber(phone: string): string {
    const clean = phone.replace(/[\s()\-+]/g, '');
    if (clean.length === 10 && clean.startsWith('3')) return `whatsapp:57${clean}`;
    if (clean.startsWith('57') && clean.length === 12) return `whatsapp:${clean}`;
    return `whatsapp:${clean}`;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private isRetryableError(error: any): boolean {
    const codes = [20429, 20500, 20503, 30001, 30002, 30003, 30004, 30005, 30006, 30007, 30008];
    if (error.code && codes.includes(error.code)) return true;
    if (['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(error.code)) return true;
    return false;
  }

  private getErrorMessage(error: any): string {
    if (['ECONNABORTED', 'ETIMEDOUT'].includes(error.code)) return 'Timeout — Twilio tardó demasiado';
    if (error.code) return `Error ${error.code}: ${error.message || 'Error de Twilio'}`;
    return error.message || 'Error desconocido al enviar WhatsApp';
  }

  /**
   * Envía la plantilla aprobada de Bodytech al paciente.
   * Variables: {{1}} nombre, {{2}} hora, {{3}} roomNameWithParams
   */
  async sendTemplateMessage(
    phone: string,
    roomNameWithParams: string,
    patientName: string,
    appointmentTime: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    const toNumber = this.formatPhoneNumber(phone);

    try {
      console.log(`📱 [Twilio WA] Enviando template a ${toNumber} (intento ${attempt}/${this.maxRetries})`);

      const msg = await this.client.messages.create({
        from: this.fromNumber,
        to: toNumber,
        contentSid: this.templateSid,
        contentVariables: JSON.stringify({
          '1': patientName,
          '2': appointmentTime,
          '3': roomNameWithParams,
        }),
      });

      console.log(`✅ [Twilio WA] Enviado — SID: ${msg.sid}`);
      return { success: true, messageSid: msg.sid };
    } catch (error: any) {
      if (this.isRetryableError(error) && attempt < this.maxRetries) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️  [Twilio WA] Intento ${attempt} falló, reintentando en ${wait / 1000}s`);
        await this.sleep(wait);
        return this.sendTemplateMessage(phone, roomNameWithParams, patientName, appointmentTime, attempt + 1);
      }
      const msg = this.getErrorMessage(error);
      console.error(`❌ [Twilio WA] Error tras ${attempt} intentos: ${msg}`);
      return { success: false, error: msg };
    }
  }

  /**
   * Envía mensaje de texto libre (para reportes internos, etc.)
   */
  async sendTextMessage(
    phone: string,
    message: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    const toNumber = this.formatPhoneNumber(phone);

    try {
      console.log(`📱 [Twilio WA] Enviando texto a ${toNumber} (intento ${attempt}/${this.maxRetries})`);

      const msg = await this.client.messages.create({
        from: this.fromNumber,
        to: toNumber,
        body: message,
      });

      console.log(`✅ [Twilio WA] Texto enviado — SID: ${msg.sid}`);
      return { success: true, messageSid: msg.sid };
    } catch (error: any) {
      if (this.isRetryableError(error) && attempt < this.maxRetries) {
        const wait = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️  [Twilio WA] Intento ${attempt} falló, reintentando en ${wait / 1000}s`);
        await this.sleep(wait);
        return this.sendTextMessage(phone, message, attempt + 1);
      }
      const msg = this.getErrorMessage(error);
      console.error(`❌ [Twilio WA] Error tras ${attempt} intentos: ${msg}`);
      return { success: false, error: msg };
    }
  }
}

export default new WhatsAppService();

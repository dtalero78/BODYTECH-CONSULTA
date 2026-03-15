import axios from 'axios';

/**
 * Servicio para enviar mensajes de WhatsApp usando WHAPI (gate.whapi.cloud)
 */
class WhatsAppService {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly maxRetries = 3;

  constructor() {
    this.apiUrl = process.env.WHAPI_URL || 'https://gate.whapi.cloud/messages/text';
    this.token = process.env.WHAPI_TOKEN || 'due3eWCwuBM2Xqd6cPujuTRqSbMb68lt';

    if (!this.token) {
      console.warn('⚠️  WHAPI_TOKEN no configurado - servicio de WhatsApp no disponible');
    } else {
      console.log('✅ WHAPI WhatsApp Service inicializado');
    }
  }

  /**
   * Espera un tiempo determinado (para backoff exponencial)
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Formatea un número de teléfono para WHAPI
   * WHAPI espera el número con código de país sin + (ej: 573001234567)
   */
  private formatPhoneNumber(phone: string): string {
    let cleanPhone = phone.replace(/[\s\(\)\-\+]/g, '');

    // Si tiene exactamente 10 dígitos y empieza con 3, es colombiano local
    if (cleanPhone.length === 10 && cleanPhone.startsWith('3')) {
      return `57${cleanPhone}`;
    }

    return cleanPhone;
  }

  /**
   * Envía un mensaje de texto al paciente con el link de la videollamada
   * Reemplaza el template de Twilio con un mensaje de texto libre via WHAPI
   *
   * @param phone Número de teléfono (ejemplo: 573001234567 o +573001234567)
   * @param roomNameWithParams Path completo: "consulta-abc123?nombre=Juan&apellido=Perez&documento=123&doctor=JUAN"
   * @param patientName Primer nombre del paciente
   * @param appointmentTime Hora de la cita (ejemplo: "3:00 PM")
   * @param attempt Número de intento actual (uso interno)
   */
  async sendTemplateMessage(
    phone: string,
    roomNameWithParams: string,
    patientName: string,
    appointmentTime: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!this.token) {
      return { success: false, error: 'WHAPI token no configurado' };
    }

    const toNumber = this.formatPhoneNumber(phone);
    const videoCallUrl = `https://bodytech.app/panel-medico/patient/${roomNameWithParams}`;

    const messageBody =
      `Hola ${patientName}, Te saludamos del Bodytech. ` +
      `Tienes una consulta médica a las ${appointmentTime}.\n\n` +
      `Ingresa a tu videollamada aquí:\n${videoCallUrl}`;

    try {
      console.log(`📱 [WHAPI] Enviando WhatsApp a: ${toNumber} (intento ${attempt}/${this.maxRetries})`);

      const response = await axios.post(this.apiUrl, {
        typing_time: 0,
        to: toNumber,
        body: messageBody,
      }, {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        timeout: 15000,
      });

      const messageId = response.data?.message?.id || response.data?.id || '';
      console.log(`✅ [WHAPI] WhatsApp enviado exitosamente a ${toNumber}`);
      console.log(`   Message ID: ${messageId}`);

      return { success: true, messageSid: messageId };
    } catch (error: any) {
      const shouldRetry = attempt < this.maxRetries && this.isRetryableError(error);

      if (shouldRetry) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️  [WHAPI] Error intento ${attempt}/${this.maxRetries}. Reintentando en ${backoffMs / 1000}s...`);
        await this.sleep(backoffMs);
        return this.sendTemplateMessage(phone, roomNameWithParams, patientName, appointmentTime, attempt + 1);
      }

      const errorMessage = this.getErrorMessage(error);
      console.error(`❌ [WHAPI] Error enviando WhatsApp después de ${attempt} intentos:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Envía un mensaje de texto libre por WhatsApp via WHAPI
   * @param phone Número de teléfono (ejemplo: 573001234567 o +573001234567)
   * @param message Mensaje a enviar
   * @param attempt Número de intento actual (uso interno)
   */
  async sendTextMessage(
    phone: string,
    message: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!this.token) {
      return { success: false, error: 'WHAPI token no configurado' };
    }

    const toNumber = this.formatPhoneNumber(phone);

    try {
      console.log(`📱 [WHAPI] Enviando texto a: ${toNumber} (intento ${attempt}/${this.maxRetries})`);

      const response = await axios.post(this.apiUrl, {
        typing_time: 0,
        to: toNumber,
        body: message,
      }, {
        headers: {
          'accept': 'application/json',
          'authorization': `Bearer ${this.token}`,
          'content-type': 'application/json',
        },
        timeout: 15000,
      });

      const messageId = response.data?.message?.id || response.data?.id || '';
      console.log(`✅ [WHAPI] Texto enviado exitosamente a ${toNumber}`);

      return { success: true, messageSid: messageId };
    } catch (error: any) {
      const shouldRetry = attempt < this.maxRetries && this.isRetryableError(error);

      if (shouldRetry) {
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(`⚠️  [WHAPI] Error intento ${attempt}/${this.maxRetries}. Reintentando en ${backoffMs / 1000}s...`);
        await this.sleep(backoffMs);
        return this.sendTextMessage(phone, message, attempt + 1);
      }

      const errorMessage = this.getErrorMessage(error);
      console.error(`❌ [WHAPI] Error enviando texto después de ${attempt} intentos:`, errorMessage);
      return { success: false, error: errorMessage };
    }
  }

  private isRetryableError(error: any): boolean {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }
    if (error.response?.status && error.response.status >= 500) {
      return true;
    }
    if (error.response?.status === 429) {
      return true;
    }
    return false;
  }

  private getErrorMessage(error: any): string {
    if (error.response?.data?.message) {
      return `WHAPI Error: ${error.response.data.message}`;
    }
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'Timeout - WHAPI tardó demasiado en responder';
    }
    if (error.message) {
      return error.message;
    }
    return 'Error desconocido al enviar WhatsApp';
  }
}

export default new WhatsAppService();

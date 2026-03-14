import twilio from 'twilio';

/**
 * Servicio para enviar mensajes de WhatsApp usando Twilio API
 */
class WhatsAppService {
  private readonly client: twilio.Twilio;
  private readonly fromNumber: string;
  private readonly templateSid: string;
  private readonly statusCallbackUrl: string;
  private readonly maxRetries = 3;

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.fromNumber = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+3153369631';
    this.templateSid = process.env.TWILIO_WHATSAPP_TEMPLATE_SID || 'HXc8473cfd60cd378314355e17e736d24d';
    // URL de callback para registrar mensajes en BSL-PLATAFORMA
    this.statusCallbackUrl = process.env.WHATSAPP_STATUS_CALLBACK_URL || 'https://bsl-plataforma.com/api/whatsapp/status';

    if (!accountSid || !authToken) {
      console.warn('⚠️  Credenciales de Twilio no configuradas - servicio de WhatsApp no disponible');
      this.client = {} as twilio.Twilio; // Cliente vacío para evitar errores
    } else {
      this.client = twilio(accountSid, authToken);
      console.log('✅ Twilio WhatsApp Service inicializado');
      console.log(`   Template SID: ${this.templateSid}`);
      console.log(`   Status Callback: ${this.statusCallbackUrl}`);
    }
  }

  /**
   * Espera un tiempo determinado (para backoff exponencial)
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Formatea un número de teléfono para WhatsApp de Twilio
   * @param phone Número de teléfono (puede tener o no el prefijo +)
   * @returns Número formateado como whatsapp:573001234567 (SIN +)
   */
  private formatPhoneNumber(phone: string): string {
    // Limpiar el número de teléfono (quitar espacios, paréntesis, guiones, y +)
    let cleanPhone = phone.replace(/[\s\(\)\-\+]/g, '');

    // Si tiene exactamente 10 dígitos, es un número colombiano local
    if (cleanPhone.length === 10 && /^\d{10}$/.test(cleanPhone)) {
      return `whatsapp:57${cleanPhone}`;
    }

    // Si empieza con 57 y tiene 12 dígitos, usar directamente
    if (cleanPhone.startsWith('57') && cleanPhone.length === 12) {
      return `whatsapp:${cleanPhone}`;
    }

    // Para otros formatos, asumir que ya está completo
    return `whatsapp:${cleanPhone}`;
  }

  /**
   * Envía un mensaje usando el template aprobado de Twilio con variables
   * Template Bodytech: "Hola {{1}}, Te saludamos del Bodytech. Tienes una consulta médica a las {{2}}..."
   * Button URL: https://bodytech.app/panel-medico/patient/{{3}}
   * @param phone Número de teléfono (ejemplo: 573001234567 o +573001234567)
   * @param roomNameWithParams Path completo: "consulta-abc123?nombre=Juan&apellido=Perez&documento=123&doctor=JUAN"
   * @param patientName Primer nombre del paciente
   * @param appointmentTime Hora de la cita (ejemplo: "3:00 PM")
   * @param attempt Número de intento actual (uso interno)
   * @returns Resultado del envío
   */
  async sendTemplateMessage(
    phone: string,
    roomNameWithParams: string,
    patientName: string,
    appointmentTime: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!this.client.messages) {
      console.error('❌ Cliente de Twilio no está configurado');
      return {
        success: false,
        error: 'Cliente de Twilio no configurado'
      };
    }

    const toNumber = this.formatPhoneNumber(phone);

    try {
      console.log(`📱 Enviando WhatsApp con template a: ${toNumber} (intento ${attempt}/${this.maxRetries})`);
      console.log(`   Variables: name=${patientName}, time=${appointmentTime}, roomPath=${roomNameWithParams}`);

      const twilioMessage = await this.client.messages.create({
        from: this.fromNumber,
        to: toNumber,
        contentSid: this.templateSid,
        contentVariables: JSON.stringify({
          '1': patientName,
          '2': appointmentTime,
          '3': roomNameWithParams
        }),
        statusCallback: this.statusCallbackUrl
      });

      console.log(`✅ WhatsApp con template enviado exitosamente a ${toNumber}`);
      console.log(`   Message SID: ${twilioMessage.sid}`);
      console.log(`   Estado: ${twilioMessage.status}`);

      return {
        success: true,
        messageSid: twilioMessage.sid
      };
    } catch (error: any) {
      const isRetryableError = this.isRetryableError(error);
      const shouldRetry = isRetryableError && attempt < this.maxRetries;

      if (shouldRetry) {
        // Backoff exponencial: 2s, 4s, 8s
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(
          `⚠️  Error en intento ${attempt}/${this.maxRetries}. ` +
          `Reintentando en ${backoffMs / 1000}s... ` +
          `(Razón: ${error.message || 'Error desconocido'})`
        );

        await this.sleep(backoffMs);
        return this.sendTemplateMessage(phone, roomNameWithParams, patientName, appointmentTime, attempt + 1);
      }

      // Error final después de todos los reintentos
      const errorMessage = this.getErrorMessage(error);
      console.error(
        `❌ Error enviando WhatsApp con template después de ${attempt} intentos:`,
        errorMessage
      );

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Envía un mensaje de texto libre por WhatsApp con reintentos automáticos
   * NOTA: Solo usar para mensajes al admin o casos especiales. Para pacientes usar sendTemplateMessage()
   * @param phone Número de teléfono (ejemplo: 573001234567 o +573001234567)
   * @param message Mensaje a enviar
   * @param attempt Número de intento actual (uso interno)
   * @returns Resultado del envío
   */
  async sendTextMessage(
    phone: string,
    message: string,
    attempt: number = 1
  ): Promise<{ success: boolean; error?: string; messageSid?: string }> {
    if (!this.client.messages) {
      console.error('❌ Cliente de Twilio no está configurado');
      return {
        success: false,
        error: 'Cliente de Twilio no configurado'
      };
    }

    const toNumber = this.formatPhoneNumber(phone);

    try {
      console.log(`📱 Enviando WhatsApp (texto libre) a: ${toNumber} (intento ${attempt}/${this.maxRetries})`);

      const twilioMessage = await this.client.messages.create({
        from: this.fromNumber,
        to: toNumber,
        body: message,
        statusCallback: this.statusCallbackUrl
      });

      console.log(`✅ WhatsApp enviado exitosamente a ${toNumber}`);
      console.log(`   Message SID: ${twilioMessage.sid}`);
      console.log(`   Estado: ${twilioMessage.status}`);

      return {
        success: true,
        messageSid: twilioMessage.sid
      };
    } catch (error: any) {
      const isRetryableError = this.isRetryableError(error);
      const shouldRetry = isRetryableError && attempt < this.maxRetries;

      if (shouldRetry) {
        // Backoff exponencial: 2s, 4s, 8s
        const backoffMs = Math.pow(2, attempt) * 1000;
        console.warn(
          `⚠️  Error en intento ${attempt}/${this.maxRetries}. ` +
          `Reintentando en ${backoffMs / 1000}s... ` +
          `(Razón: ${error.message || 'Error desconocido'})`
        );

        await this.sleep(backoffMs);
        return this.sendTextMessage(phone, message, attempt + 1);
      }

      // Error final después de todos los reintentos
      const errorMessage = this.getErrorMessage(error);
      console.error(
        `❌ Error enviando WhatsApp después de ${attempt} intentos:`,
        errorMessage
      );

      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Determina si un error es recuperable y debe reintentarse
   */
  private isRetryableError(error: any): boolean {
    // Códigos de error de Twilio que son recuperables
    const retryableErrorCodes = [
      20429, // Too Many Requests (rate limit)
      20500, // Internal Server Error
      20503, // Service Unavailable
      30001, // Queue overflow
      30002, // Account suspended
      30003, // Unreachable destination handset
      30004, // Message blocked
      30005, // Unknown destination handset
      30006, // Landline or unreachable carrier
      30007, // Message filtered
      30008, // Unknown error
    ];

    if (error.code && retryableErrorCodes.includes(error.code)) {
      return true;
    }

    // Errores de red (timeout, connection refused, etc.)
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    return false;
  }

  /**
   * Extrae un mensaje de error legible
   */
  private getErrorMessage(error: any): string {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return 'Timeout - El servicio de Twilio tardó demasiado en responder';
    }

    // Errores específicos de Twilio
    if (error.code) {
      return `Error ${error.code}: ${error.message || 'Error de Twilio'}`;
    }

    if (error.message) {
      return error.message;
    }

    return 'Error desconocido al enviar WhatsApp';
  }
}

export default new WhatsAppService();

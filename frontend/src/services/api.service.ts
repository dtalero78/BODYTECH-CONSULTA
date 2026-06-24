import axios, { AxiosInstance } from 'axios';

// En producción (Digital Ocean), el frontend se sirve desde el mismo backend
// entonces usamos URL relativa (vacía). En desarrollo, apuntamos a localhost:3000
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Interfaz para el historial de consultas anteriores
export interface PatientHistoryRecord {
  _id: string;
  numeroId: string;
  fechaConsulta: string | null;
  fechaAtencion: string | null;
  medico: string | null;
  mdDx1: string | null;
  mdDx2: string | null;
  mdConceptoFinal: string | null;
  mdAntecedentes: string | null;
  mdObsParaMiDocYa: string | null;
  mdObservacionesCertificado: string | null;
  mdRecomendacionesMedicasAdicionales: string | null;
  tipoExamen: string | null;
  talla: string | null;
  peso: string | null;
  atendido: string | null;
}

class ApiService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Run 5 — Multi-sede login: inyectar JWT en cada request si hay sesión.
    // El key `bsl_auth_token` se setea desde `authService.login()`. Si no hay
    // sesión (paciente / pre-login), el header no se agrega y el request
    // sigue siendo público.
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('bsl_auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  /**
   * Obtener token de acceso para Twilio Video
   */
  async getVideoToken(identity: string, roomName: string): Promise<string> {
    const response = await this.client.post('/api/video/token', {
      identity,
      roomName,
    });

    return response.data.data.token;
  }

  /**
   * Crear una sala de video
   */
  async createRoom(roomName: string, type?: 'group' | 'peer-to-peer') {
    const response = await this.client.post('/api/video/rooms', {
      roomName,
      type,
    });

    return response.data.data;
  }

  /**
   * Obtener información de una sala
   */
  async getRoom(roomName: string) {
    const response = await this.client.get(`/api/video/rooms/${roomName}`);
    return response.data.data;
  }

  /**
   * Finalizar una sala
   */
  async endRoom(roomName: string) {
    const response = await this.client.post(`/api/video/rooms/${roomName}/end`);
    return response.data.data;
  }

  /**
   * Descargar RIPS JSON de una consulta y disparar la descarga en el navegador
   */
  async downloadRips(historiaId: string, numeroId: string): Promise<void> {
    const response = await this.client.get(`/api/video/medical-history/${historiaId}/rips`, {
      responseType: 'blob',
    });
    const blob = new Blob([response.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.href = url;
    a.download = `RIPS_${numeroId}_${fecha}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Listar participantes
   */
  async listParticipants(roomName: string) {
    const response = await this.client.get(`/api/video/rooms/${roomName}/participants`);
    return response.data.data;
  }

  /**
   * Registrar que un participante se conectó (para reportes)
   */
  async trackParticipantConnected(
    roomName: string,
    identity: string,
    role: 'doctor' | 'patient',
    documento?: string,
    medicoCode?: string
  ): Promise<void> {
    await this.client.post('/api/video/events/participant-connected', {
      roomName,
      identity,
      role,
      documento,
      medicoCode,
    });
  }

  /**
   * Registrar que un participante se desconectó (para reportes)
   */
  async trackParticipantDisconnected(roomName: string, identity: string): Promise<void> {
    await this.client.post('/api/video/events/participant-disconnected', {
      roomName,
      identity,
    });
  }

  /**
   * Phase 3 — Vincular roomName con la historia clínica activa al iniciar la
   * sesión de video. El backend persiste el mapping y marca
   * transcription_status='pending'. Cuando Twilio termine la grabación, el
   * webhook recording-ready usará este mapping para resolver el historiaId.
   *
   * Fire-and-forget desde useVideoRoom: si falla, no rompemos la conexión.
   */
  async sessionStart(roomName: string, historiaId: string): Promise<void> {
    await this.client.post('/api/video/events/session-start', {
      roomName,
      historiaId,
    });
  }

  /**
   * Subir el audio de la consulta grabado en el navegador (entrada principal de
   * transcripción). El backend responde 202 y procesa async (Whisper →
   * GPT-4o-mini → PATCH); el panel ya pollea `transcription_status` y muestra el
   * badge "Transcripción lista". El body es el Blob crudo; el Content-Type lleva
   * el mime del MediaRecorder (webm/opus o mp4) para que el backend elija la
   * extensión correcta.
   */
  /** Token efímero para abrir el WebSocket de transcripción en vivo (OpenAI Realtime). */
  async getRealtimeToken(): Promise<{ token: string; expiresAt?: number; model?: string }> {
    const r = await this.client.post('/api/video/realtime-token');
    return r.data;
  }

  /** Procesa el transcript completo con IA → devuelve los campos extraídos. */
  async extractFields(
    historiaId: string,
    transcript: string,
    variant: 'consulta' | 'nutricional'
  ): Promise<{ fields: Record<string, string> }> {
    const r = await this.client.post(`/api/video/extract-fields/${historiaId}`, {
      transcript,
      variant,
    });
    return r.data;
  }

  async transcribeConsulta(
    historiaId: string,
    audio: Blob,
    variant?: 'consulta' | 'nutricional'
  ): Promise<void> {
    // El backend elige qué campos autollenar según la variante (columnas en el
    // panel de consulta; JSONB datosNutricionales en el nutricional).
    const q = variant === 'nutricional' ? '?variant=nutricional' : '';
    await this.client.post(`/api/video/transcribe-consulta/${historiaId}${q}`, audio, {
      headers: { 'Content-Type': audio.type || 'application/octet-stream' },
      // El servidor responde 202 apenas recibe el body; el await es básicamente
      // el tiempo de subida del audio.
      timeout: 120000,
    });
  }

  /**
   * Obtener lista de pacientes actualmente conectados
   * @param medicoCode - Opcional: filtrar solo pacientes de este médico
   */
  async getConnectedPatients(medicoCode?: string): Promise<Array<{ documento: string; roomName: string; identity: string; connectedAt: string }>> {
    const url = medicoCode
      ? `/api/video/events/connected-patients?medicoCode=${encodeURIComponent(medicoCode)}`
      : '/api/video/events/connected-patients';
    const response = await this.client.get(url);
    return response.data.data;
  }

  /**
   * Enviar mensaje de WhatsApp con template aprobado de Twilio
   * Template Bodytech: "Hola {{1}}, Te saludamos del Bodytech. Tienes una consulta médica a las {{2}}..."
   * Button URL: https://bodytech.app/panel-medico/patient/{{3}}
   *
   * @param phone - Número de teléfono sin el prefijo + (ejemplo: 573001234567)
   * @param roomNameWithParams - Path completo con query params (ejemplo: "consulta-abc123?nombre=Juan&apellido=Perez&documento=123&doctor=JUAN")
   * @param patientName - Primer nombre del paciente (para {{1}} en el mensaje)
   * @param appointmentTime - Hora de la cita (para {{2}} en el mensaje)
   */
  async sendWhatsApp(
    phone: string,
    roomNameWithParams: string,
    patientName: string,
    appointmentTime: string,
    historiaId?: string
  ): Promise<void> {
    await this.client.post('/api/video/whatsapp/send', {
      phone,
      roomNameWithParams,
      patientName,
      appointmentTime,
      historiaId,
    });
  }

  /**
   * Reprogramación pública (abierta desde el botón de WhatsApp).
   */
  async getReprogramarInfo(id: string): Promise<{
    success: boolean;
    primerNombre: string | null;
    fechaAtencion: string | null;
    horaAtencion: string | null;
  }> {
    const res = await this.client.get(`/api/video/reprogramar/${id}`);
    return res.data;
  }

  /** Días hábiles con cupos disponibles del mismo coach (selector día → hora). */
  async getReprogramarHorarios(
    id: string
  ): Promise<{ success: boolean; dias: Array<{ fecha: string; horarios: string[] }> }> {
    const res = await this.client.get(`/api/video/reprogramar/${id}/horarios`);
    return res.data;
  }

  async reprogramarCita(
    id: string,
    fecha: string,
    hora: string
  ): Promise<{ success: boolean; fecha: string; hora: string }> {
    const res = await this.client.post(`/api/video/reprogramar/${id}`, { fecha, hora });
    return res.data;
  }

  /**
   * Listar historias clínicas de personas atendidas con paginación y búsqueda
   */
  async getAtendidos(options?: { page?: number; limit?: number; buscar?: string }): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPaginas: number;
  }> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', options.page.toString());
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.buscar) params.set('buscar', options.buscar);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await this.client.get(`/api/video/medical-history/atendidos${query}`);
    return response.data;
  }

  /**
   * Obtener historia clínica de un paciente
   */
  async getMedicalHistory(historiaId: string): Promise<any> {
    const response = await this.client.get(`/api/video/medical-history/${historiaId}`);
    return response.data.data;
  }

  /**
   * Obtener historial de consultas anteriores de un paciente por su documento de identidad
   * @param numeroId - Documento de identidad del paciente
   * @returns Array de consultas anteriores ordenadas por fecha descendente
   */
  async getPatientHistory(numeroId: string): Promise<PatientHistoryRecord[]> {
    const response = await this.client.get(`/api/video/medical-history/patient/${numeroId}`);
    return response.data.data;
  }

  /**
   * Actualizar historia clínica de un paciente
   */
  async updateMedicalHistory(payload: {
    historiaId: string;
    mdAntecedentes?: string;
    mdObsParaMiDocYa?: string;
    mdObservacionesCertificado?: string;
    mdRecomendacionesMedicasAdicionales?: string;
    mdConceptoFinal?: string;
    mdDx1?: string;
    mdDx2?: string;
    talla?: string;
    peso?: string;
    cargo?: string;
    datosNutricionales?: any;
  }): Promise<void> {
    await this.client.post('/api/video/medical-history', payload);
  }

  /**
   * Generar sugerencias médicas con IA
   */
  async generateAISuggestions(patientData: any): Promise<string> {
    const response = await this.client.post('/api/video/ai-suggestions', {
      patientData,
    });
    return response.data.data.suggestions;
  }

  /**
   * Realizar llamada telefónica con Twilio Voice
   */
  async makeVoiceCall(phoneNumber: string, patientName?: string): Promise<void> {
    await this.client.post('/api/twilio/voice-call', {
      phoneNumber,
      patientName,
    });
  }
}

export default new ApiService();

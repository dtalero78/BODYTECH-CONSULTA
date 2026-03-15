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
  async createRoom(roomName: string, type?: 'group' | 'peer-to-peer' | 'group-small') {
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
    appointmentTime: string
  ): Promise<void> {
    await this.client.post('/api/video/whatsapp/send', {
      phone,
      roomNameWithParams,
      patientName,
      appointmentTime,
    });
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

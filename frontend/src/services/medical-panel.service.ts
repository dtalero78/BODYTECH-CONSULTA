import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

export interface PatientStats {
  programadosHoy: number;
  atendidosHoy: number;
  restantesHoy: number;
}

export interface Patient {
  _id: string;
  nombres: string;
  primerNombre: string;
  primerApellido: string;
  numeroId: string;
  estado: string;
  foto: string;
  celular: string;
  fechaAtencion: Date;
  empresaListado: string;
  pvEstado?: string;
  tipoExamen?: string;
}

export interface PaginatedPatients {
  patients: Patient[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
}

export interface PatientDetails extends Patient {
  segundoNombre?: string;
  segundoApellido?: string;
  email?: string;
  direccion?: string;
  ciudad?: string;
  fechaNacimiento?: Date;
  genero?: string;
  tipoConsulta?: string;
  motivoConsulta?: string;
  fechaConsulta?: Date;
}

/**
 * Payload para crear una orden / cita médica desde el panel.
 * Subset estricto del `OrdenCreateInput` del backend (no incluye
 * `codEmpresa` ni `examenes`, que no entran en este formulario).
 */
export interface OrdenCreatePayload {
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  numeroId: string;
  celular: string;
  empresa?: string;
  tipoExamen?: string;
  medico: string;
  fechaAtencion: string; // YYYY-MM-DD
  horaAtencion: string;  // HH:MM
  ciudad?: string;
  modalidad?: 'presencial' | 'virtual'; // para validar el cupo contra disponibilidad
}

/**
 * Filtros para listar órdenes / citas desde la vista Agenda del panel.
 * `medico` es obligatorio y siempre viene del `medicoCode` del estado del
 * panel — no se expone al usuario. El resto de filtros se envían sólo si
 * están definidos (no se envía `busqueda=` vacío al backend).
 */
export interface OrdenListFilters {
  medico: string;
  fechaDesde?: string; // YYYY-MM-DD
  fechaHasta?: string; // YYYY-MM-DD
  busqueda?: string;
  page?: number;
  limit?: number;
}

/**
 * Fila de orden / cita devuelta por el listado de la Agenda.
 * Mantiene los nombres camelCase que ya usa el resto del panel.
 */
export interface OrdenRow {
  id: number;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  numeroId: string;
  celular: string;
  empresa?: string;
  tipoExamen?: string;
  medico: string;
  fechaAtencion: string; // YYYY-MM-DD
  horaAtencion: string;  // HH:MM
  ciudad?: string;
  createdAt?: string;
}

/**
 * Respuesta paginada del endpoint `GET /api/medical-panel/ordenes`.
 */
export interface OrdenListResponse {
  // El backend (`listOrdenes`) devuelve el array en `ordenes` (mismo contrato
  // que consumen OrdenesPage / OrdenesView). NO `data` — leerlo como `data`
  // dejaba la tabla de la Agenda siempre vacía aunque `total` fuera correcto.
  ordenes: OrdenRow[];
  total: number;
  page: number;
  totalPages: number;
}

class MedicalPanelService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Run 5 — Multi-sede login: este servicio mantiene su propio cliente
    // axios (no usa el `apiService` compartido). El interceptor inyecta el
    // JWT en cada request para que `/api/medical-panel/*` (que ahora exige
    // `requireAuthMiddleware`) no devuelva 401.
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('bsl_auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });
  }

  /**
   * Obtiene estadísticas del día para un médico
   */
  async getDailyStats(medicoCode: string): Promise<PatientStats> {
    const response = await this.client.get<PatientStats>(
      `/api/medical-panel/stats/${medicoCode}`
    );
    return response.data;
  }

  /**
   * Obtiene lista paginada de pacientes pendientes
   */
  async getPendingPatients(
    medicoCode: string,
    page: number = 0,
    pageSize: number = 10
  ): Promise<PaginatedPatients> {
    const response = await this.client.get<PaginatedPatients>(
      `/api/medical-panel/patients/pending/${medicoCode}`,
      {
        params: { page, pageSize }
      }
    );
    return response.data;
  }

  /**
   * Busca un paciente por documento
   */
  async searchPatientByDocument(
    documento: string,
    medicoCode?: string
  ): Promise<Patient> {
    const response = await this.client.get<Patient>(
      `/api/medical-panel/patients/search/${documento}`,
      {
        params: medicoCode ? { medicoCode } : {}
      }
    );
    return response.data;
  }

  /**
   * Obtiene detalles completos de un paciente
   */
  async getPatientDetails(documento: string): Promise<PatientDetails> {
    const response = await this.client.get<PatientDetails>(
      `/api/medical-panel/patients/details/${documento}`
    );
    return response.data;
  }

  /**
   * Marca un paciente como "No Contesta"
   */
  async markAsNoAnswer(patientId: string): Promise<void> {
    await this.client.patch(`/api/medical-panel/patients/${patientId}/no-answer`);
  }

  /**
   * Genera enlace de WhatsApp con mensaje
   */
  generateWhatsAppLink(phone: string, message: string): string {
    const formattedPhone = this.formatPhoneNumber(phone);
    return `https://api.whatsapp.com/send?phone=${formattedPhone}&text=${encodeURIComponent(message)}`;
  }

  /**
   * Formatea número telefónico con prefijo internacional
   */
  formatPhoneNumber(phone: string): string {
    // Eliminar espacios y caracteres especiales
    const cleaned = phone.replace(/[\s()+-]/g, '');

    // Si ya tiene código de país, retornar con +
    if (cleaned.startsWith('57') && cleaned.length >= 10) {
      return '+' + cleaned;
    }

    // Si es número colombiano de 10 dígitos, agregar +57
    if (cleaned.length === 10 && cleaned.startsWith('3')) {
      return '+57' + cleaned;
    }

    // Otros códigos de país
    const countryCodes = ['1', '52', '54', '55', '34', '44', '49', '33'];
    for (const code of countryCodes) {
      if (cleaned.startsWith(code)) {
        return '+' + cleaned;
      }
    }

    // Por defecto, asumir Colombia
    return '+57' + cleaned;
  }

  /**
   * Genera nombre de sala para videollamada
   */
  generateRoomName(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `consulta-${timestamp}-${random}`;
  }

  /**
   * Crea una nueva orden / cita médica.
   * `medico` debe venir del `medicoCode` del estado del panel.
   */
  async createOrden(
    data: OrdenCreatePayload
  ): Promise<{ success: boolean; data?: unknown }> {
    const res = await this.client.post('/api/medical-panel/ordenes', data);
    return res.data;
  }

  /**
   * Busca un paciente por documento para pre-llenar el formulario de
   * "Agendar Cita". Devuelve un shape reducido (no es `Patient` completo)
   * o `null` si no se encuentra. Nunca lanza — el modal usa el resultado
   * para decidir si pre-llena o no.
   *
   * Nombre distinto al `searchPatientByDocument` existente para no romper
   * el flujo de "Buscar Paciente" del panel (que espera el `Patient`
   * completo y consume el throw como error).
   */
  async lookupPatientForOrden(
    documento: string
  ): Promise<{
    numeroId: string;
    primerNombre: string;
    segundoNombre?: string;
    primerApellido: string;
    segundoApellido?: string;
    celular: string;
  } | null> {
    try {
      const res = await this.client.get(
        `/api/medical-panel/patients/search/${documento}`
      );
      // El endpoint puede devolver el paciente directamente o envuelto
      // en { data }. Probamos ambos shapes.
      const raw = ((res.data && (res.data as any).data) ?? res.data) as any;
      if (!raw || !raw.numeroId) return null;
      return {
        numeroId: String(raw.numeroId),
        primerNombre: raw.primerNombre ?? '',
        segundoNombre: raw.segundoNombre,
        primerApellido: raw.primerApellido ?? '',
        segundoApellido: raw.segundoApellido,
        celular: raw.celular ?? '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Lista órdenes / citas filtradas por rango de fecha + búsqueda libre.
   * Construye la querystring con `URLSearchParams` y omite los filtros
   * opcionales no definidos (no envía `busqueda=` vacío al backend).
   * El JWT se inyecta automáticamente vía el interceptor de axios.
   */
  async listOrdenes(filters: OrdenListFilters): Promise<OrdenListResponse> {
    const params = new URLSearchParams();
    params.set('medico', filters.medico);
    // El backend (listOrdenesQuerySchema) espera `from`/`to`/`q` — NO
    // `fechaDesde`/`fechaHasta`/`busqueda`. Enviarlos con el nombre equivocado
    // hacía que el filtro de fecha y la búsqueda se ignoraran por completo.
    if (filters.fechaDesde) params.set('from', filters.fechaDesde);
    if (filters.fechaHasta) params.set('to', filters.fechaHasta);
    if (filters.busqueda) params.set('q', filters.busqueda);
    if (filters.page !== undefined) params.set('page', String(filters.page));
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    const res = await this.client.get<OrdenListResponse>(
      `/api/medical-panel/ordenes?${params.toString()}`
    );
    return res.data;
  }

  /**
   * Actualiza una orden / cita existente. `medico`, `id` y `createdAt` no
   * son editables. Sólo se envían los campos presentes en `data` (el
   * backend acepta `Partial<...>`).
   */
  async updateOrden(
    id: number,
    data: Partial<Omit<OrdenRow, 'id' | 'createdAt' | 'medico'>>
  ): Promise<{ success: boolean }> {
    const res = await this.client.patch<{ success: boolean }>(
      `/api/medical-panel/ordenes/${id}`,
      data
    );
    return res.data;
  }

  /**
   * Elimina una orden / cita por id.
   */
  async deleteOrden(id: number): Promise<{ success: boolean }> {
    const res = await this.client.delete<{ success: boolean }>(
      `/api/medical-panel/ordenes/${id}`
    );
    return res.data;
  }
}

export default new MedicalPanelService();

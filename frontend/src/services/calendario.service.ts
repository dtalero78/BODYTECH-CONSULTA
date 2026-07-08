// ============================================================================
// calendario.service (frontend) — wrappers axios para /api/calendario/*.
// ============================================================================

import axios from 'axios';
import authService from './auth.service';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders() {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Modalidad = 'presencial' | 'virtual';

export interface DiaResumen {
  total: number;
  atendidos: number;
  pendientes: number;
  porMedico: Record<
    string,
    { total: number; atendidos: number; pendientes: number }
  >;
}

export interface MesResumen {
  year: number;
  month: number;
  totalCitas: number;
  totalAtendidos: number;
  totalPendientes: number;
  medicosActivos: number;
  porDia: Record<string, DiaResumen>;
}

export interface CitaListItem {
  id: string;
  numeroId: string;
  primerNombre: string | null;
  segundoNombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  nombre: string;
  celular: string | null;
  email: string | null;
  medicoCodigo: string | null;
  horaAtencion: string | null;
  fechaAtencion: string | null;
  atendido: string | null;
  tipoConsulta: string | null;
  empresa: string | null;
  motivoConsulta: string | null;
  sedeId: string | null;
}

export interface DiaDetalle {
  fecha: string;
  total: number;
  atendidos: number;
  pendientes: number;
  citas: CitaListItem[];
  medicosResumen: Array<{
    medicoCodigo: string;
    nombre: string;
    rol: 'medico' | 'coach' | null;
    total: number;
    atendidos: number;
    pendientes: number;
  }>;
}

export interface IndicadorMedico {
  medicoCodigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  agendadas: number;
  atendidas: number;
  /** Estado NO CONTESTA (el paciente no respondió). Etiqueta: "No contesta". */
  noContactadas: number;
  /** Sin resolver y SIN link enviado (nunca se le contactó). Etiqueta: "No contactó". */
  noContacto: number;
}

export interface IndicadoresResumen {
  from: string;
  to: string;
  agendadas: number;
  atendidas: number;
  noContactadas: number;
  noContacto: number;
  porMedico: IndicadorMedico[];
}

export interface SlotHora {
  hora: string;
  disponible: boolean;
}

export interface HorariosDisponibles {
  fecha: string;
  profesionalId: number;
  modalidad: Modalidad;
  tiempoConsulta: number;
  horarios: SlotHora[];
}

export interface Rango {
  horaInicio: string;
  horaFin: string;
}

export interface DiaResumenProfesional {
  profesionalId: number;
  codigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  tiempoConsulta: number;
  overridden: boolean;
  bloqueado: boolean;
  rangos: Rango[];
  source: 'override' | 'weekly';
}

export interface DisponibilidadDia {
  fecha: string;
  modalidad: Modalidad;
  profesionales: DiaResumenProfesional[];
}

export interface DisponibilidadMes {
  year: number;
  month: number;
  modalidad: Modalidad;
  porDia: Record<string, { overrides: number; bloqueados: number }>;
}

class CalendarioService {
  async getMes(year: number, month: number, medico?: string, sedes?: string[]): Promise<MesResumen> {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (medico) params.set('medico', medico);
    if (sedes && sedes.length > 0) params.set('sedes', sedes.join(','));
    const res = await axios.get(`${API_BASE_URL}/api/calendario/mes?${params.toString()}`, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async getDia(fecha: string, medico?: string, sedes?: string[]): Promise<DiaDetalle> {
    const params = new URLSearchParams({ fecha });
    if (medico) params.set('medico', medico);
    if (sedes && sedes.length > 0) params.set('sedes', sedes.join(','));
    const res = await axios.get(`${API_BASE_URL}/api/calendario/dia?${params.toString()}`, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async getIndicadores(
    from: string,
    to: string,
    medico?: string,
    sedes?: string[]
  ): Promise<IndicadoresResumen> {
    const params = new URLSearchParams({ from, to });
    if (medico) params.set('medico', medico);
    if (sedes && sedes.length > 0) params.set('sedes', sedes.join(','));
    const res = await axios.get(
      `${API_BASE_URL}/api/calendario/indicadores?${params.toString()}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async getHorariosDisponibles(
    fecha: string,
    profesionalId: number,
    modalidad: Modalidad
  ): Promise<HorariosDisponibles> {
    const params = new URLSearchParams({
      fecha,
      profesionalId: String(profesionalId),
      modalidad,
    });
    const res = await axios.get(
      `${API_BASE_URL}/api/calendario/horarios-disponibles?${params.toString()}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async getDisponibilidadDia(fecha: string, modalidad: Modalidad, sede?: string): Promise<DisponibilidadDia> {
    const params = new URLSearchParams({ fecha, modalidad });
    if (sede) params.set('sede', sede);
    const res = await axios.get(
      `${API_BASE_URL}/api/calendario/disponibilidad-dia?${params.toString()}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async getDisponibilidadMes(year: number, month: number, modalidad: Modalidad, sedes?: string[]): Promise<DisponibilidadMes> {
    const params = new URLSearchParams({ year: String(year), month: String(month), modalidad });
    if (sedes && sedes.length > 0) params.set('sedes', sedes.join(','));
    const res = await axios.get(
      `${API_BASE_URL}/api/calendario/disponibilidad-mes?${params.toString()}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async reasignarBulk(payload: {
    citaIds: string[];
    nuevoMedicoCodigo: string;
    nuevaFechaAtencion?: string;
    nuevaHoraAtencion?: string;
  }): Promise<{ afectadas: number }> {
    const res = await axios.post(`${API_BASE_URL}/api/calendario/reasignar-bulk`, payload, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }
}

export default new CalendarioService();

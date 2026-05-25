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

class CalendarioService {
  async getMes(year: number, month: number, medico?: string): Promise<MesResumen> {
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (medico) params.set('medico', medico);
    const res = await axios.get(`${API_BASE_URL}/api/calendario/mes?${params.toString()}`, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async getDia(fecha: string, medico?: string): Promise<DiaDetalle> {
    const params = new URLSearchParams({ fecha });
    if (medico) params.set('medico', medico);
    const res = await axios.get(`${API_BASE_URL}/api/calendario/dia?${params.toString()}`, {
      headers: authHeaders(),
    });
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

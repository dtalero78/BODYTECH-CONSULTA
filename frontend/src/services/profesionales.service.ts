// ============================================================================
// profesionales.service (frontend) — wrappers axios para /api/profesionales/*.
//
// Usa el cliente axios global (con interceptor que inyecta JWT) y la base URL
// del entorno (VITE_API_BASE_URL en dev, relativa en prod).
// ============================================================================

import axios from 'axios';
import authService from './auth.service';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders() {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Rol = 'medico' | 'coach';
export type Modalidad = 'presencial' | 'virtual';

export interface Profesional {
  id: number;
  sedeId: string;
  rol: Rol;
  codigo: string;
  primerNombre: string;
  segundoNombre: string | null;
  primerApellido: string;
  segundoApellido: string | null;
  alias: string | null;
  especialidad: string | null;
  numeroLicencia: string | null;
  tipoLicencia: string | null;
  fechaVencimientoLicencia: string | null;
  tiempoConsulta: number;
  firma: string | null;
  email: string | null;
  celular: string | null;
  activo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProfesionalInput {
  rol: Rol;
  codigo: string;
  primerNombre: string;
  segundoNombre?: string | null;
  primerApellido: string;
  segundoApellido?: string | null;
  alias?: string | null;
  especialidad?: string | null;
  numeroLicencia?: string | null;
  tipoLicencia?: string | null;
  fechaVencimientoLicencia?: string | null;
  tiempoConsulta?: number;
  firma?: string | null;
  email?: string | null;
  celular?: string | null;
}

export interface Rango {
  horaInicio: string;
  horaFin: string;
}

export interface DiaRangos {
  diaSemana: number;
  rangos: Rango[];
}

export interface DisponibilidadAgrupada {
  profesionalId: number;
  modalidad: Modalidad;
  dias: DiaRangos[];
}

export interface DisponibilidadFecha {
  profesionalId: number;
  fecha: string; // YYYY-MM-DD
  modalidad: Modalidad;
  overridden: boolean;
  bloqueado: boolean;
  rangos: Rango[];
}

interface ListFilters {
  rol?: Rol;
  activo?: boolean;
  search?: string;
  sedes?: string[]; // varias sedes (calendario multi-sede del coordinador)
}

class ProfesionalesService {
  async list(filters: ListFilters = {}): Promise<Profesional[]> {
    const params = new URLSearchParams();
    if (filters.rol) params.set('rol', filters.rol);
    if (filters.activo !== undefined) params.set('activo', String(filters.activo));
    if (filters.search) params.set('search', filters.search);
    if (filters.sedes && filters.sedes.length > 0) params.set('sedes', filters.sedes.join(','));
    const query = params.toString() ? `?${params.toString()}` : '';
    const res = await axios.get(`${API_BASE_URL}/api/profesionales${query}`, {
      headers: authHeaders(),
    });
    return res.data?.data ?? [];
  }

  async getById(id: number): Promise<Profesional> {
    const res = await axios.get(`${API_BASE_URL}/api/profesionales/${id}`, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async create(input: ProfesionalInput): Promise<Profesional> {
    const res = await axios.post(`${API_BASE_URL}/api/profesionales`, input, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async update(id: number, input: Partial<ProfesionalInput>): Promise<Profesional> {
    const res = await axios.put(`${API_BASE_URL}/api/profesionales/${id}`, input, {
      headers: authHeaders(),
    });
    return res.data?.data;
  }

  async softDelete(id: number): Promise<void> {
    await axios.delete(`${API_BASE_URL}/api/profesionales/${id}`, {
      headers: authHeaders(),
    });
  }

  async reactivar(id: number): Promise<Profesional> {
    const res = await axios.post(
      `${API_BASE_URL}/api/profesionales/${id}/reactivar`,
      {},
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async getDisponibilidad(id: number, modalidad: Modalidad): Promise<DisponibilidadAgrupada> {
    const res = await axios.get(
      `${API_BASE_URL}/api/profesionales/${id}/disponibilidad?modalidad=${modalidad}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async replaceDisponibilidad(
    id: number,
    modalidad: Modalidad,
    dias: DiaRangos[]
  ): Promise<DisponibilidadAgrupada> {
    const res = await axios.post(
      `${API_BASE_URL}/api/profesionales/${id}/disponibilidad`,
      { modalidad, dias },
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  // --- Disponibilidad por FECHA (override puntual) ---

  async getDisponibilidadFecha(
    id: number,
    fecha: string,
    modalidad: Modalidad,
    sede?: string
  ): Promise<DisponibilidadFecha> {
    const sedeQs = sede ? `&sede=${encodeURIComponent(sede)}` : '';
    const res = await axios.get(
      `${API_BASE_URL}/api/profesionales/${id}/disponibilidad-fecha?fecha=${fecha}&modalidad=${modalidad}${sedeQs}`,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async replaceDisponibilidadFecha(
    id: number,
    payload: { fecha: string; modalidad: Modalidad; bloqueado: boolean; rangos: Rango[]; sede?: string }
  ): Promise<DisponibilidadFecha> {
    const res = await axios.put(
      `${API_BASE_URL}/api/profesionales/${id}/disponibilidad-fecha`,
      payload,
      { headers: authHeaders() }
    );
    return res.data?.data;
  }

  async deleteDisponibilidadFecha(
    id: number,
    fecha: string,
    modalidad: Modalidad,
    sede?: string
  ): Promise<void> {
    const sedeQs = sede ? `&sede=${encodeURIComponent(sede)}` : '';
    await axios.delete(
      `${API_BASE_URL}/api/profesionales/${id}/disponibilidad-fecha?fecha=${fecha}&modalidad=${modalidad}${sedeQs}`,
      { headers: authHeaders() }
    );
  }
}

export default new ProfesionalesService();

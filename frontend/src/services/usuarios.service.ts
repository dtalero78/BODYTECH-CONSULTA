// ============================================================================
// usuarios.service (frontend) — cliente de /api/usuarios (gestión de usuarios).
// El token se inyecta vía el interceptor global de axios (axios-auth.ts).
// ============================================================================

import axios from 'axios';
import type { Role } from './auth.service';

const API = import.meta.env.VITE_API_BASE_URL || '';

export interface UsuarioItem {
  id: number;
  email: string;
  nombre: string;
  rol: Role;
  esGlobal: boolean;
  activo: boolean;
  profesionalId: number | null;
  celular: string | null;
  sedes: string[];
}

export interface CreateUsuarioInput {
  email: string;
  password: string;
  nombre: string;
  rol: Role;
  celular?: string | null;
  sedes: string[];
  esGlobal: boolean;
  profesionalId?: number | null;
}

/** Profesional (tabla vieja) para el selector "vincular a profesional". */
export interface ProfesionalLite {
  id: number;
  codigo: string;
  nombre: string;
  rol: Role;
  sedeId?: string;
  especialidad?: string | null;
}

export interface UpdateUsuarioInput {
  nombre?: string;
  rol?: Role;
  activo?: boolean;
  celular?: string | null;
  sedes?: string[];
  esGlobal?: boolean;
}

class UsuariosApi {
  async list(): Promise<UsuarioItem[]> {
    const res = await axios.get(`${API}/api/usuarios`);
    return res.data?.data ?? [];
  }

  async create(input: CreateUsuarioInput): Promise<void> {
    await axios.post(`${API}/api/usuarios`, input);
  }

  async update(id: number, fields: UpdateUsuarioInput): Promise<void> {
    await axios.patch(`${API}/api/usuarios/${id}`, fields);
  }

  async resetPassword(id: number, password: string): Promise<void> {
    await axios.post(`${API}/api/usuarios/${id}/password`, { password });
  }

  /** Lista profesionales (tabla vieja) para vincular a una cuenta médico/coach. */
  async profesionales(rol?: Role): Promise<ProfesionalLite[]> {
    const res = await axios.get(`${API}/api/profesionales${rol ? `?rol=${rol}` : ''}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any[] = res.data?.data ?? [];
    return data.map((p) => ({
      id: p.id,
      codigo: p.codigo,
      nombre: `${p.primerNombre ?? ''} ${p.primerApellido ?? ''}`.trim() || p.codigo,
      rol: p.rol,
      sedeId: p.sedeId,
      especialidad: p.especialidad ?? null,
    }));
  }
}

/** Mensaje legible para errores de la gestión de usuarios. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function usuariosErrorMessage(err: any): string {
  const code = err?.response?.data?.error;
  const msg = err?.response?.data?.message;
  if (code === 'EMAIL_TAKEN') return 'Ese email ya está registrado.';
  if (code === 'FORBIDDEN') return msg || 'No tienes permiso para esta acción.';
  if (code === 'SEDES_REQUERIDAS') return 'Asigna al menos una sede.';
  if (code === 'VALIDATION_ERROR') return msg || 'Revisa los campos del formulario.';
  return msg || 'No se pudo completar la operación. Intenta de nuevo.';
}

export default new UsuariosApi();

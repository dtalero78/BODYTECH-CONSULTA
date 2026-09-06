// ============================================================================
// usuariosGlobalService — Creación de Usuarios (/api/usuarios-global).
//
// El panel único de las tres aplicaciones. El rol que se asigna decide a qué
// plataforma llega la persona al iniciar sesión.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_token';

export type AppDestino = 'consulta' | 'acc' | 'prepagadas';

export interface AccesoPersona {
  app: AppDestino;
  rol: string;
  alcance: Record<string, unknown>;
  activo: boolean;
}

/** La ficha de agenda de Consulta, cuando la persona tiene una. */
export interface FichaLite {
  id: number;
  codigo: string;
  documento: string | null;
  nombre: string;
  rol: string;
  sedeId: string;
  especialidad: string | null;
  activo: boolean;
}

export interface Persona {
  /** Negativo = es una ficha sin cuenta, no una persona de la tabla de cuentas. */
  id: number;
  email: string;
  nombre: string;
  documento: string | null;
  activo: boolean;
  apps: AccesoPersona[];
  /** Baja de la organización: no entra a NINGUNA aplicación. */
  baja?: { motivo: string | null; en: string } | null;
  /** Su ficha de agenda, si la tiene. `null` = no atiende, o todavía no se creó. */
  ficha?: FichaLite | null;
}

export interface CrearPersona {
  email: string;
  nombre: string;
  /** Sólo para alguien nuevo. Quien ya existe conserva la que usa. */
  password?: string;
  documento?: string | null;
  celular?: string | null;
  app: AppDestino;
  rol: string;
  sedes?: string[];
  esGlobal?: boolean;
  profesionalId?: number | null;
}

export interface EditarPersona {
  nombre?: string;
  documento?: string | null;
  activo?: boolean;
  password?: string;
  app?: AppDestino;
  rol?: string;
  accesoActivo?: boolean;
  /** Sólo tienen sentido en Consulta: de allá cuelgan. */
  sedes?: string[];
  esGlobal?: boolean;
  profesionalId?: number | null;
  celular?: string | null;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function mensajeDeError(e: unknown, porDefecto: string): Error {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (e as any)?.response?.data;
  return new Error(r?.message || r?.error || porDefecto);
}

export default {
  async listar(): Promise<Persona[]> {
    const { data } = await axios.get(`${API_BASE_URL}/api/usuarios-global`, {
      headers: authHeader(),
    });
    if (!data?.success) throw new Error(data?.error || 'No se pudo leer los usuarios');
    return data.data as Persona[];
  },

  /** Qué roles existen en cada aplicación. No hay una lista común a propósito. */
  async roles(): Promise<Record<AppDestino, string[]>> {
    const { data } = await axios.get(`${API_BASE_URL}/api/usuarios-global/roles`, {
      headers: authHeader(),
    });
    if (!data?.success) throw new Error('No se pudo leer los roles');
    return data.data as Record<AppDestino, string[]>;
  },

  async crear(input: CrearPersona): Promise<void> {
    try {
      const { data } = await axios.post(`${API_BASE_URL}/api/usuarios-global`, input, {
        headers: authHeader(),
      });
      if (!data?.success) throw new Error(data?.message || 'No se pudo crear');
    } catch (e) {
      throw mensajeDeError(e, 'No se pudo crear el usuario');
    }
  },

  async editar(id: number, cambios: EditarPersona): Promise<void> {
    try {
      const { data } = await axios.patch(`${API_BASE_URL}/api/usuarios-global/${id}`, cambios, {
        headers: authHeader(),
      });
      if (!data?.success) throw new Error(data?.message || 'No se pudo guardar');
    } catch (e) {
      throw mensajeDeError(e, 'No se pudo guardar el cambio');
    }
  },

  /**
   * Baja de la organización: sale de LAS TRES aplicaciones de una vez. Es lo
   * que hasta ahora había que hacer aplicación por aplicación —y que ya se
   * falló al menos una vez.
   */
  async baja(id: number, dar: boolean, motivo?: string | null): Promise<void> {
    try {
      const { data } = await axios.post(
        `${API_BASE_URL}/api/usuarios-global/${id}/baja`,
        { dar, motivo: motivo ?? null },
        { headers: authHeader() },
      );
      if (!data?.success) throw new Error(data?.message || 'No se pudo aplicar');
    } catch (e) {
      throw mensajeDeError(e, 'No se pudo aplicar la baja');
    }
  },
};

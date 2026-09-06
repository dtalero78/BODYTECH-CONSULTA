// ============================================================================
// padronService — Cotejo de identidades de afiliados (/api/padron).
//
// Solo lectura. Muestra cómo están hoy las identidades antes de que exista el
// padrón único; es lo que le da al equipo médico la lista de casos a resolver.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_token';

export type EstadoIdentidad = 'unico' | 'unificable' | 'conflicto' | 'administrativo';

export interface AfiliadoCotejado {
  documento: string;
  /** Todas las formas en que se escribió el nombre de esta persona. */
  variantes: string[];
  /** La versión que ganaría al unificar. */
  nombreCanonico: string;
  estado: EstadoIdentidad;
  motivo: string;
  /** La cédula es de alguien de la planta. Contexto, no clasificación. */
  esCedulaDeProfesional: boolean;
  historias: number;
  origenes: string[];
  ultimaAtencion: string | null;
}

export interface ResumenCotejo {
  documentos: number;
  unico: number;
  unificable: number;
  conflicto: number;
  administrativo: number;
  enVariosProgramas: number;
}

export interface RespuestaCotejo {
  filas: AfiliadoCotejado[];
  resumen: ResumenCotejo;
  /** Cuántas cumplen el filtro (puede ser más que las devueltas). */
  coincidencias: number;
  truncado: boolean;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export interface EstadoPadron {
  /** Personas ya reflejadas en el padrón. */
  personas: number;
  actualizadoEn: string | null;
  /** Cuántas deberían estar y todavía no están. Debería ser 0. */
  desfase: number;
}

export default {
  async estado(): Promise<EstadoPadron> {
    const { data } = await axios.get(`${API_BASE_URL}/api/padron/estado`, {
      headers: authHeader(),
    });
    if (!data?.success) throw new Error(data?.error || 'No se pudo leer el padrón');
    return data.data as EstadoPadron;
  },

  async cotejo(f: { estado?: string; q?: string } = {}): Promise<RespuestaCotejo> {
    const { data } = await axios.get(`${API_BASE_URL}/api/padron/cotejo`, {
      headers: authHeader(),
      params: { estado: f.estado || undefined, q: f.q || undefined },
    });
    if (!data?.success) throw new Error(data?.error || 'No se pudo leer el cotejo');
    return {
      filas: data.data as AfiliadoCotejado[],
      resumen: data.resumen as ResumenCotejo,
      coincidencias: Number(data.coincidencias ?? 0),
      truncado: Boolean(data.truncado),
    };
  },
};

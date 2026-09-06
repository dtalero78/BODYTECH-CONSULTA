// ============================================================================
// directorioService (frontend) — Cliente de "Base Profesionales".
//
// Lee el directorio compartido de Bodytech (`bodytech_profesionales`), la base
// que también consume BODYTECH-ACC. Solo lectura: escribir es exclusivo del
// importador del Excel de RRHH.
//
// El acceso lo decide el backend por lista de emails; acá solo se piden datos.
// Un 403 acá significa que alguien llegó a la pantalla sin estar en la lista.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_auth_token';

export type RolDirectorio = 'medico' | 'evaluador' | 'fisioterapeuta' | 'nutricionista';
export type AmbitoDirectorio = 'sede' | 'corporativo' | 'virtual';

export interface SedeDirectorio {
  slug: string;
  nombre: string;
  regional: string;
  marca: 'bodytech' | 'athletic';
  ciudad: string | null;
  profesionales: number;
}

export interface ProfesionalDirectorio {
  documento: string;
  nombre: string;
  rol: RolDirectorio;
  cargo: string;
  ambito: AmbitoDirectorio;
  ciudad: string | null;
  sedes: string[];
}

export interface ResumenDirectorio {
  sedes: number;
  profesionales: number;
  asignaciones: number;
  porRol: { rol: string; ambito: string; personas: number; asignaciones: number }[];
  cobertura: { rol: string; presencial: number; virtual: number }[];
  porRegional: { regional: string; sedes: number }[];
}

/**
 * Un profesional de ESTA app, cotejado contra el directorio de la cadena.
 *
 * `sin_documento` no es "no está en la planta": es que todavía no se le cargó
 * la cédula, así que no se puede saber.
 */
export interface CotejoProfesional {
  id: number;
  sedeId: string;
  codigo: string;
  documento: string | null;
  nombre: string;
  especialidad: string | null;
  estado: 'en_directorio' | 'solo_local' | 'sin_documento';
  directorio: {
    nombre: string;
    rol: RolDirectorio;
    cargo: string;
    ambito: AmbitoDirectorio;
    sedes: string[];
  } | null;
}

export interface CotejoResumen {
  total: number;
  enDirectorio: number;
  soloLocal: number;
  sinDocumento: number;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const { data } = await axios.get(`${API_BASE_URL}/api/directorio${path}`, {
    headers: authHeader(),
    params,
  });
  if (!data?.success) throw new Error(data?.error || 'ERROR');
  return data.data as T;
}

export default {
  /** Devuelve las filas Y el resumen, por eso no pasa por `get<T>()`. */
  cotejo: async (): Promise<{ filas: CotejoProfesional[]; resumen: CotejoResumen }> => {
    const { data } = await axios.get(`${API_BASE_URL}/api/directorio/cotejo`, {
      headers: authHeader(),
    });
    if (!data?.success) throw new Error(data?.error || 'ERROR');
    return { filas: data.data as CotejoProfesional[], resumen: data.resumen as CotejoResumen };
  },
  resumen: () => get<ResumenDirectorio>('/resumen'),
  sedes: () => get<SedeDirectorio[]>('/sedes'),
  profesionales: (f: { rol?: string; sede?: string; q?: string } = {}) =>
    get<ProfesionalDirectorio[]>('/profesionales', {
      rol: f.rol || undefined,
      sede: f.sede || undefined,
      q: f.q || undefined,
    }),
};

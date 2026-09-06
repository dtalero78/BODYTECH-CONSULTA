// ============================================================================
// accesosService — Mapa de accesos entre las tres aplicaciones (/api/accesos).
//
// Sólo lectura. No autentica ni cambia el inicio de sesión: responde la
// pregunta que hoy exige mirar en tres bases distintas.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_token';

export interface AccesoApp {
  app: string;
  rol: string | null;
  activo: boolean;
}

export interface BajaOrganizacional {
  email: string;
  motivo: string | null;
  dadaDeBajaPor: string | null;
  dadaDeBajaEn: string;
}

export interface PersonaConAccesos {
  email: string;
  nombre: string | null;
  documento: string | null;
  accesos: AccesoApp[];
  /** Activa en una aplicación e inactiva en otra: hay que resolverlo. */
  inconsistente: boolean;
  /** Si está dada de baja de la organización, no entra a ninguna aplicación. */
  baja: BajaOrganizacional | null;
}

export interface ResumenAccesos {
  personas: number;
  enVariasApps: number;
  inconsistentes: number;
  bajas: number;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default {
  async listar(): Promise<{ personas: PersonaConAccesos[]; resumen: ResumenAccesos }> {
    const { data } = await axios.get(`${API_BASE_URL}/api/accesos`, { headers: authHeader() });
    if (!data?.success) throw new Error(data?.error || 'No se pudo leer los accesos');
    return { personas: data.data as PersonaConAccesos[], resumen: data.resumen as ResumenAccesos };
  },

  /** Da de baja de la ORGANIZACIÓN: deja de entrar a todas las aplicaciones. */
  async darDeBaja(email: string, motivo: string | null): Promise<void> {
    const { data } = await axios.post(
      `${API_BASE_URL}/api/accesos/baja`,
      { email, motivo },
      { headers: authHeader() },
    );
    if (!data?.success) throw new Error(data?.message || 'No se pudo dar de baja');
  },

  async reactivar(email: string): Promise<void> {
    const { data } = await axios.delete(
      `${API_BASE_URL}/api/accesos/baja/${encodeURIComponent(email)}`,
      { headers: authHeader() },
    );
    if (!data?.success) throw new Error(data?.error || 'No se pudo reactivar');
  },

  async sincronizar(): Promise<void> {
    const { data } = await axios.post(
      `${API_BASE_URL}/api/accesos/sincronizar`,
      {},
      { headers: authHeader() },
    );
    if (!data?.success) throw new Error(data?.error || 'No se pudo actualizar');
  },
};

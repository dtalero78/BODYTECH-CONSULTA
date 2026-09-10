// ============================================================================
// digitalizarService — Pantallazos de "Citas asignadas" de MyBodytech
// (/api/digitalizar). Lo usa la vista "Digitalizar" del panel de coordinador.
//
// El token lo pone el interceptor global de axios (axios-auth.ts).
// ============================================================================

import axios from 'axios';

const API = `${import.meta.env.VITE_API_BASE_URL || ''}/api/digitalizar`;

export type CampoDudoso = 'numeroId' | 'telefono';

export interface CitaDigitalizada {
  id: number;
  fecha: string;
  hora: string | null;
  sedeMbt: string | null;
  tipo: string | null;
  nombre: string;
  numeroId: string;
  telefono: string | null;
  modalidad: string | null;
  estadoMbt: string | null;
  /** Campos en los que las dos lecturas del pantallazo no coincidieron. */
  dudas: CampoDudoso[];
  alternativas: Partial<Record<CampoDudoso, string[]>>;
  verificadaPor: string | null;
  subidoPor: string | null;
  creadoEn: string;
  revisadoEn: string | null;
  revisadoPor: string | null;
  vecesAntes: number;
  ultimaVezAntes: string | null;
  urlMyBodytech: string;
}

export interface ResultadoLectura {
  leidas: number;
  porVerificar: number;
  descartadas: number;
  lecturasFallidas: number;
  nuevas: number;
  yaEstaban: number;
}

export interface CambiosCita {
  numeroId?: string;
  nombre?: string;
  telefono?: string | null;
  confirmar?: true;
}

/** El mensaje que manda el backend, o uno genérico. */
function error(e: unknown, generico: string): Error {
  const msg = axios.isAxiosError(e) ? e.response?.data?.message : undefined;
  return new Error(typeof msg === 'string' && msg ? msg : generico);
}

export default {
  /**
   * Si esta persona puede usar Digitalizar. Lo decide el backend; ante
   * cualquier error, no: una pestaña que lleva a un 403 es peor que no tenerla.
   */
  async acceso(): Promise<boolean> {
    try {
      const { data } = await axios.get(`${API}/acceso`);
      return Boolean(data?.data?.puede);
    } catch {
      return false;
    }
  },

  async listar(fecha: string): Promise<CitaDigitalizada[]> {
    try {
      const { data } = await axios.get(API, { params: { fecha } });
      return data.data as CitaDigitalizada[];
    } catch (e) {
      throw error(e, 'No se pudo cargar la lista.');
    }
  },

  /** Un pantallazo, ya partido en franjas (data URLs). */
  async leer(franjas: string[], fecha: string): Promise<ResultadoLectura> {
    try {
      const { data } = await axios.post(`${API}/leer`, { franjas, fecha });
      return data.data as ResultadoLectura;
    } catch (e) {
      throw error(e, 'No se pudo leer el pantallazo.');
    }
  },

  async editar(id: number, cambios: CambiosCita): Promise<void> {
    try {
      await axios.patch(`${API}/${id}`, cambios);
    } catch (e) {
      throw error(e, 'No se pudo guardar el cambio.');
    }
  },

  async marcarRevisada(id: number): Promise<void> {
    await axios.post(`${API}/${id}/revisada`);
  },

  async eliminar(id: number): Promise<void> {
    try {
      await axios.delete(`${API}/${id}`);
    } catch (e) {
      throw error(e, 'No se pudo quitar la fila.');
    }
  },
};

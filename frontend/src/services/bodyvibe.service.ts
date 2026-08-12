// ============================================================================
// bodyvibe.service — Cliente de la API de BodyVibeTech.
//
// Cliente propio (no el de `api.service`) por una razón concreta: la generación
// de un app puede tardar minutos, y el cliente compartido no tiene un tiempo de
// espera pensado para eso. Un corte a mitad de una generación se cobra igual y
// no deja nada.
// ============================================================================

import axios, { AxiosInstance } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export interface App {
  id: string;
  titulo: string;
  creadorEmail: string | null;
  estado: string;
  codigo: string;
  notas: string | null;
  version: number;
  creadoAt: string;
  actualizadoAt: string;
}

export interface VersionApp {
  version: number;
  pedido: string | null;
  notas: string | null;
  creadaAt: string;
}

export interface UsoGeneracion {
  entrada: number;
  escrituraCache: number;
  lecturaCache: number;
  salida: number;
  costoUsd: number;
}

export interface EstadoBodyVibe {
  activo: boolean;
  motivo: string | null;
  apagadoPor: string | null;
  apagadoAt: string | null;
  rolDisponible: boolean;
  configurado: boolean;
}

export interface EstadoGasto {
  gastadoUsd: number;
  topeUsd: number;
  disponible: boolean;
}

export interface Solicitud {
  id: number;
  appId: string;
  titulo?: string;
  version: number;
  codigo: string;
  estantes: string[];
  alcance: string;
  roles: string[];
  sedes: string[];
  anclaje: string | null;
  solicitante: string | null;
  creadaAt: string;
}

export interface AppPublicado {
  id: string;
  titulo: string;
  notas: string | null;
  codigo: string;
  creadorEmail: string | null;
  publicadoAt: string | null;
  anclaje: string | null;
}

export interface AnclajeDisponible {
  id: string;
  pantalla: string;
  nombre: string;
  descripcion: string;
}

export interface Paleta {
  id: string;
  nombre: string;
  descripcion: string;
  tokens: Record<string, string>;
}

export interface TemaConOpciones {
  paleta: string;
  densidad: string;
  actualizadoPor: string | null;
  actualizadoAt: string | null;
  paletas: Paleta[];
  densidades: string[];
}

export type ResultadoConsultaApi =
  | { ok: true; filas: any[]; recortado: boolean; deCache: boolean }
  | { ok: false; mensaje: string; code: string };

class BodyVibeService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
      // Generar un app con razonamiento profundo puede tardar varios minutos.
      timeout: 5 * 60_000,
    });
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('bsl_auth_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  async estado(): Promise<EstadoBodyVibe> {
    return (await this.client.get('/api/bodyvibe/estado')).data;
  }

  async gasto(): Promise<EstadoGasto> {
    return (await this.client.get('/api/bodyvibe/gasto')).data;
  }

  async apagar(motivo: string): Promise<EstadoBodyVibe> {
    return (await this.client.post('/api/bodyvibe/apagar', { motivo })).data;
  }

  async encender(): Promise<EstadoBodyVibe> {
    return (await this.client.post('/api/bodyvibe/encender')).data;
  }

  async listarApps(): Promise<App[]> {
    return (await this.client.get('/api/bodyvibe/apps')).data;
  }

  async crearApp(): Promise<App> {
    return (await this.client.post('/api/bodyvibe/apps')).data;
  }

  async obtenerApp(id: string): Promise<App> {
    return (await this.client.get(`/api/bodyvibe/apps/${id}`)).data;
  }

  async eliminarApp(id: string): Promise<void> {
    await this.client.delete(`/api/bodyvibe/apps/${id}`);
  }

  async versiones(id: string): Promise<VersionApp[]> {
    return (await this.client.get(`/api/bodyvibe/apps/${id}/versiones`)).data;
  }

  async restaurar(id: string, version: number): Promise<App> {
    return (await this.client.post(`/api/bodyvibe/apps/${id}/restaurar`, { version })).data;
  }

  async generar(
    id: string,
    pedido: string,
    historial: { pedido: string; titulo: string }[]
  ): Promise<{ ok: true; app: App; notas: string; uso: UsoGeneracion } | { ok: false; mensaje: string; code?: string }> {
    try {
      const r = await this.client.post(`/api/bodyvibe/apps/${id}/generar`, { pedido, historial });
      return r.data;
    } catch (e: any) {
      // El backend devuelve el motivo con forma estable incluso en 429/502; se
      // prefiere ese mensaje al genérico de axios, que no le dice nada a nadie.
      const datos = e?.response?.data;
      return {
        ok: false,
        mensaje: datos?.mensaje ?? 'No se pudo generar el app. Intentalo de nuevo.',
        code: datos?.code,
      };
    }
  }

  // -- Apariencia --------------------------------------------------------------

  async tema(): Promise<TemaConOpciones> {
    return (await this.client.get('/api/bodyvibe/tema')).data;
  }

  async guardarTema(
    paleta: string,
    densidad: string
  ): Promise<{ ok: true } | { ok: false; mensaje: string }> {
    try {
      return (await this.client.put('/api/bodyvibe/tema', { paleta, densidad })).data;
    } catch (e: any) {
      return { ok: false, mensaje: e?.response?.data?.mensaje ?? 'No se pudo cambiar la apariencia.' };
    }
  }

  // -- Publicación -------------------------------------------------------------

  async publicar(
    id: string,
    alcance: 'sede' | 'global',
    roles: string[],
    sedes: string[] = [],
    anclaje: string | null = null
  ): Promise<
    | { ok: true; publicado: true }
    | { ok: true; publicado: false; solicitud: Solicitud }
    | { ok: false; mensaje: string }
  > {
    try {
      return (
        await this.client.post(`/api/bodyvibe/apps/${id}/publicar`, {
          alcance,
          roles,
          sedes,
          anclaje,
        })
      ).data;
    } catch (e: any) {
      return { ok: false, mensaje: e?.response?.data?.mensaje ?? 'No se pudo publicar.' };
    }
  }

  async despublicar(id: string, motivo: string): Promise<boolean> {
    try {
      return (await this.client.post(`/api/bodyvibe/apps/${id}/despublicar`, { motivo })).data.ok;
    } catch {
      return false;
    }
  }

  async solicitudes(): Promise<Solicitud[]> {
    try {
      return (await this.client.get('/api/bodyvibe/solicitudes')).data;
    } catch {
      // 403 cuando quien mira no aprueba: no es un error que valga la pena
      // mostrar, simplemente no tiene bandeja.
      return [];
    }
  }

  async aprobar(id: number): Promise<void> {
    await this.client.post(`/api/bodyvibe/solicitudes/${id}/aprobar`);
  }

  async rechazar(id: number, motivo: string): Promise<void> {
    await this.client.post(`/api/bodyvibe/solicitudes/${id}/rechazar`, { motivo });
  }

  /**
   * Apps publicados visibles para esta persona.
   *
   * `anclaje` filtra por punto de incrustación; `'sueltos'` devuelve los que
   * viven en la pantalla de Aplicaciones.
   */
  async publicados(anclaje?: string): Promise<AppPublicado[]> {
    const r = await this.client.get('/api/bodyvibe/publicados', {
      params: anclaje ? { anclaje } : undefined,
      timeout: 15_000,
    });
    return r.data;
  }

  async anclajes(): Promise<AnclajeDisponible[]> {
    return (await this.client.get('/api/bodyvibe/anclajes')).data;
  }

  /** La ventanilla: la usa el recinto para pedir datos. */
  async consultar(sql: string, params: any[], appId?: string): Promise<ResultadoConsultaApi> {
    try {
      const r = await this.client.post(
        '/api/bodyvibe/query',
        { sql, params, appId },
        { timeout: 20_000 }
      );
      return r.data;
    } catch (e: any) {
      return {
        ok: false,
        code: 'red',
        mensaje: e?.response?.data?.mensaje ?? 'No se pudo consultar los datos.',
      };
    }
  }
}

export const bodyvibeService = new BodyVibeService();
export default bodyvibeService;

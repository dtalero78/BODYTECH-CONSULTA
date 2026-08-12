// ============================================================================
// bodyvibe.service — Cliente de la API de BodyVibeTech.
//
// Cliente propio (no el de `api.service`) por una razón concreta: la generación
// de un app puede tardar minutos, y el cliente compartido no tiene un tiempo de
// espera pensado para eso. Un corte a mitad de una generación se cobra igual y
// no deja nada.
// ============================================================================

import axios, { AxiosInstance } from 'axios';
import { instalarCierreDeSesion } from './sesion-vencida';

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
  /** ¿Esta persona puede CONSTRUIR apps? Lo decide el backend, no el rol. */
  puedoConstruir: boolean;
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

    instalarCierreDeSesion(this.client);
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

  /**
   * Genera (o modifica) un app.
   *
   * Por dentro son dos pasos: el servidor arranca el trabajo y responde al
   * instante, y acá se pregunta cada pocos segundos hasta que termina. Antes
   * era una sola petición abierta durante minutos, y el balanceador la cortaba:
   * el navegador se quedaba sin respuesta mientras la generación seguía
   * corriendo del otro lado y se cobraba igual.
   */
  async generar(
    id: string,
    pedido: string,
    historial: { pedido: string; titulo: string }[]
  ): Promise<
    | { ok: true; app: App; notas: string; costoUsd: number | null }
    | { ok: false; mensaje: string; code?: string }
  > {
    let jobId: number;
    try {
      const r = await this.client.post(
        `/api/bodyvibe/apps/${id}/generar`,
        { pedido, historial },
        { timeout: 20_000 }
      );
      if (!r.data?.ok) return { ok: false, mensaje: r.data?.mensaje ?? 'No se pudo iniciar.' };
      jobId = r.data.id;
    } catch (e: any) {
      const datos = e?.response?.data;
      return {
        ok: false,
        // Sin respuesta del servidor no hay `mensaje` que mostrar; se dice eso
        // en vez de "intentalo de nuevo", que no le sirve a nadie.
        mensaje:
          datos?.mensaje ??
          (e?.response
            ? `El servidor respondió ${e.response.status} sin explicación.`
            : 'No hubo respuesta del servidor al iniciar la generación.'),
        code: datos?.code,
      };
    }

    // Un intervalo corto al principio (a veces termina rápido) y más espaciado
    // después, para no golpear el servidor durante minutos.
    const inicio = Date.now();
    const LIMITE_MS = 8 * 60_000;
    let espera = 2_000;

    while (Date.now() - inicio < LIMITE_MS) {
      await new Promise((r) => setTimeout(r, espera));
      espera = Math.min(espera + 1_000, 6_000);

      try {
        const e = (await this.client.get(`/api/bodyvibe/generaciones/${jobId}`, { timeout: 20_000 }))
          .data;

        if (e.estado === 'listo' && e.app) {
          return { ok: true, app: e.app, notas: e.notas ?? '', costoUsd: e.costoUsd ?? null };
        }
        if (e.estado === 'error') {
          return { ok: false, mensaje: e.mensaje ?? 'La generación falló.' };
        }
      } catch {
        // Un tropiezo de red no cancela el trabajo: sigue corriendo del lado
        // del servidor, así que se vuelve a preguntar.
      }
    }

    return {
      ok: false,
      mensaje:
        'La generación se pasó de ocho minutos. Puede haber terminado igual — revise las versiones de la aplicación antes de volver a pedirla, para no pagarla dos veces.',
    };
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

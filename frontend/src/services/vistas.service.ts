// ============================================================================
// vistas.service — "Mi vista" de cualquier tabla. Cliente de /api/vistas.
// ============================================================================

import axios, { AxiosInstance } from 'axios';
import { instalarCierreDeSesion } from './sesion-vencida';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export interface VistaGuardada {
  id: number;
  tablaId: string;
  nombre: string;
  config: Record<string, unknown>;
  actualizadaAt: string;
}

class VistasService {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: { 'Content-Type': 'application/json' },
      timeout: 15_000,
    });
    this.client.interceptors.request.use((config) => {
      const token = localStorage.getItem('bsl_auth_token');
      if (token) config.headers.Authorization = `Bearer ${token}`;
      return config;
    });

    instalarCierreDeSesion(this.client);
  }

  async listar(tablaId: string): Promise<VistaGuardada[]> {
    return (await this.client.get('/api/vistas', { params: { tabla: tablaId } })).data;
  }

  async guardar(
    tablaId: string,
    nombre: string,
    config: Record<string, unknown>
  ): Promise<{ ok: true; vista: VistaGuardada } | { ok: false; mensaje: string }> {
    try {
      return (await this.client.post('/api/vistas', { tabla: tablaId, nombre, config })).data;
    } catch (e: any) {
      return { ok: false, mensaje: e?.response?.data?.mensaje ?? 'No se pudo guardar la vista.' };
    }
  }

  async eliminar(id: number): Promise<void> {
    await this.client.delete(`/api/vistas/${id}`);
  }
}

export const vistasService = new VistasService();
export default vistasService;

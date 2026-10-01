// ============================================================================
// dispositivoService — El asistente de escritorio de la consulta presencial
// (/api/dispositivo). Desde el panel el médico solo lo vincula y lo desvincula;
// lo demás lo hace la placa con su propio token.
//
// El token de sesión lo pone el interceptor global de axios (axios-auth.ts).
// ============================================================================

import axios from 'axios';

const API = `${import.meta.env.VITE_API_BASE_URL || ''}/api/dispositivo`;

export interface DispositivoVinculado {
  id: number;
  nombre: string;
  creado_en: string;
  ultimo_uso_en: string | null;
}

function mensajeDe(e: unknown, porDefecto: string): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (e as any)?.response?.data?.message || porDefecto;
}

const dispositivoService = {
  async vincular(codigo: string): Promise<void> {
    try {
      await axios.post(`${API}/vincular`, { codigo });
    } catch (e) {
      throw new Error(mensajeDe(e, 'No se pudo vincular. Intenta de nuevo.'));
    }
  },

  async mios(): Promise<DispositivoVinculado[]> {
    const r = await axios.get(`${API}/mios`);
    return r.data.data;
  },

  async desvincular(id: number): Promise<void> {
    try {
      await axios.delete(`${API}/mios/${id}`);
    } catch (e) {
      throw new Error(mensajeDe(e, 'No se pudo desvincular.'));
    }
  },
};

export default dispositivoService;

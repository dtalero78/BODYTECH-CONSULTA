// ============================================================================
// empresasService — Catálogo de empresas cliente (/api/empresas).
//
// Lo lee el panel del médico corporativo (campo "Empresa" del examen) y lo
// administra el panel de coordinador.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_token';

export interface Empresa {
  id: number;
  nombre: string;
  nit: string | null;
  activa: boolean;
  creadaEn: string;
  creadaPor: string | null;
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default {
  async listar(todas = false): Promise<Empresa[]> {
    const { data } = await axios.get(`${API_BASE_URL}/api/empresas`, {
      headers: authHeader(),
      params: todas ? { todas: '1' } : undefined,
    });
    if (!data?.success) throw new Error(data?.error || 'No se pudo leer las empresas');
    return data.data as Empresa[];
  },

  async crear(input: { nombre: string; nit?: string | null }): Promise<Empresa> {
    const { data } = await axios.post(
      `${API_BASE_URL}/api/empresas`,
      { nombre: input.nombre, nit: input.nit || undefined },
      { headers: authHeader() },
    );
    if (!data?.success) throw new Error(data?.message || 'No se pudo crear la empresa');
    return data.data as Empresa;
  },

  async desactivar(id: number): Promise<void> {
    const { data } = await axios.delete(`${API_BASE_URL}/api/empresas/${id}`, {
      headers: authHeader(),
    });
    if (!data?.success) throw new Error(data?.error || 'No se pudo desactivar la empresa');
  },
};

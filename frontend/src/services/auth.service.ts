// ============================================================================
// authService (frontend) — Run 5 (multi-sede login).
//
// Singleton que envuelve los endpoints `/api/auth/sedes` y `/api/auth/login`
// y persiste el JWT + medicoCode + sedeId en localStorage para que el
// interceptor de `api.service.ts` los inyecte automáticamente en cada request.
//
// Usa `axios` directo (no el singleton `apiService`) porque estos endpoints
// no requieren auth y para evitar un ciclo de imports al inicializar el
// interceptor.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

// Keys de localStorage. Las usa también el interceptor de `api.service.ts`
// y de `medical-panel.service.ts` — si cambian acá, cambiarlos allá.
const TOKEN_KEY = 'bsl_auth_token';
const MEDICO_KEY = 'bsl_medico_code';
const SEDE_KEY = 'bsl_sede_id';
const ROL_KEY = 'bsl_rol';

/**
 * Convierte un error de axios del endpoint /api/auth/login en un mensaje
 * legible. Distingue entre código no registrado y sede inválida.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loginErrorMessage(err: any): string {
  const code = err?.response?.data?.error;
  if (code === 'CODIGO_NOT_FOUND') {
    return 'Tu código no está registrado como profesional activo en esta sede. Pide al coordinador que te dé de alta.';
  }
  if (code === 'SEDE_NOT_FOUND') {
    return 'La sede seleccionada no existe o no está activa.';
  }
  if (code === 'VALIDATION_ERROR') {
    return 'Código o sede inválidos.';
  }
  if (code === 'DB_ERROR') {
    return 'Hubo un problema de conexión. Intenta de nuevo en unos segundos.';
  }
  return 'Código o sede incorrectos. Verifica tus credenciales.';
}

export interface Sede {
  sedeId: string;
  nombre: string;
  ciudad: string;
}

class AuthService {
  /**
   * Lista pública de sedes activas (para el <select> del form de login).
   */
  async getSedes(): Promise<Sede[]> {
    const res = await axios.get(`${API_BASE_URL}/api/auth/sedes`);
    return res.data?.data ?? [];
  }

  /**
   * Login: emite el POST, persiste token + medicoCode + sedeId en
   * localStorage. Si el server responde 4xx, axios lanza y el caller
   * (MedicalPanelPage) muestra el error.
   */
  async login(medicoCode: string, sedeId: string): Promise<void> {
    const res = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      medicoCode,
      sedeId,
    });
    const {
      token,
      medicoCode: returnedCode,
      sedeId: returnedSede,
      rol,
    } = res.data || {};
    if (!token) {
      throw new Error('Login response missing token');
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MEDICO_KEY, returnedCode ?? medicoCode);
    localStorage.setItem(SEDE_KEY, returnedSede ?? sedeId);
    if (rol) localStorage.setItem(ROL_KEY, rol);
  }

  /**
   * Cierra sesión local — sólo limpia localStorage. No hay endpoint server
   * de logout (el JWT es stateless y vence en 24h).
   */
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MEDICO_KEY);
    localStorage.removeItem(SEDE_KEY);
    localStorage.removeItem(ROL_KEY);
  }

  getRol(): 'medico' | 'coach' | null {
    const v = localStorage.getItem(ROL_KEY);
    if (v === 'medico' || v === 'coach') return v;
    return null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  getMedicoCode(): string | null {
    return localStorage.getItem(MEDICO_KEY);
  }

  getSedeId(): string | null {
    return localStorage.getItem(SEDE_KEY);
  }

  isLoggedIn(): boolean {
    return !!localStorage.getItem(TOKEN_KEY);
  }
}

export default new AuthService();

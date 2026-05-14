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
    const { token, medicoCode: returnedCode, sedeId: returnedSede } = res.data || {};
    if (!token) {
      throw new Error('Login response missing token');
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MEDICO_KEY, returnedCode ?? medicoCode);
    localStorage.setItem(SEDE_KEY, returnedSede ?? sedeId);
  }

  /**
   * Cierra sesión local — sólo limpia localStorage. No hay endpoint server
   * de logout (el JWT es stateless y vence en 24h).
   */
  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MEDICO_KEY);
    localStorage.removeItem(SEDE_KEY);
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

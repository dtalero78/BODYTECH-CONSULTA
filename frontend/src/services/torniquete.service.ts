// ============================================================================
// torniqueteService (frontend) — Cliente del torniquete de jornada.
//
//  - heartbeat(): latido de presencia mientras el profesional tiene la
//    plataforma abierta. Best-effort: si falla (red intermitente), no molesta al
//    usuario; el sweeper del backend cerrará la jornada si el corte se prolonga.
//  - getBoard(): tablero del día para el panel Coordinador.
//
// El cierre explícito de jornada (logout) lo dispara authService.logout() con
// fetch keepalive para cubrir también el unload — no vive aquí.
//
// Usa axios directo (no el singleton apiService) para evitar ciclos de import y
// mantener el heartbeat aislado del cliente principal.
// ============================================================================

import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const TOKEN_KEY = 'bsl_auth_token';

export interface BoardProfesional {
  codigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  sedeId: string;
  enLinea: boolean;
  enLineaDesde: string | null;
  primeraEntrada: string | null;
  ultimaSalida: string | null;
  minutosConectado: number;
  jornadas: number;
}

export interface BoardResult {
  fecha: string;
  sedeIds: string[];
  ahoraEnLinea: number;
  profesionales: BoardProfesional[];
}

function authHeader(): Record<string, string> {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

class TorniqueteService {
  /** Latido de presencia. Silencioso ante errores (best-effort). */
  async heartbeat(): Promise<void> {
    try {
      await axios.post(`${API_BASE_URL}/api/torniquete/heartbeat`, null, {
        headers: authHeader(),
        timeout: 8000,
      });
    } catch {
      // Ignorado a propósito: la red intermitente no debe generar ruido; el
      // sweeper del backend maneja los cortes.
    }
  }

  /** Tablero del día (coordinador). `sedes` opcional (CSV constreñido en backend). */
  async getBoard(sedes?: string[]): Promise<BoardResult> {
    const params = sedes && sedes.length > 0 ? { sedes: sedes.join(',') } : undefined;
    const res = await axios.get(`${API_BASE_URL}/api/torniquete/board`, {
      headers: authHeader(),
      params,
    });
    return res.data?.data as BoardResult;
  }
}

export default new TorniqueteService();

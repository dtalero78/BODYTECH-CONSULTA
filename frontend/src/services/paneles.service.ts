// ============================================================================
// panelesService — la página de paneles (/paneles) del creador de la
// plataforma.
//
// Guarda los tokens de ACC y Prepagadas que el backend pidió al iniciar sesión
// (o después, con /entrar) y arma el salto a cada app. Cada token lo firmó su
// app con su propio secreto; acá solo se transporta, igual que en el login.
//
// Viven en localStorage junto a la sesión de Consulta, y se borran con ella:
// `authService.logout` llama a `olvidar`, y cada login los reemplaza.
//
// El token de sesión lo pone el interceptor global de axios (axios-auth.ts).
// ============================================================================

import axios from 'axios';

const API = `${import.meta.env.VITE_API_BASE_URL || ''}/api/paneles`;
const CLAVE = 'bsl_paneles';

/**
 * Margen antes del vencimiento. Un token que vence en treinta segundos todavía
 * "sirve", pero no alcanza a llegar: la otra app lo valida al abrir y la
 * persona terminaría en su pantalla de "vuelve a ingresar".
 */
const MARGEN_MS = 60_000;

export type ProgramaPanel = 'acc' | 'prepagadas';

export interface TokenPanel {
  programa: ProgramaPanel;
  token: string;
  /** El /sso de la app, donde se entrega el token en el fragmento. */
  redirectUrl: string;
}

/** Cuándo vence, leído del propio JWT. `null` si no es un JWT legible. */
export function venceA(t: TokenPanel): Date | null {
  try {
    const cuerpo = t.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp = JSON.parse(atob(cuerpo)).exp;
    return typeof exp === 'number' ? new Date(exp * 1000) : null;
  } catch {
    return null;
  }
}

export function vigente(t: TokenPanel | null | undefined, ahora = Date.now()): t is TokenPanel {
  if (!t) return false;
  const vence = venceA(t);
  return vence !== null && vence.getTime() > ahora + MARGEN_MS;
}

function leer(): Partial<Record<ProgramaPanel, TokenPanel>> {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? JSON.parse(crudo) : {};
  } catch {
    return {};
  }
}

export function guardar(tokens: TokenPanel[]): void {
  const actuales = leer();
  for (const t of tokens) actuales[t.programa] = t;
  localStorage.setItem(CLAVE, JSON.stringify(actuales));
}

/** El token de esa app, solo si todavía sirve. */
export function tokenDe(programa: ProgramaPanel): TokenPanel | null {
  const t = leer()[programa];
  return vigente(t) ? t : null;
}

export function olvidar(): void {
  localStorage.removeItem(CLAVE);
}

/**
 * La URL del salto: el /sso de la app con el token en el FRAGMENTO —no viaja
 * al servidor ni queda en logs— y la pantalla a la que ir. `ir` lo lee ACC;
 * Prepagadas lo ignora y abre su inicio.
 */
export function urlDeSalto(t: TokenPanel, ir?: string): string {
  const fragmento = new URLSearchParams({ t: t.token });
  if (ir) fragmento.set('ir', ir);
  return `${t.redirectUrl}#${fragmento.toString()}`;
}

const panelesService = {
  /** Lo decide el backend (SUPERUSUARIOS): acá no hay copia de la lista. */
  async acceso(): Promise<boolean> {
    const r = await axios.get(`${API}/acceso`);
    return Boolean(r.data?.data?.puede);
  },

  /** Pide un token nuevo de UNA app con la contraseña, y lo guarda. */
  async entrar(programa: ProgramaPanel, password: string): Promise<TokenPanel> {
    const r = await axios.post(`${API}/entrar`, { programa, password });
    const t = r.data.data as TokenPanel;
    guardar([t]);
    return t;
  },
};

export default panelesService;

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
const ESP_KEY = 'bsl_especialidad';
// RBAC (nueva auth email+contraseña): el usuario de sesión completo.
const USER_KEY = 'bsl_user';

export type Role = 'admin' | 'coordinador' | 'medico' | 'coach' | 'auxiliar' | 'torre';

export interface SessionUser {
  userId: number;
  email: string;
  nombre: string;
  role: Role;
  sedes: string[];
  esGlobal: boolean;
  /** Código del profesional vinculado (médico/coach), si aplica. */
  codigo?: string | null;
  /** Especialidad del profesional vinculado — decide panel nutricional vs médico. */
  especialidad?: string | null;
}

/**
 * Resultado del login unificado. `consulta` = usuario de esta app (sesión ya
 * persistida). Cualquier otro `program` es una app hermana: el caller redirige
 * a `redirectUrl` entregando `token` en el fragmento (#).
 *
 * La lista de hermanas vive en el backend; acá se enumeran para que la unión
 * siga discriminando por `program` (con un `string` abierto, TypeScript no
 * puede descartar la rama 'consulta' y se pierde el chequeo). Registrar una
 * app nueva es agregarla también acá.
 */
export type ProgramaHermano = 'prepagadas' | 'acc';

export type PasswordLoginOutcome =
  | { program: 'consulta'; user: SessionUser }
  | { program: ProgramaHermano; token: string; redirectUrl: string };

/** Mensaje legible para errores del login por email+contraseña. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function passwordLoginErrorMessage(err: any): string {
  const code = err?.response?.data?.error;
  if (code === 'INVALID_CREDENTIALS') return 'Email o contraseña incorrectos.';
  if (code === 'VALIDATION_ERROR') return 'Email o contraseña inválidos.';
  if (code === 'DB_ERROR') return 'Problema de conexión. Intenta de nuevo en unos segundos.';
  return 'No se pudo iniciar sesión. Intenta de nuevo.';
}

/** Ruta de inicio por defecto según el rol (redirección post-login). */
export function homePathForRole(role: Role | null | undefined): string {
  switch (role) {
    case 'admin':
    case 'coordinador':
      return '/coordinador';
    case 'medico':
    case 'coach':
      return '/panel-medico';
    case 'auxiliar':
      return '/ordenes';
    case 'torre':
      return '/sin-acceso';
    default:
      return '/login';
  }
}

/** Normaliza una especialidad: minúsculas, sin acentos, trim. */
function normalizeEsp(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

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

// ── Registro de profesionales ───────────────────────────────────────────────
//
// La cuenta se crea en ACC (Composición Corporal); acá vive la pantalla porque
// bodytech.app es la puerta única. El backend hace de proxy — ver
// `authService.proxyRegistro` del lado del servidor.

/** Lo que devuelve el paso 1: la ficha del directorio, para confirmar. */
export interface FichaRegistro {
  documento: string;
  nombre: string;
  cargo: string;
  sedes: Array<{ slug: string; nombre: string }>;
}

/**
 * Mensaje legible para los errores del registro.
 *
 * ACC devuelve 422 con un `mensaje` escrito para la persona ("esa cédula ya
 * tiene una cuenta", "tu ficha no tiene sedes asignadas"). Se muestra tal cual:
 * traducirlo a un error genérico acá tiraría justo la parte accionable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registroErrorMessage(err: any): string {
  const data = err?.response?.data;
  if (typeof data?.mensaje === 'string' && data.mensaje) return data.mensaje;
  if (err?.response?.status === 429) {
    return 'Demasiados intentos. Esperá un rato o pedile la cuenta a tu coordinador.';
  }
  return 'No se pudo completar el registro. Intentá de nuevo en unos minutos.';
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
      especialidad,
    } = res.data || {};
    if (!token) {
      throw new Error('Login response missing token');
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(MEDICO_KEY, returnedCode ?? medicoCode);
    localStorage.setItem(SEDE_KEY, returnedSede ?? sedeId);
    if (rol) localStorage.setItem(ROL_KEY, rol);
    if (especialidad) localStorage.setItem(ESP_KEY, especialidad);
    else localStorage.removeItem(ESP_KEY);
  }

  /**
   * RBAC — Login por email + contraseña. Puerta única para las dos apps
   * hermanas:
   *  - Usuario de consulta → persiste el token en `bsl_auth_token` + `bsl_user`
   *    y devuelve `{ program: 'consulta', user }`.
   *  - Usuario de prepagadas → el backend lo detecta y devuelve un token de
   *    prepagadas; aquí NO se persiste nada de consulta, se devuelve
   *    `{ program: 'prepagadas', token, redirectUrl }` para el handoff.
   * `remember` extiende la sesión de consulta a 30 días.
   */
  async passwordLogin(
    email: string,
    password: string,
    remember: boolean
  ): Promise<PasswordLoginOutcome> {
    const res = await axios.post(`${API_BASE_URL}/api/auth/password-login`, {
      email,
      password,
      remember,
    });
    const data = res.data || {};

    // Usuario de una app hermana: handoff SSO (no toca el localStorage de
    // consulta). Se acepta cualquier `program` distinto de 'consulta' para que
    // registrar una app nueva sea un cambio solo del backend.
    if (data.program && data.program !== 'consulta') {
      if (!data.token || !data.redirectUrl) {
        throw new Error(`Login ${data.program} inválido`);
      }
      return { program: data.program as ProgramaHermano, token: data.token, redirectUrl: data.redirectUrl };
    }

    const { token, user } = data;
    if (!token || !user) {
      throw new Error('Login response inválido');
    }
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return { program: 'consulta', user: user as SessionUser };
  }

  /** Solicita el enlace de reset de contraseña por email (Resend). */
  async forgotPassword(email: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/auth/forgot-password`, { email });
  }

  /** Fija una nueva contraseña a partir del token recibido por email. */
  async resetPassword(token: string, password: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/api/auth/reset-password`, { token, password });
  }

  /** Usuario de sesión (nueva auth) o null. */
  getUser(): SessionUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SessionUser;
    } catch {
      return null;
    }
  }

  /** Rol de la sesión actual (nueva auth). */
  getSessionRole(): Role | null {
    return this.getUser()?.role ?? null;
  }

  /**
   * Cierra sesión local — limpia localStorage. Antes de borrar el token, avisa
   * al torniquete de jornada (deslogue = fin de jornada) con fetch keepalive.
   * Si el usuario no es un profesional, el backend lo trata como no-op.
   */
  logout(): void {
    // Fin de jornada (best-effort). Lee el token ANTES de limpiar localStorage.
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      try {
        fetch(`${API_BASE_URL}/api/torniquete/logout`, {
          method: 'POST',
          keepalive: true,
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      } catch {
        // no-op
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(MEDICO_KEY);
    localStorage.removeItem(SEDE_KEY);
    localStorage.removeItem(ROL_KEY);
    localStorage.removeItem(ESP_KEY);
    localStorage.removeItem(USER_KEY);
  }

  getRol(): 'medico' | 'coach' | null {
    const v = localStorage.getItem(ROL_KEY);
    if (v === 'medico' || v === 'coach') return v;
    return null;
  }

  getEspecialidad(): string | null {
    return localStorage.getItem(ESP_KEY);
  }

  /** True si el profesional logueado es de Nutrición Deportiva → abre panel nutricional. */
  isNutricionDeportiva(): boolean {
    // Nueva auth: la especialidad viene en la sesión. Fallback al legacy ESP_KEY.
    const esp = this.getUser()?.especialidad ?? localStorage.getItem(ESP_KEY);
    return normalizeEsp(esp) === 'nutricion deportiva';
  }

  /**
   * True si el profesional logueado es Médico Corporativo → examen ocupacional
   * presencial, sin sala de video ni notificación WhatsApp (ver /corporativo).
   */
  isMedicoCorporativo(): boolean {
    const esp = this.getUser()?.especialidad ?? localStorage.getItem(ESP_KEY);
    return normalizeEsp(esp) === 'medico corporativo';
  }

  /**
   * Registro paso 1: busca la cédula en el directorio compartido de Bodytech.
   * Lanza si no aparece, si el rol no es fisioterapeuta o si ya tiene cuenta;
   * el mensaje del backend explica cuál de los tres.
   */
  async registroBuscar(documento: string): Promise<FichaRegistro> {
    const res = await axios.post(`${API_BASE_URL}/api/auth/registro/buscar`, { documento });
    const ficha = res.data?.ficha;
    if (!ficha) throw new Error('Respuesta de registro inválida');
    return ficha as FichaRegistro;
  }

  /**
   * Registro paso 2: crea la cuenta. Devuelve el handoff SSO con la misma forma
   * que `passwordLogin` para una app hermana, así que la pantalla termina el
   * registro por el mismo camino: `${redirectUrl}#t=${token}`.
   */
  async registroCrear(datos: {
    documento: string;
    email: string;
    password: string;
    foto: string;
  }): Promise<{ token: string; redirectUrl: string }> {
    const res = await axios.post(`${API_BASE_URL}/api/auth/registro`, datos);
    const { token, redirectUrl } = res.data || {};
    if (!token || !redirectUrl) throw new Error('Respuesta de registro inválida');
    return { token, redirectUrl };
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

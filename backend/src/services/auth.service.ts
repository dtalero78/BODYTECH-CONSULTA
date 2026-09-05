// ============================================================================
// authService — Multi-sede login con validación contra tabla `profesionales`.
//
// Responsabilidades:
//   1) Validar que la sede exista y esté activa.
//   2) Validar que el código corresponda a un profesional ACTIVO de esa sede
//      (médico o coach). Sin password ni PIN — la entrega del código es la
//      credencial.
//   3) Emitir JWT con payload `{ medicoCode, sedeId, rol }` (TTL 24h).
//   4) Listar sedes activas (para popular el <select> del login).
//   5) Verificar tokens recibidos en `Authorization: Bearer ...`.
// ============================================================================

import jwt from 'jsonwebtoken';
import postgresService from './postgres.service';
import usuariosService, { Rol } from './usuarios.service';

const JWT_SECRET = process.env.JWT_SECRET || 'bsl-dev-secret-change-in-prod';
const JWT_TTL = '24h';
// RBAC (email+contraseña): sesión corta + "recordarme" extendida.
const SESSION_TTL = '12h';
const SESSION_TTL_REMEMBER = '30d';

// Apps hermanas. El login de bodytech.app es la puerta única: si las
// credenciales no son de un usuario de consulta, se reenvían a la API de cada
// hermana hasta que alguna autentique (SSO por handoff). No comparten
// JWT_SECRET — cada app sigue firmando y validando sus propios tokens; acá el
// token solo se transporta.
//
// Para sumar una app nueva: una entrada más en esta lista. El `programa` es lo
// que el frontend usa para saber a dónde redirigir, así que tiene que coincidir
// con lo que espera `PasswordLoginOutcome` del lado del cliente.
const APPS_HERMANAS: Array<{ programa: string; url: string }> = [
  {
    programa: 'prepagadas',
    url: (process.env.PREPAGADAS_URL || 'https://prepagadas.bodytech.app').replace(/\/+$/, ''),
  },
  {
    programa: 'acc',
    url: (process.env.ACC_URL || 'https://bodytech-acc-f9hd6.ondigitalocean.app').replace(/\/+$/, ''),
  },
];

export interface AuthPayload {
  medicoCode: string;
  sedeId: string;
  rol?: 'medico' | 'coach';
}

/**
 * Payload del JWT de la nueva auth por email+contraseña. `kind: 'session'` lo
 * distingue del token legacy (code+sede) para que los middlewares sepan cuál
 * es. `sedes` lista las sedes asignadas; si `esGlobal`, aplica a todas.
 */
export interface SessionPayload {
  kind: 'session';
  userId: number;
  email: string;
  nombre: string;
  role: Rol;
  sedes: string[];
  esGlobal: boolean;
  /** Código del profesional vinculado (médico/coach) — para el panel. */
  codigo?: string | null;
  /** Especialidad del profesional vinculado — decide panel nutricional vs médico. */
  especialidad?: string | null;
}

export type PasswordLoginError = 'INVALID_CREDENTIALS' | 'DB_ERROR';

export interface PasswordLoginResult {
  ok: boolean;
  token?: string;
  user?: Omit<SessionPayload, 'kind'>;
  error?: PasswordLoginError;
}

/** Resultado del puente de login hacia una app hermana. */
export interface HermanaLoginResult {
  ok: boolean;
  /** Qué app autenticó: 'prepagadas', 'acc'… Lo usa el frontend para redirigir. */
  programa?: string;
  /** Token firmado por ESA app (con su propio secreto) para el handoff SSO. */
  token?: string;
  /** Su URL /sso, donde el frontend entrega el token en el fragmento. */
  redirectUrl?: string;
}

/** @deprecated Alias del tipo anterior; se mantiene por compatibilidad. */
export type PrepagadasLoginResult = HermanaLoginResult;

export type LoginErrorCode = 'SEDE_NOT_FOUND' | 'CODIGO_NOT_FOUND' | 'DB_ERROR';

export interface LoginResult {
  ok: boolean;
  token?: string;
  rol?: 'medico' | 'coach';
  /** Especialidad del profesional (ej. "Nutricion Deportiva") — define qué panel abre. */
  especialidad?: string | null;
  error?: LoginErrorCode;
}

export interface SedeRow {
  sedeId: string;
  nombre: string;
  ciudad: string;
}

class AuthService {
  /**
   * Login: valida sede activa + código de profesional activo en esa sede.
   * Si todo OK, firma JWT con `{ medicoCode, sedeId, rol }`.
   */
  async login(medicoCode: string, sedeId: string): Promise<LoginResult> {
    // 1) Sede activa
    const sedeResult = await postgresService.query(
      'SELECT sede_id FROM sedes WHERE sede_id = $1 AND activa = TRUE',
      [sedeId]
    );
    if (sedeResult === null) {
      return { ok: false, error: 'DB_ERROR' };
    }
    if (sedeResult.length === 0) {
      return { ok: false, error: 'SEDE_NOT_FOUND' };
    }

    // 2) Profesional activo con ese código en esa sede
    const profResult = await postgresService.query(
      `SELECT rol, especialidad FROM profesionales
        WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE
        LIMIT 1`,
      [medicoCode, sedeId]
    );
    if (profResult === null) {
      return { ok: false, error: 'DB_ERROR' };
    }
    if (profResult.length === 0) {
      return { ok: false, error: 'CODIGO_NOT_FOUND' };
    }
    const rol = profResult[0].rol === 'coach' ? 'coach' : 'medico';
    const especialidad = profResult[0].especialidad ? String(profResult[0].especialidad) : null;

    const payload: AuthPayload = { medicoCode, sedeId, rol };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL });
    return { ok: true, token, rol, especialidad };
  }

  /**
   * Lista sedes activas, ordenadas por ciudad y nombre. Mapea las columnas
   * snake_case de la DB → camelCase para el frontend.
   */
  async getSedes(): Promise<SedeRow[]> {
    const result = await postgresService.query(
      'SELECT sede_id, nombre, ciudad FROM sedes WHERE activa = true ORDER BY ciudad, nombre'
    );

    if (!result) {
      return [];
    }

    return result.map((row: any) => ({
      sedeId: row.sede_id,
      nombre: row.nombre,
      ciudad: row.ciudad,
    }));
  }

  /**
   * Verifica un JWT. Retorna el payload si es válido, `null` si está expirado,
   * tiene firma inválida o cualquier otra falla.
   */
  verifyToken(token: string): AuthPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
      return decoded;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // RBAC — Login por email + contraseña (nueva auth). Aditivo: el login
  // legacy (code+sede) de arriba sigue funcionando hasta el cutover.
  // ==========================================================================

  /**
   * Login por email + contraseña. Valida contra `usuarios` (bcrypt) y firma un
   * JWT de sesión con `{ userId, role, sedes, esGlobal }`. `remember` extiende
   * la vigencia a 30 días (equipos de confianza); por defecto 12h.
   */
  async loginWithPassword(
    email: string,
    password: string,
    remember = false
  ): Promise<PasswordLoginResult> {
    const row = await usuariosService.findActiveByEmail(email);
    // Mensaje uniforme INVALID_CREDENTIALS para no filtrar si el email existe.
    if (!row) {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }

    const passOk = await usuariosService.verifyPassword(password, row.password_hash);
    if (!passOk) {
      return { ok: false, error: 'INVALID_CREDENTIALS' };
    }

    const sesion = await usuariosService.toSesion(row);
    const payload: SessionPayload = {
      kind: 'session',
      userId: sesion.id,
      email: sesion.email,
      nombre: sesion.nombre,
      role: sesion.rol,
      sedes: sesion.sedes,
      esGlobal: sesion.esGlobal,
      codigo: sesion.codigo,
      especialidad: sesion.especialidad,
    };
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: remember ? SESSION_TTL_REMEMBER : SESSION_TTL,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kind: _kind, ...user } = payload;
    return { ok: true, token, user };
  }

  /**
   * Puente hacia las apps hermanas. Reenvía las credenciales a la API de login
   * de cada una (server-to-server) hasta que alguna autentique. Devuelve el
   * token que ESA app firmó con su propio JWT_SECRET y su URL /sso, donde el
   * frontend lo entrega vía fragmento. Cualquier fallo de una hermana
   * (credenciales inválidas, red, timeout) pasa a la siguiente; si ninguna
   * autentica → `ok:false` y el caller responde como login fallido normal.
   *
   * Se prueban EN ORDEN, no en paralelo: en paralelo las credenciales del
   * usuario viajarían siempre a todas las apps, incluso a las que no son la
   * suya. El costo es latencia — con N hermanas, un login fallido tarda hasta
   * N × 8 s. Con dos es tolerable; a la cuarta conviene enrutar por email
   * (una tabla `email → app` acá) en vez de seguir encadenando.
   */
  async loginHermanas(email: string, password: string): Promise<HermanaLoginResult> {
    for (const hermana of APPS_HERMANAS) {
      try {
        const resp = await fetch(`${hermana.url}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) continue;
        const data = (await resp.json()) as { token?: string };
        if (!data?.token) continue;
        return {
          ok: true,
          programa: hermana.programa,
          token: data.token,
          redirectUrl: `${hermana.url}/sso`,
        };
      } catch {
        // Una hermana caída no puede impedir que las demás respondan.
        continue;
      }
    }
    return { ok: false };
  }

  /** @deprecated Usar `loginHermanas`. Se mantiene por compatibilidad. */
  async loginPrepagadas(email: string, password: string): Promise<HermanaLoginResult> {
    return this.loginHermanas(email, password);
  }

  // ==========================================================================
  // Registro de profesionales — puente hacia ACC.
  //
  // La PANTALLA vive acá (bodytech.app es la puerta única, y es donde la gente
  // llega), pero la CUENTA se crea en ACC: su tabla `usuarios`, su `JWT_SECRET`,
  // su rol `fisioterapeuta`. Acá solo se reenvía, igual que con el login.
  //
  // Por qué proxy y no que el navegador llame a ACC directo:
  //   1. ACC no tiene CORS abierto a bodytech.app en producción (frontend y API
  //      comparten origen allá), así que la llamada del navegador moriría en el
  //      preflight.
  //   2. El rate-limit tiene que aplicarse donde se ve la IP del navegador, y
  //      eso es acá. Del lado de ACC todo llega desde una sola IP —la nuestra—
  //      y limitar por IP allá no distinguiría a nadie.
  //
  // Hoy solo se registran fisioterapeutas de ACC (el resto de los roles del
  // directorio ya tienen su acceso por otro lado). Cuando otra app hermana
  // acepte registro, esto pasa a elegir destino por el rol del directorio; no
  // conviene generalizarlo antes, porque el mapeo rol-directorio → rol-app es
  // una definición de negocio distinta en cada app.
  // ==========================================================================

  /** A dónde apunta el registro. Misma URL que la hermana 'acc' del login. */
  private accUrl(): string {
    return (process.env.ACC_URL || 'https://bodytech-acc-f9hd6.ondigitalocean.app').replace(/\/+$/, '');
  }

  /**
   * Reenvía a ACC y devuelve su respuesta TAL CUAL, con su status.
   *
   * Se pasa el cuerpo sin reinterpretarlo a propósito: los mensajes de ACC son
   * los que saben por qué se rechazó ("esa cédula ya tiene cuenta", "tu ficha
   * no tiene sedes asignadas"), y traducirlos acá a un error genérico dejaría
   * a la persona sin saber qué hacer. Un 502 solo cuando ACC no responde.
   */
  async proxyRegistro(
    ruta: 'buscar' | 'crear',
    cuerpo: unknown
  ): Promise<{ status: number; body: unknown }> {
    const url = `${this.accUrl()}/api/auth/registro${ruta === 'buscar' ? '/buscar' : ''}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        // Más generoso que los 8 s del login: crear la cuenta sube la foto al
        // bucket antes de responder.
        signal: AbortSignal.timeout(20000),
      });
      return { status: resp.status, body: await resp.json() };
    } catch (e) {
      console.error('[registro] ACC no respondió:', e instanceof Error ? e.message : e);
      return {
        status: 502,
        body: {
          ok: false,
          codigo: 'acc_no_disponible',
          mensaje: 'La plataforma de Composición Corporal no está respondiendo. Intentá en unos minutos.',
        },
      };
    }
  }

  /** URL /sso de ACC, donde el frontend entrega el token en el fragmento. */
  ssoUrlAcc(): string {
    return `${this.accUrl()}/sso`;
  }

  // ==========================================================================
  // RBAC — Reset de contraseña por email (Resend). El token se firma con una
  // clave derivada del hash ACTUAL de la contraseña, así que apenas el usuario
  // cambia su contraseña, cualquier enlace de reset previo deja de servir
  // (un solo uso efectivo). TTL 1h.
  // ==========================================================================

  /** Crea un token de reset para un usuario (clave = JWT_SECRET + ':' + hash). */
  createPasswordResetToken(userId: number, passwordHash: string): string {
    const key = `${JWT_SECRET}:${passwordHash}`;
    return jwt.sign({ kind: 'pwreset', userId }, key, { expiresIn: '1h' });
  }

  /**
   * Verifica un token de reset. Decodifica sin verificar para sacar el userId,
   * busca el usuario, reconstruye la clave con su hash actual y verifica la
   * firma. Retorna el userId si es válido, null si no.
   */
  async verifyPasswordResetToken(token: string): Promise<number | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decoded = jwt.decode(token) as any;
    if (!decoded || decoded.kind !== 'pwreset' || typeof decoded.userId !== 'number') {
      return null;
    }
    const row = await usuariosService.findActiveById(decoded.userId);
    if (!row) return null;
    const key = `${JWT_SECRET}:${row.password_hash}`;
    try {
      jwt.verify(token, key);
      return decoded.userId as number;
    } catch {
      return null;
    }
  }

  /**
   * Verifica un JWT de sesión (nueva auth). Retorna el `SessionPayload` si es
   * válido y es de tipo 'session'; `null` en cualquier otro caso (incluye los
   * tokens legacy code+sede, que no llevan `kind: 'session'`).
   */
  verifySessionToken(token: string): SessionPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
      if (decoded && decoded.kind === 'session' && typeof decoded.userId === 'number') {
        return decoded;
      }
      return null;
    } catch {
      return null;
    }
  }
}

export default new AuthService();

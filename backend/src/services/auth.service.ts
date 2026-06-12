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
}

export type PasswordLoginError = 'INVALID_CREDENTIALS' | 'DB_ERROR';

export interface PasswordLoginResult {
  ok: boolean;
  token?: string;
  user?: Omit<SessionPayload, 'kind'>;
  error?: PasswordLoginError;
}

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
    };
    const token = jwt.sign(payload, JWT_SECRET, {
      expiresIn: remember ? SESSION_TTL_REMEMBER : SESSION_TTL,
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { kind: _kind, ...user } = payload;
    return { ok: true, token, user };
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

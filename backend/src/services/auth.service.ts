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

const JWT_SECRET = process.env.JWT_SECRET || 'bsl-dev-secret-change-in-prod';
const JWT_TTL = '24h';

export interface AuthPayload {
  medicoCode: string;
  sedeId: string;
  rol?: 'medico' | 'coach';
}

export type LoginErrorCode = 'SEDE_NOT_FOUND' | 'CODIGO_NOT_FOUND' | 'DB_ERROR';

export interface LoginResult {
  ok: boolean;
  token?: string;
  rol?: 'medico' | 'coach';
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
      `SELECT rol FROM profesionales
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

    const payload: AuthPayload = { medicoCode, sedeId, rol };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_TTL });
    return { ok: true, token, rol };
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
}

export default new AuthService();

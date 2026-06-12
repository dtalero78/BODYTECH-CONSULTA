// ============================================================================
// usuariosService — Capa de datos + auth de la tabla `usuarios` (RBAC).
//
// Fuente única de identidad/login/rol para los 6 roles. La autenticación es
// por email + contraseña (bcrypt). El alcance por sede se resuelve con la
// tabla puente `usuario_sedes` (1..N) o el flag `es_global` (todas las sedes).
//
// Fase 1: helpers de login (findByEmail, verifyPassword), resolución de sedes,
// y siembra idempotente del primer admin desde variables de entorno. El CRUD
// para la UI de gestión de usuarios se agrega en la Fase 4.
// ============================================================================

import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import postgresService from './postgres.service';

export type Rol = 'admin' | 'coordinador' | 'medico' | 'coach' | 'auxiliar' | 'torre';

export const ROLES: ReadonlyArray<Rol> = [
  'admin',
  'coordinador',
  'medico',
  'coach',
  'auxiliar',
  'torre',
];

const BCRYPT_ROUNDS = 10;

export interface UsuarioRow {
  id: number;
  email: string;
  password_hash: string;
  nombre: string;
  rol: Rol;
  profesional_id: number | null;
  es_global: boolean;
  activo: boolean;
}

/** Usuario resuelto para sesión: sin hash, con la lista de sedes ya cargada. */
export interface UsuarioSesion {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  profesionalId: number | null;
  esGlobal: boolean;
  sedes: string[];
  /** Código (cédula) del profesional vinculado — lo usa el panel médico/coach. */
  codigo: string | null;
  /** Especialidad del profesional vinculado — decide qué panel abre (nutricional vs médico). */
  especialidad: string | null;
}

/** Fila cruda del JOIN usuarios + array_agg(sedes). */
interface UsuarioRowWithSedes {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  es_global: boolean;
  activo: boolean;
  profesional_id: number | null;
  sedes: string[];
}

/** Usuario para la UI de gestión (sin hash). */
export interface UsuarioListItem {
  id: number;
  email: string;
  nombre: string;
  rol: Rol;
  esGlobal: boolean;
  activo: boolean;
  profesionalId: number | null;
  sedes: string[];
}

/** Input de creación (el hash lo calcula el controller/service de auth). */
export interface CreateUsuarioInput {
  email: string;
  passwordHash: string;
  nombre: string;
  rol: Rol;
  esGlobal: boolean;
  profesionalId?: number | null;
  sedes: string[];
}

class UsuariosService {
  hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  }

  verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Normaliza email para comparación case-insensitive y sin espacios. */
  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** Busca un usuario ACTIVO por email (para login). null si no existe / DB error. */
  async findActiveByEmail(email: string): Promise<UsuarioRow | null> {
    const rows = await postgresService.query(
      `SELECT id, email, password_hash, nombre, rol, profesional_id, es_global, activo
         FROM usuarios
        WHERE LOWER(email) = $1 AND activo = TRUE
        LIMIT 1`,
      [this.normalizeEmail(email)]
    );
    if (!rows || rows.length === 0) return null;
    return rows[0] as UsuarioRow;
  }

  /** Busca un usuario ACTIVO por id (incluye hash — para verificar tokens de reset). */
  async findActiveById(id: number): Promise<UsuarioRow | null> {
    const rows = await postgresService.query(
      `SELECT id, email, password_hash, nombre, rol, profesional_id, es_global, activo
         FROM usuarios
        WHERE id = $1 AND activo = TRUE
        LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return rows[0] as UsuarioRow;
  }

  /** Lista las sedes asignadas a un usuario (vacío si es_global o sin asignar). */
  async getSedes(usuarioId: number): Promise<string[]> {
    const rows = await postgresService.query(
      `SELECT sede_id FROM usuario_sedes WHERE usuario_id = $1 ORDER BY sede_id`,
      [usuarioId]
    );
    if (!rows) return [];
    return rows.map((r: { sede_id: string }) => r.sede_id);
  }

  /** Construye el objeto de sesión (sin hash) a partir de una fila + sus sedes. */
  async toSesion(row: UsuarioRow): Promise<UsuarioSesion> {
    const sedes = row.es_global ? [] : await this.getSedes(row.id);
    // Si está vinculado a un profesional (médico/coach), traemos su código y
    // especialidad para que el panel sepa a quién representa y qué panel abrir.
    let codigo: string | null = null;
    let especialidad: string | null = null;
    if (row.profesional_id) {
      const p = await postgresService.query(
        `SELECT codigo, especialidad FROM profesionales WHERE id = $1 LIMIT 1`,
        [row.profesional_id]
      );
      if (p && p.length > 0) {
        codigo = p[0].codigo ?? null;
        especialidad = p[0].especialidad ?? null;
      }
    }
    return {
      id: row.id,
      email: row.email,
      nombre: row.nombre,
      rol: row.rol,
      profesionalId: row.profesional_id,
      esGlobal: row.es_global,
      sedes,
      codigo,
      especialidad,
    };
  }

  // ==========================================================================
  // CRUD — gestión de usuarios (Fase 4). La AUTORIZACIÓN (límites P7) la aplica
  // el controller usando la sesión del actor; aquí solo van operaciones de datos.
  // ==========================================================================

  /** ¿Existe ya un usuario con ese email? null en error de BD. */
  async emailExists(email: string): Promise<boolean | null> {
    const rows = await postgresService.query(
      `SELECT 1 FROM usuarios WHERE LOWER(email) = $1 LIMIT 1`,
      [this.normalizeEmail(email)]
    );
    if (rows === null) return null;
    return rows.length > 0;
  }

  private mapListItem(row: UsuarioRowWithSedes): UsuarioListItem {
    return {
      id: row.id,
      email: row.email,
      nombre: row.nombre,
      rol: row.rol,
      esGlobal: row.es_global,
      activo: row.activo,
      profesionalId: row.profesional_id,
      sedes: Array.isArray(row.sedes) ? row.sedes : [],
    };
  }

  /**
   * Lista usuarios con sus sedes. `soloRoles` y `soloSedes` acotan el resultado
   * (el coordinador solo ve usuarios de roles gestionables y de sus sedes).
   */
  async list(opts: { soloRoles?: Rol[]; soloSedes?: string[] }): Promise<UsuarioListItem[] | null> {
    const where: string[] = [];
    const params: unknown[] = [];
    let i = 1;
    if (opts.soloRoles && opts.soloRoles.length > 0) {
      where.push(`u.rol = ANY($${i++}::text[])`);
      params.push(opts.soloRoles);
    }
    if (opts.soloSedes) {
      where.push(
        `u.id IN (SELECT usuario_id FROM usuario_sedes WHERE sede_id = ANY($${i++}::text[]))`
      );
      params.push(opts.soloSedes);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = await postgresService.query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.es_global, u.activo, u.profesional_id,
              COALESCE(array_agg(us.sede_id) FILTER (WHERE us.sede_id IS NOT NULL), '{}') AS sedes
         FROM usuarios u
         LEFT JOIN usuario_sedes us ON us.usuario_id = u.id
         ${whereClause}
         GROUP BY u.id
         ORDER BY u.nombre`,
      params
    );
    if (rows === null) return null;
    return rows.map((r) => this.mapListItem(r as UsuarioRowWithSedes));
  }

  async getById(id: number): Promise<UsuarioListItem | null> {
    const rows = await postgresService.query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.es_global, u.activo, u.profesional_id,
              COALESCE(array_agg(us.sede_id) FILTER (WHERE us.sede_id IS NOT NULL), '{}') AS sedes
         FROM usuarios u
         LEFT JOIN usuario_sedes us ON us.usuario_id = u.id
         WHERE u.id = $1
         GROUP BY u.id`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    return this.mapListItem(rows[0] as UsuarioRowWithSedes);
  }

  private async replaceSedes(client: PoolClient, id: number, sedes: string[]): Promise<void> {
    await client.query(`DELETE FROM usuario_sedes WHERE usuario_id = $1`, [id]);
    for (const s of sedes) {
      await client.query(
        `INSERT INTO usuario_sedes (usuario_id, sede_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, s]
      );
    }
  }

  /** Crea un usuario + sus sedes de forma atómica. `EMAIL_TAKEN` si el email ya existe. */
  async create(input: CreateUsuarioInput): Promise<{ ok: boolean; id?: number; error?: string }> {
    const client = await postgresService.getClient();
    if (!client) return { ok: false, error: 'DB_ERROR' };
    try {
      await client.query('BEGIN');
      const ins = await client.query(
        `INSERT INTO usuarios (email, password_hash, nombre, rol, profesional_id, es_global, activo)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING id`,
        [
          this.normalizeEmail(input.email),
          input.passwordHash,
          input.nombre,
          input.rol,
          input.profesionalId ?? null,
          input.esGlobal,
        ]
      );
      const id = ins.rows[0].id as number;
      if (!input.esGlobal && input.sedes.length > 0) {
        await this.replaceSedes(client, id, input.sedes);
      }
      await client.query('COMMIT');
      return { ok: true, id };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      if (e?.code === '23505') return { ok: false, error: 'EMAIL_TAKEN' };
      console.error('❌ [usuarios.create]', e?.message ?? e);
      return { ok: false, error: 'DB_ERROR' };
    } finally {
      client.release();
    }
  }

  /** Actualiza campos del usuario y, si `sedes` viene, reemplaza sus sedes (atómico). */
  async update(
    id: number,
    fields: {
      nombre?: string;
      rol?: Rol;
      activo?: boolean;
      esGlobal?: boolean;
      profesionalId?: number | null;
    },
    sedes?: string[]
  ): Promise<{ ok: boolean; error?: string }> {
    const client = await postgresService.getClient();
    if (!client) return { ok: false, error: 'DB_ERROR' };
    try {
      await client.query('BEGIN');
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      if (fields.nombre !== undefined) { sets.push(`nombre = $${i++}`); params.push(fields.nombre); }
      if (fields.rol !== undefined) { sets.push(`rol = $${i++}`); params.push(fields.rol); }
      if (fields.activo !== undefined) { sets.push(`activo = $${i++}`); params.push(fields.activo); }
      if (fields.esGlobal !== undefined) { sets.push(`es_global = $${i++}`); params.push(fields.esGlobal); }
      if (fields.profesionalId !== undefined) { sets.push(`profesional_id = $${i++}`); params.push(fields.profesionalId); }
      sets.push(`updated_at = NOW()`);
      params.push(id);
      const r = await client.query(
        `UPDATE usuarios SET ${sets.join(', ')} WHERE id = $${i} RETURNING id`,
        params
      );
      if (r.rowCount === 0) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'NOT_FOUND' };
      }
      if (sedes !== undefined) {
        await this.replaceSedes(client, id, fields.esGlobal ? [] : sedes);
      }
      await client.query('COMMIT');
      return { ok: true };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('❌ [usuarios.update]', e?.message ?? e);
      return { ok: false, error: 'DB_ERROR' };
    } finally {
      client.release();
    }
  }

  async setPassword(id: number, passwordHash: string): Promise<boolean> {
    const r = await postgresService.query(
      `UPDATE usuarios SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
      [passwordHash, id]
    );
    return !!(r && r.length > 0);
  }

  /**
   * Siembra el PRIMER admin si todavía no existe ningún admin. Rompe el
   * huevo-gallina: lee credenciales de las env vars BOOTSTRAP_ADMIN_EMAIL y
   * BOOTSTRAP_ADMIN_PASSWORD. Idempotente: si ya hay un admin, no hace nada.
   * Se invoca tras runMigrations() en index.ts.
   */
  async seedBootstrapAdmin(): Promise<void> {
    const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    const nombre = process.env.BOOTSTRAP_ADMIN_NOMBRE?.trim() || 'Administrador';

    if (!email || !password) {
      // Sin credenciales configuradas no sembramos (evita un admin sin clave).
      return;
    }
    if (password.length < 8) {
      console.warn('⚠️ [usuarios] BOOTSTRAP_ADMIN_PASSWORD < 8 chars — admin NO sembrado.');
      return;
    }

    const existing = await postgresService.query(
      `SELECT 1 FROM usuarios WHERE rol = 'admin' LIMIT 1`
    );
    if (existing === null) {
      // DB error — no insistir.
      return;
    }
    if (existing.length > 0) {
      // Ya hay un admin: nada que hacer.
      return;
    }

    const hash = await this.hashPassword(password);
    // Sin ON CONFLICT: la unicidad la da el índice de expresión LOWER(email)
    // (no una constraint sobre la columna). La verificación de "no hay admin"
    // de arriba evita duplicados en el flujo normal; ante una carrera, el índice
    // lanza 23505 y `query()` devuelve null → se loguea "no sembrado".
    const inserted = await postgresService.query(
      `INSERT INTO usuarios (email, password_hash, nombre, rol, es_global, activo)
       VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
       RETURNING id`,
      [this.normalizeEmail(email), hash, nombre]
    );
    if (inserted && inserted.length > 0) {
      console.log(`✅ [usuarios] Admin inicial sembrado: ${this.normalizeEmail(email)} (es_global)`);
    } else {
      console.log('ℹ️ [usuarios] Admin inicial no sembrado (email duplicado o error de BD).');
    }
  }
}

export default new UsuariosService();

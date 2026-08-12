// ============================================================================
// bodyvibe-db.service — Cerrojo #1 de BodyVibeTech: el usuario de base de datos
// que NO SABE ESCRIBIR.
//
// Todo lo que un app de BodyVibeTech consulte pasa por acá, con un rol de
// Postgres distinto (`bodyvibe_ro`) que no es dueño de nada y al que solo se le
// otorga SELECT sobre los "estantes" (las vistas `bv_*`). La diferencia con
// poner un `if` en el código es que acá NO EXISTE EL PERMISO: si un app intenta
// escribir, no es que el sistema lo bloquee — es que Postgres no le reconoce la
// operación.
//
// Cuatro capas, todas estructurales (ninguna depende de que el código generado
// se porte bien):
//
//   1) El rol no tiene GRANT de escritura sobre ninguna tabla. Nunca.
//   2) `default_transaction_read_only = on` a nivel de rol.
//   3) Cada consulta corre dentro de `BEGIN TRANSACTION READ ONLY` — Postgres
//      rechaza INSERT/UPDATE/DELETE/DDL ahí adentro, sin importar el SQL.
//   4) El SQL debe ser UNA sola sentencia que empiece en SELECT o WITH.
//
// Y tres topes que protegen a la consulta médica (decisión 09 — los apps son
// ciudadanos de segunda y comparten base con la videollamada):
//
//   · CONNECTION LIMIT 4 en el rol  → el cupo lo impone el servidor, no el pool.
//   · statement_timeout 5s en el rol → el corte lo impone el servidor.
//   · tope de filas en la respuesta  → protege la memoria del contenedor.
//
// Si `POSTGRES_READONLY_PASSWORD` no está configurada, el servicio queda
// deshabilitado y BodyVibeTech no arranca. No hay degradación silenciosa a
// "usar el pool normal": eso sería exactamente el agujero que este archivo
// existe para cerrar.
// ============================================================================

import { Pool } from 'pg';
import postgresService from './postgres.service';

/** Rol de Postgres. Constante, nunca desde env — no es superficie de inyección. */
const RO_ROLE = 'bodyvibe_ro';

/** Cupo de conexiones propio, apartado de las 20 del pool principal. */
export const BV_POOL_MAX = 4;

/** Corte de una consulta. Lo impone el servidor vía statement_timeout del rol. */
export const BV_TIMEOUT_MS = 5_000;

/** Tope de filas devueltas a un app. Más que esto se agrupa, no se lista. */
export const BV_MAX_ROWS = 5_000;

/**
 * La contraseña se interpola en un `CREATE ROLE ... PASSWORD '...'` (el DDL de
 * Postgres no acepta parámetros), así que se valida el juego de caracteres
 * antes de tocar el string. Sin comillas, sin backslash, sin espacios.
 */
const PASSWORD_SHAPE = /^[A-Za-z0-9_\-.:@#%^&*+=~?]{16,128}$/;

/** Código estable de error, para que el frontend decida el mensaje. */
export type BvErrorCode =
  | 'disabled'
  | 'not_select'
  | 'multiple_statements'
  | 'timeout'
  | 'denied'
  | 'error';

export type BvQueryResult =
  | {
      ok: true;
      rows: any[];
      rowCount: number;
      /** true si la consulta devolvió más de BV_MAX_ROWS y se recortó. */
      truncated: boolean;
      ms: number;
    }
  | {
      ok: false;
      code: BvErrorCode;
      message: string;
      ms: number;
    };

export interface BvQueryActor {
  /** Id del usuario de la sesión RBAC que abrió el app. */
  usuarioId?: number | null;
  email?: string | null;
  /** Id del app (borrador o publicado) que originó la consulta. */
  appId?: string | null;
}

export type FormaSQL =
  | { ok: true }
  | { ok: false; code: 'not_select' | 'multiple_statements'; message: string };

/**
 * Validación de forma: UNA sentencia, y que empiece en SELECT o WITH.
 *
 * No es la defensa principal —la transacción de solo lectura y los GRANT lo
 * son— sino la que produce un mensaje entendible antes de gastar una conexión.
 * Se exporta aparte para poder probarla sin base de datos.
 */
export function validarFormaSQL(sql: string): FormaSQL {
  const trimmed = sql.trim().replace(/;\s*$/, '');

  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    return {
      ok: false,
      code: 'not_select',
      message: 'Solo se permiten consultas de lectura (SELECT o WITH).',
    };
  }

  // Un `;` que sobreviva al recorte del final significa más de una sentencia.
  // Se vacían antes los literales de texto para no confundir un punto y coma
  // que viva dentro de una cadena ('a;b') con un separador real.
  const sinLiterales = trimmed.replace(/'(?:[^']|'')*'/g, "''");
  if (sinLiterales.includes(';')) {
    return {
      ok: false,
      code: 'multiple_statements',
      message: 'Solo se permite una consulta por llamada.',
    };
  }

  return { ok: true };
}

class BodyVibeDbService {
  private pool: Pool | null = null;
  private roleReady = false;

  /** ¿Hay contraseña configurada? Sin esto, BodyVibeTech no opera. */
  isConfigured(): boolean {
    return Boolean(process.env.POSTGRES_READONLY_PASSWORD);
  }

  /** ¿El rol quedó creado y el pool levantado? */
  isEnabled(): boolean {
    return this.roleReady && this.pool !== null;
  }

  // --------------------------------------------------------------------------
  // Creación idempotente del rol. Corre en cada arranque con el usuario dueño
  // (doadmin) y deja el rol en el estado que este archivo declara, aunque
  // alguien lo haya cambiado a mano en la consola de Digital Ocean.
  // --------------------------------------------------------------------------
  async ensureReadOnlyRole(): Promise<boolean> {
    const password = process.env.POSTGRES_READONLY_PASSWORD;

    if (!password) {
      console.warn(
        '⚠️  [BodyVibe] POSTGRES_READONLY_PASSWORD no configurada — BodyVibeTech queda apagado. ' +
          'No se usa el pool principal como respaldo: sería el agujero que el cerrojo evita.'
      );
      return false;
    }

    if (!PASSWORD_SHAPE.test(password)) {
      console.error(
        '❌ [BodyVibe] POSTGRES_READONLY_PASSWORD tiene caracteres no permitidos ' +
          '(se aceptan letras, dígitos y _-.:@#%^&*+=~?, entre 16 y 128). BodyVibeTech queda apagado.'
      );
      return false;
    }

    // Escapado defensivo además de la validación: comilla simple duplicada.
    const literal = `'${password.replace(/'/g, "''")}'`;

    try {
      const existing = await postgresService.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [
        RO_ROLE,
      ]);

      if (existing === null) {
        console.error('❌ [BodyVibe] No se pudo consultar pg_roles — BodyVibeTech queda apagado.');
        return false;
      }

      if (existing.length === 0) {
        await postgresService.query(`CREATE ROLE ${RO_ROLE} LOGIN PASSWORD ${literal}`);
        console.log(`✅ [BodyVibe] Rol ${RO_ROLE} creado`);
      } else {
        // Re-sincroniza la contraseña en cada arranque: la fuente de verdad es
        // la variable de entorno, no lo que quedó en el cluster.
        await postgresService.query(`ALTER ROLE ${RO_ROLE} WITH PASSWORD ${literal}`);
      }

      // Los topes viven en el servidor. Aunque el pool de Node esté mal
      // configurado, Postgres no deja pasar más de 4 conexiones ni consultas
      // de más de 5 segundos con este rol.
      //
      // No se tocan los atributos SUPERUSER/CREATEDB/CREATEROLE: `CREATE ROLE`
      // ya los deja apagados, y alterarlos exige ser superusuario — que
      // `doadmin` no es en un cluster gestionado de Digital Ocean. Intentarlo
      // solo produciría un error en cada arranque.
      await postgresService.query(`ALTER ROLE ${RO_ROLE} CONNECTION LIMIT ${BV_POOL_MAX}`);
      await postgresService.query(`ALTER ROLE ${RO_ROLE} SET default_transaction_read_only = on`);
      await postgresService.query(`ALTER ROLE ${RO_ROLE} SET statement_timeout = '${BV_TIMEOUT_MS}ms'`);
      await postgresService.query(
        `ALTER ROLE ${RO_ROLE} SET idle_in_transaction_session_timeout = '10s'`
      );
      await postgresService.query(`ALTER ROLE ${RO_ROLE} SET application_name = 'bodyvibetech'`);

      // Puede entrar al esquema, pero no lee ninguna tabla todavía: los GRANT
      // de SELECT se otorgan uno por uno sobre las vistas `bv_*` (los estantes)
      // en el bloque 1. Mientras no existan, este rol se conecta y no ve
      // absolutamente nada. Ese es el estado correcto.
      //
      // El REVOKE de CREATE quita lo que se le haya otorgado directamente; en
      // Postgres 14 y anteriores el rol PUBLIC conserva CREATE sobre `public`,
      // y revocárselo a PUBLIC rompería al resto de la aplicación. Ese hueco lo
      // tapa la transacción de solo lectura de `runSelect`: dentro de ella
      // Postgres rechaza cualquier DDL, venga de donde venga el permiso.
      await postgresService.query(`GRANT USAGE ON SCHEMA public TO ${RO_ROLE}`);
      await postgresService.query(`REVOKE CREATE ON SCHEMA public FROM ${RO_ROLE}`);
      await postgresService.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${RO_ROLE}`);
      await postgresService.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${RO_ROLE}`);
      await postgresService.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${RO_ROLE}`);

      this.roleReady = true;
      this.initializePool();
      console.log(
        `🔒 [BodyVibe] Cerrojo 1 activo — rol ${RO_ROLE}: solo lectura, ${BV_POOL_MAX} conexiones, corte a ${BV_TIMEOUT_MS / 1000}s`
      );
      return true;
    } catch (error: any) {
      console.error('❌ [BodyVibe] Error preparando el rol de solo lectura:', error?.message ?? error);
      return false;
    }
  }

  private initializePool(): void {
    if (this.pool) return;

    this.pool = new Pool({
      user: RO_ROLE,
      password: process.env.POSTGRES_READONLY_PASSWORD,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT || '25060'),
      database: process.env.POSTGRES_DATABASE,
      ssl: { rejectUnauthorized: false },
      max: BV_POOL_MAX,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 3_000,
      // Duplicado del ajuste de rol: si alguien altera el rol en el cluster,
      // el cliente lo vuelve a imponer en cada conexión.
      statement_timeout: BV_TIMEOUT_MS,
      query_timeout: BV_TIMEOUT_MS + 500,
      application_name: 'bodyvibetech',
    });

    this.pool.on('error', (err) => {
      console.error('❌ [BodyVibe] Error inesperado en el pool de solo lectura:', err.message);
    });
  }

  // --------------------------------------------------------------------------
  // Ejecuta una consulta de lectura sobre los estantes.
  // --------------------------------------------------------------------------
  async runSelect(sql: string, params: any[] = [], actor: BvQueryActor = {}): Promise<BvQueryResult> {
    const started = Date.now();

    if (!this.isEnabled() || !this.pool) {
      return {
        ok: false,
        code: 'disabled',
        message: 'BodyVibeTech no está habilitado en este servidor.',
        ms: 0,
      };
    }

    const shape = validarFormaSQL(sql);
    if (!shape.ok) {
      this.logQuery(actor, sql, 0, Date.now() - started, shape.code);
      return { ok: false, code: shape.code, message: shape.message, ms: Date.now() - started };
    }

    const client = await this.pool.connect().catch((e) => {
      console.error('❌ [BodyVibe] No hay conexión disponible:', e?.message ?? e);
      return null;
    });

    if (!client) {
      const ms = Date.now() - started;
      this.logQuery(actor, sql, 0, ms, 'sin_conexion');
      return {
        ok: false,
        code: 'error',
        message: 'No hay conexiones disponibles para BodyVibeTech en este momento.',
        ms,
      };
    }

    try {
      // La capa que de verdad cierra la puerta: dentro de una transacción de
      // solo lectura, Postgres rechaza cualquier escritura y cualquier DDL,
      // sin importar qué diga el SQL.
      await client.query('BEGIN TRANSACTION READ ONLY');
      const result = await client.query(sql, params);
      await client.query('COMMIT');

      const all = result.rows ?? [];
      const truncated = all.length > BV_MAX_ROWS;
      const rows = truncated ? all.slice(0, BV_MAX_ROWS) : all;
      const ms = Date.now() - started;

      this.logQuery(actor, sql, rows.length, ms, truncated ? 'truncada' : 'ok');

      return { ok: true, rows, rowCount: rows.length, truncated, ms };
    } catch (error: any) {
      await client.query('ROLLBACK').catch(() => undefined);
      const ms = Date.now() - started;

      // 57014 = query_canceled → se pasó del statement_timeout.
      // 42501 = insufficient_privilege → pidió algo fuera de los estantes.
      const code: BvErrorCode =
        error?.code === '57014' ? 'timeout' : error?.code === '42501' ? 'denied' : 'error';

      const message =
        code === 'timeout'
          ? `La consulta se pasó de ${BV_TIMEOUT_MS / 1000} segundos y se cortó. Agrupe o filtre más.`
          : code === 'denied'
            ? 'Esa consulta pide datos que no están disponibles.'
            : (error?.message ?? 'Error ejecutando la consulta.');

      this.logQuery(actor, sql, 0, ms, code, error?.message);

      return { ok: false, code, message, ms };
    } finally {
      client.release();
    }
  }

  // --------------------------------------------------------------------------
  // Auditoría de LECTURAS. La bitácora existente (`audit_log`) solo registra
  // escrituras; con tableros que consultan condiciones médicas hace falta saber
  // quién consultó qué. Se escribe con el pool principal (el rol de solo
  // lectura, por definición, no puede escribir su propia bitácora) y es
  // fire-and-forget: auditar nunca debe tumbar una consulta.
  // --------------------------------------------------------------------------
  private logQuery(
    actor: BvQueryActor,
    sql: string,
    filas: number,
    ms: number,
    resultado: string,
    error?: string
  ): void {
    postgresService
      .query(
        `INSERT INTO bodyvibe_query_log
           (usuario_id, email, app_id, sql_texto, filas, duracion_ms, resultado, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          actor.usuarioId ?? null,
          actor.email ?? null,
          actor.appId ?? null,
          sql.slice(0, 4000),
          filas,
          ms,
          resultado,
          error ? error.slice(0, 500) : null,
        ]
      )
      .catch(() => undefined);
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.roleReady = false;
    }
  }
}

export const bodyvibeDbService = new BodyVibeDbService();
export default bodyvibeDbService;

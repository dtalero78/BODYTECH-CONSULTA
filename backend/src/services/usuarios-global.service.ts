// ============================================================================
// usuariosGlobalService — LA tabla de usuarios. Una, compartida por las tres
// aplicaciones.
//
// ── Qué reemplaza ──────────────────────────────────────────────────────────
// Tres tablas `usuarios`, una por aplicación (bodytech, bodytech_acc,
// bodytech_prepagadas). Quien trabajaba en dos programas tenía dos cuentas y
// dos contraseñas; darlo de baja había que hacerlo dos veces, y se falló.
//
// ── La forma: identidad compartida, permisos por aplicación ────────────────
// Al medir las tres tablas quedó claro qué se puede unificar y qué no:
//
//   IGUAL en las tres → correo, contraseña, nombre, cédula, activo.
//                       Eso es LA PERSONA y va en `personas`.
//
//   DISTINTO          → el rol (6 en Consulta, 2 en ACC, 3 en Prepagadas) y el
//                       alcance (sede+profesional / sedes / ciudades+sede).
//                       Eso es lo que la persona PUEDE HACER en cada
//                       aplicación, y va en `persona_apps`, una fila por
//                       aplicación donde tenga acceso.
//
// Un fisioterapeuta no tiene por qué existir como rol en Prepagadas. Forzar un
// vocabulario único de roles sería inventarse una realidad que no existe.
//
// ── Por qué las contraseñas se pueden mover tal cual ───────────────────────
// Las tres aplicaciones cifran con bcrypt y el mismo formato ($2a$). Verificado
// contra las tres bases. Nadie tiene que restablecer su clave.
//
// ── Las tablas viejas NO se borran ─────────────────────────────────────────
// Quedan congeladas como red de seguridad: si algo sale mal, cada aplicación
// vuelve a leer la suya cambiando una variable de entorno, sin desplegar
// código. Se retiran cuando esto lleve semanas funcionando.
// ============================================================================

import { getSharedPool } from './shared-db';
import postgresService from './postgres.service';

export type App = 'consulta' | 'acc' | 'prepagadas';

export interface PersonaGlobal {
  id: number;
  email: string;
  nombre: string;
  documento: string | null;
  activo: boolean;
  /** Qué puede hacer en cada aplicación donde tiene acceso. */
  apps: Array<{ app: App; rol: string; alcance: Record<string, unknown>; activo: boolean }>;
}

/** Fila cruda para autenticar: incluye el hash, que nunca sale del backend. */
export interface PersonaConHash extends PersonaGlobal {
  passwordHash: string;
}

class UsuariosGlobalService {
  async asegurarEsquema(): Promise<void> {
    const pool = getSharedPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS personas (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(120) NOT NULL,
        nombre        VARCHAR(200) NOT NULL,
        documento     VARCHAR(30),
        activo        BOOLEAN NOT NULL DEFAULT TRUE,
        creada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS persona_apps (
        persona_id  INTEGER NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
        app         VARCHAR(20) NOT NULL,
        rol         VARCHAR(40) NOT NULL,
        -- El alcance tiene forma distinta en cada aplicación (sede+profesional,
        -- sedes, ciudades+sede). Se guarda como viene, sin forzar un formato
        -- común que ninguna usaría igual.
        alcance     JSONB NOT NULL DEFAULT '{}',
        activo      BOOLEAN NOT NULL DEFAULT TRUE,
        PRIMARY KEY (persona_id, app)
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_persona_apps_app ON persona_apps (app, activo)`,
    );
    // ACC y prepagadas leen para autenticar; escribir es exclusivo del panel de
    // Consulta, que es donde se administran los usuarios.
    for (const rol of ['acc_app', 'prepagadas_app']) {
      await pool
        .query(`GRANT SELECT ON personas, persona_apps TO ${rol}`)
        .catch((e) =>
          console.error(`⚠️ [usuarios-global] no se pudo dar SELECT a ${rol}:`, e?.message ?? e),
        );
    }
  }

  /**
   * Busca por correo, con su hash y sus permisos. Es lo que usa el login.
   * Devuelve `null` si no existe o si la persona está inactiva.
   */
  async porEmail(email: string): Promise<PersonaConHash | null> {
    const limpio = String(email ?? '').trim().toLowerCase();
    if (!limpio) return null;
    const { rows } = await getSharedPool().query(
      `SELECT p.id, p.email, p.password_hash, p.nombre, p.documento, p.activo,
              COALESCE(
                jsonb_agg(jsonb_build_object('app', pa.app, 'rol', pa.rol,
                                             'alcance', pa.alcance, 'activo', pa.activo)
                          ORDER BY pa.app) FILTER (WHERE pa.app IS NOT NULL),
                '[]'::jsonb
              ) AS apps
         FROM personas p
         LEFT JOIN persona_apps pa ON pa.persona_id = p.id AND pa.activo
        WHERE p.email = $1 AND p.activo
        GROUP BY p.id`,
      [limpio],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      email: String(r.email),
      passwordHash: String(r.password_hash),
      nombre: String(r.nombre),
      documento: r.documento ? String(r.documento) : null,
      activo: Boolean(r.activo),
      apps: r.apps as PersonaGlobal['apps'],
    };
  }

  /**
   * Refleja en la tabla global un usuario de Consulta, releyendo su fila.
   *
   * Se llama después de crear, editar o cambiar la contraseña. RELEE en vez de
   * recibir los campos: si mañana se agrega una columna, este código no se
   * olvida de ella, que es exactamente cómo dos tablas empiezan a divergir.
   *
   * Nunca lanza: un fallo acá no puede impedir que se guarde el usuario. Queda
   * en el log y el próximo cambio lo corrige.
   */
  async reflejarDesdeConsulta(usuarioId: number): Promise<void> {
    try {
      const filas = await postgresService.query(
        `SELECT u.id, lower(u.email) AS email, u.password_hash, u.nombre, u.rol,
                u.es_global, u.profesional_id, u.activo,
                COALESCE(array_agg(us.sede_id) FILTER (WHERE us.sede_id IS NOT NULL), '{}') AS sedes
           FROM usuarios u LEFT JOIN usuario_sedes us ON us.usuario_id = u.id
          WHERE u.id = $1
          GROUP BY u.id`,
        [usuarioId],
      );
      const u = filas?.[0];
      if (!u) return;

      const pool = getSharedPool();
      const { rows } = await pool.query(
        `INSERT INTO personas (email, password_hash, nombre, activo, actualizada_en)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (email) DO UPDATE
           SET password_hash = EXCLUDED.password_hash,
               nombre = EXCLUDED.nombre,
               activo = EXCLUDED.activo,
               actualizada_en = NOW()
         RETURNING id`,
        [String(u.email), String(u.password_hash), String(u.nombre), Boolean(u.activo)],
      );
      const personaId = Number(rows[0].id);

      await pool.query(
        `INSERT INTO persona_apps (persona_id, app, rol, alcance, activo)
         VALUES ($1, 'consulta', $2, $3, $4)
         ON CONFLICT (persona_id, app) DO UPDATE
           SET rol = EXCLUDED.rol, alcance = EXCLUDED.alcance, activo = EXCLUDED.activo`,
        [
          personaId,
          String(u.rol),
          JSON.stringify({
            sedes: u.sedes ?? [],
            esGlobal: Boolean(u.es_global),
            profesionalId: u.profesional_id ?? null,
            usuarioIdLocal: Number(u.id),
          }),
          Boolean(u.activo),
        ],
      );
    } catch (e) {
      console.error(
        '⚠️ [usuarios-global] no se pudo reflejar el usuario',
        usuarioId,
        e instanceof Error ? e.message : e,
      );
    }
  }

  /** Todas las personas, para el panel de control. Sin hashes. */
  async listar(): Promise<PersonaGlobal[]> {
    const { rows } = await getSharedPool().query(
      `SELECT p.id, p.email, p.nombre, p.documento, p.activo,
              COALESCE(
                jsonb_agg(jsonb_build_object('app', pa.app, 'rol', pa.rol,
                                             'alcance', pa.alcance, 'activo', pa.activo)
                          ORDER BY pa.app) FILTER (WHERE pa.app IS NOT NULL),
                '[]'::jsonb
              ) AS apps
         FROM personas p
         LEFT JOIN persona_apps pa ON pa.persona_id = p.id
        GROUP BY p.id
        ORDER BY p.activo DESC, p.nombre`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      email: String(r.email),
      nombre: String(r.nombre),
      documento: r.documento ? String(r.documento) : null,
      activo: Boolean(r.activo),
      apps: r.apps as PersonaGlobal['apps'],
    }));
  }
}

export default new UsuariosGlobalService();

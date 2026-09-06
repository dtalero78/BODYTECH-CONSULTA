// ============================================================================
// accesosSyncService — Espejo de quién tiene acceso a qué aplicación.
//
// Fase 1 de la unificación del login. NO toca el inicio de sesión: cada
// aplicación sigue autenticando contra su propia lista, exactamente como hoy.
// Lo único que agrega es poder responder, en un solo lugar, la pregunta que
// hoy exige mirar en tres bases: «¿a qué tiene acceso esta persona?».
//
// ── Por qué hace falta ──────────────────────────────────────────────────────
// Hay tres listas de usuarios, una por aplicación. Quien trabaja en dos
// programas necesita dos cuentas, y darle de baja hay que hacerlo dos veces.
// Eso ya está fallando: una administradora figura ACTIVA en ACC e INACTIVA en
// prepagadas. Sin este espejo, esa contradicción no se ve desde ningún lado.
//
// ── Qué NO guarda ──────────────────────────────────────────────────────────
// Contraseñas. Ni el hash. Este espejo existe para ver accesos, no para
// autenticar, y mover credenciales entre bases sin necesidad sería regalar
// superficie de ataque. La fase 2 sí las moverá, con su propio cuidado.
//
// ── Sobre leer la base de otras aplicaciones ───────────────────────────────
// Acá consulta lee las tablas `usuarios` de ACC y prepagadas. Es el
// acoplamiento que en general queremos evitar, y se acepta porque esto es
// SOLO LECTURA, es temporal (fase 1 de tres) y su alternativa —pedirle a cada
// repo que publique su lista— exige tocar tres repositorios para conseguir
// visibilidad que hoy no existe en ninguno. En el diseño final cada aplicación
// publica la suya.
// ============================================================================

import { Pool } from 'pg';
import { getSharedPool } from './shared-db';

/** Las tres aplicaciones hermanas, con la base donde vive su lista. */
const APPS: ReadonlyArray<{ app: string; base: string }> = [
  { app: 'consulta', base: 'bodytech' },
  { app: 'acc', base: 'bodytech_acc' },
  { app: 'prepagadas', base: 'bodytech_prepagadas' },
];

export interface ResultadoSyncAccesos {
  reflejados: number;
  porApp: Record<string, number>;
  /** Correos presentes en más de una aplicación. */
  enVariasApps: number;
  /** Correos activos en una aplicación e inactivos en otra: el caso a resolver. */
  inconsistentes: number;
  errores: string[];
  ms: number;
}

class AccesosSyncService {
  private pools = new Map<string, Pool>();

  private poolDe(base: string): Pool {
    const existente = this.pools.get(base);
    if (existente) return existente;
    const pool = new Pool({
      user: process.env.POSTGRES_USER || 'doadmin',
      password: process.env.POSTGRES_PASSWORD,
      host:
        process.env.POSTGRES_HOST ||
        'bslpostgres-do-user-19197755-0.k.db.ondigitalocean.com',
      port: parseInt(process.env.POSTGRES_PORT || '25060'),
      database: base,
      ssl: { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on('error', (e) => console.error(`❌ [accesos:${base}] pool:`, e));
    this.pools.set(base, pool);
    return pool;
  }

  async asegurarEsquema(): Promise<void> {
    await getSharedPool().query(`
      CREATE TABLE IF NOT EXISTS accesos (
        email           VARCHAR(200) NOT NULL,
        app             VARCHAR(20)  NOT NULL,
        nombre          VARCHAR(200),
        documento       VARCHAR(30),
        rol             VARCHAR(40),
        activo          BOOLEAN NOT NULL,
        sincronizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (email, app)
      )
    `);
  }

  /**
   * Refleja las tres listas. Cada aplicación se lee por separado y sus fallas
   * no se contagian: si ACC no responde, se refleja igual lo de las otras dos y
   * el error queda reportado. Un espejo parcial y honesto sirve; uno que se cae
   * entero porque una base estaba lenta, no.
   */
  async sincronizar(): Promise<ResultadoSyncAccesos> {
    const t0 = Date.now();
    await this.asegurarEsquema();

    const res: ResultadoSyncAccesos = {
      reflejados: 0,
      porApp: {},
      enVariasApps: 0,
      inconsistentes: 0,
      errores: [],
      ms: 0,
    };

    const compartida = getSharedPool();

    for (const { app, base } of APPS) {
      try {
        // `documento` no existe en consulta; el SELECT lo resuelve por base.
        const tieneDocumento = app !== 'consulta';
        const { rows } = await this.poolDe(base).query(
          `SELECT lower(trim(email)) AS email, nombre, rol, activo
                  ${tieneDocumento ? ', documento' : ", NULL::text AS documento"}
             FROM usuarios
            WHERE email IS NOT NULL AND trim(email) <> ''`,
        );
        for (const r of rows) {
          await compartida.query(
            `INSERT INTO accesos (email, app, nombre, documento, rol, activo, sincronizado_en)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (email, app) DO UPDATE SET
               nombre = EXCLUDED.nombre,
               documento = EXCLUDED.documento,
               rol = EXCLUDED.rol,
               activo = EXCLUDED.activo,
               sincronizado_en = NOW()`,
            [
              String(r.email).slice(0, 200),
              app,
              r.nombre ? String(r.nombre).slice(0, 200) : null,
              r.documento ? String(r.documento).replace(/\D/g, '').slice(0, 30) || null : null,
              r.rol ? String(r.rol).slice(0, 40) : null,
              Boolean(r.activo),
            ],
          );
        }
        res.porApp[app] = rows.length;
        res.reflejados += rows.length;
      } catch (e) {
        res.errores.push(`${app}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Cuentas que quedaron en el espejo y ya no existen en su aplicación (por
    // ejemplo, borradas a mano). Sólo se limpian las apps que SÍ respondieron:
    // borrar por una app caída dejaría el espejo peor que antes.
    const appsOk = APPS.map((a) => a.app).filter((a) => res.porApp[a] !== undefined);
    if (appsOk.length > 0) {
      await compartida.query(
        `DELETE FROM accesos
          WHERE app = ANY($1::text[]) AND sincronizado_en < NOW() - INTERVAL '1 minute'`,
        [appsOk],
      );
    }

    const resumen = await this.resumen();
    res.enVariasApps = resumen.enVariasApps;
    res.inconsistentes = resumen.inconsistentes;
    res.ms = Date.now() - t0;
    return res;
  }

  /** Personas en más de una app, y las que están activas en una e inactivas en otra. */
  async resumen(): Promise<{ personas: number; enVariasApps: number; inconsistentes: number }> {
    await this.asegurarEsquema();
    const { rows } = await getSharedPool().query(`
      WITH por_persona AS (
        SELECT email,
               count(*) AS apps,
               count(*) FILTER (WHERE activo) AS activas
          FROM accesos GROUP BY email
      )
      SELECT count(*)::int AS personas,
             count(*) FILTER (WHERE apps > 1)::int AS varias,
             count(*) FILTER (WHERE apps > 1 AND activas > 0 AND activas < apps)::int AS inconsistentes
        FROM por_persona
    `);
    return {
      personas: Number(rows[0]?.personas ?? 0),
      enVariasApps: Number(rows[0]?.varias ?? 0),
      inconsistentes: Number(rows[0]?.inconsistentes ?? 0),
    };
  }

  /**
   * A qué aplicaciones pertenece un correo, según el espejo. En el orden en que
   * conviene probarlas.
   *
   * Es la «tabla email → app» que el propio `auth.service` pedía en su
   * comentario para dejar de encadenar. Devuelve vacío cuando no sabe —correo
   * desconocido, o el espejo caído— y ese vacío es importante: quien llama debe
   * caer en la cascada de siempre, nunca dejar a alguien afuera por lo que este
   * espejo no alcanzó a reflejar.
   *
   * Sólo cuentas ACTIVAS: una desactivada no debe ni siquiera dirigir el
   * intento, aunque de todos modos la aplicación destino la rechazaría.
   */
  async appsDe(email: string): Promise<string[]> {
    const limpio = String(email ?? '').trim().toLowerCase();
    if (!limpio) return [];
    try {
      const { rows } = await getSharedPool().query(
        `SELECT app FROM accesos WHERE email = $1 AND activo`,
        [limpio],
      );
      return rows.map((r) => String(r.app));
    } catch (e) {
      // El espejo es una ayuda, no un requisito para entrar.
      console.error('⚠️ [accesos] appsDe falló, se usará la cascada:', e instanceof Error ? e.message : e);
      return [];
    }
  }

  /** El detalle para la pantalla: una fila por persona, con sus accesos. */
  async listar(): Promise<
    Array<{
      email: string;
      nombre: string | null;
      documento: string | null;
      accesos: Array<{ app: string; rol: string | null; activo: boolean }>;
      inconsistente: boolean;
    }>
  > {
    await this.asegurarEsquema();
    const { rows } = await getSharedPool().query(`
      SELECT email,
             (array_remove(array_agg(nombre ORDER BY app), NULL))[1] AS nombre,
             (array_remove(array_agg(documento ORDER BY app), NULL))[1] AS documento,
             jsonb_agg(jsonb_build_object('app', app, 'rol', rol, 'activo', activo) ORDER BY app) AS accesos,
             (count(*) > 1 AND count(*) FILTER (WHERE activo) > 0
                            AND count(*) FILTER (WHERE activo) < count(*)) AS inconsistente
        FROM accesos
       GROUP BY email
       ORDER BY (count(*) > 1 AND count(*) FILTER (WHERE activo) > 0
                              AND count(*) FILTER (WHERE activo) < count(*)) DESC,
                count(*) DESC, email
    `);
    return rows.map((r) => ({
      email: String(r.email),
      nombre: r.nombre ? String(r.nombre) : null,
      documento: r.documento ? String(r.documento) : null,
      accesos: r.accesos as Array<{ app: string; rol: string | null; activo: boolean }>,
      inconsistente: Boolean(r.inconsistente),
    }));
  }
}

export default new AccesosSyncService();

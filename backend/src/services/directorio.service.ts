// ============================================================================
// directorioService — Lectura del directorio compartido de Bodytech.
//
// Vive en `bodytech_profesionales`, OTRA base del mismo cluster (`bslpostgres`)
// que también leen BODYTECH-ACC y prepagadas. Es la lista única de sedes y de
// planta que antes cada app guardaba por su cuenta y que ya había divergido:
// consulta creía que había 5 sedes, ACC creía 6, y la realidad son 94.
//
// Tres tablas:
//   sedes             (94)  — las de toda la cadena, Athletic incluido
//   profesionales    (141)  — UNA fila por persona, llave = cédula
//   profesional_sedes(887)  — quién atiende dónde
//
// La tercera existe porque la gente NO trabaja en una sola sede: 21 de 29
// médicos cubren varias y una evaluadora cubre 13. Es justo lo que la tabla
// `profesionales` de ESTA app no modela — acá una persona en 5 sedes son 5
// filas con 5 ids distintos, por el UNIQUE (codigo, sede_id).
//
// ── Por qué una conexión aparte y no un JOIN ────────────────────────────────
// Postgres no cruza bases distintas. `postgres_fdw` lo permitiría, pero exige
// superusuario y DigitalOcean no lo entrega: en este cluster `doadmin` tiene
// `rolsuper = false` y los únicos superusuarios son roles internos de DO.
// Verificado contra el catálogo, no deducido. De ahí el pool separado.
//
// ── Solo lectura ────────────────────────────────────────────────────────────
// Escribir en el directorio es exclusivo de `profesionales_app`, que usa el
// importador del Excel de RRHH (vive en el repo de ACC). Desde acá se lee y
// nada más: este archivo no tiene un solo INSERT/UPDATE a propósito.
// ============================================================================

import { Pool } from 'pg';

export type RolDirectorio = 'medico' | 'evaluador' | 'fisioterapeuta' | 'nutricionista';
export type AmbitoDirectorio = 'sede' | 'corporativo' | 'virtual';

export interface SedeDirectorio {
  slug: string;
  nombre: string;
  regional: string;
  marca: 'bodytech' | 'athletic';
  ciudad: string | null;
  profesionales: number;
}

export interface ProfesionalDirectorio {
  documento: string;
  nombre: string;
  rol: RolDirectorio;
  cargo: string;
  ambito: AmbitoDirectorio;
  ciudad: string | null;
  sedes: string[];
}

export interface ResumenDirectorio {
  sedes: number;
  profesionales: number;
  asignaciones: number;
  /** Una fila por (rol, ámbito): así se ve que "evaluador" mezcla sitio y teleconsulta. */
  porRol: { rol: string; ambito: string; personas: number; asignaciones: number }[];
  /** Sedes con al menos una persona de ese rol, separando presencial de virtual. */
  cobertura: { rol: string; presencial: number; virtual: number }[];
  porRegional: { regional: string; sedes: number }[];
}

class DirectorioService {
  private pool: Pool | null = null;

  /**
   * Pool perezoso: si nadie abre la pantalla, nunca se conecta. Es una función
   * privada de una sola persona, no vale tener conexiones abiertas al arrancar.
   *
   * `max: 4` porque esto lee un catálogo de 141 filas de vez en cuando; no
   * compite con las 20 conexiones de la operación.
   */
  private getPool(): Pool {
    if (this.pool) return this.pool;
    this.pool = new Pool({
      user: process.env.POSTGRES_USER || 'doadmin',
      password: process.env.POSTGRES_PASSWORD,
      host:
        process.env.POSTGRES_HOST ||
        'bslpostgres-do-user-19197755-0.k.db.ondigitalocean.com',
      port: parseInt(process.env.POSTGRES_PORT || '25060'),
      database: process.env.DIRECTORIO_DATABASE || 'bodytech_profesionales',
      // Igual que el pool principal: la CA de DigitalOcean no está en el trust
      // store del contenedor.
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    this.pool.on('error', (err) => {
      console.error('❌ [directorio] error inesperado en el pool:', err);
    });
    return this.pool;
  }

  async resumen(): Promise<ResumenDirectorio> {
    const pool = this.getPool();

    const [totales, porRol, cobertura, porRegional] = await Promise.all([
      pool.query<{ sedes: string; profesionales: string; asignaciones: string }>(
        `SELECT (SELECT count(*) FROM sedes WHERE activa)::text          AS sedes,
                (SELECT count(*) FROM profesionales WHERE activo)::text  AS profesionales,
                (SELECT count(*) FROM profesional_sedes)::text           AS asignaciones`,
      ),
      pool.query<{ rol: string; ambito: string; personas: string; asignaciones: string }>(
        `SELECT p.rol, p.ambito,
                count(DISTINCT p.documento)::text AS personas,
                count(ps.sede_slug)::text         AS asignaciones
           FROM profesionales p
           LEFT JOIN profesional_sedes ps ON ps.documento = p.documento
          WHERE p.activo
          GROUP BY p.rol, p.ambito
          ORDER BY p.rol, p.ambito`,
      ),
      pool.query<{ rol: string; presencial: string; virtual: string }>(
        `SELECT r.rol,
                count(DISTINCT ps.sede_slug) FILTER (WHERE p.ambito = 'sede')::text    AS presencial,
                count(DISTINCT ps.sede_slug) FILTER (WHERE p.ambito = 'virtual')::text AS virtual
           FROM (VALUES ('medico'),('evaluador'),('fisioterapeuta'),('nutricionista')) AS r(rol)
           LEFT JOIN profesionales p ON p.rol = r.rol AND p.activo
           LEFT JOIN profesional_sedes ps ON ps.documento = p.documento
          GROUP BY r.rol
          ORDER BY r.rol`,
      ),
      pool.query<{ regional: string; sedes: string }>(
        `SELECT regional, count(*)::text AS sedes
           FROM sedes WHERE activa
          GROUP BY regional ORDER BY count(*) DESC, regional`,
      ),
    ]);

    const t = totales.rows[0];
    return {
      sedes: Number(t?.sedes ?? 0),
      profesionales: Number(t?.profesionales ?? 0),
      asignaciones: Number(t?.asignaciones ?? 0),
      porRol: porRol.rows.map((r) => ({
        rol: r.rol,
        ambito: r.ambito,
        personas: Number(r.personas),
        asignaciones: Number(r.asignaciones),
      })),
      cobertura: cobertura.rows.map((r) => ({
        rol: r.rol,
        presencial: Number(r.presencial),
        virtual: Number(r.virtual),
      })),
      porRegional: porRegional.rows.map((r) => ({
        regional: r.regional,
        sedes: Number(r.sedes),
      })),
    };
  }

  async sedes(): Promise<SedeDirectorio[]> {
    const { rows } = await this.getPool().query<SedeDirectorio & { profesionales: string }>(
      `SELECT s.slug, s.nombre, s.regional, s.marca, s.ciudad,
              count(ps.documento)::text AS profesionales
         FROM sedes s
         LEFT JOIN profesional_sedes ps ON ps.sede_slug = s.slug
        WHERE s.activa
        GROUP BY s.slug, s.nombre, s.regional, s.marca, s.ciudad
        ORDER BY s.regional, s.nombre`,
    );
    return rows.map((r) => ({ ...r, profesionales: Number(r.profesionales) }));
  }

  /**
   * La planta. `rol` y `sede` filtran; `q` busca por nombre o cédula.
   *
   * Los parámetros van por placeholder ($1, $2…) y nunca interpolados: es una
   * pantalla con caja de búsqueda, que es exactamente por donde entra una
   * inyección.
   */
  async profesionales(filtros: {
    rol?: string;
    sede?: string;
    q?: string;
  }): Promise<ProfesionalDirectorio[]> {
    const where: string[] = ['p.activo'];
    const params: unknown[] = [];

    if (filtros.rol) {
      params.push(filtros.rol);
      where.push(`p.rol = $${params.length}`);
    }
    if (filtros.sede) {
      params.push(filtros.sede);
      where.push(
        `EXISTS (SELECT 1 FROM profesional_sedes x
                  WHERE x.documento = p.documento AND x.sede_slug = $${params.length})`,
      );
    }
    if (filtros.q) {
      params.push(`%${filtros.q}%`);
      where.push(`(p.nombre ILIKE $${params.length} OR p.documento LIKE $${params.length})`);
    }

    const { rows } = await this.getPool().query<ProfesionalDirectorio & { sedes: string[] | null }>(
      `SELECT p.documento, p.nombre, p.rol, p.cargo, p.ambito, p.ciudad,
              array_remove(array_agg(ps.sede_slug ORDER BY ps.sede_slug), NULL) AS sedes
         FROM profesionales p
         LEFT JOIN profesional_sedes ps ON ps.documento = p.documento
        WHERE ${where.join(' AND ')}
        GROUP BY p.documento, p.nombre, p.rol, p.cargo, p.ambito, p.ciudad
        ORDER BY p.nombre`,
      params,
    );
    return rows.map((r) => ({ ...r, sedes: r.sedes ?? [] }));
  }

  /**
   * De una lista de cédulas, cuáles están en el directorio y con qué datos.
   *
   * Existe para el cotejo: saber si el profesional dado de alta en ESTA app es
   * alguien de la planta de la cadena o alguien que sólo existe acá. No se puede
   * resolver con un JOIN porque son bases distintas del mismo cluster y
   * DigitalOcean no entrega el superusuario que exige `postgres_fdw` (ver la
   * cabecera de este archivo), así que el cruce se hace en memoria: son ~141
   * filas del lado del directorio y una decena del lado de acá.
   */
  async porDocumentos(documentos: ReadonlyArray<string>): Promise<Map<string, ProfesionalDirectorio>> {
    const limpios = [...new Set(documentos.filter((d) => /^[0-9]{5,15}$/.test(d)))];
    if (limpios.length === 0) return new Map();

    const { rows } = await this.getPool().query<ProfesionalDirectorio & { sedes: string[] | null }>(
      `SELECT p.documento, p.nombre, p.rol, p.cargo, p.ambito, p.ciudad,
              array_remove(array_agg(ps.sede_slug ORDER BY ps.sede_slug), NULL) AS sedes
         FROM profesionales p
         LEFT JOIN profesional_sedes ps ON ps.documento = p.documento
        WHERE p.documento = ANY($1::text[])
        GROUP BY p.documento, p.nombre, p.rol, p.cargo, p.ambito, p.ciudad`,
      [limpios],
    );
    return new Map(rows.map((r) => [r.documento, { ...r, sedes: r.sedes ?? [] }]));
  }
}

export default new DirectorioService();

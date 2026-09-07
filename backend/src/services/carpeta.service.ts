// ============================================================================
// carpeta — LA historia clínica de la persona. Una sola, en el armario.
//
// ── El problema que resuelve ────────────────────────────────────────────────
// Hasta ahora los datos clínicos vivían sueltos en tres bases que no se hablan:
// las consultas de Consulta, las valoraciones de ACC y las atenciones de
// prepagadas. Y dentro de Consulta, cada consulta es una fila independiente:
// 4.551 consultas de 4.203 personas. Si alguien entra por Trepsi y después pasa
// a la Unidad Médica Virtual, el médico NO ve lo que ya escribió el
// nutricionista — ni siquiera aunque sea la misma persona y la misma semana.
//
// La carpeta es la respuesta: una por persona, con una ENTRADA por cada
// atención, venga de la aplicación que venga. Quien atiende puede leer lo que
// ya está y agregar lo suyo encima, en vez de empezar de cero.
//
// ── Cómo se llena ──────────────────────────────────────────────────────────
// Reflejo, no segundo cuaderno. Cada aplicación sigue guardando donde guarda
// hoy —no se toca lo que funciona, y Trepsi son 9 de cada 10 consultas— y
// además deja su entrada acá. Si el reflejo falla, la atención ya quedó
// guardada en su base: la carpeta se pone al día en el siguiente guardado o con
// el barrido de recuperación.
//
// La llave es la CÉDULA, que es lo único que existe en las tres puntas.
// ============================================================================

import { getSharedPool } from './shared-db';
import postgresService from './postgres.service';

/**
 * De qué SERVICIO viene la atención. Es el vocabulario del negocio, no el de la
 * plomería: para quien lee la historia hay cuatro servicios que la alimentan,
 * aunque por dentro tres de ellos vivan en la misma aplicación.
 */
export type Servicio = 'trepsi' | 'corporativo' | 'umv' | 'acc' | 'prepagadas' | 'nativa';

export interface EntradaCarpeta {
  /** Qué backend la escribió. Sólo para rastrear de dónde salió una fila. */
  app: 'consulta' | 'acc' | 'prepagadas';
  servicio: Servicio;
  origenId: string;
  profesional: string | null;
  profesion: string | null;
  fecha: string;
  /** Lo que otro profesional necesita leer de un vistazo. */
  resumen: string | null;
  datos: Record<string, unknown>;
}

class CarpetaService {
  async asegurarEsquema(): Promise<void> {
    const pool = getSharedPool();
    // El paciente NO se crea acá: ya existe en `afiliados`, el padrón, que es la
    // única lista de pacientes y tiene 4.184. Crear una segunda sería repetir el
    // problema que este trabajo vino a resolver — dos listas de lo mismo y nadie
    // sabiendo cuál manda. La historia cuelga del padrón por la cédula.
    // Una fila por ATENCIÓN, de cualquier aplicación. `(app, origen_id)` es
    // única para que reflejar dos veces la misma atención no la duplique: los
    // guardados de una historia son muchos, uno por campo que toca el médico.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historia_entradas (
        id            BIGSERIAL PRIMARY KEY,
        documento     VARCHAR(30) NOT NULL,
        app           VARCHAR(20) NOT NULL,
        servicio      VARCHAR(20) NOT NULL,
        origen_id     TEXT NOT NULL,
        profesional   TEXT,
        profesion     TEXT,
        fecha         TIMESTAMPTZ,
        resumen       TEXT,
        datos         JSONB NOT NULL DEFAULT '{}',
        creada_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        actualizada_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (app, origen_id)
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_historia_entradas_documento
        ON historia_entradas (documento, fecha DESC)
    `);

    // Lo que es de la PERSONA y no de un día: antecedentes, alergias,
    // condiciones y medicamentos. Cualquiera de los cuatro servicios los
    // agrega, y quedan para todos.
    //
    // Cada uno es una fila con quién lo registró y desde qué servicio, no un
    // campo que se pisa. Corregir no borra: se marca la fila como no vigente y
    // se deja la nota. Es como funciona una historia clínica de verdad, y para
    // una IPS no es una preferencia de diseño — hay que poder responder quién
    // escribió qué y cuándo.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historia_problemas (
        id              BIGSERIAL PRIMARY KEY,
        documento       VARCHAR(30) NOT NULL,
        tipo            VARCHAR(20) NOT NULL,
        descripcion     TEXT NOT NULL,
        servicio        VARCHAR(20) NOT NULL,
        registrado_por  TEXT,
        registrado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        vigente         BOOLEAN NOT NULL DEFAULT TRUE,
        corregido_por   TEXT,
        corregido_en    TIMESTAMPTZ,
        nota_correccion TEXT
      )
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_historia_problemas_documento
        ON historia_problemas (documento) WHERE vigente
    `);
    // Las tres aplicaciones LEEN la carpeta. Escribir la sigue haciendo cada
    // una por su lado, desde su propio backend.
    for (const rol of ['acc_app', 'prepagadas_app']) {
      await pool
        .query(`GRANT SELECT ON historia_entradas, historia_problemas TO ${rol}`)
        .catch(() => undefined);
    }
  }

  /** Deja (o actualiza) una entrada en la carpeta de esa persona. */
  async registrar(documento: string, nombre: string | null, e: EntradaCarpeta): Promise<boolean> {
    const doc = String(documento ?? '').replace(/\D/g, '');
    if (!doc) return false;
    const pool = getSharedPool();
    try {
      // El paciente se da de alta en el padrón si es su primera atención —da
      // igual por qué servicio entre—. Si ya está, no se le pisa nada: el padrón
      // se sincroniza aparte y sabe más que esta llamada.
      await pool.query(
        `INSERT INTO afiliados (documento, nombre) VALUES ($1, $2)
         ON CONFLICT (documento) DO UPDATE
           SET nombre = COALESCE(afiliados.nombre, EXCLUDED.nombre)`,
        [doc, nombre],
      );
      await pool.query(
        `INSERT INTO historia_entradas
           (documento, app, servicio, origen_id, profesional, profesion, fecha, resumen, datos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (app, origen_id) DO UPDATE
           SET documento = EXCLUDED.documento,
               servicio = EXCLUDED.servicio,
               profesional = EXCLUDED.profesional,
               profesion = EXCLUDED.profesion,
               fecha = EXCLUDED.fecha,
               resumen = EXCLUDED.resumen,
               datos = EXCLUDED.datos,
               actualizada_en = NOW()`,
        [
          doc,
          e.app,
          e.servicio,
          e.origenId,
          e.profesional,
          e.profesion,
          e.fecha || null,
          e.resumen,
          JSON.stringify(e.datos ?? {}),
        ],
      );
      return true;
    } catch (err) {
      console.error(
        '⚠️ [carpeta] no se pudo reflejar la atención',
        e.origenId,
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  }

  /**
   * Refleja UNA consulta de Consulta en la carpeta de su paciente.
   *
   * Lleva TODO lo que el profesional escribió, no un extracto. Si el médico de
   * la UMV abre lo que hizo el coach de Trepsi y sólo ve el motivo y el peso,
   * la historia común no le sirve para atender.
   *
   * `jsonb_strip_nulls` deja sólo los campos llenos: de las 350 columnas, una
   * consulta usa 90 en promedio. Por eso `datos` es JSONB y no columnas fijas —
   * cada servicio guarda lo suyo con su propia forma, y ninguno tiene que
   * caber en el molde del otro.
   */
  async reflejarDesdeConsulta(historiaId: string): Promise<boolean> {
    try {
      const filas = await postgresService.query(
        `SELECT jsonb_strip_nulls(to_jsonb(h)) AS todo FROM "HistoriaClinica" h WHERE h."_id" = $1`,
        [historiaId],
      );
      const h = (filas?.[0]?.todo ?? null) as Record<string, unknown> | null;
      if (!h || !h.numeroId) return false;

      // El resumen es para leer de un vistazo; el detalle completo va en `datos`.
      const partes = [
        h.motivo_consulta_texto && `Motivo: ${h.motivo_consulta_texto}`,
        h.hallazgos_descripcion && `Hallazgos: ${h.hallazgos_descripcion}`,
        h.mdConceptoFinal && `Concepto: ${h.mdConceptoFinal}`,
      ].filter(Boolean) as string[];

      // El `origen` de la cita ES el servicio: trepsi, umv o corporativo. Las
      // que entran por la plataforma o por mybodytech no son un servicio
      // aparte, son la consulta de siempre.
      const origen = String(h.origen ?? '').toLowerCase();
      const servicio: Servicio =
        origen === 'trepsi' || origen === 'umv' || origen === 'corporativo'
          ? (origen as Servicio)
          : 'nativa';

      return await this.registrar(
        String(h.numeroId),
        [h.primerNombre, h.primerApellido].filter(Boolean).join(' ').trim() || null,
        {
          app: 'consulta',
          servicio,
          origenId: String(h._id),
          profesional: h.medico ? String(h.medico) : null,
          profesion: null,
          fecha: String(h.fechaConsulta || h.fechaAtencion || ''),
          resumen: partes.length > 0 ? partes.join(' · ') : null,
          datos: h,
        },
      );
    } catch (e) {
      console.error(
        '⚠️ [carpeta] no se pudo leer la consulta',
        historiaId,
        e instanceof Error ? e.message : e,
      );
      return false;
    }
  }

  /**
   * Agrega un antecedente, alergia, condición o medicamento a la persona.
   * Nunca pisa lo que ya está: si algo estaba mal, se corrige con `corregir`.
   */
  async agregarProblema(p: {
    documento: string;
    tipo: 'antecedente' | 'alergia' | 'condicion' | 'medicamento';
    descripcion: string;
    servicio: Servicio;
    registradoPor: string | null;
  }): Promise<number | null> {
    const doc = String(p.documento ?? '').replace(/\D/g, '');
    if (!doc || !p.descripcion.trim()) return null;
    const { rows } = await getSharedPool().query(
      `INSERT INTO historia_problemas (documento, tipo, descripcion, servicio, registrado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [doc, p.tipo, p.descripcion.trim(), p.servicio, p.registradoPor],
    );
    return Number(rows[0].id);
  }

  /**
   * Corrige un dato de la persona. No lo borra: lo marca como no vigente y deja
   * dicho quién y por qué. Lo viejo tiene que poder leerse después.
   */
  async corregirProblema(id: number, por: string | null, nota: string | null): Promise<boolean> {
    const r = await getSharedPool().query(
      `UPDATE historia_problemas
          SET vigente = FALSE, corregido_por = $2, corregido_en = NOW(), nota_correccion = $3
        WHERE id = $1 AND vigente`,
      [id, por, nota],
    );
    return (r.rowCount ?? 0) > 0;
  }

  /** La carpeta de una persona: sus entradas, de todas las aplicaciones. */
  async leer(documento: string): Promise<{
    documento: string;
    nombre: string | null;
    entradas: Array<EntradaCarpeta & { id: number }>;
    problemas: Array<{
      id: number;
      tipo: string;
      descripcion: string;
      servicio: string;
      registradoPor: string | null;
      registradoEn: string;
    }>;
  } | null> {
    const doc = String(documento ?? '').replace(/\D/g, '');
    if (!doc) return null;
    const pool = getSharedPool();
    const { rows: cab } = await pool.query(
      'SELECT documento, nombre FROM afiliados WHERE documento = $1',
      [doc],
    );
    if (cab.length === 0) return null;
    const { rows } = await pool.query(
      `SELECT id, app, servicio, origen_id, profesional, profesion, fecha, resumen, datos
         FROM historia_entradas WHERE documento = $1 ORDER BY fecha DESC NULLS LAST`,
      [doc],
    );
    const { rows: probs } = await pool.query(
      `SELECT id, tipo, descripcion, servicio, registrado_por, registrado_en
         FROM historia_problemas
        WHERE documento = $1 AND vigente
        ORDER BY tipo, registrado_en DESC`,
      [doc],
    );
    return {
      documento: doc,
      nombre: cab[0].nombre ?? null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      problemas: probs.map((r: any) => ({
        id: Number(r.id),
        tipo: r.tipo,
        descripcion: r.descripcion,
        servicio: r.servicio,
        registradoPor: r.registrado_por,
        registradoEn: new Date(r.registrado_en).toISOString(),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      entradas: rows.map((r: any) => ({
        id: Number(r.id),
        app: r.app,
        servicio: r.servicio,
        origenId: r.origen_id,
        profesional: r.profesional,
        profesion: r.profesion,
        fecha: r.fecha ? new Date(r.fecha).toISOString() : '',
        resumen: r.resumen,
        datos: r.datos ?? {},
      })),
    };
  }
}

export default new CarpetaService();

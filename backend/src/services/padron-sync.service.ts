// ============================================================================
// padronSyncService — El padrón de afiliados, como ESPEJO.
//
// ── Por qué espejo y no un segundo cuaderno ────────────────────────────────
// Hoy un paciente entra por CUATRO puertas distintas: la API de Trepsi, la de
// MyBodytech, el botón "Nueva consulta" del coordinador, y el `upsert` genérico
// que usa el guardado masivo del panel nutricional. Si el padrón fuera un lugar
// más donde hay que acordarse de anotar, las cuatro tendrían que acordarse — y
// la quinta puerta que se agregue el año que viene se va a olvidar.
//
// Y eso no falla con ruido: falla en silencio. El padrón queda incompleto,
// nadie se entera, y la gente lo usa creyendo que está completo. Un padrón
// mentiroso es peor que no tenerlo.
//
// Por eso NO se escribe al crear la historia. Se construye leyendo lo que ya se
// guardó. El número de puertas deja de importar: la que se agregue mañana queda
// reflejada sin que nadie haya tenido que acordarse de nada.
//
// El precio, aceptado a conciencia: el padrón va unos minutos atrás de la
// realidad. Para lo que sirve —saber si alguien estuvo en otro programa, contar
// el embudo, registrar remisiones— unos minutos no le molestan a nadie.
//
// ── Qué NO entra ───────────────────────────────────────────────────────────
// Los documentos en 'conflicto' y los 'administrativo'. El padrón guarda sólo
// personas de las que estamos seguros: un documento con dos personas distintas
// (existe uno real) se fusionaría en una sola y le colgaría a alguien la
// historia clínica de otro. Quedan fuera, contados, y visibles en la pantalla
// Identidades para que alguien los resuelva.
//
// ── Riesgo para lo que ya funciona ─────────────────────────────────────────
// Ninguno: sobre `HistoriaClinica` sólo hace SELECT. Escribe exclusivamente en
// la tabla `afiliados` de la base compartida. Si esto falla entero, no se cae
// una atención — a lo sumo una pantalla nueva se ve vacía.
// ============================================================================

import postgresService from './postgres.service';
import { getSharedPool } from './shared-db';
import { clasificarIdentidad } from '../helpers/padron.helper';

export interface ResultadoSync {
  leidos: number;
  reflejados: number;
  excluidos: { conflicto: number; administrativo: number };
  ms: number;
}

export interface EstadoPadron {
  personas: number;
  actualizadoEn: string | null;
  /** Personas en las historias que todavía NO están en el padrón. */
  desfase: number;
}

class PadronSyncService {
  async asegurarEsquema(): Promise<void> {
    const pool = getSharedPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS afiliados (
        documento        VARCHAR(30) PRIMARY KEY,
        nombre           VARCHAR(240) NOT NULL,
        celular          VARCHAR(30),
        email            VARCHAR(200),
        -- En qué programas ha sido atendida la persona: trepsi, nativa, umv,
        -- corporativo, mybodytech… y algún día 'acc'. Es la dimensión que
        -- permite contar el recorrido entre programas.
        programas        TEXT[] NOT NULL DEFAULT '{}',
        atenciones       INTEGER NOT NULL DEFAULT 0,
        ultima_atencion  TIMESTAMPTZ,
        actualizado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_afiliados_programas ON afiliados USING GIN (programas)`,
    );
  }

  /**
   * Refleja en el padrón las personas de las que estamos seguros.
   *
   * Sin filtro de sede a propósito: el padrón es de toda la institución, no de
   * quien lo dispara. Por eso no se expone a cualquiera — el endpoint que lo
   * corre está restringido, y lo normal es que corra solo.
   */
  async sincronizar(): Promise<ResultadoSync> {
    const t0 = Date.now();
    await this.asegurarEsquema();

    const profs = await postgresService.query('SELECT codigo FROM profesionales');
    const docsProfesionales = new Set<string>(
      (profs ?? []).map((r) => String(r.codigo ?? '').replace(/\D/g, '')).filter(Boolean),
    );

    const rows = await postgresService.query(
      `SELECT "numeroId" AS doc,
              array_agg(DISTINCT trim(
                COALESCE("primerNombre",'')||' '||COALESCE("segundoNombre",'')||' '||
                COALESCE("primerApellido",'')||' '||COALESCE("segundoApellido",''))) AS variantes,
              array_agg(DISTINCT COALESCE("origen",'nativa')) AS programas,
              count(*) AS atenciones,
              max(CASE WHEN "fechaAtencion" ~ '^\\d{4}-\\d{2}-\\d{2}'
                       THEN "fechaAtencion"::timestamptz END) AS ultima,
              (array_remove(array_agg(NULLIF(trim(COALESCE("celular",'')),'')), NULL))[1] AS celular,
              (array_remove(array_agg(NULLIF(trim(COALESCE("email",'')),'')), NULL))[1] AS email
         FROM "HistoriaClinica"
        WHERE "numeroId" IS NOT NULL AND trim("numeroId") <> ''
        GROUP BY "numeroId"`,
    );
    // Sin esta guarda, una caída de la base vaciaría el padrón en silencio.
    if (rows === null) throw new Error('No se pudieron leer las historias para el padrón.');

    const res: ResultadoSync = {
      leidos: rows.length,
      reflejados: 0,
      excluidos: { conflicto: 0, administrativo: 0 },
      ms: 0,
    };

    // Se arma primero todo en memoria y se escribe por lotes. La primera versión
    // hacía un INSERT por persona: 4.155 viajes de ida y vuelta a la base. Con
    // la base al lado son segundos, pero probándolo por la VPN pasó de 10
    // minutos — y eso es señal de que el diseño estaba mal, no la VPN.
    const aEscribir: unknown[][] = [];
    for (const r of rows) {
      const c = clasificarIdentidad(
        String(r.doc),
        Array.isArray(r.variantes) ? (r.variantes as string[]) : [],
        docsProfesionales,
      );
      if (c.estado === 'conflicto' || c.estado === 'administrativo') {
        res.excluidos[c.estado] += 1;
        continue;
      }
      aEscribir.push([
        c.documento,
        c.nombreCanonico.slice(0, 240),
        r.celular ? String(r.celular).slice(0, 30) : null,
        r.email ? String(r.email).slice(0, 200) : null,
        (Array.isArray(r.programas) ? (r.programas as string[]) : []).sort(),
        Number(r.atenciones ?? 0),
        r.ultima ?? null,
      ]);
    }

    const pool = getSharedPool();
    const LOTE = 500;
    for (let i = 0; i < aEscribir.length; i += LOTE) {
      const lote = aEscribir.slice(i, i + LOTE);
      // ($1,$2,…,$7), ($8,…,$14), … — una sola sentencia por lote.
      const valores = lote
        .map((_, j) => {
          const b = j * 7;
          return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, NOW())`;
        })
        .join(', ');
      await pool.query(
        `INSERT INTO afiliados (documento, nombre, celular, email, programas, atenciones, ultima_atencion, actualizado_en)
         VALUES ${valores}
         ON CONFLICT (documento) DO UPDATE SET
           nombre = EXCLUDED.nombre,
           celular = COALESCE(EXCLUDED.celular, afiliados.celular),
           email = COALESCE(EXCLUDED.email, afiliados.email),
           programas = EXCLUDED.programas,
           atenciones = EXCLUDED.atenciones,
           ultima_atencion = EXCLUDED.ultima_atencion,
           actualizado_en = NOW()`,
        lote.flat(),
      );
      res.reflejados += lote.length;
    }

    res.ms = Date.now() - t0;
    return res;
  }

  /**
   * Estado del espejo, con el desfase incluido.
   *
   * El desfase es la red de seguridad de todo el diseño: si algún día ese
   * número se dispara, la avería se ve. Sin él, un espejo que dejó de
   * actualizarse se vería idéntico a uno al día.
   */
  async estado(): Promise<EstadoPadron> {
    await this.asegurarEsquema();
    const pool = getSharedPool();
    const { rows } = await pool.query(
      'SELECT count(*)::int AS personas, max(actualizado_en) AS actualizado FROM afiliados',
    );
    const personas = Number(rows[0]?.personas ?? 0);

    // El desfase se mide contra las personas que DEBERÍAN estar, no contra el
    // total de las historias: los conflictos y los administrativos se excluyen a
    // propósito, así que restarlos del total daría un desfase permanente de ~20
    // y la alarma no diría nada. Por eso se vuelve a clasificar — cuesta una
    // lectura de ~4.000 filas y a cambio el número es exacto.
    const deberian = await this.contarEsperados();

    return {
      personas,
      actualizadoEn: rows[0]?.actualizado ? new Date(rows[0].actualizado).toISOString() : null,
      desfase: Math.max(0, deberian - personas),
    };
  }

  /** Cuántas personas deberían estar en el padrón (las que no se excluyen). */
  private async contarEsperados(): Promise<number> {
    const profs = await postgresService.query('SELECT codigo FROM profesionales');
    const docsProfesionales = new Set<string>(
      (profs ?? []).map((r) => String(r.codigo ?? '').replace(/\D/g, '')).filter(Boolean),
    );
    const rows = await postgresService.query(
      `SELECT "numeroId" AS doc,
              array_agg(DISTINCT trim(
                COALESCE("primerNombre",'')||' '||COALESCE("segundoNombre",'')||' '||
                COALESCE("primerApellido",'')||' '||COALESCE("segundoApellido",''))) AS variantes
         FROM "HistoriaClinica"
        WHERE "numeroId" IS NOT NULL AND trim("numeroId") <> ''
        GROUP BY "numeroId"`,
    );
    if (rows === null) throw new Error('No se pudieron leer las historias para medir el desfase.');
    return rows.filter((r) => {
      const c = clasificarIdentidad(
        String(r.doc),
        Array.isArray(r.variantes) ? (r.variantes as string[]) : [],
        docsProfesionales,
      );
      return c.estado !== 'conflicto' && c.estado !== 'administrativo';
    }).length;
  }
}

export default new PadronSyncService();

// ============================================================================
// calendario.service — Lógica de calendario / agenda para el Panel Coordinador.
//
// Fuente única de citas: tabla "HistoriaClinica" (campo `fechaAtencion` como
// texto ISO 8601, `horaAtencion` como "HH:MM", `medico` como código del
// profesional, `atendido` como estado).
//
// Timezone: todas las citas se interpretan en Colombia (UTC-5). Los rangos
// de búsqueda del mes y día se construyen contra hora local Colombia y se
// comparan vs `"fechaAtencion"::timestamptz`.
//
// Multi-sede: todo scoped por `sede_id`.
// ============================================================================

import postgresService from './postgres.service';
import disponibilidadFechaService from './disponibilidad-fecha.service';

const TZ = 'America/Bogota';

// Sede por defecto para citas Trepsi cuyo médico no está registrado en
// `profesionales` (no resuelve a una sede real). Evita que queden ocultas
// en el calendario del coordinador. `bsl` = sede principal.
const TREPSI_FALLBACK_SEDE = 'bsl';

// Sede "efectiva" de una cita para el filtro multi-sede del coordinador.
// Las citas Trepsi se persisten con sede_id='trepsi' (placeholder, no es una
// sede real), así que se atribuyen a la sede del médico asignado; si el médico
// no está registrado, caen a TREPSI_FALLBACK_SEDE. El resto conserva su sede_id.
// Asume que la tabla en la query se llama "HistoriaClinica" (sin alias).
const EFFECTIVE_SEDE_SQL = `
  CASE WHEN "HistoriaClinica"."sede_id" = 'trepsi'
       THEN COALESCE(
              (SELECT p.sede_id FROM profesionales p
                WHERE p.codigo = "HistoriaClinica"."medico" AND p.activo = TRUE
                LIMIT 1),
              '${TREPSI_FALLBACK_SEDE}')
       ELSE "HistoriaClinica"."sede_id"
  END`;

// Clasificación de una cita. ÚNICA para todo el módulo: la usan el calendario
// (getMes/getDia) y los indicadores (getIndicadores), así que las tarjetas del
// calendario y el tablero de indicadores nunca pueden discrepar.
//   ATENDIDA   = atendido ATENDIDO
//   NOCONTESTA = atendido NO CONTESTA (el afiliado no respondió)
//   NOCONTACTO = sin resolver, SIN link enviado y con la hora ya vencida
//                (el profesional dejó pasar la cita sin contactar)
//   PENDIENTE  = el resto sin resolver: hora aún por venir, o link ya enviado
// La comparación con NOW() evita marcar como "no contactó" citas futuras.
// OJO: `link_enviado_at` solo es fiable desde 2026-07-09 (no hay backfill); en
// meses anteriores NOCONTACTO sale inflado — mismo caveat que /indicadores.
const CLASE_CITA_SQL = `
  CASE
    WHEN UPPER(COALESCE("atendido", 'PENDIENTE')) = 'ATENDIDO' THEN 'ATENDIDA'
    WHEN UPPER(COALESCE("atendido", 'PENDIENTE')) = 'NO CONTESTA' THEN 'NOCONTESTA'
    WHEN "link_enviado_at" IS NULL AND "fechaAtencion"::timestamptz < NOW() THEN 'NOCONTACTO'
    ELSE 'PENDIENTE'
  END`;

export type Modalidad = 'presencial' | 'virtual';

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Helpers de timezone
// ---------------------------------------------------------------------------

/**
 * Devuelve el rango ISO [start, endExclusive) para un mes en Colombia (UTC-5),
 * expresado como timestamps UTC para usarse contra `timestamptz` en Postgres.
 *
 * Ej: getMonthRange(2026, 12) →
 *   start = 2026-12-01T00:00:00-05:00 = 2026-12-01T05:00:00Z
 *   end   = 2027-01-01T00:00:00-05:00 = 2027-01-01T05:00:00Z
 */
function getMonthRange(year: number, month1Indexed: number): { startUtc: string; endUtc: string } {
  // El mes en el query viene 1-indexado (1=enero). JS Date usa 0-indexado.
  const m = month1Indexed - 1;
  // Colombia es UTC-5. Para el inicio del mes en hora local Colombia, eso
  // equivale a UTC `año-mes-01 05:00:00`.
  const startUtc = new Date(Date.UTC(year, m, 1, 5, 0, 0)).toISOString();
  const endUtc = new Date(Date.UTC(year, m + 1, 1, 5, 0, 0)).toISOString();
  return { startUtc, endUtc };
}

/**
 * Devuelve el rango ISO [start, endExclusive) para un rango de días
 * [from, to] (ambos YYYY-MM-DD, inclusivos) en hora Colombia. `to` cubre el día
 * completo (fin exclusivo = medianoche del día siguiente a `to`, hora Colombia).
 */
function getRangeUtc(from: string, to: string): { startUtc: string; endUtc: string } {
  const mf = from.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const mt = to.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!mf) throw new Error(`Fecha inválida: ${from}. Esperado YYYY-MM-DD.`);
  if (!mt) throw new Error(`Fecha inválida: ${to}. Esperado YYYY-MM-DD.`);
  const [, yf, mof, df] = mf;
  const [, yt, mot, dt] = mt;
  const startUtc = new Date(Date.UTC(Number(yf), Number(mof) - 1, Number(df), 5, 0, 0)).toISOString();
  const endUtc = new Date(Date.UTC(Number(yt), Number(mot) - 1, Number(dt) + 1, 5, 0, 0)).toISOString();
  return { startUtc, endUtc };
}

/**
 * Devuelve el rango ISO [start, endExclusive) para UN día (YYYY-MM-DD) en
 * hora Colombia.
 */
function getDayRange(fechaIso: string): { startUtc: string; endUtc: string } {
  const m = fechaIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    throw new Error(`Fecha inválida: ${fechaIso}. Esperado YYYY-MM-DD.`);
  }
  const [, y, mo, d] = m;
  const startUtc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 5, 0, 0)).toISOString();
  const endUtc = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + 1, 5, 0, 0)).toISOString();
  return { startUtc, endUtc };
}

/**
 * Momento actual en Colombia (UTC-5): fecha YYYY-MM-DD y minutos desde
 * medianoche. Se usa para descartar franjas que ya pasaron en el día de hoy.
 */
function nowColombia(): { fecha: string; minutos: number } {
  const c = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, '0');
  const d = String(c.getUTCDate()).padStart(2, '0');
  return { fecha: `${y}-${m}-${d}`, minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
}

// Antelación mínima para agendar/reprogramar (minutos): NO se ofrecen cupos que
// empiecen dentro de este margen desde ahora → se muestra el siguiente turno.
const MARGEN_ANTICIPACION_MIN = 40;

/**
 * Suma `n` días a una fecha YYYY-MM-DD y devuelve la nueva fecha + día de la
 * semana (0=Dom .. 6=Sáb). Usa mediodía UTC para evitar bordes de DST.
 */
function addDaysIso(fechaIso: string, n: number): { fecha: string; dow: number } {
  const m = fechaIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error(`Fecha inválida: ${fechaIso}`);
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d) + n, 12, 0, 0));
  const fecha = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
  return { fecha, dow: dt.getUTCDay() };
}

// ---------------------------------------------------------------------------
// Tipos de salida
// ---------------------------------------------------------------------------

export interface MesResumen {
  year: number;
  month: number;
  totalCitas: number; // = "personas agendadas" en /indicadores
  totalAtendidos: number;
  totalPendientes: number; // sentido estricto: ni atendida, ni no-contesta, ni no-contactó
  totalNoContesta: number;
  totalNoContacto: number;
  /** Cupos teóricos del mes según disponibilidad configurada; null si no se pudo calcular. */
  capacidad: number | null;
  medicosActivos: number;
  porDia: Record<string, DiaResumen>; // YYYY-MM-DD → resumen
}

export interface ClaseCitaConteo {
  total: number;
  atendidos: number;
  pendientes: number;
  noContesta: number;
  noContacto: number;
}

export type DiaResumen = ClaseCitaConteo & {
  /** Cupos teóricos de ese día (disponibilidad ÷ tiempo_consulta). */
  capacidad?: number;
  porMedico: Record<string, ClaseCitaConteo>;
};

export interface CitaListItem {
  id: string;
  numeroId: string;
  primerNombre: string | null;
  segundoNombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  nombre: string;
  celular: string | null;
  email: string | null;
  medicoCodigo: string | null;
  horaAtencion: string | null; // "HH:MM"
  fechaAtencion: string | null; // ISO completo
  atendido: string | null;
  tipoConsulta: string | null;
  empresa: string | null;
  motivoConsulta: string | null;
  sedeId: string | null;
  /** Departamento / vía de entrada: 'trepsi' | 'umv' | 'mybodytech' | 'nativa'. */
  origen: string | null;
}

export interface DiaDetalle {
  fecha: string; // YYYY-MM-DD
  total: number;
  atendidos: number;
  pendientes: number; // estricto, igual que en MesResumen / indicadores
  noContesta: number;
  noContacto: number;
  citas: CitaListItem[];
  medicosResumen: Array<
    ClaseCitaConteo & {
      medicoCodigo: string;
      nombre: string;
      rol: 'medico' | 'coach' | null;
    }
  >;
}

export interface IndicadorMedico {
  medicoCodigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  agendadas: number;
  atendidas: number;
  /** Estado NO CONTESTA (el paciente no respondió). Etiqueta: "No contesta". */
  noContactadas: number;
  /** Sin resolver y SIN link enviado (nunca se le contactó). Etiqueta: "No contactó". */
  noContacto: number;
}

export interface IndicadoresResumen {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  agendadas: number;
  atendidas: number;
  noContactadas: number;
  noContacto: number;
  /** Cupos teóricos del rango (disponibilidad ÷ tiempo_consulta); null si falló. */
  capacidad: number | null;
  porMedico: IndicadorMedico[];
}

/** Una persona del listado "No contactó" (cita sin resolver, sin link, hora vencida). */
export interface NoContactoItem {
  id: string;
  nombre: string;
  numeroId: string;
  celular: string | null;
  hora: string | null; // "HH:MM" Colombia
  fechaAtencion: string | null;
}

export interface SlotHora {
  hora: string; // "HH:MM"
  disponible: boolean;
}

export interface HorariosDisponibles {
  fecha: string;
  profesionalId: number;
  modalidad: Modalidad;
  tiempoConsulta: number;
  horarios: SlotHora[];
}

// ---------------------------------------------------------------------------
// Helpers de mapeo
// ---------------------------------------------------------------------------

function nuevoConteo(): ClaseCitaConteo {
  return { total: 0, atendidos: 0, pendientes: 0, noContesta: 0, noContacto: 0 };
}

/** Suma `n` citas de la clase `clase` al acumulador (ver CLASE_CITA_SQL). */
function acumularClase(acc: ClaseCitaConteo, clase: string, n: number): void {
  acc.total += n;
  if (clase === 'ATENDIDA') acc.atendidos += n;
  else if (clase === 'NOCONTESTA') acc.noContesta += n;
  else if (clase === 'NOCONTACTO') acc.noContacto += n;
  else acc.pendientes += n;
}

function buildNombre(row: Record<string, unknown>): string {
  const parts = [row.primerNombre, row.segundoNombre, row.primerApellido, row.segundoApellido]
    .filter(Boolean)
    .map(String);
  return parts.join(' ') || '(sin nombre)';
}

function rowToCitaListItem(row: Record<string, unknown>): CitaListItem {
  return {
    id: String(row._id),
    numeroId: String(row.numeroId ?? ''),
    primerNombre: row.primerNombre ? String(row.primerNombre) : null,
    segundoNombre: row.segundoNombre ? String(row.segundoNombre) : null,
    primerApellido: row.primerApellido ? String(row.primerApellido) : null,
    segundoApellido: row.segundoApellido ? String(row.segundoApellido) : null,
    nombre: buildNombre(row),
    celular: row.celular ? String(row.celular) : null,
    email: row.email ? String(row.email) : null,
    medicoCodigo: row.medico ? String(row.medico) : null,
    horaAtencion: row.horaAtencion ? String(row.horaAtencion) : null,
    fechaAtencion: row.fechaAtencion ? String(row.fechaAtencion) : null,
    atendido: row.atendido ? String(row.atendido) : null,
    tipoConsulta: row.tipo_consulta ? String(row.tipo_consulta) : null,
    empresa: row.empresa ? String(row.empresa) : null,
    motivoConsulta: row.motivo_consulta_texto ? String(row.motivo_consulta_texto) : null,
    sedeId: row.sede_id ? String(row.sede_id) : null,
    origen: row.origen ? String(row.origen) : null,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class CalendarioService {
  /**
   * Resumen del mes: conteos por día + total + estadísticas + por médico.
   * Devuelve un mapa `{ "YYYY-MM-DD": DiaResumen }` para que el frontend
   * pueda pintar el grid del mes.
   */
  async getMes(
    year: number,
    month: number,
    sedeIds: string[],
    medicoCodigo?: string
  ): Promise<ServiceResult<MesResumen>> {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return { ok: false, status: 400, error: { code: 'INVALID_YEAR', message: 'Año inválido.' } };
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, status: 400, error: { code: 'INVALID_MONTH', message: 'Mes inválido (1-12).' } };
    }

    const { startUtc, endUtc } = getMonthRange(year, month);

    const params: unknown[] = [sedeIds, startUtc, endUtc];
    let medicoFilter = '';
    if (medicoCodigo) {
      params.push(medicoCodigo);
      medicoFilter = `AND "medico" = $${params.length}`;
    }

    // Agregado por (día Colombia, medico, clase). Misma clasificación que
    // /indicadores para que las tarjetas del calendario cuadren con ese tablero.
    const sql = `
      SELECT
        TO_CHAR(("fechaAtencion"::timestamptz AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS fecha,
        COALESCE("medico", '__SIN_ASIGNAR__') AS medico_codigo,
        ${CLASE_CITA_SQL} AS clase,
        COUNT(*)::int AS total
      FROM "HistoriaClinica"
      WHERE (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
        ${medicoFilter}
      GROUP BY fecha, medico_codigo, clase
      ORDER BY fecha
    `;

    // Citas y cupos teóricos en paralelo: son independientes y el segundo no
    // debe alargar la carga del calendario.
    const primerDia = `${year}-${String(month).padStart(2, '0')}-01`;
    const mesSiguiente = month === 12 ? 1 : month + 1;
    const anioSiguiente = month === 12 ? year + 1 : year;
    const finExclusivo = `${anioSiguiente}-${String(mesSiguiente).padStart(2, '0')}-01`;
    const [rows, cuposPorDia] = await Promise.all([
      postgresService.query(sql, params),
      this.getCuposPorDia(primerDia, finExclusivo, sedeIds, medicoCodigo),
    ]);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando calendario.' } };
    }

    const porDia: Record<string, DiaResumen> = {};
    const totales = nuevoConteo();
    const medicosSet = new Set<string>();

    for (const row of rows) {
      const fecha = String(row.fecha);
      const medico = String(row.medico_codigo);
      const clase = String(row.clase);
      const total = Number(row.total);

      if (!porDia[fecha]) {
        porDia[fecha] = { ...nuevoConteo(), porMedico: {} };
      }
      if (!porDia[fecha].porMedico[medico]) {
        porDia[fecha].porMedico[medico] = nuevoConteo();
      }

      acumularClase(porDia[fecha], clase, total);
      acumularClase(porDia[fecha].porMedico[medico], clase, total);
      acumularClase(totales, clase, total);

      if (medico !== '__SIN_ASIGNAR__') {
        medicosSet.add(medico);
      }
    }

    // Cupos teóricos por día. Se anexan a los días que ya existen y también
    // crean día si hay agenda abierta sin una sola cita (capacidad ociosa pura,
    // que es justo lo que interesa ver). null = la consulta falló: la tarjeta de
    // capacidad se apaga en vez de mentir con ceros.
    let capacidadTotal: number | null = null;
    if (cuposPorDia !== null) {
      capacidadTotal = 0;
      for (const [fecha, cupos] of Object.entries(cuposPorDia)) {
        capacidadTotal += cupos;
        if (cupos === 0 && !porDia[fecha]) continue;
        if (!porDia[fecha]) porDia[fecha] = { ...nuevoConteo(), porMedico: {} };
        porDia[fecha].capacidad = cupos;
      }
    }

    return {
      ok: true,
      status: 200,
      data: {
        year,
        month,
        totalCitas: totales.total,
        totalAtendidos: totales.atendidos,
        totalPendientes: totales.pendientes,
        totalNoContesta: totales.noContesta,
        totalNoContacto: totales.noContacto,
        capacidad: capacidadTotal,
        medicosActivos: medicosSet.size,
        porDia,
      },
    };
  }

  /**
   * Detalle de un día: lista de citas + resumen por médico.
   * `fecha` debe ser YYYY-MM-DD.
   */
  async getDia(
    fecha: string,
    sedeIds: string[],
    medicoCodigo?: string
  ): Promise<ServiceResult<DiaDetalle>> {
    let range;
    try {
      range = getDayRange(fecha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }

    const params: unknown[] = [sedeIds, range.startUtc, range.endUtc];
    let medicoFilter = '';
    if (medicoCodigo) {
      params.push(medicoCodigo);
      medicoFilter = `AND "medico" = $${params.length}`;
    }

    const sql = `
      SELECT
        "_id", "numeroId", "primerNombre", "segundoNombre",
        "primerApellido", "segundoApellido",
        "celular", "email", "medico", "horaAtencion", "fechaAtencion",
        "atendido", "empresa", "motivo_consulta_texto", "tipo_consulta", "sede_id", "origen",
        ${CLASE_CITA_SQL} AS clase
      FROM "HistoriaClinica"
      WHERE (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
        ${medicoFilter}
      ORDER BY "horaAtencion" NULLS LAST, "fechaAtencion"
    `;

    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando citas del día.' } };
    }

    const citas = rows.map(rowToCitaListItem);

    // Resumen por médico (todos los del día, no filtrado).
    // Lo hago en una segunda query para no perder médicos cuando se filtra.
    const resumenSql = `
      SELECT
        COALESCE("medico", '__SIN_ASIGNAR__') AS codigo,
        ${CLASE_CITA_SQL} AS clase,
        COUNT(*)::int AS total
      FROM "HistoriaClinica"
      WHERE (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
      GROUP BY codigo, clase
    `;
    const resumenRows = await postgresService.query(resumenSql, [sedeIds, range.startUtc, range.endUtc]);

    const resumenMap = new Map<string, ClaseCitaConteo & { medicoCodigo: string }>();
    if (resumenRows !== null) {
      for (const r of resumenRows) {
        const codigo = String(r.codigo);
        let entry = resumenMap.get(codigo);
        if (!entry) {
          entry = { medicoCodigo: codigo, ...nuevoConteo() };
          resumenMap.set(codigo, entry);
        }
        acumularClase(entry, String(r.clase), Number(r.total));
      }
    }

    // Enriquecer con nombre y rol del profesional (si existe en tabla profesionales).
    const codigos = Array.from(resumenMap.keys()).filter((c) => c !== '__SIN_ASIGNAR__');
    const profesionalesMap = new Map<
      string,
      { nombre: string; rol: 'medico' | 'coach' | null }
    >();
    if (codigos.length > 0) {
      const profRows = await postgresService.query(
        `SELECT codigo, alias, primer_nombre, primer_apellido, rol
           FROM profesionales
           WHERE sede_id = ANY($1::text[]) AND codigo = ANY($2::text[])`,
        [sedeIds, codigos]
      );
      if (profRows) {
        for (const p of profRows) {
          const nombre =
            (p.alias ? String(p.alias) : '') ||
            [p.primer_nombre, p.primer_apellido].filter(Boolean).join(' ');
          profesionalesMap.set(String(p.codigo), {
            nombre,
            rol: p.rol === 'coach' ? 'coach' : 'medico',
          });
        }
      }
    }

    const medicosResumen = Array.from(resumenMap.values()).map((entry) => {
      const prof = profesionalesMap.get(entry.medicoCodigo);
      return {
        medicoCodigo: entry.medicoCodigo,
        nombre:
          entry.medicoCodigo === '__SIN_ASIGNAR__' ? 'Sin asignar' : (prof?.nombre || entry.medicoCodigo),
        rol: prof?.rol ?? null,
        total: entry.total,
        atendidos: entry.atendidos,
        pendientes: entry.pendientes,
        noContesta: entry.noContesta,
        noContacto: entry.noContacto,
      };
    });

    medicosResumen.sort((a, b) => a.nombre.localeCompare(b.nombre));

    // Totales del día (ya filtrados por médico si aplica). La clase la calcula
    // el propio SELECT de citas, así que coincide exactamente con getMes.
    const totales = nuevoConteo();
    for (const r of rows) acumularClase(totales, String(r.clase), 1);

    return {
      ok: true,
      status: 200,
      data: {
        fecha,
        total: totales.total,
        atendidos: totales.atendidos,
        pendientes: totales.pendientes,
        noContesta: totales.noContesta,
        noContacto: totales.noContacto,
        citas,
        medicosResumen,
      },
    };
  }

  /**
   * Indicadores (KPIs) de un rango de fechas [from, to], opcionalmente acotado a
   * un médico/coach. Devuelve tres métricas — agendadas, atendidas y no
   * contactadas — a nivel global y desglosadas por profesional.
   *
   * Semántica de estados (columna `atendido`, misma que usa el calendario):
   *   - agendadas      = todas las citas del rango (independiente del estado).
   *   - atendidas      = estado 'ATENDIDO'.
   *   - noContactadas  = estado 'NO CONTESTA' (lo marca markPatientAsNoAnswer).
   *
   * Multi-sede y Trepsi se resuelven con EFFECTIVE_SEDE_SQL, igual que getMes/getDia,
   * de modo que los números coinciden con lo que el coordinador ve en el calendario.
   */
  async getIndicadores(
    from: string,
    to: string,
    sedeIds: string[],
    medicoCodigo?: string
  ): Promise<ServiceResult<IndicadoresResumen>> {
    let range;
    try {
      range = getRangeUtc(from, to);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }
    // El rango debe ser cronológico (from <= to).
    if (range.startUtc >= range.endUtc) {
      return {
        ok: false,
        status: 400,
        error: { code: 'INVALID_RANGE', message: 'El rango de fechas es inválido (from > to).' },
      };
    }

    const params: unknown[] = [sedeIds, range.startUtc, range.endUtc];
    let medicoFilter = '';
    if (medicoCodigo) {
      params.push(medicoCodigo);
      medicoFilter = `AND "medico" = $${params.length}`;
    }

    // Agregado por (medico, clase) en todo el rango, con la clasificación de 4
    // vías compartida con el calendario (ver CLASE_CITA_SQL). `fechaAtencion` ya
    // viene filtrada por el regex del WHERE, así que el cast a timestamptz es
    // seguro.
    const sql = `
      SELECT
        COALESCE("medico", '__SIN_ASIGNAR__') AS medico_codigo,
        ${CLASE_CITA_SQL} AS clase,
        COUNT(*)::int AS total
      FROM "HistoriaClinica"
      WHERE (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
        ${medicoFilter}
      GROUP BY medico_codigo, clase
    `;

    // Citas y cupos teóricos del rango en paralelo. `to` es inclusive para el
    // usuario, y getCuposPorDia espera el fin exclusivo → +1 día.
    const [rows, cuposPorDia] = await Promise.all([
      postgresService.query(sql, params),
      this.getCuposPorDia(from, addDaysIso(to, 1).fecha, sedeIds, medicoCodigo),
    ]);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando indicadores.' } };
    }
    const capacidad =
      cuposPorDia === null
        ? null
        : Object.values(cuposPorDia).reduce((a, n) => a + n, 0);

    let agendadas = 0;
    let atendidas = 0;
    let noContactadas = 0;
    let noContacto = 0;
    const porMedicoMap = new Map<
      string,
      { agendadas: number; atendidas: number; noContactadas: number; noContacto: number }
    >();

    for (const row of rows) {
      const codigo = String(row.medico_codigo);
      const clase = String(row.clase);
      const total = Number(row.total);

      let entry = porMedicoMap.get(codigo);
      if (!entry) {
        entry = { agendadas: 0, atendidas: 0, noContactadas: 0, noContacto: 0 };
        porMedicoMap.set(codigo, entry);
      }
      entry.agendadas += total;
      agendadas += total;
      if (clase === 'ATENDIDA') {
        entry.atendidas += total;
        atendidas += total;
      } else if (clase === 'NOCONTESTA') {
        entry.noContactadas += total;
        noContactadas += total;
      } else if (clase === 'NOCONTACTO') {
        entry.noContacto += total;
        noContacto += total;
      }
      // 'PENDIENTE' (link enviado, sin resolver) solo suma a agendadas → pendientes se deriva.
    }

    // Enriquecer con nombre y rol del profesional (si existe en tabla profesionales).
    const codigos = Array.from(porMedicoMap.keys()).filter((c) => c !== '__SIN_ASIGNAR__');
    const profesionalesMap = new Map<string, { nombre: string; rol: 'medico' | 'coach' | null }>();
    if (codigos.length > 0) {
      const profRows = await postgresService.query(
        `SELECT codigo, alias, primer_nombre, primer_apellido, rol
           FROM profesionales
           WHERE sede_id = ANY($1::text[]) AND codigo = ANY($2::text[])`,
        [sedeIds, codigos]
      );
      if (profRows) {
        for (const p of profRows) {
          const nombre =
            (p.alias ? String(p.alias) : '') ||
            [p.primer_nombre, p.primer_apellido].filter(Boolean).join(' ');
          profesionalesMap.set(String(p.codigo), {
            nombre,
            rol: p.rol === 'coach' ? 'coach' : 'medico',
          });
        }
      }
    }

    const porMedico: IndicadorMedico[] = Array.from(porMedicoMap.entries()).map(([codigo, v]) => {
      const prof = profesionalesMap.get(codigo);
      return {
        medicoCodigo: codigo,
        nombre: codigo === '__SIN_ASIGNAR__' ? 'Sin asignar' : prof?.nombre || codigo,
        rol: prof?.rol ?? null,
        agendadas: v.agendadas,
        atendidas: v.atendidas,
        noContactadas: v.noContactadas,
        noContacto: v.noContacto,
      };
    });

    // Orden: mejor calificado primero (mayor % de ejecución = atendidas/agendadas).
    // Coaches sin agendadas van al final; empate → más agendadas, luego alfabético.
    porMedico.sort((a, b) => {
      const ea = a.agendadas > 0 ? a.atendidas / a.agendadas : -1;
      const eb = b.agendadas > 0 ? b.atendidas / b.agendadas : -1;
      return eb - ea || b.agendadas - a.agendadas || a.nombre.localeCompare(b.nombre);
    });

    return {
      ok: true,
      status: 200,
      data: { from, to, agendadas, atendidas, noContactadas, noContacto, capacidad, porMedico },
    };
  }

  /**
   * Tiempos de atención por cita en un rango: hora PROGRAMADA de la cita, hora
   * en que se ENVIÓ el link de la videollamada (`link_enviado_at`), los minutos
   * de DESFASE entre ambas (positivo = link enviado tarde), y la hora ATENDIDA
   * (`fechaConsulta`). Solo incluye citas con link enviado. Alimenta el export a
   * Excel del panel Indicadores.
   *
   * OJO: `link_enviado_at` solo es fiable desde 2026-07-09 (no hay backfill).
   */
  async getTiemposAtencion(
    from: string,
    to: string,
    sedes: string[]
  ): Promise<
    Array<{
      cedula: string;
      paciente: string;
      coach: string;
      sede: string;
      hora_cita: string | null;
      link_enviado: string | null;
      min_desfase: number | null;
      hora_atendida: string | null;
    }>
  > {
    const rows = await postgresService.query(
      `SELECT h."numeroId" AS cedula,
              trim(COALESCE(h."primerNombre", '') || ' ' || COALESCE(h."primerApellido", '')) AS paciente,
              COALESCE(p.alias, h."medico") AS coach,
              p.sede_id AS sede,
              to_char(h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS hora_cita,
              to_char(h."link_enviado_at" AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS link_enviado,
              round(extract(epoch FROM (h."link_enviado_at" - h."fechaAtencion"::timestamptz)) / 60)::int AS min_desfase,
              to_char(h."fechaConsulta" AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI') AS hora_atendida
         FROM "HistoriaClinica" h
         JOIN profesionales p ON p.codigo = h."medico" AND p.sede_id = ANY($3::text[])
        WHERE h."fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND (h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota')::date >= $1::date
          AND (h."fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota')::date <= $2::date
          AND h."link_enviado_at" IS NOT NULL
        ORDER BY h."fechaAtencion"::timestamptz`,
      [from, to, sedes]
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (rows ?? []) as any;
  }

  /**
   * Listado de personas "No contactó" de UN profesional en un rango: citas sin
   * resolver (≠ ATENDIDO/NO CONTESTA), SIN link enviado y con la hora YA vencida
   * — misma definición que la clase NOCONTACTO de getIndicadores. Alimenta la
   * fila expandible del panel Indicadores.
   */
  async getNoContactoDetalle(
    from: string,
    to: string,
    sedeIds: string[],
    medicoCodigo: string
  ): Promise<ServiceResult<{ items: NoContactoItem[] }>> {
    let range;
    try {
      range = getRangeUtc(from, to);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }

    const params: unknown[] = [sedeIds, range.startUtc, range.endUtc];
    let medicoCond: string;
    if (medicoCodigo === '__SIN_ASIGNAR__') {
      medicoCond = `AND "medico" IS NULL`;
    } else {
      params.push(medicoCodigo);
      medicoCond = `AND "medico" = $${params.length}`;
    }

    const sql = `
      SELECT
        "_id" AS id,
        TRIM(CONCAT_WS(' ', "primerNombre", "segundoNombre", "primerApellido", "segundoApellido")) AS nombre,
        "numeroId", "celular",
        to_char("fechaAtencion"::timestamptz AT TIME ZONE '${TZ}', 'HH24:MI') AS hora,
        "fechaAtencion"
      FROM "HistoriaClinica"
      WHERE (${EFFECTIVE_SEDE_SQL}) = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
        ${medicoCond}
        AND UPPER(COALESCE("atendido", 'PENDIENTE')) NOT IN ('ATENDIDO', 'NO CONTESTA')
        AND "link_enviado_at" IS NULL
        AND "fechaAtencion"::timestamptz < NOW()
      ORDER BY "fechaAtencion"
    `;

    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando el detalle.' } };
    }
    const items: NoContactoItem[] = rows.map((r: Record<string, unknown>) => ({
      id: String(r.id),
      nombre: (r.nombre ? String(r.nombre) : '').trim() || '(sin nombre)',
      numeroId: r.numeroId ? String(r.numeroId) : '',
      celular: r.celular ? String(r.celular) : null,
      hora: r.hora ? String(r.hora) : null,
      fechaAtencion: r.fechaAtencion ? String(r.fechaAtencion) : null,
    }));
    return { ok: true, status: 200, data: { items } };
  }

  /**
   * Cupos teóricos por día del mes: cuántas consultas caben en la disponibilidad
   * configurada de los profesionales de esas sedes.
   *
   * Replica en SQL la resolución de `disponibilidad-fecha.getRangosEfectivos()`
   * (override por fecha > patrón semanal; día bloqueado = 0) y trocea cada rango
   * con el `tiempo_consulta` de CADA profesional, igual que
   * `getHorariosDisponibles()` — así el cupo contado es el cupo que el agendador
   * realmente ofrece. Un solo query en vez del N+1 de `getDiaResumen`.
   *
   * Modalidad: se toma el MÁXIMO entre presencial y virtual por (profesional,
   * día), no la suma. Declarar 8-12 en ambas modalidades son 4 horas de agenda,
   * no 8. Contrapartida: si alguien parte el día (mañana virtual, tarde
   * presencial), esto lo subestima.
   */
  private async getCuposPorDia(
    /** Primer día del rango, inclusive (YYYY-MM-DD). */
    start: string,
    /** Día siguiente al último, EXCLUSIVE (YYYY-MM-DD). */
    end: string,
    sedeIds: string[],
    medicoCodigo?: string
  ): Promise<Record<string, number> | null> {
    const params: unknown[] = [sedeIds, start, end];
    let medicoFilter = '';
    if (medicoCodigo) {
      params.push(medicoCodigo);
      medicoFilter = `AND p.codigo = $${params.length}`;
    }

    const sql = `
      WITH dias AS (
        SELECT gs::date AS fecha, EXTRACT(DOW FROM gs)::int AS dow
          FROM generate_series($2::date, $3::date - 1, interval '1 day') gs
      ),
      profs AS (
        SELECT p.id, p.sede_id,
               GREATEST(COALESCE(p.tiempo_consulta, 30), 1) AS tc
          FROM profesionales p
         WHERE p.sede_id = ANY($1::text[]) AND p.activo = TRUE
           ${medicoFilter}
      ),
      -- Override por (profesional, sede, fecha): gana sobre el patrón semanal.
      -- Se queda con la modalidad de más minutos (ver nota de MÁXIMO arriba).
      ovr AS (
        SELECT profesional_id, sede_id, fecha,
               BOOL_AND(bloqueado) AS bloqueado,
               MAX(minutos) AS minutos
          FROM (
            SELECT profesional_id, sede_id, fecha, modalidad,
                   BOOL_OR(bloqueado) AS bloqueado,
                   COALESCE(SUM(
                     EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 60
                   ) FILTER (WHERE NOT bloqueado), 0) AS minutos
              FROM profesionales_disponibilidad_fecha
             WHERE fecha >= $2::date AND fecha < $3::date
             GROUP BY profesional_id, sede_id, fecha, modalidad
          ) x
         GROUP BY profesional_id, sede_id, fecha
      ),
      sem AS (
        SELECT profesional_id, sede_id, dia_semana, MAX(minutos) AS minutos
          FROM (
            SELECT profesional_id, sede_id, dia_semana, modalidad,
                   SUM(EXTRACT(EPOCH FROM (hora_fin - hora_inicio)) / 60) AS minutos
              FROM profesionales_disponibilidad
             WHERE activo = TRUE
             GROUP BY profesional_id, sede_id, dia_semana, modalidad
          ) y
         GROUP BY profesional_id, sede_id, dia_semana
      )
      SELECT TO_CHAR(d.fecha, 'YYYY-MM-DD') AS fecha,
             COALESCE(SUM(FLOOR(
               CASE
                 WHEN o.profesional_id IS NOT NULL
                   THEN CASE WHEN o.bloqueado THEN 0 ELSE o.minutos END
                 ELSE COALESCE(w.minutos, 0)
               END / p.tc
             )), 0)::int AS cupos
        FROM dias d
        CROSS JOIN profs p
        LEFT JOIN ovr o
          ON o.profesional_id = p.id AND o.sede_id = p.sede_id AND o.fecha = d.fecha
        LEFT JOIN sem w
          ON w.profesional_id = p.id AND w.sede_id = p.sede_id AND w.dia_semana = d.dow
       GROUP BY d.fecha
    `;

    const rows = await postgresService.query(sql, params);
    if (rows === null) return null;

    const porDia: Record<string, number> = {};
    for (const r of rows) porDia[String(r.fecha)] = Number(r.cupos);
    return porDia;
  }

  /**
   * Resumen mensual de OVERRIDES de disponibilidad por fecha (para marcar las
   * celdas del calendario en modo "Disponibilidad"). Devuelve, por día, cuántos
   * profesionales tienen un override y cuántos están bloqueados.
   */
  async getDisponibilidadMes(
    year: number,
    month: number,
    sedeIds: string[],
    modalidad: Modalidad
  ): Promise<ServiceResult<{ year: number; month: number; modalidad: Modalidad; porDia: Record<string, { overrides: number; bloqueados: number }> }>> {
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      return { ok: false, status: 400, error: { code: 'INVALID_YEAR', message: 'Año inválido.' } };
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return { ok: false, status: 400, error: { code: 'INVALID_MONTH', message: 'Mes inválido (1-12).' } };
    }

    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const end = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;

    const rows = await postgresService.query(
      `SELECT TO_CHAR(fecha, 'YYYY-MM-DD') AS fecha,
              COUNT(DISTINCT profesional_id)::int AS overrides,
              COUNT(DISTINCT profesional_id) FILTER (WHERE bloqueado)::int AS bloqueados
         FROM profesionales_disponibilidad_fecha
         WHERE sede_id = ANY($1::text[]) AND modalidad = $2 AND fecha >= $3::date AND fecha < $4::date
         GROUP BY fecha`,
      [sedeIds, modalidad, start, end]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando overrides del mes.' } };
    }
    const porDia: Record<string, { overrides: number; bloqueados: number }> = {};
    for (const r of rows) {
      porDia[String(r.fecha)] = { overrides: Number(r.overrides), bloqueados: Number(r.bloqueados) };
    }
    return { ok: true, status: 200, data: { year, month, modalidad, porDia } };
  }

  /**
   * Horarios disponibles de UN profesional en una fecha, según su disponibilidad
   * teórica MENOS los slots ya ocupados por citas pendientes en HistoriaClinica.
   *
   * Slots se generan en bloques de `tiempo_consulta` minutos.
   */
  async getHorariosDisponibles(
    fecha: string,
    profesionalId: number,
    // Sede del solicitante: se ignora a propósito. La disponibilidad se resuelve
    // bajo la sede REAL del profesional (profesionalId es PK global). Se conserva
    // en la firma por compatibilidad con los llamadores existentes.
    _sedeIdSolicitante: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<HorariosDisponibles>> {
    let range;
    try {
      range = getDayRange(fecha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }

    // 1) Profesional + tiempo_consulta + codigo.
    // profesionalId es PK global, así que NO se filtra por la sede del solicitante:
    // la disponibilidad se resuelve bajo la sede REAL del profesional. Si no, un
    // coordinador de otra sede (o una cita con sede genérica) nunca ve la agenda
    // del coach (ej. coaches de nutrición viven en 'bdt-nutricion').
    const profRows = await postgresService.query(
      `SELECT id, codigo, tiempo_consulta, sede_id FROM profesionales
         WHERE id = $1 AND activo = TRUE`,
      [profesionalId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    if (profRows.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado o inactivo.' } };
    }
    const prof = profRows[0];
    const tiempoConsulta = Number(prof.tiempo_consulta) || 30;
    const codigoMedico = String(prof.codigo);
    // Sede real del profesional — fuente para disponibilidad y cupos ocupados.
    const sedeReal = String(prof.sede_id);

    // 2) Día de la semana (0-6) en Colombia
    const diaSemanaUtc = new Date(range.startUtc);
    // range.startUtc fue construido como 05:00Z = 00:00 Colombia, así que el getUTCDay
    // del momento un instante DESPUÉS coincide con el día Colombia.
    const diaSemana = new Date(diaSemanaUtc.getTime() + 1000).getUTCDay();

    // 3) Rangos EFECTIVOS de disponibilidad (override por fecha > patrón semanal).
    const efectivos = await disponibilidadFechaService.getRangosEfectivos(
      profesionalId,
      sedeReal,
      fecha,
      diaSemana,
      modalidad
    );
    if (!efectivos.ok || !efectivos.data) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando disponibilidad.' } };
    }
    const rangosDisponibles = efectivos.data.rangos;

    // Sin rangos efectivos (día bloqueado por override, o sin patrón semanal) → no hay cupos.
    if (rangosDisponibles.length === 0) {
      return {
        ok: true,
        status: 200,
        data: { fecha, profesionalId, modalidad, tiempoConsulta, horarios: [] },
      };
    }

    // 4) Citas existentes (pendientes) del médico en ese día → ocupan slots
    const ocupRows = await postgresService.query(
      // Cupos ocupados del coach ese día. IMPORTANTE: las citas Trepsi se
      // guardan con sede_id='trepsi' (placeholder), no con la sede real del
      // coach; si sólo filtramos por la sede real, quedan invisibles y el cupo
      // aparece libre → doble-agendamiento. Por eso incluimos 'trepsi'.
      // 'mybodytech' va por la misma razón, PERO hoy no llega a coincidir: ese
      // alta guarda en "medico" el NOMBRE del profesional, no su `codigo`
      // (decisión deliberada de la Fase 1, ver mybodytech.service.ts:1-14), así
      // que el `AND "medico" = $4` nunca casa. Queda puesto a propósito para que
      // el día que la agenda se sincronice (Fase 2) el hueco no se abra en
      // silencio — que es exactamente como apareció con Trepsi.
      // La hora ocupada se deriva de fechaAtencion (COT) para no depender de
      // que horaAtencion esté poblada.
      `SELECT to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "horaAtencion"
         FROM "HistoriaClinica"
         WHERE (sede_id = $1 OR sede_id IN ('trepsi', 'mybodytech'))
           AND "fechaAtencion" IS NOT NULL
           AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND "fechaAtencion"::timestamptz >= $2::timestamptz
           AND "fechaAtencion"::timestamptz < $3::timestamptz
           AND "medico" = $4
           AND UPPER(COALESCE("atendido", 'PENDIENTE')) <> 'ATENDIDO'`,
      [sedeReal, range.startUtc, range.endUtc, codigoMedico]
    );
    if (ocupRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando citas existentes.' } };
    }
    // Cupos ocupados en MINUTOS. Un slot candidato se marca ocupado si SOLAPA
    // con una cita existente (no solo si coincide la hora exacta): las citas
    // pueden estar en una grilla distinta (ej. :30) a la que generan los slots
    // (ej. cada 20 min), y un match exacto dejaría pasar los solapes.
    const ocupadasMin: number[] = [];
    for (const r of ocupRows) {
      const [hh, mm] = String(r.horaAtencion).slice(0, 5).split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) ocupadasMin.push(hh * 60 + mm);
    }

    // 5) Generar slots dentro de cada rango
    function hhmmToMin(s: string): number {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m;
    }
    function minToHHMM(m: number): string {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    }
    // Si la fecha es hoy (Colombia), descartar los cupos que empiezan dentro
    // del margen de anticipación (o que ya pasaron): solo se ofrece a partir de
    // ahora + MARGEN_ANTICIPACION_MIN.
    const ahora = nowColombia();
    const minInicio = fecha === ahora.fecha ? ahora.minutos + MARGEN_ANTICIPACION_MIN : -1;

    const horarios: SlotHora[] = [];
    for (const r of rangosDisponibles) {
      const inicio = hhmmToMin(r.horaInicio);
      const fin = hhmmToMin(r.horaFin);
      for (let t = inicio; t + tiempoConsulta <= fin; t += tiempoConsulta) {
        if (t < minInicio) continue; // aún no cumple el margen de anticipación
        const hora = minToHHMM(t);
        const ocupado = ocupadasMin.some((o) => Math.abs(t - o) < tiempoConsulta);
        horarios.push({ hora, disponible: !ocupado });
      }
    }

    return {
      ok: true,
      status: 200,
      data: { fecha, profesionalId, modalidad, tiempoConsulta, horarios },
    };
  }

  /**
   * Valida que (medicoCodigo, fecha, hora, modalidad) sea un cupo agendable.
   *
   * Reglas (mismas que generan los slots en `getHorariosDisponibles`):
   *  1. Anti doble-reserva POR MÉDICO: no puede existir otra cita pendiente del
   *     mismo médico ese día a la misma hora.
   *  2. Si el profesional tiene disponibilidad configurada para ese día y
   *     modalidad, la hora debe coincidir EXACTO con un slot generado (alineado
   *     a `tiempo_consulta`).
   *  3. Degradación: si el médico no existe como profesional configurado, o no
   *     tiene disponibilidad ese día, sólo se aplica la regla 1 (no se bloquea
   *     por horario, para no romper códigos de médico legacy).
   */
  async validarSlotDisponible(
    sedeId: string,
    medicoCodigo: string,
    fecha: string,
    hora: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<{ disponible: true }>> {
    let range;
    try {
      range = getDayRange(fecha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }

    const horaHHMM = hora.slice(0, 5);

    // 0) No permitir agendar una hora pasada ni dentro del margen de anticipación.
    const ahora = nowColombia();
    if (fecha === ahora.fecha) {
      const [hh, mm] = horaHHMM.split(':').map(Number);
      const pedido = hh * 60 + mm;
      if (pedido <= ahora.minutos) {
        return {
          ok: false,
          status: 422,
          error: { code: 'SLOT_PAST', message: 'La hora seleccionada ya pasó.' },
        };
      }
      if (pedido < ahora.minutos + MARGEN_ANTICIPACION_MIN) {
        return {
          ok: false,
          status: 422,
          error: {
            code: 'SLOT_TOO_SOON',
            message: `Debes agendar con al menos ${MARGEN_ANTICIPACION_MIN} minutos de anticipación.`,
          },
        };
      }
    }

    // 1) Citas pendientes del mismo médico ese día → ocupan slots.
    const ocupRows = await postgresService.query(
      // Ver nota en getHorariosDisponibles: incluir 'trepsi' (y 'mybodytech',
      // hoy inerte) para que esas citas cuenten como cupo ocupado en vez de
      // dejar agendar encima. Las dos queries tienen que quedar iguales: si
      // divergen, el cupo que se ofrece deja de ser el cupo que se valida.
      `SELECT to_char("fechaAtencion"::timestamptz AT TIME ZONE 'America/Bogota', 'HH24:MI') AS "horaAtencion"
         FROM "HistoriaClinica"
         WHERE (sede_id = $1 OR sede_id IN ('trepsi', 'mybodytech'))
           AND "fechaAtencion" IS NOT NULL
           AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND "fechaAtencion"::timestamptz >= $2::timestamptz
           AND "fechaAtencion"::timestamptz < $3::timestamptz
           AND "medico" = $4
           AND UPPER(COALESCE("atendido", 'PENDIENTE')) <> 'ATENDIDO'`,
      [sedeId, range.startUtc, range.endUtc, medicoCodigo]
    );
    if (ocupRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando citas existentes.' } };
    }
    // Cupos ocupados en MINUTOS (para chequear SOLAPAMIENTO, no coincidencia
    // exacta: una cita en :30 debe bloquear un slot en :20/:40 que la solape).
    const ocupadasMin: number[] = [];
    for (const r of ocupRows) {
      const [hh, mm] = String(r.horaAtencion).slice(0, 5).split(':').map(Number);
      if (Number.isFinite(hh) && Number.isFinite(mm)) ocupadasMin.push(hh * 60 + mm);
    }
    const [slotH, slotM] = horaHHMM.split(':').map(Number);
    const slotMin = slotH * 60 + slotM;

    // 2) Profesional + tiempo_consulta (duración del slot).
    const profRows = await postgresService.query(
      `SELECT id, tiempo_consulta FROM profesionales
         WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE`,
      [medicoCodigo, sedeId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    // Duración del slot: la del profesional; para médico legacy sin ficha, 30 min.
    const tiempoConsulta = profRows.length > 0 ? Number(profRows[0].tiempo_consulta) || 30 : 30;

    // Anti doble-reserva por SOLAPAMIENTO: rechaza si el slot pedido se cruza con
    // una cita existente del profesional (aunque no coincida la hora exacta).
    if (ocupadasMin.some((o) => Math.abs(slotMin - o) < tiempoConsulta)) {
      return {
        ok: false,
        status: 409,
        error: { code: 'SLOT_TAKEN', message: 'Ese horario ya está ocupado para este profesional.' },
      };
    }

    if (profRows.length === 0) {
      // Médico legacy sin ficha de profesional → ya se validó anti doble-reserva.
      return { ok: true, status: 200, data: { disponible: true } };
    }
    const profesionalId = Number(profRows[0].id);

    // Día de la semana (0-6) en Colombia — mismo cálculo que getHorariosDisponibles.
    const diaSemana = new Date(new Date(range.startUtc).getTime() + 1000).getUTCDay();

    // Rangos EFECTIVOS del día (override por fecha > patrón semanal).
    const efectivos = await disponibilidadFechaService.getRangosEfectivos(
      profesionalId,
      sedeId,
      fecha,
      diaSemana,
      modalidad
    );
    if (!efectivos.ok || !efectivos.data) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando disponibilidad.' } };
    }

    // Override explícito del día sin rangos (bloqueado) → no se puede agendar.
    if (efectivos.data.source === 'override' && efectivos.data.rangos.length === 0) {
      return {
        ok: false,
        status: 422,
        error: { code: 'SLOT_BLOCKED', message: 'El profesional no está disponible ese día.' },
      };
    }

    // Patrón semanal sin disponibilidad ese día → no bloquear por horario (degradación
    // legacy, sólo aplica la regla 1 ya validada). El override SÍ bloquea (caso arriba).
    if (efectivos.data.rangos.length === 0) {
      return { ok: true, status: 200, data: { disponible: true } };
    }

    // 3) Generar slots válidos y verificar que la hora caiga exacto en uno.
    const hhmmToMin = (s: string): number => {
      const [hh, mm] = s.split(':').map(Number);
      return hh * 60 + mm;
    };
    const minToHHMM = (m: number): string =>
      `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    const slots = new Set<string>();
    for (const r of efectivos.data.rangos) {
      const inicio = hhmmToMin(r.horaInicio);
      const fin = hhmmToMin(r.horaFin);
      for (let t = inicio; t + tiempoConsulta <= fin; t += tiempoConsulta) {
        slots.add(minToHHMM(t));
      }
    }
    if (!slots.has(horaHHMM)) {
      return {
        ok: false,
        status: 422,
        error: {
          code: 'SLOT_INVALID',
          message: 'La hora seleccionada no corresponde a un horario disponible del profesional.',
        },
      };
    }

    return { ok: true, status: 200, data: { disponible: true } };
  }

  /**
   * Busca el primer cupo libre para reprogramar una cita: próximo DÍA HÁBIL
   * (lun-vie) con un slot disponible en la franja pedida (mañana < 12:00,
   * tarde ≥ 12:00), para el mismo médico. Reutiliza la generación de slots de
   * `getHorariosDisponibles` (respeta disponibilidad + ocupados + horas pasadas).
   * Escanea hasta 30 días hacia adelante por si el día hábil siguiente está lleno.
   */
  async findRescheduleSlot(
    sedeId: string,
    medicoCodigo: string,
    franja: 'manana' | 'tarde',
    modalidad: Modalidad = 'virtual'
  ): Promise<ServiceResult<{ fecha: string; hora: string }>> {
    const profRows = await postgresService.query(
      `SELECT id FROM profesionales WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE`,
      [medicoCodigo, sedeId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    if (profRows.length === 0) {
      return {
        ok: false,
        status: 409,
        error: { code: 'NO_PROFESIONAL', message: 'El profesional no tiene agenda configurada para reprogramar.' },
      };
    }
    const profesionalId = Number(profRows[0].id);

    const base = nowColombia().fecha;
    const MAX_SCAN = 30; // días calendario hacia adelante
    for (let offset = 1; offset <= MAX_SCAN; offset++) {
      const { fecha, dow } = addDaysIso(base, offset);
      if (dow === 0 || dow === 6) continue; // sólo lun-vie
      const res = await this.getHorariosDisponibles(fecha, profesionalId, sedeId, modalidad);
      if (!res.ok || !res.data) continue;
      const libres = res.data.horarios.filter((s) => {
        if (!s.disponible) return false;
        const hh = Number(s.hora.slice(0, 2));
        return franja === 'manana' ? hh < 12 : hh >= 12;
      });
      if (libres.length > 0) {
        return { ok: true, status: 200, data: { fecha, hora: libres[0].hora } };
      }
    }
    return {
      ok: false,
      status: 409,
      error: {
        code: 'NO_SLOT',
        message: 'No hay cupos disponibles en esa franja en los próximos días hábiles.',
      },
    };
  }

  /**
   * Lista los próximos días hábiles con cupos disponibles para un médico/coach
   * (el MISMO profesional de la cita), agrupados por fecha. Reutiliza
   * getHorariosDisponibles (respeta disponibilidad efectiva > override semanal,
   * cupos ocupados y horas ya pasadas). Devuelve hasta `maxDias` días con al
   * menos un cupo, escaneando hasta 30 días calendario hacia adelante.
   *
   * Es la fuente del selector "día → hora" de la página pública de reprogramar.
   */
  /**
   * Resuelve la sede EFECTIVA de un médico/coach por su código, prefiriendo
   * `preferSedeId` si el profesional existe activo ahí; si no, cae a su sede
   * real (la primera sede activa con ese código).
   *
   * Necesario porque la cita puede traer una sede genérica ('bsl' por el
   * COALESCE, o 'trepsi') distinta a la sede donde el coach tiene su agenda
   * (p. ej. 'bdt-nutricion'). Devuelve null si no hay profesional activo.
   */
  async resolveSedeMedico(medicoCodigo: string, preferSedeId: string): Promise<string | null> {
    const rows = await postgresService.query(
      `SELECT sede_id FROM profesionales
        WHERE codigo = $1 AND activo = TRUE
        ORDER BY (sede_id = $2) DESC
        LIMIT 1`,
      [medicoCodigo, preferSedeId]
    );
    if (!rows || rows.length === 0) return null;
    return String(rows[0].sede_id);
  }

  async getHorariosReprogramar(
    sedeId: string,
    medicoCodigo: string,
    modalidad: Modalidad = 'virtual',
    maxDias = 10
  ): Promise<ServiceResult<{ dias: Array<{ fecha: string; horarios: string[] }> }>> {
    // Resolver la sede donde el coach realmente tiene agenda (no la de la cita,
    // que puede ser genérica). Sin esto, las citas 'bsl'/'trepsi' nunca encuentran
    // la disponibilidad (almacenada bajo la sede real, ej. 'bdt-nutricion').
    const sedeEfectiva = await this.resolveSedeMedico(medicoCodigo, sedeId);
    if (sedeEfectiva === null) {
      return {
        ok: false,
        status: 409,
        error: { code: 'NO_PROFESIONAL', message: 'El profesional no tiene agenda configurada para reprogramar.' },
      };
    }
    const profRows = await postgresService.query(
      `SELECT id FROM profesionales WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE`,
      [medicoCodigo, sedeEfectiva]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    if (profRows.length === 0) {
      return {
        ok: false,
        status: 409,
        error: { code: 'NO_PROFESIONAL', message: 'El profesional no tiene agenda configurada para reprogramar.' },
      };
    }
    const profesionalId = Number(profRows[0].id);

    const base = nowColombia().fecha;
    const MAX_SCAN = 30; // días calendario hacia adelante
    const dias: Array<{ fecha: string; horarios: string[] }> = [];
    for (let offset = 1; offset <= MAX_SCAN && dias.length < maxDias; offset++) {
      const { fecha, dow } = addDaysIso(base, offset);
      if (dow === 0 || dow === 6) continue; // sólo lun-vie
      const res = await this.getHorariosDisponibles(fecha, profesionalId, sedeEfectiva, modalidad);
      if (!res.ok || !res.data) continue;
      const libres = res.data.horarios.filter((s) => s.disponible).map((s) => s.hora);
      if (libres.length > 0) dias.push({ fecha, horarios: libres });
    }
    return { ok: true, status: 200, data: { dias } };
  }

  /**
   * Reasigna en lote N citas a un nuevo médico, opcionalmente cambiando la
   * fecha y hora de todas a un mismo valor. Útil cuando un médico no puede
   * atender un día y hay que redistribuir sus citas.
   *
   * Devuelve la cantidad afectada.
   */
  async reasignarBulk(
    citaIds: string[],
    sedeId: string,
    nuevoMedicoCodigo: string,
    nuevaFechaIso?: string,
    nuevaHora?: string
  ): Promise<ServiceResult<{ afectadas: number }>> {
    if (!Array.isArray(citaIds) || citaIds.length === 0) {
      return {
        ok: false,
        status: 400,
        error: { code: 'EMPTY_LIST', message: 'Debe enviar al menos un citaId.' },
      };
    }
    if (citaIds.length > 200) {
      return {
        ok: false,
        status: 400,
        error: { code: 'TOO_MANY', message: 'No se permiten más de 200 citas por bulk.' },
      };
    }

    // Verificar que el nuevo médico existe y está activo
    const profRows = await postgresService.query(
      `SELECT codigo FROM profesionales
         WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE`,
      [nuevoMedicoCodigo, sedeId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando médico destino.' } };
    }
    if (profRows.length === 0) {
      return {
        ok: false,
        status: 404,
        error: { code: 'MEDICO_NOT_FOUND', message: 'Médico destino no encontrado o inactivo.' },
      };
    }

    const sets: string[] = [`"medico" = $1`, `"_updatedDate" = NOW()`];
    const params: unknown[] = [nuevoMedicoCodigo];
    let i = 2;
    if (nuevaFechaIso) {
      sets.push(`"fechaAtencion" = $${i++}`);
      params.push(nuevaFechaIso);
    }
    if (nuevaHora) {
      sets.push(`"horaAtencion" = $${i++}`);
      params.push(nuevaHora);
    }
    params.push(sedeId);
    params.push(citaIds);

    const sql = `
      UPDATE "HistoriaClinica"
         SET ${sets.join(', ')}
         WHERE sede_id = $${i++} AND "_id" = ANY($${i}::text[])
         RETURNING "_id"
    `;
    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error reasignando citas.' } };
    }
    return { ok: true, status: 200, data: { afectadas: rows.length } };
  }
}

export default new CalendarioService();

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
  totalCitas: number;
  totalAtendidos: number;
  totalPendientes: number;
  medicosActivos: number;
  porDia: Record<string, DiaResumen>; // YYYY-MM-DD → resumen
}

export interface DiaResumen {
  total: number;
  atendidos: number;
  pendientes: number;
  porMedico: Record<string, { total: number; atendidos: number; pendientes: number }>;
}

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
}

export interface DiaDetalle {
  fecha: string; // YYYY-MM-DD
  total: number;
  atendidos: number;
  pendientes: number;
  citas: CitaListItem[];
  medicosResumen: Array<{
    medicoCodigo: string;
    nombre: string;
    rol: 'medico' | 'coach' | null;
    total: number;
    atendidos: number;
    pendientes: number;
  }>;
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

    // Agregado por (día Colombia, medico, estado).
    const sql = `
      SELECT
        TO_CHAR(("fechaAtencion"::timestamptz AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS fecha,
        COALESCE("medico", '__SIN_ASIGNAR__') AS medico_codigo,
        UPPER(COALESCE("atendido", 'PENDIENTE')) AS estado,
        COUNT(*)::int AS total
      FROM "HistoriaClinica"
      WHERE sede_id = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
        ${medicoFilter}
      GROUP BY fecha, medico_codigo, estado
      ORDER BY fecha
    `;

    const rows = await postgresService.query(sql, params);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando calendario.' } };
    }

    const porDia: Record<string, DiaResumen> = {};
    let totalCitas = 0;
    let totalAtendidos = 0;
    let totalPendientes = 0;
    const medicosSet = new Set<string>();

    for (const row of rows) {
      const fecha = String(row.fecha);
      const medico = String(row.medico_codigo);
      const estado = String(row.estado);
      const total = Number(row.total);

      if (!porDia[fecha]) {
        porDia[fecha] = { total: 0, atendidos: 0, pendientes: 0, porMedico: {} };
      }
      if (!porDia[fecha].porMedico[medico]) {
        porDia[fecha].porMedico[medico] = { total: 0, atendidos: 0, pendientes: 0 };
      }

      porDia[fecha].total += total;
      porDia[fecha].porMedico[medico].total += total;
      totalCitas += total;

      if (estado === 'ATENDIDO') {
        porDia[fecha].atendidos += total;
        porDia[fecha].porMedico[medico].atendidos += total;
        totalAtendidos += total;
      } else {
        // Cualquier estado distinto de ATENDIDO se cuenta como pendiente
        // (incluye PENDIENTE, EN PROCESO, NO CONTESTA, NULL).
        porDia[fecha].pendientes += total;
        porDia[fecha].porMedico[medico].pendientes += total;
        totalPendientes += total;
      }
      if (medico !== '__SIN_ASIGNAR__') {
        medicosSet.add(medico);
      }
    }

    return {
      ok: true,
      status: 200,
      data: {
        year,
        month,
        totalCitas,
        totalAtendidos,
        totalPendientes,
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
        "atendido", "empresa", "motivo_consulta_texto", "tipo_consulta", "sede_id"
      FROM "HistoriaClinica"
      WHERE sede_id = ANY($1::text[])
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
        UPPER(COALESCE("atendido", 'PENDIENTE')) AS estado,
        COUNT(*)::int AS total
      FROM "HistoriaClinica"
      WHERE sede_id = ANY($1::text[])
        AND "fechaAtencion" IS NOT NULL
        AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND "fechaAtencion"::timestamptz >= $2::timestamptz
        AND "fechaAtencion"::timestamptz < $3::timestamptz
      GROUP BY codigo, estado
    `;
    const resumenRows = await postgresService.query(resumenSql, [sedeIds, range.startUtc, range.endUtc]);

    const resumenMap = new Map<
      string,
      { medicoCodigo: string; total: number; atendidos: number; pendientes: number }
    >();
    if (resumenRows !== null) {
      for (const r of resumenRows) {
        const codigo = String(r.codigo);
        const estado = String(r.estado);
        const total = Number(r.total);
        let entry = resumenMap.get(codigo);
        if (!entry) {
          entry = { medicoCodigo: codigo, total: 0, atendidos: 0, pendientes: 0 };
          resumenMap.set(codigo, entry);
        }
        entry.total += total;
        if (estado === 'ATENDIDO') entry.atendidos += total;
        else entry.pendientes += total;
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
      };
    });

    medicosResumen.sort((a, b) => a.nombre.localeCompare(b.nombre));

    const total = citas.length;
    const atendidos = citas.filter((c) => (c.atendido ?? '').toUpperCase() === 'ATENDIDO').length;

    return {
      ok: true,
      status: 200,
      data: {
        fecha,
        total,
        atendidos,
        pendientes: total - atendidos,
        citas,
        medicosResumen,
      },
    };
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
    sedeId: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<HorariosDisponibles>> {
    let range;
    try {
      range = getDayRange(fecha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: msg } };
    }

    // 1) Profesional + tiempo_consulta + codigo
    const profRows = await postgresService.query(
      `SELECT id, codigo, tiempo_consulta FROM profesionales
         WHERE id = $1 AND sede_id = $2 AND activo = TRUE`,
      [profesionalId, sedeId]
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

    // 2) Día de la semana (0-6) en Colombia
    const diaSemanaUtc = new Date(range.startUtc);
    // range.startUtc fue construido como 05:00Z = 00:00 Colombia, así que el getUTCDay
    // del momento un instante DESPUÉS coincide con el día Colombia.
    const diaSemana = new Date(diaSemanaUtc.getTime() + 1000).getUTCDay();

    // 3) Rangos EFECTIVOS de disponibilidad (override por fecha > patrón semanal).
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
      `SELECT "horaAtencion"
         FROM "HistoriaClinica"
         WHERE sede_id = $1
           AND "fechaAtencion" IS NOT NULL
           AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND "fechaAtencion"::timestamptz >= $2::timestamptz
           AND "fechaAtencion"::timestamptz < $3::timestamptz
           AND "medico" = $4
           AND "horaAtencion" IS NOT NULL
           AND UPPER(COALESCE("atendido", 'PENDIENTE')) <> 'ATENDIDO'`,
      [sedeId, range.startUtc, range.endUtc, codigoMedico]
    );
    if (ocupRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando citas existentes.' } };
    }
    const ocupadas = new Set<string>();
    for (const r of ocupRows) {
      const h = String(r.horaAtencion).slice(0, 5);
      ocupadas.add(h);
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
    // Si la fecha es hoy (Colombia), descartar las franjas que ya pasaron.
    const ahora = nowColombia();
    const minVisible = fecha === ahora.fecha ? ahora.minutos : -1;

    const horarios: SlotHora[] = [];
    for (const r of rangosDisponibles) {
      const inicio = hhmmToMin(r.horaInicio);
      const fin = hhmmToMin(r.horaFin);
      for (let t = inicio; t + tiempoConsulta <= fin; t += tiempoConsulta) {
        if (t <= minVisible) continue; // franja ya pasada hoy
        const hora = minToHHMM(t);
        horarios.push({ hora, disponible: !ocupadas.has(hora) });
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

    // 0) No permitir agendar una hora que ya pasó hoy (Colombia).
    const ahora = nowColombia();
    if (fecha === ahora.fecha) {
      const [hh, mm] = horaHHMM.split(':').map(Number);
      if (hh * 60 + mm <= ahora.minutos) {
        return {
          ok: false,
          status: 422,
          error: { code: 'SLOT_PAST', message: 'La hora seleccionada ya pasó.' },
        };
      }
    }

    // 1) Citas pendientes del mismo médico ese día → ocupan slots.
    const ocupRows = await postgresService.query(
      `SELECT "horaAtencion"
         FROM "HistoriaClinica"
         WHERE sede_id = $1
           AND "fechaAtencion" IS NOT NULL
           AND "fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
           AND "fechaAtencion"::timestamptz >= $2::timestamptz
           AND "fechaAtencion"::timestamptz < $3::timestamptz
           AND "medico" = $4
           AND "horaAtencion" IS NOT NULL
           AND UPPER(COALESCE("atendido", 'PENDIENTE')) <> 'ATENDIDO'`,
      [sedeId, range.startUtc, range.endUtc, medicoCodigo]
    );
    if (ocupRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando citas existentes.' } };
    }
    const ocupadas = new Set<string>();
    for (const r of ocupRows) {
      ocupadas.add(String(r.horaAtencion).slice(0, 5));
    }
    if (ocupadas.has(horaHHMM)) {
      return {
        ok: false,
        status: 409,
        error: { code: 'SLOT_TAKEN', message: 'Ese horario ya está ocupado para este profesional.' },
      };
    }

    // 2) Profesional + tiempo_consulta (para validar contra slots de disponibilidad).
    const profRows = await postgresService.query(
      `SELECT id, tiempo_consulta FROM profesionales
         WHERE codigo = $1 AND sede_id = $2 AND activo = TRUE`,
      [medicoCodigo, sedeId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    if (profRows.length === 0) {
      // Médico legacy sin ficha de profesional → sólo anti doble-reserva.
      return { ok: true, status: 200, data: { disponible: true } };
    }
    const profesionalId = Number(profRows[0].id);
    const tiempoConsulta = Number(profRows[0].tiempo_consulta) || 30;

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

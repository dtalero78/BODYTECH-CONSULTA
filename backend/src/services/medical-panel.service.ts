/**
 * Medical Panel Service
 *
 * Este servicio consulta PostgreSQL como base de datos principal.
 * Wix queda como backup secundario.
 */

import { randomUUID } from 'crypto';
import postgresService from './postgres.service';
import { sedeFilter } from '../helpers/sede-scope';

interface PatientStats {
  programadosHoy: number;
  atendidosHoy: number;
  restantesHoy: number;
}

interface Patient {
  _id: string;
  nombres: string;
  primerNombre: string;
  primerApellido: string;
  numeroId: string;
  estado: string;
  foto: string;
  celular: string;
  fechaAtencion: Date;
  empresaListado: string;
  pvEstado?: string;
  segundoNombre?: string;
  segundoApellido?: string;
  medico?: string;
  motivoConsulta?: string;
  tipoExamen?: string;
}

interface PaginatedPatients {
  patients: Patient[];
  currentPage: number;
  totalPages: number;
  totalItems: number;
}

interface PatientDetails extends Patient {
  email?: string;
  direccion?: string;
  ciudad?: string;
  fechaNacimiento?: Date;
  genero?: string;
  tipoConsulta?: string;
  fechaConsulta?: Date;
  diagnostico?: string;
  tratamiento?: string;
}

export interface OrdenItem {
  _id: string;
  numeroId: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  celular: string;
  empresa?: string;
  codEmpresa?: string;
  tipoExamen?: string;
  examenes?: string;
  medico?: string;
  fechaAtencion?: string;
  horaAtencion?: string;
  atendido?: string;
  ciudad?: string;
  /** Timestamp de creación de la fila (`_createdDate`). Ordena el listado. */
  createdAt?: string;
  // Calidad: última evaluación (cualquier estado) ligada a esta historia.
  // Si no hay ninguna, los tres campos van null.
  calidadEvalId?: number | null;
  calidadPuntaje?: number | null; // 0..100 normalizado por el backend de calidad
  calidadEstado?:
    | 'procesando'
    | 'transcribiendo'
    | 'evaluando'
    | 'completado'
    | 'error'
    | null;
}

export interface OrdenFilters {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
  medico?: string;
  q?: string;
  /** Solo órdenes originadas en Trepsi (su `_id` empieza con `trepsi_`). */
  trepsi?: boolean;
}

export interface OrdenCreateInput {
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  numeroId: string;
  celular: string;
  empresa?: string;
  codEmpresa?: string;
  tipoExamen?: string;
  examenes?: string;
  medico: string;
  fechaAtencion: string;  // YYYY-MM-DD
  horaAtencion: string;   // HH:MM
  ciudad?: string;
}

export interface OrdenUpdateInput {
  primerNombre?: string;
  primerApellido?: string;
  celular?: string;
  empresa?: string;
  tipoExamen?: string;
  examenes?: string;
  medico?: string;
  fechaAtencion?: string; // YYYY-MM-DD
  horaAtencion?: string;  // HH:MM
  atendido?: string;
  ciudad?: string;
}

/**
 * Convierte una fecha YYYY-MM-DD a los límites del día en Colombia (UTC-5).
 */
function colombiaDay(yyyy_mm_dd: string): { start: Date; end: Date } {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, d, 5, 0, 0, 0)),
    end: new Date(Date.UTC(y, m - 1, d + 1, 4, 59, 59, 999)),
  };
}

class MedicalPanelService {
  constructor() {
    console.log('🔗 Medical Panel Service conectado a PostgreSQL');
  }

  /**
   * Obtiene las estadísticas del día para un médico específico
   */
  async getDailyStats(medicoCode: string, sedes?: string[]): Promise<PatientStats> {
    try {
      // Calcular inicio y fin del día en Colombia (UTC-5)
      const now = new Date();
      const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
      const year = colombiaTime.getUTCFullYear();
      const month = colombiaTime.getUTCMonth();
      const day = colombiaTime.getUTCDate();

      const startOfDay = new Date(Date.UTC(year, month, day, 5, 0, 0, 0)); // 00:00 Colombia = 05:00 UTC
      const endOfDay = new Date(Date.UTC(year, month, day + 1, 4, 59, 59, 999)); // 23:59:59 Colombia

      // Aislamiento por sede: las 3 queries comparten los mismos params
      // ([medicoCode, start, end] + sedes si aplica).
      const params: unknown[] = [medicoCode, startOfDay, endOfDay];
      const sf = sedeFilter(sedes, '"sede_id"', params);

      // Query para programados hoy
      const programadosResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3${sf}`,
        params
      );

      // Query para atendidos hoy (programados hoy que ya tienen fechaConsulta)
      const atendidosResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND "fechaConsulta" IS NOT NULL${sf}`,
        params
      );

      // Query para restantes hoy (programados sin fechaConsulta y que NO estén
      // en "No Contesta" — esos se ocultan de la lista del coach, así que el
      // contador de restantes debe cuadrar con la lista de getPendingPatients).
      const restantesResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND "fechaConsulta" IS NULL
         AND UPPER(COALESCE("atendido", '')) <> 'NO CONTESTA'
         AND COALESCE("pvEstado", '') <> 'No Contesta'${sf}`,
        params
      );

      return {
        programadosHoy: parseInt(programadosResult?.[0]?.count || '0'),
        atendidosHoy: parseInt(atendidosResult?.[0]?.count || '0'),
        restantesHoy: parseInt(restantesResult?.[0]?.count || '0')
      };
    } catch (error) {
      console.error('❌ Error obteniendo estadísticas de PostgreSQL:', error);
      return {
        programadosHoy: 0,
        atendidosHoy: 0,
        restantesHoy: 0
      };
    }
  }

  /**
   * Obtiene lista paginada de pacientes pendientes del día
   */
  async getPendingPatients(
    medicoCode: string,
    page: number = 0,
    pageSize: number = 10,
    sedes?: string[]
  ): Promise<PaginatedPatients> {
    try {
      // Calcular inicio y fin del día en Colombia (UTC-5)
      const now = new Date();
      const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
      const year = colombiaTime.getUTCFullYear();
      const month = colombiaTime.getUTCMonth();
      const day = colombiaTime.getUTCDate();

      const startOfDay = new Date(Date.UTC(year, month, day, 5, 0, 0, 0));
      const endOfDay = new Date(Date.UTC(year, month, day + 1, 4, 59, 59, 999));

      const offset = page * pageSize;

      // Aislamiento por sede en el WHERE (antes de LIMIT/OFFSET).
      const whereParams: unknown[] = [medicoCode, startOfDay, endOfDay];
      const sf = sedeFilter(sedes, '"sede_id"', whereParams);
      const limitIdx = whereParams.length + 1;
      const offsetIdx = whereParams.length + 2;

      // Query para obtener pacientes pendientes
      const patientsResult = await postgresService.query(
        `SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "fechaAtencion", "atendido", "pvEstado", "codEmpresa", "empresa",
                "medico", "motivoConsulta", "tipoExamen"
         FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND ("fechaConsulta" IS NULL)
         AND UPPER(COALESCE("atendido", '')) <> 'NO CONTESTA'
         AND COALESCE("pvEstado", '') <> 'No Contesta'
         AND "numeroId" NOT IN ('TEST', 'test')${sf}
         ORDER BY "fechaAtencion" ASC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        [...whereParams, pageSize, offset]
      );

      // Query para contar total
      const countResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND ("fechaConsulta" IS NULL)
         AND UPPER(COALESCE("atendido", '')) <> 'NO CONTESTA'
         AND COALESCE("pvEstado", '') <> 'No Contesta'
         AND "numeroId" NOT IN ('TEST', 'test')${sf}`,
        whereParams
      );

      const totalItems = parseInt(countResult?.[0]?.count || '0');
      const totalPages = Math.ceil(totalItems / pageSize);

      const patients: Patient[] = (patientsResult || []).map((row: any) => ({
        _id: row._id,
        nombres: `${row.primerNombre || ''} ${row.primerApellido || ''}`.trim(),
        primerNombre: row.primerNombre || '',
        segundoNombre: row.segundoNombre || '',
        primerApellido: row.primerApellido || '',
        segundoApellido: row.segundoApellido || '',
        numeroId: row.numeroId,
        estado: row.atendido || 'Pendiente',
        pvEstado: row.pvEstado || '',
        foto: '', // PostgreSQL no tiene fotos, se pueden agregar después
        celular: row.celular || '',
        fechaAtencion: row.fechaAtencion,
        empresaListado: row.codEmpresa || row.empresa || 'SIN EMPRESA',
        medico: row.medico,
        motivoConsulta: row.motivoConsulta || '',
        tipoExamen: row.tipoExamen || ''
      }));

      return {
        patients,
        currentPage: page,
        totalPages,
        totalItems
      };
    } catch (error) {
      console.error('❌ Error obteniendo pacientes pendientes de PostgreSQL:', error);
      return {
        patients: [],
        currentPage: page,
        totalPages: 0,
        totalItems: 0
      };
    }
  }

  /**
   * Busca un paciente por documento de identidad o celular
   */
  async searchPatientByDocument(searchTerm: string, sedes?: string[]): Promise<Patient | null> {
    try {
      // Aislamiento por sede: la búsqueda por documento/celular se acota a las
      // sedes del actor (un usuario clínico no ve pacientes de otra sede).
      const params: unknown[] = [searchTerm];
      const sf = sedeFilter(sedes, '"sede_id"', params);
      const result = await postgresService.query(
        `SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "fechaAtencion", "fechaConsulta", "atendido", "pvEstado", "codEmpresa",
                "empresa", "medico", "motivoConsulta", "tipoExamen"
         FROM "HistoriaClinica"
         WHERE ("numeroId" = $1 OR "celular" = $1)${sf}
         ORDER BY "fechaAtencion" DESC
         LIMIT 1`,
        params
      );

      if (!result || result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        _id: row._id,
        nombres: `${row.primerNombre || ''} ${row.primerApellido || ''}`.trim(),
        primerNombre: row.primerNombre || '',
        segundoNombre: row.segundoNombre || '',
        primerApellido: row.primerApellido || '',
        segundoApellido: row.segundoApellido || '',
        numeroId: row.numeroId,
        estado: row.atendido || 'Pendiente',
        pvEstado: row.pvEstado || '',
        foto: '',
        celular: row.celular || '',
        fechaAtencion: row.fechaAtencion,
        empresaListado: row.codEmpresa || row.empresa || 'SIN EMPRESA',
        medico: row.medico,
        motivoConsulta: row.motivoConsulta || '',
        tipoExamen: row.tipoExamen || ''
      };
    } catch (error) {
      console.error('❌ Error buscando paciente en PostgreSQL:', error);
      return null;
    }
  }

  /**
   * Marca un paciente como "No Contesta".
   *
   * IMPORTANTE: NO se cambia el "medico" — la cita debe conservar su coach
   * asignado. El estado "No Contesta" se registra en campos aparte:
   *   - "atendido" = 'NO CONTESTA'  → lo reconoce el calendario del coordinador.
   *   - "pvEstado" = 'No Contesta'  → estado usado por el panel.
   * (Antes se ponía "medico" = 'RESERVA', lo que borraba el coach; ya no.)
   */
  async markPatientAsNoAnswer(patientId: string): Promise<boolean> {
    try {
      const result = await postgresService.query(
        `UPDATE "HistoriaClinica"
         SET "pvEstado" = 'No Contesta', "atendido" = 'NO CONTESTA'
         WHERE "_id" = $1
         RETURNING "_id"`,
        [patientId]
      );

      return result !== null && result.length > 0;
    } catch (error) {
      console.error('❌ Error marcando paciente como No Contesta en PostgreSQL:', error);
      return false;
    }
  }

  /**
   * Obtiene detalles completos de un paciente
   */
  async getPatientDetails(documento: string, sedes?: string[]): Promise<PatientDetails | null> {
    try {
      const params: unknown[] = [documento];
      const sf = sedeFilter(sedes, '"sede_id"', params);
      const result = await postgresService.query(
        `SELECT * FROM "HistoriaClinica"
         WHERE "numeroId" = $1${sf}
         ORDER BY "fechaAtencion" DESC
         LIMIT 1`,
        params
      );

      if (!result || result.length === 0) {
        return null;
      }

      const row = result[0];
      return {
        _id: row._id,
        nombres: `${row.primerNombre || ''} ${row.primerApellido || ''}`.trim(),
        primerNombre: row.primerNombre || '',
        segundoNombre: row.segundoNombre || '',
        primerApellido: row.primerApellido || '',
        segundoApellido: row.segundoApellido || '',
        numeroId: row.numeroId,
        estado: row.atendido || 'Pendiente',
        pvEstado: row.pvEstado || '',
        foto: '',
        celular: row.celular || '',
        fechaAtencion: row.fechaAtencion,
        fechaConsulta: row.fechaConsulta,
        empresaListado: row.codEmpresa || row.empresa || 'SIN EMPRESA',
        medico: row.medico,
        motivoConsulta: row.motivoConsulta || '',
        tipoExamen: row.tipoExamen || '',
        email: row.email || '',
        ciudad: row.ciudad || '',
        diagnostico: row.diagnostico || '',
        tratamiento: row.tratamiento || ''
      };
    } catch (error) {
      console.error('❌ Error obteniendo detalles del paciente en PostgreSQL:', error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD de Órdenes
  // ---------------------------------------------------------------------------

  /**
   * Lista órdenes con filtros y paginación.
   */
  async listOrdenes(filters: OrdenFilters = {}): Promise<{
    ordenes: OrdenItem[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const page = filters.page ?? 0;
      const limit = filters.limit ?? 20;
      const offset = page * limit;

      const conditions: string[] = ['1=1'];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (filters.status && filters.status !== 'all') {
        conditions.push(`"atendido" = $${paramIndex++}`);
        params.push(filters.status);
      }

      if (filters.medico) {
        conditions.push(`"medico" = $${paramIndex++}`);
        params.push(filters.medico);
      }

      // `fechaAtencion` es TEXT con formatos mezclados (ISO con 'T' y offset
      // +00:00, offset -05:00, e incluso fecha sola "YYYY-MM-DD"). Comparar como
      // texto era frágil/incorrecto; casteamos a timestamptz con una guarda
      // regex (mismo patrón que calendario.service) para tolerar todos los
      // formatos y comparar en tiempo absoluto contra los límites del día Colombia.
      if (filters.from) {
        const { start } = colombiaDay(filters.from);
        conditions.push(
          `("fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND "fechaAtencion"::timestamptz >= $${paramIndex}::timestamptz)`
        );
        params.push(start);
        paramIndex++;
      }

      if (filters.to) {
        const { end } = colombiaDay(filters.to);
        conditions.push(
          `("fechaAtencion" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND "fechaAtencion"::timestamptz <= $${paramIndex}::timestamptz)`
        );
        params.push(end);
        paramIndex++;
      }

      if (filters.q) {
        const like = `%${filters.q}%`;
        conditions.push(
          `("numeroId" ILIKE $${paramIndex} OR "primerNombre" ILIKE $${paramIndex} OR "primerApellido" ILIKE $${paramIndex})`
        );
        params.push(like);
        paramIndex++;
      }

      // Solo órdenes de Trepsi: las historias creadas por la integración usan un
      // `_id` con prefijo `trepsi_` (las nativas usan UUID). Literal, sin input.
      if (filters.trepsi) {
        conditions.push(`"_id" LIKE 'trepsi\\_%'`);
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await postgresService.query(
        `SELECT COUNT(*) AS count FROM "HistoriaClinica" WHERE ${whereClause}`,
        params
      );
      const total = parseInt(countResult?.[0]?.count ?? '0', 10);

      const dataParams = [...params, limit, offset];
      // LEFT JOIN LATERAL contra consulta_evaluaciones para traer la última
      // evaluación de calidad (cualquier estado) por historia, sin abrir
      // N+1 desde el frontend. ORDER BY priorizando 'completado' sobre los
      // demás estados para que un retry fallido no oculte el último puntaje.
      const rows = await postgresService.query(
        `SELECT h."_id", h."numeroId", h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido",
                h."celular", h."empresa", h."codEmpresa", h."tipoExamen", h."examenes", h."medico",
                h."fechaAtencion", h."horaAtencion", h."atendido", h."ciudad", h."_createdDate",
                ce.id           AS calidad_eval_id,
                ce.puntaje_total AS calidad_puntaje,
                ce.estado       AS calidad_estado
         FROM "HistoriaClinica" h
         LEFT JOIN LATERAL (
           SELECT id, puntaje_total, estado
           FROM consulta_evaluaciones
           WHERE historia_id = h."_id"
           ORDER BY (estado = 'completado') DESC, created_at DESC
           LIMIT 1
         ) ce ON TRUE
         WHERE ${whereClause}
         ORDER BY h."_createdDate" DESC NULLS LAST, h."_id" DESC
         LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        dataParams
      );

      const ordenes: OrdenItem[] = (rows ?? []).map((row: Record<string, unknown>) => ({
        _id: row._id as string,
        numeroId: row.numeroId as string,
        primerNombre: (row.primerNombre as string) ?? '',
        segundoNombre: (row.segundoNombre as string) ?? undefined,
        primerApellido: (row.primerApellido as string) ?? '',
        segundoApellido: (row.segundoApellido as string) ?? undefined,
        celular: (row.celular as string) ?? '',
        empresa: (row.empresa as string) ?? undefined,
        codEmpresa: (row.codEmpresa as string) ?? undefined,
        tipoExamen: (row.tipoExamen as string) ?? undefined,
        examenes: (row.examenes as string) ?? undefined,
        medico: (row.medico as string) ?? undefined,
        fechaAtencion: row.fechaAtencion ? String(row.fechaAtencion) : undefined,
        horaAtencion: (row.horaAtencion as string) ?? undefined,
        atendido: (row.atendido as string) ?? undefined,
        ciudad: (row.ciudad as string) ?? undefined,
        createdAt:
          row._createdDate instanceof Date
            ? row._createdDate.toISOString()
            : row._createdDate
            ? String(row._createdDate)
            : undefined,
        calidadEvalId: row.calidad_eval_id != null ? Number(row.calidad_eval_id) : null,
        calidadPuntaje: row.calidad_puntaje != null ? Number(row.calidad_puntaje) : null,
        calidadEstado: (row.calidad_estado as OrdenItem['calidadEstado']) ?? null,
      }));

      return {
        ordenes,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      };
    } catch (error) {
      console.error('❌ Error listando órdenes:', error);
      throw error;
    }
  }

  /**
   * Crea una nueva orden (fila) en HistoriaClinica.
   */
  async createOrden(data: OrdenCreateInput, sedeId = 'bsl'): Promise<OrdenItem> {
    try {
      const id = randomUUID();

      // Construir timestamp Colombia combinando fecha + hora.
      // Colombia = UTC-5, por tanto UTC = hora_local + 5 h.
      const [h, min] = data.horaAtencion.split(':').map(Number);
      const [y, m, d] = data.fechaAtencion.split('-').map(Number);
      const fechaTs = new Date(Date.UTC(y, m - 1, d, h + 5, min, 0));

      const result = await postgresService.query(
        `INSERT INTO "HistoriaClinica" (
           "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
           "celular", "empresa", "codEmpresa", "tipoExamen", "examenes", "medico",
           "fechaAtencion", "horaAtencion", "atendido", "ciudad", "sede_id"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                   "celular", "empresa", "codEmpresa", "tipoExamen", "examenes", "medico",
                   "fechaAtencion", "horaAtencion", "atendido", "ciudad"`,
        [
          id,
          data.numeroId,
          data.primerNombre,
          data.segundoNombre ?? null,
          data.primerApellido,
          data.segundoApellido ?? null,
          data.celular,
          data.empresa ?? null,
          data.codEmpresa ?? null,
          data.tipoExamen ?? null,
          data.examenes ?? null,
          data.medico,
          fechaTs,
          data.horaAtencion,
          'PENDIENTE',
          data.ciudad ?? null,
          sedeId,
        ]
      );

      if (!result || result.length === 0) {
        throw new Error('INSERT no retornó fila');
      }

      const row = result[0] as Record<string, unknown>;
      return {
        _id: row._id as string,
        numeroId: row.numeroId as string,
        primerNombre: (row.primerNombre as string) ?? '',
        segundoNombre: (row.segundoNombre as string) ?? undefined,
        primerApellido: (row.primerApellido as string) ?? '',
        segundoApellido: (row.segundoApellido as string) ?? undefined,
        celular: (row.celular as string) ?? '',
        empresa: (row.empresa as string) ?? undefined,
        codEmpresa: (row.codEmpresa as string) ?? undefined,
        tipoExamen: (row.tipoExamen as string) ?? undefined,
        examenes: (row.examenes as string) ?? undefined,
        medico: (row.medico as string) ?? undefined,
        fechaAtencion: row.fechaAtencion ? String(row.fechaAtencion) : undefined,
        horaAtencion: (row.horaAtencion as string) ?? undefined,
        atendido: (row.atendido as string) ?? 'PENDIENTE',
        ciudad: (row.ciudad as string) ?? undefined,
      };
    } catch (error) {
      console.error('❌ Error creando orden:', error);
      throw error;
    }
  }

  /**
   * Datos mínimos de una cita (HistoriaClinica) para el flujo de reprogramación.
   */
  async getCitaBasics(id: string): Promise<{
    medico: string | null;
    sedeId: string;
    primerNombre: string | null;
    celular: string | null;
    fechaAtencion: string | null;
    horaAtencion: string | null;
  } | null> {
    const rows = await postgresService.query(
      `SELECT "medico", COALESCE("sede_id", 'bsl') AS sede_id, "primerNombre",
              "celular", "fechaAtencion", "horaAtencion"
         FROM "HistoriaClinica" WHERE "_id" = $1 LIMIT 1`,
      [id]
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      medico: r.medico ? String(r.medico) : null,
      sedeId: String(r.sede_id ?? 'bsl'),
      primerNombre: r.primerNombre ? String(r.primerNombre) : null,
      celular: r.celular ? String(r.celular) : null,
      fechaAtencion: r.fechaAtencion ? String(r.fechaAtencion) : null,
      horaAtencion: r.horaAtencion ? String(r.horaAtencion) : null,
    };
  }

  /**
   * Actualiza campos arbitrarios de una orden existente.
   */
  async updateOrden(id: string, fields: OrdenUpdateInput): Promise<boolean> {
    try {
      const ALLOWED_DIRECT: Array<keyof OrdenUpdateInput> = [
        'primerNombre',
        'primerApellido',
        'celular',
        'empresa',
        'tipoExamen',
        'examenes',
        'medico',
        'horaAtencion',
        'atendido',
        'ciudad',
      ];

      const sets: string[] = [];
      const vals: unknown[] = [];
      let paramIndex = 1;

      for (const key of ALLOWED_DIRECT) {
        if (fields[key] !== undefined) {
          sets.push(`"${key}" = $${paramIndex++}`);
          vals.push(fields[key]);
        }
      }

      // fechaAtencion se recalcula si viene junto con horaAtencion, o solo fecha.
      if (fields.fechaAtencion) {
        const hora = fields.horaAtencion ?? '00:00';
        const [h, min] = hora.split(':').map(Number);
        const [y, mo, d] = fields.fechaAtencion.split('-').map(Number);
        const fechaTs = new Date(Date.UTC(y, mo - 1, d, h + 5, min, 0));
        sets.push(`"fechaAtencion" = $${paramIndex++}`);
        vals.push(fechaTs);
      }

      if (sets.length === 0) {
        return true; // Nada que actualizar
      }

      vals.push(id);
      const result = await postgresService.query(
        `UPDATE "HistoriaClinica"
         SET ${sets.join(', ')}
         WHERE "_id" = $${paramIndex}
         RETURNING "_id"`,
        vals
      );

      return result !== null && result.length > 0;
    } catch (error) {
      console.error('❌ Error actualizando orden:', error);
      throw error;
    }
  }

  /**
   * Elimina una orden por su _id.
   */
  async deleteOrden(id: string): Promise<boolean> {
    try {
      const result = await postgresService.query(
        `DELETE FROM "HistoriaClinica" WHERE "_id" = $1 RETURNING "_id"`,
        [id]
      );
      return result !== null && result.length > 0;
    } catch (error) {
      console.error('❌ Error eliminando orden:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Utilidades de sala y teléfono
  // ---------------------------------------------------------------------------

  /**
   * Genera un nombre de sala para videollamada
   */
  generateRoomName(_medicoCode: string, _patientId: string): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `consulta-${timestamp}-${random}`;
  }

  /**
   * Formatea número telefónico con prefijo internacional
   */
  formatPhoneNumber(phone: string): string {
    const cleaned = phone.replace(/[\s\(\)\+\-]/g, '');

    if (cleaned.startsWith('57') && cleaned.length >= 10) {
      return '+' + cleaned;
    }

    if (cleaned.length === 10 && cleaned.startsWith('3')) {
      return '+57' + cleaned;
    }

    const countryCodes = ['1', '52', '54', '55', '34', '44', '49', '33'];
    for (const code of countryCodes) {
      if (cleaned.startsWith(code)) {
        return '+' + cleaned;
      }
    }

    return '+57' + cleaned;
  }
}

export default new MedicalPanelService();
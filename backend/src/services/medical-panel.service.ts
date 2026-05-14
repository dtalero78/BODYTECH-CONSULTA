/**
 * Medical Panel Service
 *
 * Este servicio consulta PostgreSQL como base de datos principal.
 * Wix queda como backup secundario.
 */

import { randomUUID } from 'crypto';
import postgresService from './postgres.service';

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
}

export interface OrdenFilters {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  status?: string;
  medico?: string;
  q?: string;
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
  async getDailyStats(medicoCode: string): Promise<PatientStats> {
    try {
      // Calcular inicio y fin del día en Colombia (UTC-5)
      const now = new Date();
      const colombiaTime = new Date(now.getTime() - (5 * 60 * 60 * 1000));
      const year = colombiaTime.getUTCFullYear();
      const month = colombiaTime.getUTCMonth();
      const day = colombiaTime.getUTCDate();

      const startOfDay = new Date(Date.UTC(year, month, day, 5, 0, 0, 0)); // 00:00 Colombia = 05:00 UTC
      const endOfDay = new Date(Date.UTC(year, month, day + 1, 4, 59, 59, 999)); // 23:59:59 Colombia

      // Query para programados hoy
      const programadosResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3`,
        [medicoCode, startOfDay, endOfDay]
      );

      // Query para atendidos hoy (programados hoy que ya tienen fechaConsulta)
      const atendidosResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND "fechaConsulta" IS NOT NULL`,
        [medicoCode, startOfDay, endOfDay]
      );

      // Query para restantes hoy (programados sin fechaConsulta)
      const restantesResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND "fechaConsulta" IS NULL`,
        [medicoCode, startOfDay, endOfDay]
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
    pageSize: number = 10
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
         AND "numeroId" NOT IN ('TEST', 'test')
         ORDER BY "fechaAtencion" ASC
         LIMIT $4 OFFSET $5`,
        [medicoCode, startOfDay, endOfDay, pageSize, offset]
      );

      // Query para contar total
      const countResult = await postgresService.query(
        `SELECT COUNT(*) as count FROM "HistoriaClinica"
         WHERE "medico" = $1
         AND "fechaAtencion" >= $2
         AND "fechaAtencion" <= $3
         AND ("fechaConsulta" IS NULL)
         AND "numeroId" NOT IN ('TEST', 'test')`,
        [medicoCode, startOfDay, endOfDay]
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
  async searchPatientByDocument(searchTerm: string): Promise<Patient | null> {
    try {
      // Buscar por numeroId o celular
      const result = await postgresService.query(
        `SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "fechaAtencion", "fechaConsulta", "atendido", "pvEstado", "codEmpresa",
                "empresa", "medico", "motivoConsulta", "tipoExamen"
         FROM "HistoriaClinica"
         WHERE "numeroId" = $1 OR "celular" = $1
         ORDER BY "fechaAtencion" DESC
         LIMIT 1`,
        [searchTerm]
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
   * Marca un paciente como "No Contesta"
   */
  async markPatientAsNoAnswer(patientId: string): Promise<boolean> {
    try {
      const result = await postgresService.query(
        `UPDATE "HistoriaClinica"
         SET "pvEstado" = 'No Contesta', "medico" = 'RESERVA'
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
  async getPatientDetails(documento: string): Promise<PatientDetails | null> {
    try {
      const result = await postgresService.query(
        `SELECT * FROM "HistoriaClinica"
         WHERE "numeroId" = $1
         ORDER BY "fechaAtencion" DESC
         LIMIT 1`,
        [documento]
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

      if (filters.from) {
        const { start } = colombiaDay(filters.from);
        conditions.push(`"fechaAtencion" >= $${paramIndex++}`);
        params.push(start);
      }

      if (filters.to) {
        const { end } = colombiaDay(filters.to);
        conditions.push(`"fechaAtencion" <= $${paramIndex++}`);
        params.push(end);
      }

      if (filters.q) {
        const like = `%${filters.q}%`;
        conditions.push(
          `("numeroId" ILIKE $${paramIndex} OR "primerNombre" ILIKE $${paramIndex} OR "primerApellido" ILIKE $${paramIndex})`
        );
        params.push(like);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      const countResult = await postgresService.query(
        `SELECT COUNT(*) AS count FROM "HistoriaClinica" WHERE ${whereClause}`,
        params
      );
      const total = parseInt(countResult?.[0]?.count ?? '0', 10);

      const dataParams = [...params, limit, offset];
      const rows = await postgresService.query(
        `SELECT "_id", "numeroId", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido",
                "celular", "empresa", "codEmpresa", "tipoExamen", "examenes", "medico",
                "fechaAtencion", "horaAtencion", "atendido", "ciudad"
         FROM "HistoriaClinica"
         WHERE ${whereClause}
         ORDER BY "fechaAtencion" DESC NULLS LAST
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
  async createOrden(data: OrdenCreateInput): Promise<OrdenItem> {
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
           "fechaAtencion", "horaAtencion", "atendido", "ciudad"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
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
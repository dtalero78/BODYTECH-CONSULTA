// ============================================================================
// trepsi.service — Integración API Trepsi <-> Bodytech.
//
// Especificación: /Especificacion_Integracion_Trepsi_Bodytech.pdf (v2.1)
//
// Persistencia:
//   - trepsi_appointments: ciclo de vida de la cita (cita_id PK, estado, fecha
//     atención, médico, payload crudo, vínculo a historia_id).
//   - HistoriaClinica: se crea/actualiza la fila con datos del paciente +
//     motivo de consulta + médico. Identificada por _id = generado UUID.
//
// Idempotencia: cita_id es la llave. Reenvíos no duplican. Operaciones son
// best-effort: si Postgres falla, devolvemos DB_ERROR (500) y el cliente debe
// reintentar.
// ============================================================================

import postgresService from './postgres.service';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Tipos del contrato (espejo de la spec)
// ---------------------------------------------------------------------------

export interface TrepsiMedico {
  codigo: string;
  nombre?: string;
  especialidad?: string;
}

export interface TrepsiPaciente {
  numeroId: string;
  tipoDocumento: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  fechaNacimiento: string; // YYYY-MM-DD
  sexo?: string;
  celular: string;
  email?: string;
  direccion?: string;
  ciudad?: string;
  eps?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TrepsiHistoriaClinica = Record<string, any> & {
  motivoConsulta: string;
  consentimientoInformado: boolean;
};

export interface CreateAppointmentInput {
  citaId: string;
  fechaAtencion: string; // ISO 8601 con offset
  duracionMinutos?: number;
  medico: TrepsiMedico;
  paciente: TrepsiPaciente;
  historiaClinica: TrepsiHistoriaClinica;
  tipoConsulta?: string;
  sede?: string;
  observaciones?: string;
}

export interface ScheduleInput {
  fechaAtencion?: string;
  duracionMinutos?: number;
  medico?: TrepsiMedico;
  motivo?: string;
}

export type AppointmentStatus =
  | 'scheduled'
  | 'in_progress'
  | 'attended'
  | 'cancelled'
  | 'no_show';

export interface AppointmentRecord {
  citaId: string;
  historiaClinicaId: string;
  estado: AppointmentStatus;
  fechaAtencion: string | null;
  duracionMinutos: number | null;
  medicoCodigo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceResult<T> {
  ok: boolean;
  status: number; // HTTP a usar
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateHistoriaId(): string {
  return `trepsi_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function isFechaInPast(iso: string): boolean {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return t < Date.now() - 60 * 1000; // 1 min de gracia para clock skew
}

function rowToRecord(row: Record<string, unknown>): AppointmentRecord {
  return {
    citaId: String(row.cita_id),
    historiaClinicaId: String(row.historia_id),
    estado: String(row.estado) as AppointmentStatus,
    fechaAtencion:
      row.fecha_atencion instanceof Date
        ? (row.fecha_atencion as Date).toISOString()
        : row.fecha_atencion
          ? String(row.fecha_atencion)
          : null,
    duracionMinutos: row.duracion_minutos != null ? Number(row.duracion_minutos) : null,
    medicoCodigo: row.medico_codigo ? String(row.medico_codigo) : null,
    createdAt:
      row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? (row.updated_at as Date).toISOString()
        : String(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

class TrepsiService {
  /**
   * Crea (o devuelve, si ya existe) la cita + historia clínica.
   * Idempotente por cita_id.
   */
  async createAppointment(
    input: CreateAppointmentInput
  ): Promise<ServiceResult<AppointmentRecord>> {
    if (!input.historiaClinica?.consentimientoInformado) {
      return {
        ok: false,
        status: 422,
        error: {
          code: 'CONSENT_REQUIRED',
          message: 'El campo historiaClinica.consentimientoInformado debe ser true.',
        },
      };
    }

    if (isFechaInPast(input.fechaAtencion)) {
      return {
        ok: false,
        status: 422,
        error: {
          code: 'FECHA_IN_PAST',
          message: 'fechaAtencion no puede estar en el pasado.',
        },
      };
    }

    // Idempotencia: si ya existe la cita, devolvemos 200 con el recurso actual.
    const existing = await postgresService.query(
      'SELECT * FROM trepsi_appointments WHERE cita_id = $1',
      [input.citaId]
    );
    if (existing === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' },
      };
    }
    if (existing.length > 0) {
      return {
        ok: true,
        status: 200,
        data: rowToRecord(existing[0]),
      };
    }

    // Crear nueva historia clínica.
    const historiaId = generateHistoriaId();
    const motivo = String(input.historiaClinica.motivoConsulta ?? '').slice(0, 4000);

    const hcInsert = await postgresService.query(
      `INSERT INTO "HistoriaClinica" (
         "_id",
         "_createdDate",
         "_updatedDate",
         "numeroId",
         "primerNombre",
         "segundoNombre",
         "primerApellido",
         "segundoApellido",
         "celular",
         "email",
         "medico",
         "ciudad",
         "eps",
         "fechaAtencion",
         "fecha_nacimiento",
         "motivoConsulta",
         "motivo_consulta_texto",
         "tipo_consulta",
         "atendido",
         "sede_id"
       ) VALUES (
         $1, NOW(), NOW(),
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'PENDIENTE', 'trepsi'
       ) RETURNING "_id"`,
      [
        historiaId,
        input.paciente.numeroId,
        input.paciente.primerNombre,
        input.paciente.segundoNombre ?? null,
        input.paciente.primerApellido,
        input.paciente.segundoApellido ?? null,
        input.paciente.celular,
        input.paciente.email ?? null,
        input.medico.codigo,
        input.paciente.ciudad ?? null,
        input.paciente.eps ?? null,
        input.fechaAtencion,
        input.paciente.fechaNacimiento,
        motivo,
        motivo,
        input.tipoConsulta ?? null,
      ]
    );

    if (hcInsert === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error creando historia clínica.' },
      };
    }

    // Insertar la cita Trepsi + payload crudo para auditoría / reconciliación.
    const apptInsert = await postgresService.query(
      `INSERT INTO trepsi_appointments (
         cita_id,
         historia_id,
         estado,
         fecha_atencion,
         duracion_minutos,
         medico_codigo,
         medico_nombre,
         tipo_consulta,
         sede_origen,
         observaciones,
         payload,
         created_at,
         updated_at
       ) VALUES ($1, $2, 'scheduled', $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       RETURNING *`,
      [
        input.citaId,
        historiaId,
        input.fechaAtencion,
        input.duracionMinutos ?? 30,
        input.medico.codigo,
        input.medico.nombre ?? null,
        input.tipoConsulta ?? null,
        input.sede ?? null,
        input.observaciones ?? null,
        JSON.stringify(input),
      ]
    );

    if (apptInsert === null || apptInsert.length === 0) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error registrando la cita.' },
      };
    }

    return {
      ok: true,
      status: 201,
      data: rowToRecord(apptInsert[0]),
    };
  }

  /**
   * Actualiza la fecha de atención y/o el médico de una cita existente.
   */
  async reschedule(
    citaId: string,
    input: ScheduleInput
  ): Promise<ServiceResult<AppointmentRecord>> {
    if (input.fechaAtencion && isFechaInPast(input.fechaAtencion)) {
      return {
        ok: false,
        status: 422,
        error: {
          code: 'FECHA_IN_PAST',
          message: 'fechaAtencion no puede estar en el pasado.',
        },
      };
    }

    const existing = await postgresService.query(
      'SELECT * FROM trepsi_appointments WHERE cita_id = $1',
      [citaId]
    );
    if (existing === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' },
      };
    }
    if (existing.length === 0) {
      return {
        ok: false,
        status: 404,
        error: { code: 'NOT_FOUND', message: 'citaId no encontrada.' },
      };
    }
    if (existing[0].estado === 'cancelled') {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'ALREADY_CANCELLED',
          message: 'La cita está cancelada y no puede reprogramarse.',
        },
      };
    }

    const historiaId = String(existing[0].historia_id);

    // Build dynamic UPDATE only with provided fields.
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [];
    let i = 1;

    if (input.fechaAtencion) {
      sets.push(`fecha_atencion = $${i++}`);
      params.push(input.fechaAtencion);
    }
    if (input.duracionMinutos != null) {
      sets.push(`duracion_minutos = $${i++}`);
      params.push(input.duracionMinutos);
    }
    if (input.medico?.codigo) {
      sets.push(`medico_codigo = $${i++}`);
      params.push(input.medico.codigo);
      sets.push(`medico_nombre = $${i++}`);
      params.push(input.medico.nombre ?? null);
    }
    if (input.motivo) {
      sets.push(`reschedule_motivo = $${i++}`);
      params.push(input.motivo);
    }

    params.push(citaId);
    const sql = `UPDATE trepsi_appointments SET ${sets.join(', ')} WHERE cita_id = $${i} RETURNING *`;

    const updated = await postgresService.query(sql, params);
    if (updated === null || updated.length === 0) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error reprogramando la cita.' },
      };
    }

    // Reflejar el cambio en HistoriaClinica (médico / fechaAtencion).
    const hcSets: string[] = ['"_updatedDate" = NOW()'];
    const hcParams: unknown[] = [];
    let j = 1;
    if (input.fechaAtencion) {
      hcSets.push(`"fechaAtencion" = $${j++}`);
      hcParams.push(input.fechaAtencion);
    }
    if (input.medico?.codigo) {
      hcSets.push(`"medico" = $${j++}`);
      hcParams.push(input.medico.codigo);
    }
    if (hcParams.length > 0) {
      hcParams.push(historiaId);
      await postgresService.query(
        `UPDATE "HistoriaClinica" SET ${hcSets.join(', ')} WHERE "_id" = $${j}`,
        hcParams
      );
    }

    return { ok: true, status: 200, data: rowToRecord(updated[0]) };
  }

  /**
   * Cancela una cita. Idempotente: cancelar dos veces devuelve el mismo estado.
   */
  async cancel(citaId: string): Promise<ServiceResult<AppointmentRecord>> {
    const existing = await postgresService.query(
      'SELECT * FROM trepsi_appointments WHERE cita_id = $1',
      [citaId]
    );
    if (existing === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' },
      };
    }
    if (existing.length === 0) {
      return {
        ok: false,
        status: 404,
        error: { code: 'NOT_FOUND', message: 'citaId no encontrada.' },
      };
    }

    if (existing[0].estado === 'cancelled') {
      return { ok: true, status: 200, data: rowToRecord(existing[0]) };
    }

    const updated = await postgresService.query(
      `UPDATE trepsi_appointments
         SET estado = 'cancelled', updated_at = NOW()
         WHERE cita_id = $1
         RETURNING *`,
      [citaId]
    );
    if (updated === null || updated.length === 0) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error cancelando la cita.' },
      };
    }
    return { ok: true, status: 200, data: rowToRecord(updated[0]) };
  }

  async get(citaId: string): Promise<ServiceResult<AppointmentRecord>> {
    const rows = await postgresService.query(
      'SELECT * FROM trepsi_appointments WHERE cita_id = $1',
      [citaId]
    );
    if (rows === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error consultando base de datos.' },
      };
    }
    if (rows.length === 0) {
      return {
        ok: false,
        status: 404,
        error: { code: 'NOT_FOUND', message: 'citaId no encontrada.' },
      };
    }
    return { ok: true, status: 200, data: rowToRecord(rows[0]) };
  }
}

export default new TrepsiService();

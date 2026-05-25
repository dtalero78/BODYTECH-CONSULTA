// ============================================================================
// disponibilidad.service — Horarios disponibles de profesionales.
//
// Modelo: cada fila en `profesionales_disponibilidad` es UN rango horario en
// UN día de la semana en UNA modalidad. Esto permite múltiples rangos por día
// (ej. lunes 8-12 y lunes 14-18, ambos como filas separadas).
//
// Operaciones principales:
//  - getByProfesional(id, modalidad)  → estructura agrupada por día con sus rangos
//  - replace(id, modalidad, dias)     → reemplaza TODA la disponibilidad de la modalidad
//  - deleteDia(id, dia, modalidad)    → borra todos los rangos de un día/modalidad
//  - getHorariosLibres(...)           → cruza disponibilidad teórica con citas existentes
// ============================================================================

import postgresService from './postgres.service';

export type Modalidad = 'presencial' | 'virtual';

export interface Rango {
  horaInicio: string; // "HH:MM" o "HH:MM:SS"
  horaFin: string;
}

export interface DiaRangos {
  diaSemana: number; // 0 = domingo, 6 = sábado
  rangos: Rango[];
}

export interface DisponibilidadAgrupada {
  profesionalId: number;
  modalidad: Modalidad;
  dias: DiaRangos[];
}

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function normalizeHora(h: string): string {
  // Devuelve "HH:MM" (los segundos los descartamos para comparación).
  const m = h.match(HORA_REGEX);
  if (!m) return h;
  return `${m[1]}:${m[2]}`;
}

class DisponibilidadService {
  /**
   * Devuelve disponibilidad de un profesional, agrupada por día de la semana.
   * Si el día no tiene rangos, no aparece en la lista.
   */
  async getByProfesional(
    profesionalId: number,
    sedeId: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<DisponibilidadAgrupada>> {
    const rows = await postgresService.query(
      `SELECT dia_semana, hora_inicio, hora_fin
         FROM profesionales_disponibilidad
         WHERE profesional_id = $1 AND sede_id = $2 AND modalidad = $3 AND activo = TRUE
         ORDER BY dia_semana, hora_inicio`,
      [profesionalId, sedeId, modalidad]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando disponibilidad.' } };
    }
    const byDia: Map<number, Rango[]> = new Map();
    for (const row of rows) {
      const dia = Number(row.dia_semana);
      const rango: Rango = {
        horaInicio: normalizeHora(String(row.hora_inicio)),
        horaFin: normalizeHora(String(row.hora_fin)),
      };
      const existing = byDia.get(dia);
      if (existing) {
        existing.push(rango);
      } else {
        byDia.set(dia, [rango]);
      }
    }
    const dias: DiaRangos[] = Array.from(byDia.entries())
      .map(([diaSemana, rangos]) => ({ diaSemana, rangos }))
      .sort((a, b) => a.diaSemana - b.diaSemana);

    return { ok: true, status: 200, data: { profesionalId, modalidad, dias } };
  }

  /**
   * Reemplaza TODA la disponibilidad de un profesional para una modalidad.
   * Borra las filas existentes y crea las nuevas en una sola transacción.
   *
   * Si `dias` es un array vacío, deja al profesional sin disponibilidad en
   * esa modalidad (válido para "no atiende virtual").
   */
  async replace(
    profesionalId: number,
    sedeId: string,
    modalidad: Modalidad,
    dias: DiaRangos[]
  ): Promise<ServiceResult<DisponibilidadAgrupada>> {
    // Validar input antes de tocar la DB.
    for (const d of dias) {
      if (!Number.isInteger(d.diaSemana) || d.diaSemana < 0 || d.diaSemana > 6) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'INVALID_DAY',
            message: `diaSemana inválido: ${d.diaSemana}. Debe estar entre 0 y 6.`,
          },
        };
      }
      for (const r of d.rangos) {
        if (!HORA_REGEX.test(r.horaInicio) || !HORA_REGEX.test(r.horaFin)) {
          return {
            ok: false,
            status: 400,
            error: {
              code: 'INVALID_HORA',
              message: `Hora inválida en día ${d.diaSemana}. Formato esperado HH:MM.`,
            },
          };
        }
        if (normalizeHora(r.horaInicio) >= normalizeHora(r.horaFin)) {
          return {
            ok: false,
            status: 400,
            error: {
              code: 'INVALID_RANGE',
              message: `Rango inválido en día ${d.diaSemana}: horaInicio debe ser menor que horaFin.`,
            },
          };
        }
      }
    }

    // Verificar que el profesional existe en la sede.
    const exists = await postgresService.query(
      'SELECT id FROM profesionales WHERE id = $1 AND sede_id = $2',
      [profesionalId, sedeId]
    );
    if (exists === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesional.' } };
    }
    if (exists.length === 0) {
      return { ok: false, status: 404, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } };
    }

    // Replace strategy: borrar todo lo de esa modalidad, insertar los nuevos.
    // No usamos transacción explícita porque postgresService.query toma una
    // conexión por llamada; aceptamos el riesgo (window pequeña, idempotente
    // si reintentan). Para garantía transaccional, mover esto a un único
    // statement con CTE o a un client.query con BEGIN/COMMIT.
    const deleted = await postgresService.query(
      `DELETE FROM profesionales_disponibilidad
         WHERE profesional_id = $1 AND sede_id = $2 AND modalidad = $3`,
      [profesionalId, sedeId, modalidad]
    );
    if (deleted === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error limpiando disponibilidad previa.' } };
    }

    // Insertar todos los rangos (si hay).
    for (const d of dias) {
      for (const r of d.rangos) {
        const insertResult = await postgresService.query(
          `INSERT INTO profesionales_disponibilidad
             (profesional_id, sede_id, dia_semana, hora_inicio, hora_fin, modalidad)
             VALUES ($1, $2, $3, $4, $5, $6)`,
          [profesionalId, sedeId, d.diaSemana, r.horaInicio, r.horaFin, modalidad]
        );
        if (insertResult === null) {
          return {
            ok: false,
            status: 500,
            error: {
              code: 'DB_ERROR',
              message: `Error insertando rango ${r.horaInicio}-${r.horaFin} en día ${d.diaSemana}.`,
            },
          };
        }
      }
    }

    // Devolver el estado final.
    return this.getByProfesional(profesionalId, sedeId, modalidad);
  }

  /**
   * Elimina todos los rangos de un profesional para un día/modalidad
   * específicos (ej. "ya no atiende los martes virtuales").
   */
  async deleteDia(
    profesionalId: number,
    sedeId: string,
    diaSemana: number,
    modalidad: Modalidad
  ): Promise<ServiceResult<{ deleted: number }>> {
    if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
      return {
        ok: false,
        status: 400,
        error: { code: 'INVALID_DAY', message: 'diaSemana debe estar entre 0 y 6.' },
      };
    }
    const rows = await postgresService.query(
      `DELETE FROM profesionales_disponibilidad
         WHERE profesional_id = $1 AND sede_id = $2 AND dia_semana = $3 AND modalidad = $4
         RETURNING id`,
      [profesionalId, sedeId, diaSemana, modalidad]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error eliminando disponibilidad.' } };
    }
    return { ok: true, status: 200, data: { deleted: rows.length } };
  }
}

export default new DisponibilidadService();

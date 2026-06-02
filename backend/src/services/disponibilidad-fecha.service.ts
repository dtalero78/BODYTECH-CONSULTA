// ============================================================================
// disponibilidad-fecha.service — Override de disponibilidad por FECHA puntual.
//
// Modelo: cada fila en `profesionales_disponibilidad_fecha` representa el
// horario de UN profesional en UNA fecha concreta y UNA modalidad. Permite que
// el coordinador ajuste un día puntual (ej. "este miércoles 3 de junio") sin
// alterar el patrón semanal recurrente (`profesionales_disponibilidad`).
//
// Semántica del override (existe ⟺ hay ≥1 fila para prof+sede+fecha+modalidad):
//   - override con horas → N filas con hora_inicio/hora_fin y bloqueado=false.
//   - override de bloqueo (día libre) → 1 fila centinela bloqueado=true, horas NULL.
//   - sin override (ninguna fila) → se usa el patrón semanal.
//
// Operaciones principales:
//   - getByFecha(...)          → estado del override de un profesional en una fecha
//   - replaceByFecha(...)      → reemplaza el override de esa fecha/modalidad
//   - clearByFecha(...)        → elimina el override (revierte al patrón semanal)
//   - getRangosEfectivos(...)  → rangos reales del día (override > semanal)
//   - getDiaResumen(...)       → estado de TODOS los profesionales de la sede ese día
// ============================================================================

import postgresService from './postgres.service';

export type Modalidad = 'presencial' | 'virtual';

export interface Rango {
  horaInicio: string; // "HH:MM"
  horaFin: string;
}

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string };
}

export interface DisponibilidadFecha {
  profesionalId: number;
  fecha: string; // YYYY-MM-DD
  modalidad: Modalidad;
  overridden: boolean; // hay override explícito para esta fecha
  bloqueado: boolean; // override de "no disponible este día"
  rangos: Rango[]; // rangos del override (vacío si bloqueado o sin override)
}

export interface RangosEfectivos {
  rangos: Rango[];
  source: 'override' | 'weekly';
  bloqueado: boolean;
}

export interface DiaResumenProfesional {
  profesionalId: number;
  codigo: string;
  nombre: string;
  rol: 'medico' | 'coach' | null;
  tiempoConsulta: number;
  overridden: boolean;
  bloqueado: boolean;
  rangos: Rango[];
  source: 'override' | 'weekly';
}

const FECHA_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const HORA_REGEX = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function normalizeHora(h: string): string {
  const m = h.match(HORA_REGEX);
  if (!m) return h;
  return `${m[1]}:${m[2]}`;
}

/**
 * Día de la semana (0=Dom .. 6=Sáb) para una fecha YYYY-MM-DD. Usa mediodía UTC
 * para evitar bordes de DST/zona horaria — el día de la semana de una fecha
 * calendario es independiente de la zona.
 */
function diaSemanaDeFecha(fechaIso: string): number {
  const m = fechaIso.match(FECHA_REGEX);
  if (!m) return -1;
  const [y, mo, d] = fechaIso.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)).getUTCDay();
}

class DisponibilidadFechaService {
  /**
   * Lee las filas crudas del override de una fecha/modalidad para un profesional.
   * Devuelve null en error de DB.
   */
  private async fetchOverrideRows(
    profesionalId: number,
    sedeId: string,
    fecha: string,
    modalidad: Modalidad
  ): Promise<Array<{ hora_inicio: string | null; hora_fin: string | null; bloqueado: boolean }> | null> {
    const rows = await postgresService.query(
      `SELECT TO_CHAR(hora_inicio, 'HH24:MI') AS hora_inicio,
              TO_CHAR(hora_fin,    'HH24:MI') AS hora_fin,
              bloqueado
         FROM profesionales_disponibilidad_fecha
         WHERE profesional_id = $1 AND sede_id = $2 AND fecha = $3 AND modalidad = $4
         ORDER BY hora_inicio NULLS FIRST`,
      [profesionalId, sedeId, fecha, modalidad]
    );
    if (rows === null) return null;
    return rows as Array<{ hora_inicio: string | null; hora_fin: string | null; bloqueado: boolean }>;
  }

  /**
   * Estado del override de un profesional en una fecha/modalidad concreta.
   */
  async getByFecha(
    profesionalId: number,
    sedeId: string,
    fecha: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<DisponibilidadFecha>> {
    if (!FECHA_REGEX.test(fecha)) {
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: 'fecha debe ser YYYY-MM-DD.' } };
    }
    const rows = await this.fetchOverrideRows(profesionalId, sedeId, fecha, modalidad);
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando disponibilidad por fecha.' } };
    }
    const bloqueado = rows.some((r) => r.bloqueado);
    const rangos: Rango[] = rows
      .filter((r) => !r.bloqueado && r.hora_inicio && r.hora_fin)
      .map((r) => ({ horaInicio: normalizeHora(String(r.hora_inicio)), horaFin: normalizeHora(String(r.hora_fin)) }));
    return {
      ok: true,
      status: 200,
      data: { profesionalId, fecha, modalidad, overridden: rows.length > 0, bloqueado, rangos },
    };
  }

  /**
   * Reemplaza el override de un profesional para una fecha/modalidad.
   *  - bloqueado=true → inserta 1 fila centinela (día libre), ignora rangos.
   *  - bloqueado=false + rangos → inserta los rangos.
   *  - bloqueado=false + rangos vacío → solo borra (revierte al patrón semanal).
   */
  async replaceByFecha(
    profesionalId: number,
    sedeId: string,
    fecha: string,
    modalidad: Modalidad,
    payload: { bloqueado: boolean; rangos: Rango[] }
  ): Promise<ServiceResult<DisponibilidadFecha>> {
    if (!FECHA_REGEX.test(fecha)) {
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: 'fecha debe ser YYYY-MM-DD.' } };
    }

    const bloqueado = !!payload.bloqueado;
    const rangos = Array.isArray(payload.rangos) ? payload.rangos : [];

    // Validar rangos solo si no está bloqueado.
    if (!bloqueado) {
      for (const r of rangos) {
        if (!HORA_REGEX.test(r.horaInicio) || !HORA_REGEX.test(r.horaFin)) {
          return { ok: false, status: 400, error: { code: 'INVALID_HORA', message: 'Hora inválida. Formato esperado HH:MM.' } };
        }
        if (normalizeHora(r.horaInicio) >= normalizeHora(r.horaFin)) {
          return { ok: false, status: 400, error: { code: 'INVALID_RANGE', message: 'horaInicio debe ser menor que horaFin.' } };
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

    // Replace strategy: borrar el override previo de esa fecha/modalidad, insertar el nuevo.
    const deleted = await postgresService.query(
      `DELETE FROM profesionales_disponibilidad_fecha
         WHERE profesional_id = $1 AND sede_id = $2 AND fecha = $3 AND modalidad = $4`,
      [profesionalId, sedeId, fecha, modalidad]
    );
    if (deleted === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error limpiando override previo.' } };
    }

    if (bloqueado) {
      const ins = await postgresService.query(
        `INSERT INTO profesionales_disponibilidad_fecha
           (profesional_id, sede_id, fecha, hora_inicio, hora_fin, modalidad, bloqueado)
           VALUES ($1, $2, $3, NULL, NULL, $4, TRUE)`,
        [profesionalId, sedeId, fecha, modalidad]
      );
      if (ins === null) {
        return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error guardando bloqueo del día.' } };
      }
    } else {
      for (const r of rangos) {
        const ins = await postgresService.query(
          `INSERT INTO profesionales_disponibilidad_fecha
             (profesional_id, sede_id, fecha, hora_inicio, hora_fin, modalidad, bloqueado)
             VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
          [profesionalId, sedeId, fecha, r.horaInicio, r.horaFin, modalidad]
        );
        if (ins === null) {
          return { ok: false, status: 500, error: { code: 'DB_ERROR', message: `Error insertando rango ${r.horaInicio}-${r.horaFin}.` } };
        }
      }
    }

    return this.getByFecha(profesionalId, sedeId, fecha, modalidad);
  }

  /**
   * Elimina el override de una fecha/modalidad → el día vuelve al patrón semanal.
   */
  async clearByFecha(
    profesionalId: number,
    sedeId: string,
    fecha: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<{ deleted: number }>> {
    if (!FECHA_REGEX.test(fecha)) {
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: 'fecha debe ser YYYY-MM-DD.' } };
    }
    const rows = await postgresService.query(
      `DELETE FROM profesionales_disponibilidad_fecha
         WHERE profesional_id = $1 AND sede_id = $2 AND fecha = $3 AND modalidad = $4
         RETURNING id`,
      [profesionalId, sedeId, fecha, modalidad]
    );
    if (rows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error eliminando override.' } };
    }
    return { ok: true, status: 200, data: { deleted: rows.length } };
  }

  /**
   * Rangos EFECTIVOS de un profesional en una fecha: si hay override, mandan sus
   * rangos (vacío si bloqueado); si no, los rangos semanales del `diaSemana`.
   *
   * Pieza central que conecta el override con el agendamiento — la usan
   * `getHorariosDisponibles` y `validarSlotDisponible` en calendario.service.
   *
   * El caller debe pasar el `diaSemana` (0-6) calculado para esa fecha en
   * Colombia, para no divergir del cálculo de calendario.service.
   */
  async getRangosEfectivos(
    profesionalId: number,
    sedeId: string,
    fecha: string,
    diaSemana: number,
    modalidad: Modalidad
  ): Promise<ServiceResult<RangosEfectivos>> {
    const overrideRows = await this.fetchOverrideRows(profesionalId, sedeId, fecha, modalidad);
    if (overrideRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando override por fecha.' } };
    }

    if (overrideRows.length > 0) {
      const bloqueado = overrideRows.some((r) => r.bloqueado);
      const rangos: Rango[] = bloqueado
        ? []
        : overrideRows
            .filter((r) => r.hora_inicio && r.hora_fin)
            .map((r) => ({ horaInicio: normalizeHora(String(r.hora_inicio)), horaFin: normalizeHora(String(r.hora_fin)) }));
      return { ok: true, status: 200, data: { rangos, source: 'override', bloqueado } };
    }

    // Sin override → patrón semanal.
    const weeklyRows = await postgresService.query(
      `SELECT TO_CHAR(hora_inicio, 'HH24:MI') AS hora_inicio,
              TO_CHAR(hora_fin,    'HH24:MI') AS hora_fin
         FROM profesionales_disponibilidad
         WHERE profesional_id = $1 AND sede_id = $2 AND modalidad = $3
           AND dia_semana = $4 AND activo = TRUE
         ORDER BY hora_inicio`,
      [profesionalId, sedeId, modalidad, diaSemana]
    );
    if (weeklyRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando disponibilidad semanal.' } };
    }
    const rangos: Rango[] = weeklyRows.map((r) => ({
      horaInicio: normalizeHora(String(r.hora_inicio)),
      horaFin: normalizeHora(String(r.hora_fin)),
    }));
    return { ok: true, status: 200, data: { rangos, source: 'weekly', bloqueado: false } };
  }

  /**
   * Estado de disponibilidad de TODOS los profesionales activos de la sede en
   * una fecha/modalidad. Alimenta el drawer "Disponibilidad del día" y la vista
   * mensual. Resuelve override vs semanal por profesional en una sola pasada.
   */
  async getDiaResumen(
    sedeId: string,
    fecha: string,
    modalidad: Modalidad
  ): Promise<ServiceResult<{ fecha: string; modalidad: Modalidad; profesionales: DiaResumenProfesional[] }>> {
    if (!FECHA_REGEX.test(fecha)) {
      return { ok: false, status: 400, error: { code: 'INVALID_DATE', message: 'fecha debe ser YYYY-MM-DD.' } };
    }
    const diaSemana = diaSemanaDeFecha(fecha);

    const profRows = await postgresService.query(
      `SELECT id, codigo, alias, primer_nombre, primer_apellido, rol, tiempo_consulta
         FROM profesionales
         WHERE sede_id = $1 AND activo = TRUE
         ORDER BY rol, primer_nombre, primer_apellido`,
      [sedeId]
    );
    if (profRows === null) {
      return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error consultando profesionales.' } };
    }

    const profesionales: DiaResumenProfesional[] = [];
    for (const p of profRows) {
      const profesionalId = Number(p.id);
      const efectivos = await this.getRangosEfectivos(profesionalId, sedeId, fecha, diaSemana, modalidad);
      if (!efectivos.ok || !efectivos.data) {
        return { ok: false, status: 500, error: { code: 'DB_ERROR', message: 'Error resolviendo disponibilidad del día.' } };
      }
      const nombre =
        (p.alias ? String(p.alias) : '') ||
        [p.primer_nombre, p.primer_apellido].filter(Boolean).map(String).join(' ') ||
        String(p.codigo);
      profesionales.push({
        profesionalId,
        codigo: String(p.codigo),
        nombre,
        rol: p.rol === 'coach' ? 'coach' : 'medico',
        tiempoConsulta: Number(p.tiempo_consulta) || 30,
        overridden: efectivos.data.source === 'override',
        bloqueado: efectivos.data.bloqueado,
        rangos: efectivos.data.rangos,
        source: efectivos.data.source,
      });
    }

    return { ok: true, status: 200, data: { fecha, modalidad, profesionales } };
  }
}

export default new DisponibilidadFechaService();

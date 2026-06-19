// ============================================================================
// HistoriaClinicaRepository — capa de acceso a datos para historias clínicas.
//
// Encapsula el SQL de lectura/escritura de `HistoriaClinica` (y JOIN con
// `formularios`). Acepta `sedeId` opcional para aislamiento multi-tenant:
// si `sedeId` está definido, agrega `AND "sede_id" = $N` al WHERE. Si es
// `undefined`, no filtra (backward compat con callers internos como
// `transcription.service.ts`).
//
// El SQL en cada método es idéntico al que ya existía en los services antes
// de la Run 4 — solo se agrega la cláusula de sede cuando aplica.
// ============================================================================

import { BaseRepository } from './base.repository';
import { sedeFilter } from '../helpers/sede-scope';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

export interface FindAtendidosOptions {
  medicoCode?: string;
  page: number;
  limit: number;
  buscar?: string;
  /** Aislamiento por sede: undefined = sin filtro (admin/global); array = ANY(sedes). */
  sedes?: string[];
}

export class HistoriaClinicaRepository extends BaseRepository {
  /**
   * Busca una historia clínica por `_id` con LEFT JOIN a `formularios`
   * para datos demográficos y antecedentes.
   *
   * El filtro `sede_id` se aplica SOLO sobre `HistoriaClinica` (alias `h`).
   * El JOIN a `formularios` queda por `numeroId` — la sede en formularios se
   * valida en `findFormularioByNumeroId`.
   */
  async findById(id: string, sedes?: string[]): Promise<Row | null> {
    const params: unknown[] = [id];
    const sedeClause = sedeFilter(sedes, 'h."sede_id"', params);

    const sql = `SELECT
        h.*,
        f.edad as f_edad,
        f.genero as f_genero,
        f.email as f_email,
        f.estado_civil as f_estado_civil,
        f.hijos as f_hijos,
        f.ejercicio as f_ejercicio,
        f.foto_url as f_foto,
        -- Antecedentes personales
        f.cirugia_ocular,
        f.cirugia_programada,
        f.condicion_medica,
        f.dolor_cabeza,
        f.dolor_espalda,
        f.embarazo,
        f.enfermedad_higado,
        f.enfermedad_pulmonar,
        f.fuma,
        f.consumo_licor,
        f.hernias,
        f.hormigueos,
        f.presion_alta,
        f.problemas_azucar,
        f.problemas_cardiacos,
        f.problemas_sueno,
        f.usa_anteojos,
        f.usa_lentes_contacto,
        f.varices,
        f.hepatitis,
        f.trastorno_psicologico,
        f.sintomas_psicologicos,
        f.diagnostico_cancer,
        f.enfermedades_laborales,
        f.enfermedad_osteomuscular,
        f.enfermedad_autoinmune,
        f.ruido_jaqueca,
        -- Antecedentes familiares
        f.familia_hereditarias,
        f.familia_geneticas,
        f.familia_diabetes,
        f.familia_hipertension,
        f.familia_infartos,
        f.familia_cancer,
        f.familia_trastornos,
        f.familia_infecciosas
      FROM "HistoriaClinica" h
      LEFT JOIN formularios f ON h."numeroId" = f.numero_id
      WHERE h."_id" = $1${sedeClause}
      ORDER BY f.fecha_registro DESC
      LIMIT 1`;

    const rows = await this.query<Row>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Lista historias clínicas atendidas con paginación y búsqueda opcional.
   * Replica las dos queries (count + paginated SELECT) que vivían en
   * `historia-query.service.ts → getAtendidos`.
   *
   * NOTA: `medicoCode` queda en la firma para Run 5+ pero **no se filtra
   * todavía** (el método actual tampoco lo filtra).
   */
  async findAtendidos(opts: FindAtendidosOptions): Promise<{ rows: Row[]; total: number }> {
    const { page, limit, buscar, sedes } = opts;
    const offset = (page - 1) * limit;

    // Aflojado: incluye también las historias con transcripción auto-llenada
    // aunque el médico no haya marcado formalmente la consulta como atendida.
    // Eso permite que el panel `/historias` muestre consultas ya transcritas
    // mientras el médico todavía no cierra el caso desde la UI.
    let whereClause = `WHERE (
      (h."atendido" = 'ATENDIDO' AND h."fechaConsulta" IS NOT NULL)
      OR h."transcription_status" = 'done'
    )`;
    const params: unknown[] = [];
    let paramIndex = 1;

    if (buscar && buscar.length >= 2) {
      whereClause += ` AND (
        h."numeroId" ILIKE $${paramIndex}
        OR h."primerNombre" ILIKE $${paramIndex}
        OR h."primerApellido" ILIKE $${paramIndex}
        OR CONCAT(h."primerNombre", ' ', h."primerApellido") ILIKE $${paramIndex}
      )`;
      params.push(`%${buscar}%`);
      paramIndex++;
    }

    const sedeClause = sedeFilter(sedes, 'h."sede_id"', params);
    if (sedeClause) {
      whereClause += sedeClause;
      paramIndex++;
    }

    // 1) Count
    const countRows = await this.query<Row>(
      `SELECT COUNT(*) as total FROM "HistoriaClinica" h ${whereClause}`,
      params
    );
    const total = parseInt(countRows?.[0]?.total || '0', 10);

    // 2) Page
    const dataRows = await this.query<Row>(
      `SELECT
        h."_id",
        h."numeroId",
        h."primerNombre",
        h."segundoNombre",
        h."primerApellido",
        h."segundoApellido",
        h."celular",
        h."email",
        h."codEmpresa",
        h."empresa",
        h."cargo",
        h."tipoExamen",
        h."mdConceptoFinal",
        h."mdDx1",
        h."mdDx2",
        h."mdAntecedentes",
        h."mdObsParaMiDocYa",
        h."mdObservacionesCertificado",
        h."mdRecomendacionesMedicasAdicionales",
        h."talla",
        h."peso",
        h."motivoConsulta",
        h."diagnostico",
        h."tratamiento",
        h."fechaAtencion",
        h."fechaConsulta",
        h."atendido",
        h."medico",
        h."ciudad",
        h."examenes",
        h."horaAtencion",
        h."datosNutricionales",
        f.edad as "f_edad",
        f.genero as "f_genero",
        f.foto_url as "f_foto"
      FROM "HistoriaClinica" h
      LEFT JOIN formularios f ON h."numeroId" = f.numero_id
      ${whereClause}
      ORDER BY h."fechaConsulta" DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );

    return { rows: dataRows, total };
  }

  /**
   * Busca el último formulario por `numero_id`. La sede en `formularios`
   * NO tiene comillas dobles (snake plano).
   */
  async findFormularioByNumeroId(numeroId: string, sedeId?: string): Promise<Row | null> {
    const params: unknown[] = [numeroId];
    let sedeClause = '';
    if (sedeId !== undefined) {
      params.push(sedeId);
      sedeClause = ` AND sede_id = $${params.length}`;
    }

    const sql = `SELECT * FROM formularios
      WHERE numero_id = $1${sedeClause}
      ORDER BY fecha_registro DESC
      LIMIT 1`;

    const rows = await this.query<Row>(sql, params);
    return rows[0] ?? null;
  }

  /**
   * Ejecuta un UPDATE de un campo de historia. El SQL llega ya construido
   * desde `historia-mutation.service.ts → updateField` (porque el nombre
   * de la columna se concatena desde la whitelist EDITABLE_FIELDS, fuera
   * del scope del repo).
   *
   * El `historiaId` se acepta como parámetro semántico para futuro logging /
   * telemetría; el SQL ya lo trae hardcodeado en `WHERE "_id" = $2`.
   */
  async updateField(
    _historiaId: string,
    sql: string,
    params: unknown[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<{ rowCount: number; rows: any[] }> {
    // `_historiaId` se conserva en la firma como parámetro semántico para
    // futuro logging / telemetría (Run 5+). El SQL ya trae `WHERE "_id" = $2`
    // hardcodeado por el service.
    const { rows, rowCount } = await this.queryRaw(sql, params);
    return { rowCount, rows };
  }

  /**
   * Reservado para refactor de upserts en Run 5. Hoy `historia-mutation.service.ts →
   * updateMedicalHistory` delega a `historia-clinica-postgres.service.ts` (un
   * service separado con un SQL muy distinto), por lo que este método existe
   * como fundamento pero no es invocado todavía.
   */
  async updateMedicalHistory(id: string, setParts: string[], values: unknown[]): Promise<number> {
    const sql = `UPDATE "HistoriaClinica" SET ${setParts.join(', ')}, "_updatedDate" = NOW() WHERE "_id" = $${values.length + 1}`;
    const { rowCount } = await this.queryRaw(sql, [...values, id]);
    return rowCount;
  }
}

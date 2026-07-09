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

export interface TrepsiPatientMedidas {
  perimetroCintura?: number | null;
  perimetroAbdomen?: number | null;
  perimetroCadera?: number | null;
  perimetroPecho?: number | null;
  brazoDerecho?: number | null;
  brazoIzquierdo?: number | null;
  piernaDerecha?: number | null;
  piernaIzquierda?: number | null;
  pliegueBiceps?: number | null;
  pliegueTriceps?: number | null;
  pliegueSubescapular?: number | null;
  pliegueAbdominal?: number | null;
  perimetroCuello?: number | null;
}

export interface TrepsiAlimentoAnamnesis {
  alimento: string;
  cantidad: number;
}

export interface TrepsiAnamnesis {
  desayuno?: TrepsiAlimentoAnamnesis[];
  nueves?: TrepsiAlimentoAnamnesis[];
  almuerzo?: TrepsiAlimentoAnamnesis[];
  onces?: TrepsiAlimentoAnamnesis[];
  cena?: TrepsiAlimentoAnamnesis[];
}

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
  empresa?: string;
  // Datos nutricionales que el paciente diligencia en la app Trepsi.
  vasosDeAguaBebidos?: string;
  perimetros?: TrepsiPatientMedidas | null;
  alimentosNoDeseados?: string[];
  alimentosFavoritos?: string[];
  anamnesis?: TrepsiAnamnesis;
  objective?: string;
  // Medidas de primer nivel (Trepsi las envía fuera de historiaClinica).
  peso?: number | string;
  alturaEnCm?: number | string;
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

/**
 * Mapea campos del payload `historiaClinica` (camelCase de la spec Trepsi) a
 * columnas de la tabla HistoriaClinica. Solo se incluyen mapeos directos —
 * todo lo demás (hábitos, medicación, alergias, adjuntos, etc.) se persiste
 * en `trepsi_appointments.payload` para auditoría.
 *
 * Devuelve un mapa `{ columna_snake_case: valor }` listo para construir un
 * UPDATE / INSERT. Si un campo del input es `undefined`, no se incluye.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapHistoriaToColumns(hc: Record<string, any>): Record<string, unknown> {
  const cols: Record<string, unknown> = {};

  if (typeof hc.motivoConsulta === 'string') {
    cols['motivoConsulta'] = hc.motivoConsulta.slice(0, 4000);
    cols['motivo_consulta_texto'] = hc.motivoConsulta.slice(0, 4000);
  }

  if (typeof hc.antecedentesFamiliares === 'string') {
    cols['ant_familiares_obs'] = hc.antecedentesFamiliares;
  }

  const sv = hc.signosVitales;
  if (sv && typeof sv === 'object') {
    if (typeof sv.ta === 'string') {
      const m = sv.ta.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
      if (m) {
        cols['tas'] = parseInt(m[1], 10);
        cols['tad'] = parseInt(m[2], 10);
      }
    }
    if (sv.fc != null && !Number.isNaN(Number(sv.fc))) cols['fcr'] = parseInt(String(sv.fc), 10);
    if (sv.peso != null && !Number.isNaN(Number(sv.peso))) cols['cc_peso_nuevo'] = Number(sv.peso);
    if (sv.talla != null && !Number.isNaN(Number(sv.talla))) cols['cc_estatura_nuevo'] = Number(sv.talla);
    if (sv.imc != null && !Number.isNaN(Number(sv.imc))) cols['cc_imc_nuevo'] = Number(sv.imc);
  }

  return cols;
}

/**
 * Mapea los campos nutricionales que envía Trepsi a las keys del JSONB
 * `datosNutricionales` que consume el panel nutricional de Bodytech.
 *
 * - Arrays de strings → cadenas separadas por coma (lo que el TEXT del panel
 *   nutricional espera).
 * - Arrays de objetos {alimento, cantidad} → cadena tipo "huevo (2), arepa (1)".
 * - Perímetros nuevos que no existían en el panel original → mismas keys que
 *   Trepsi (el JSONB es extensible; el panel puede leerlas cuando se actualice
 *   la UI).
 *
 * Devuelve {} si no hay nada que escribir.
 */
function buildDatosNutricionalesFromTrepsi(input: CreateAppointmentInput): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const joinFood = (list?: TrepsiAlimentoAnamnesis[]): string | undefined => {
    if (!Array.isArray(list) || list.length === 0) return undefined;
    return list
      .filter((it) => it && typeof it.alimento === 'string' && it.alimento.trim())
      .map((it) => `${it.alimento.trim()} (${Number(it.cantidad)})`)
      .join(', ');
  };

  const joinList = (arr?: string[]): string | undefined => {
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const cleaned = arr.map((s) => String(s).trim()).filter((s) => s.length > 0);
    return cleaned.length > 0 ? cleaned.join(', ') : undefined;
  };

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // medicacionActual: [{nombre,dosis,frecuencia}] (o strings) → "Acetaminofén 500mg PRN; ..."
  const joinMedicamentos = (arr?: any): string | undefined => {
    if (typeof arr === 'string') return arr.trim() || undefined;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const items = arr
      .map((m) =>
        typeof m === 'string'
          ? m.trim()
          : [m?.nombre, m?.dosis, m?.frecuencia]
              .filter((x) => x != null && String(x).trim())
              .map(String)
              .join(' ')
              .trim()
      )
      .filter((s) => s.length > 0);
    return items.length ? items.join('; ') : undefined;
  };
  // alergias: [{sustancia,reaccion}] (o strings) → "Penicilina - Rash; ..."
  const joinAlergiasArr = (arr?: any): string | undefined => {
    if (typeof arr === 'string') return arr.trim() || undefined;
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    const items = arr
      .map((a) =>
        typeof a === 'string'
          ? a.trim()
          : [a?.sustancia, a?.reaccion]
              .filter((x) => x != null && String(x).trim())
              .map(String)
              .join(' - ')
              .trim()
      )
      .filter((s) => s.length > 0);
    return items.length ? items.join('; ') : undefined;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (input.vasosDeAguaBebidos && input.vasosDeAguaBebidos.trim()) {
    out.consumoAgua = input.vasosDeAguaBebidos.trim();
  }
  if (input.objective && input.objective.trim()) {
    out.objetivoPrincipal = input.objective.trim();
  }
  const favs = joinList(input.alimentosFavoritos);
  if (favs) out.alimentosPreferidos = favs;
  const noDes = joinList(input.alimentosNoDeseados);
  if (noDes) out.alimentosRechazados = noDes;

  if (input.anamnesis) {
    const a = input.anamnesis;
    const desayuno = joinFood(a.desayuno);
    if (desayuno) out.anamnesisDesayuno = desayuno;
    // Trepsi llama "nueves" al snack de media mañana (típo ~11am). En el panel
    // nutricional ya existe la key `anamnesisMediaManana`; lo mapeamos ahí.
    const mediaManana = joinFood(a.nueves);
    if (mediaManana) out.anamnesisMediaManana = mediaManana;
    const almuerzo = joinFood(a.almuerzo);
    if (almuerzo) out.anamnesisAlmuerzo = almuerzo;
    // "onces" en Colombia/Trepsi = media tarde.
    const mediaTarde = joinFood(a.onces);
    if (mediaTarde) out.anamnesisMediaTarde = mediaTarde;
    const cena = joinFood(a.cena);
    if (cena) out.anamnesisCena = cena;
  }

  if (input.perimetros && typeof input.perimetros === 'object') {
    const p = input.perimetros;
    // Keys del panel nutricional original.
    if (p.perimetroCintura != null) out.circunferenciaCintura = Number(p.perimetroCintura);
    if (p.perimetroCadera != null) out.circunferenciaCadera = Number(p.perimetroCadera);
    if (p.pliegueBiceps != null) out.pliegueBiceps = Number(p.pliegueBiceps);
    if (p.pliegueTriceps != null) out.pliegueTriceps = Number(p.pliegueTriceps);
    if (p.pliegueSubescapular != null) out.pliegueSubescapular = Number(p.pliegueSubescapular);
    if (p.pliegueAbdominal != null) out.pliegueAbdominal = Number(p.pliegueAbdominal);
    // Keys nuevas que el panel aún no tiene UI; guardamos con el mismo nombre
    // que Trepsi para que el panel las pueda exponer luego sin remapear.
    if (p.perimetroAbdomen != null) out.perimetroAbdomen = Number(p.perimetroAbdomen);
    if (p.perimetroPecho != null) out.perimetroPecho = Number(p.perimetroPecho);
    if (p.brazoDerecho != null) out.brazoDerecho = Number(p.brazoDerecho);
    if (p.brazoIzquierdo != null) out.brazoIzquierdo = Number(p.brazoIzquierdo);
    if (p.piernaDerecha != null) out.piernaDerecha = Number(p.piernaDerecha);
    if (p.piernaIzquierda != null) out.piernaIzquierda = Number(p.piernaIzquierda);
    if (p.perimetroCuello != null) out.perimetroCuello = Number(p.perimetroCuello);
  }

  // ----- historiaClinica diligenciada por el paciente en Trepsi -----
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const hc = input.historiaClinica as Record<string, any> | undefined;
  if (hc && typeof hc === 'object') {
    const ap = hc.antecedentesPersonales as Record<string, any> | undefined;

    // Enfermedad actual + antecedentes patológicos → descripción de enfermedad.
    const enfermedad: string[] = [];
    if (typeof hc.enfermedadActual === 'string' && hc.enfermedadActual.trim()) {
      enfermedad.push(hc.enfermedadActual.trim());
    }
    const patologicos = joinList(ap?.patologicos);
    if (patologicos) enfermedad.push(`Patológicos: ${patologicos}`);
    if (enfermedad.length) out.descripcionEnfermedad = enfermedad.join('\n');

    // Cirugías (antecedentes quirúrgicos).
    const quirurgicos = joinList(ap?.quirurgicos);
    if (quirurgicos) out.cirugias = quirurgicos;

    // Medicamentos: medicacionActual + antecedentes farmacológicos.
    const meds = [joinMedicamentos(hc.medicacionActual), joinList(ap?.farmacologicos)]
      .filter(Boolean)
      .join('; ');
    if (meds) out.medicamentosActuales = meds;

    // Alergias: alergias + antecedentes alérgicos.
    const alg = [joinAlergiasArr(hc.alergias), joinList(ap?.alergicos)]
      .filter(Boolean)
      .join('; ');
    if (alg) out.alergias = alg;

    // Hábitos: actividad física, alcohol, sueño, tabaquismo.
    const h = hc.habitos as Record<string, any> | undefined;
    if (h && typeof h === 'object') {
      if (typeof h.actividadFisica === 'string' && h.actividadFisica.trim()) {
        out.realizaActividadFisica = 'Sí';
        out.frecuenciaEjercicio = h.actividadFisica.trim();
      }
      if (typeof h.alcohol === 'string' && h.alcohol.trim()) {
        const al = h.alcohol.trim();
        out.consumoAlcohol = /^(no|ninguno|nunca)$/i.test(al) ? 'No' : 'Sí';
        out.frecuenciaAlcohol = al;
      }
      if (h.sueno != null && String(h.sueno).trim()) {
        out.horasSueno = String(h.sueno).trim();
      }
      if (typeof h.tabaquismo === 'string' && h.tabaquismo.trim()) {
        // Sin campo dedicado en el guion → se anexa a signos clínicos.
        const prev = typeof out.signosClinicos === 'string' ? out.signosClinicos : '';
        out.signosClinicos = [prev, `Tabaquismo: ${h.tabaquismo.trim()}`].filter(Boolean).join('\n');
      }
    }
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return out;
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
    // Antecedentes familiares: Trepsi los manda en historiaClinica; persistir al
    // crear (antes solo entraban por PATCH) para que se vean en el panel del coach.
    const antFamiliares =
      typeof input.historiaClinica.antecedentesFamiliares === 'string'
        ? input.historiaClinica.antecedentesFamiliares.slice(0, 4000)
        : null;

    // Peso (kg) y talla (cm). Trepsi los manda de primer nivel (peso/alturaEnCm);
    // si no, caen a historiaClinica.signosVitales (talla allí puede venir en metros).
    const toNum = (v: unknown): number | null => {
      if (v == null || String(v).trim() === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sv = (input.historiaClinica as Record<string, any>)?.signosVitales as
      | Record<string, unknown>
      | undefined;
    const pesoVal = toNum(input.peso) ?? toNum(sv?.peso);
    let tallaVal = toNum(input.alturaEnCm);
    if (tallaVal == null) {
      const t = toNum(sv?.talla);
      // signosVitales.talla suele venir en metros (ej. 1.65) → convertir a cm.
      tallaVal = t != null && t > 0 && t < 3 ? Math.round(t * 100) : t;
    }

    // horaAtencion (HH:MM en Colombia) derivada de fechaAtencion. El panel usa
    // esta columna para el chip de hora; sin ella la cita salía "sin hora".
    // Colombia no tiene DST → offset fijo UTC-5.
    let horaAtencion: string | null = null;
    {
      const ts = Date.parse(input.fechaAtencion);
      if (!Number.isNaN(ts)) {
        const cot = new Date(ts - 5 * 60 * 60 * 1000);
        horaAtencion = `${String(cot.getUTCHours()).padStart(2, '0')}:${String(
          cot.getUTCMinutes()
        ).padStart(2, '0')}`;
      }
    }

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
         "tipo_documento",
         "genero_biologico",
         "motivoConsulta",
         "motivo_consulta_texto",
         "tipo_consulta",
         "ant_familiares_obs",
         "peso",
         "talla",
         "horaAtencion",
         "codEmpresa",
         "atendido",
         "sede_id"
       ) VALUES (
         $1, NOW(), NOW(),
         $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, 'PENDIENTE', 'trepsi'
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
        input.paciente.tipoDocumento ?? null,
        input.paciente.sexo ?? null,
        motivo,
        motivo,
        input.tipoConsulta ?? null,
        antFamiliares,
        pesoVal != null ? String(pesoVal) : null,
        tallaVal != null ? String(tallaVal) : null,
        horaAtencion,
        input.empresa ? input.empresa.trim().toUpperCase() : null,
      ]
    );

    if (hcInsert === null) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error creando historia clínica.' },
      };
    }

    // Mapear los campos nutricionales que el paciente diligencia en la app
    // Trepsi al JSONB `datosNutricionales` que consume el panel nutricional.
    // Si Trepsi no envía nada, no se ejecuta el UPDATE (datosNutricionales
    // queda NULL y el coach lo llena durante la consulta).
    const datosNutricionales = buildDatosNutricionalesFromTrepsi(input);
    if (Object.keys(datosNutricionales).length > 0) {
      const dnUpdate = await postgresService.query(
        `UPDATE "HistoriaClinica"
            SET "datosNutricionales" = $1::jsonb, "_updatedDate" = NOW()
          WHERE "_id" = $2`,
        [JSON.stringify(datosNutricionales), historiaId]
      );
      if (dnUpdate === null) {
        // No bloqueamos la creación de la cita: log y seguimos. El coach puede
        // llenar manualmente lo que faltó.
        console.error('[trepsi] No se pudo guardar datosNutricionales para', historiaId);
      }
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

  /**
   * Actualiza la historia clínica de una cita que aún no se ha atendido ni
   * cancelado. Aplica el patch sobre las columnas mapeadas de HistoriaClinica
   * y deja el objeto completo (incluyendo campos no mapeados) en
   * `trepsi_appointments.payload.historiaClinica` para auditoría.
   *
   * Rechaza con 409 si la cita está cancelada o atendida.
   */
  async updateHistoria(
    citaId: string,
    historiaPartial: Record<string, unknown>
  ): Promise<ServiceResult<AppointmentRecord>> {
    if (!historiaPartial || Object.keys(historiaPartial).length === 0) {
      return {
        ok: false,
        status: 400,
        error: {
          code: 'EMPTY_PATCH',
          message: 'Debe enviar al menos un campo de historiaClinica a actualizar.',
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

    const cita = existing[0];
    if (cita.estado === 'cancelled') {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'ALREADY_CANCELLED',
          message: 'La cita está cancelada; la historia clínica no puede modificarse.',
        },
      };
    }
    if (cita.estado === 'attended') {
      return {
        ok: false,
        status: 409,
        error: {
          code: 'ALREADY_ATTENDED',
          message:
            'La consulta ya fue atendida; la historia clínica fue consignada por el médico y no puede modificarse desde Trepsi.',
        },
      };
    }

    const historiaId = String(cita.historia_id);

    // Mapear los campos a columnas de HistoriaClinica donde haya equivalencia
    // directa. Lo que no mapea se queda en el payload JSONB.
    const colUpdates = mapHistoriaToColumns(historiaPartial);
    if (Object.keys(colUpdates).length > 0) {
      const sets: string[] = [];
      const params: unknown[] = [];
      let i = 1;
      for (const [col, value] of Object.entries(colUpdates)) {
        sets.push(`"${col}" = $${i++}`);
        params.push(value);
      }
      sets.push('"_updatedDate" = NOW()');
      params.push(historiaId);
      const hcResult = await postgresService.query(
        `UPDATE "HistoriaClinica" SET ${sets.join(', ')} WHERE "_id" = $${i}`,
        params
      );
      if (hcResult === null) {
        return {
          ok: false,
          status: 500,
          error: { code: 'DB_ERROR', message: 'Error actualizando historia clínica.' },
        };
      }
    }

    // Merge del payload: { ...payload, historiaClinica: { ...payload.historiaClinica, ...patch } }
    // payload puede venir como objeto (pg lo deserializa) o como string crudo.
    let currentPayload: Record<string, unknown> = {};
    if (cita.payload && typeof cita.payload === 'object') {
      currentPayload = cita.payload as Record<string, unknown>;
    } else if (typeof cita.payload === 'string') {
      try {
        currentPayload = JSON.parse(cita.payload);
      } catch {
        currentPayload = {};
      }
    }
    const currentHistoria = (currentPayload.historiaClinica || {}) as Record<string, unknown>;
    const mergedHistoria = { ...currentHistoria, ...historiaPartial };
    const newPayload = { ...currentPayload, historiaClinica: mergedHistoria };

    const apptUpdate = await postgresService.query(
      `UPDATE trepsi_appointments
         SET payload = $1, updated_at = NOW()
         WHERE cita_id = $2
         RETURNING *`,
      [JSON.stringify(newPayload), citaId]
    );
    if (apptUpdate === null || apptUpdate.length === 0) {
      return {
        ok: false,
        status: 500,
        error: { code: 'DB_ERROR', message: 'Error actualizando registro de la cita.' },
      };
    }

    return { ok: true, status: 200, data: rowToRecord(apptUpdate[0]) };
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

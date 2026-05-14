import axios from 'axios';
import historiaClinicaPostgresService from './historia-clinica-postgres.service';
import postgresService from './postgres.service';
import whatsappService from './whatsapp.service';
import { generarHTMLHistoriaClinica } from '../helpers/historia-clinica-html';

// ============================================
// Phase 1 — Foundation: whitelist de campos editables vía PATCH
// La whitelist garantiza que el nombre de columna que se concatena en el
// SQL del UPDATE provenga siempre de una constante hardcodeada.
// ============================================

export type EditableFieldType = 'string' | 'number' | 'boolean' | 'date';

interface EditableFieldDef {
  field: string;
  type: EditableFieldType;
}

const EDITABLE_FIELD_DEFS: ReadonlyArray<EditableFieldDef> = [
  // ---- Campos médicos legacy (camelCase, ya existían) ----
  { field: 'mdAntecedentes', type: 'string' },
  { field: 'mdObsParaMiDocYa', type: 'string' },
  { field: 'mdObservacionesCertificado', type: 'string' },
  { field: 'mdRecomendacionesMedicasAdicionales', type: 'string' },
  { field: 'mdConceptoFinal', type: 'string' },
  { field: 'mdDx1', type: 'string' },
  { field: 'mdDx2', type: 'string' },
  { field: 'talla', type: 'string' },
  { field: 'peso', type: 'string' },
  { field: 'cargo', type: 'string' },
  { field: 'motivoConsulta', type: 'string' },
  { field: 'diagnostico', type: 'string' },
  { field: 'tratamiento', type: 'string' },
  { field: 'eps', type: 'string' },

  // ---- Datos Básicos (snake_case, nuevos) ----
  { field: 'genero_biologico', type: 'string' },
  { field: 'identidad_genero', type: 'string' },
  { field: 'grupo_sanguineo', type: 'string' },
  { field: 'fecha_nacimiento', type: 'date' },
  { field: 'comunidad_etnica', type: 'string' },
  { field: 'pertenencia_etnica', type: 'string' },
  { field: 'estado_civil', type: 'string' },
  { field: 'pais_residencia', type: 'string' },
  { field: 'municipio', type: 'string' },
  { field: 'zona_territorial', type: 'string' },
  { field: 'telefono_residencia', type: 'string' },
  { field: 'contacto_emergencia_nombre', type: 'string' },
  { field: 'contacto_emergencia_telefono', type: 'string' },
  { field: 'contacto_emergencia_parentesco', type: 'string' },
  { field: 'ocupacion', type: 'string' },
  { field: 'tipo_vinculacion', type: 'string' },
  { field: 'entidad_territorial', type: 'string' },
  { field: 'categoria_discapacidad', type: 'string' },

  // ---- Anamnesis ----
  { field: 'objetivo_bodytech', type: 'string' },
  { field: 'modalidad', type: 'string' },
  { field: 'servicio_atencion', type: 'string' },
  { field: 'lugar_atencion', type: 'string' },
  { field: 'puerta_entrada', type: 'string' },
  { field: 'causa', type: 'string' },
  { field: 'tipo_consulta', type: 'string' },
  { field: 'motivo_consulta_texto', type: 'string' },
  { field: 'ant_patologico_flag', type: 'boolean' },
  { field: 'ant_patologico_tipo', type: 'string' },
  { field: 'ant_patologico_obs', type: 'string' },
  { field: 'ant_quirurgico_flag', type: 'boolean' },
  { field: 'ant_quirurgico_tipo', type: 'string' },
  { field: 'ant_quirurgico_obs', type: 'string' },
  { field: 'ant_osteomuscular_flag', type: 'boolean' },
  { field: 'ant_osteomuscular_tipo', type: 'string' },
  { field: 'ant_osteomuscular_obs', type: 'string' },
  { field: 'ant_farmacologico_flag', type: 'boolean' },
  { field: 'ant_farmacologico_tipo', type: 'string' },
  { field: 'ant_farmacologico_obs', type: 'string' },
  { field: 'ant_alergicos_flag', type: 'boolean' },
  { field: 'ant_alergicos_tipo', type: 'string' },
  { field: 'ant_alergicos_obs', type: 'string' },
  { field: 'ant_familiares_flag', type: 'boolean' },
  { field: 'ant_familiares_tipo', type: 'string' },
  { field: 'ant_familiares_obs', type: 'string' },
  { field: 'embarazo_actual', type: 'boolean' },
  { field: 'partos', type: 'number' },
  { field: 'cesareas', type: 'number' },
  { field: 'abortos', type: 'number' },
  { field: 'fum', type: 'date' },
  { field: 'planificacion', type: 'string' },
  { field: 'actividad_frecuencia', type: 'string' },
  { field: 'actividad_duracion_min', type: 'number' },
  { field: 'actividad_fuerza_semanal', type: 'number' },
  // ---- Phase 2: nuevos campos Anamnesis ----
  { field: 'ant_quirurgico_tiempo', type: 'string' },
  { field: 'planificacion_familiar_flag', type: 'boolean' },
  { field: 'actividad_duracion', type: 'string' },
  { field: 'actividad_fuerza_semanal_label', type: 'string' },
  // ---- Phase 5: nuevos campos osteomuscular ----
  { field: 'ant_osteomuscular_lista', type: 'string' },
  { field: 'ant_osteomuscular_lateralidad', type: 'string' },
  { field: 'ant_osteomuscular_evolucion', type: 'string' },
  // ---- Phase 5: nuevos campos familiar ----
  { field: 'ant_familiares_consanguinidad', type: 'string' },
  // ---- Phase 5: actividad nivel ----
  { field: 'actividad_nivel', type: 'string' },

  // ---- Clasificación de Riesgo ----
  { field: 'downton_caidas', type: 'boolean' },
  { field: 'downton_medicamentos', type: 'boolean' },
  { field: 'downton_deficits_sensoriales', type: 'boolean' },
  { field: 'downton_estado_mental', type: 'boolean' },
  { field: 'downton_deambulacion', type: 'boolean' },
  { field: 'downton_neurologico', type: 'boolean' },
  { field: 'downton_cardiovascular', type: 'boolean' },
  { field: 'downton_visual', type: 'boolean' },
  { field: 'downton_auditivo', type: 'boolean' },
  { field: 'downton_marcha', type: 'boolean' },
  { field: 'downton_riesgo', type: 'string' },
  // ---- Phase 2: nuevos campos Downton ----
  { field: 'downton_med_antiparkinson', type: 'boolean' },
  { field: 'downton_med_antidepresivos', type: 'boolean' },
  { field: 'downton_med_otros', type: 'boolean' },
  { field: 'downton_def_extremidades', type: 'boolean' },
  { field: 'acsm_edad_hombre', type: 'boolean' },
  { field: 'acsm_edad_mujer', type: 'boolean' },
  { field: 'acsm_familiar_cardiaco', type: 'boolean' },
  { field: 'acsm_tabaquismo', type: 'boolean' },
  { field: 'acsm_sedentarismo', type: 'boolean' },
  { field: 'acsm_obesidad', type: 'boolean' },
  { field: 'acsm_hipertension', type: 'boolean' },
  { field: 'acsm_dislipidemia', type: 'boolean' },
  { field: 'acsm_prediabetes', type: 'boolean' },
  { field: 'acsm_diabetes', type: 'boolean' },
  { field: 'acsm_signos_sintomas', type: 'boolean' },
  { field: 'acsm_enfermedad_conocida', type: 'boolean' },
  // ---- Phase 2: nuevos campos ACSM ----
  { field: 'acsm_edad', type: 'boolean' },
  { field: 'acsm_genero', type: 'boolean' },
  { field: 'acsm_enf_pulmonar', type: 'boolean' },
  { field: 'acsm_enf_cardiovascular', type: 'boolean' },
  { field: 'acsm_enf_renal', type: 'boolean' },
  { field: 'acsm_riesgo', type: 'string' },
  { field: 'bt_factor_1', type: 'boolean' },
  { field: 'bt_factor_2', type: 'boolean' },
  { field: 'bt_factor_3', type: 'boolean' },
  { field: 'riesgo_final', type: 'string' },

  // ---- Examen físico ----
  { field: 'cc_peso_anterior', type: 'number' },
  { field: 'cc_peso_nuevo', type: 'number' },
  { field: 'cc_estatura_anterior', type: 'number' },
  { field: 'cc_estatura_nuevo', type: 'number' },
  { field: 'cc_masa_muscular_anterior', type: 'number' },
  { field: 'cc_masa_muscular_nuevo', type: 'number' },
  { field: 'cc_imc_anterior', type: 'number' },
  { field: 'cc_imc_nuevo', type: 'number' },
  { field: 'cc_imm_anterior', type: 'number' },
  { field: 'cc_imm_nuevo', type: 'number' },
  { field: 'cc_grasa_anterior', type: 'number' },
  { field: 'cc_grasa_nuevo', type: 'number' },
  { field: 'cc_perimetro_abdominal_anterior', type: 'number' },
  { field: 'cc_perimetro_abdominal_nuevo', type: 'number' },
  { field: 'cc_observacion', type: 'string' },
  { field: 'postura_espalda', type: 'string' },
  { field: 'postura_cad_sup', type: 'string' },
  { field: 'postura_cad_inf', type: 'string' },
  { field: 'postura_descripcion', type: 'string' },
  { field: 'hallazgos_descripcion', type: 'string' },
  { field: 'hallazgos_stretching', type: 'string' },
  // ---- Phase 2: numeric stretching (cm) ----
  { field: 'hallazgos_stretching_cm', type: 'number' },
  { field: 'hallazgos_observaciones', type: 'string' },
  { field: 'hallazgos_dolor', type: 'string' },
  { field: 'mov_tren_superior', type: 'string' },
  { field: 'fuerza_superior', type: 'number' },
  { field: 'fuerza_abdominal', type: 'number' },
  { field: 'fuerza_inferior', type: 'number' },
  { field: 'tecnica_sentadilla', type: 'string' },
  { field: 'estabilidad_plancha', type: 'number' },
  { field: 'fcr', type: 'number' },
  { field: 'fcm', type: 'number' },
  { field: 'tas', type: 'number' },
  { field: 'tad', type: 'number' },
  { field: 'equilibrio_unipodal', type: 'string' },
  { field: 'equilibrio_unipodal_segundos', type: 'number' },
  { field: 'riesgo_marcha', type: 'string' },
  { field: 'marcha_estacionaria', type: 'string' },
  { field: 'riesgo_om', type: 'string' },

  // ---- Intervención y procedimiento ----
  { field: 'intervencion_analisis', type: 'string' },
  { field: 'intervencion_tipo_tecnologia', type: 'string' },
  { field: 'intervencion_educacion_si', type: 'boolean' },
  { field: 'intervencion_educacion_tipo', type: 'string' },
  { field: 'intervencion_tipo_meta', type: 'string' },
  { field: 'intervencion_meta_texto', type: 'string' },
  { field: 'dx_tecnologia_salud', type: 'string' },
  { field: 'dx_procedimiento', type: 'string' },
  { field: 'dx_tipo', type: 'string' },

  // ---- Conducta ----
  { field: 'aptitud', type: 'string' },
  { field: 'control_fecha', type: 'date' },
  { field: 'exoneracion_programa', type: 'boolean' },

  // ---- Phase 3: Transcripción post-llamada ----
  // Estos campos son escritos por transcription.service.ts (no por la UI),
  // pero pasan por updateField() para reutilizar la coerción + audit centralizada.
  { field: 'transcription_status', type: 'string' },
  { field: 'transcription_text', type: 'string' },
];

export const EDITABLE_FIELDS: ReadonlyArray<string> = EDITABLE_FIELD_DEFS.map((d) => d.field);

const EDITABLE_FIELD_TYPE_MAP: Readonly<Record<string, EditableFieldType>> = EDITABLE_FIELD_DEFS.reduce(
  (acc, def) => {
    acc[def.field] = def.type;
    return acc;
  },
  {} as Record<string, EditableFieldType>
);

// Fix bug #1: incluir TODOS los campos editables, no solo los snake_case con underscore.
// Antes el filtro excluía `municipio`, `ocupacion`, `eps` etc. del spread y el GET devolvía null.
const SNAKE_KEYS = new Set<string>(EDITABLE_FIELD_DEFS.map((d) => d.field));

function snakeToCamel(s: string): string {
  // Soporta `_letra` y `_dígito` para que columnas como `bt_factor_1` mapeen a
  // `btFactor1` (sin guion bajo residual). Si solo manejáramos `_[a-z]`, el
  // frontend leería `btFactor_1` y el campo nunca se reflejaría en la UI.
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

type FieldValue = string | number | boolean | null;

interface UpdateFieldResult {
  success: boolean;
  field?: string;
  value?: FieldValue;
  updatedAt?: string;
  error?: string;
  code?: number;
}

// Subset de campos `string` que en realidad almacenan JSON serializado.
// Para estos aceptamos array/objeto (lo stringificamos) o string ya pre-encoded
// (lo validamos con JSON.parse). El frontend hoy serializa, pero esta puerta
// trasera evita regresiones si en el futuro envía el array directo.
const JSON_STRING_FIELDS = new Set<string>(['ant_osteomuscular_lista']);

// Reglas para 'date': aceptar YYYY-MM-DD o ISO 8601 con T (con/sin TZ).
// Rechaza strings ambiguos como 'Sep 32' que `new Date()` ingeriría sin chistar.
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function isValidDateString(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;

  // Match YYYY-MM-DD primero
  let m = DATE_ONLY_RE.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12) return false;
    if (d < 1 || d > 31) return false;
    // Verificar día real del mes (ej. 31 feb es inválido)
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== d
    ) {
      return false;
    }
    return true;
  }

  // Match ISO 8601 con tiempo
  m = ISO_DATETIME_RE.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    const ss = m[6] !== undefined ? Number(m[6]) : 0;
    if (mo < 1 || mo > 12) return false;
    if (d < 1 || d > 31) return false;
    if (hh > 23 || mm > 59 || ss > 59) return false;
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (
      probe.getUTCFullYear() !== y ||
      probe.getUTCMonth() !== mo - 1 ||
      probe.getUTCDate() !== d
    ) {
      return false;
    }
    return true;
  }

  return false;
}

function coerceValue(field: string, raw: unknown): { ok: true; value: FieldValue } | { ok: false; error: string } {
  const type = EDITABLE_FIELD_TYPE_MAP[field];
  if (!type) return { ok: false, error: 'INVALID_FIELD' };

  // null o undefined => NULL explícito.
  if (raw === null || raw === undefined) return { ok: true, value: null };
  // String vacío para tipos no-string => NULL.
  if (typeof raw === 'string' && raw.trim() === '' && type !== 'string') return { ok: true, value: null };

  switch (type) {
    case 'string': {
      // Tratamiento especial para columnas TEXT que almacenan JSON.
      if (JSON_STRING_FIELDS.has(field)) {
        // Aceptar array/objeto plano: serializamos.
        if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) {
          try {
            return { ok: true, value: JSON.stringify(raw) };
          } catch {
            return { ok: false, error: 'INVALID_VALUE' };
          }
        }
        // Aceptar string ya pre-encoded — validamos parse.
        if (typeof raw === 'string') {
          try {
            JSON.parse(raw);
            return { ok: true, value: raw };
          } catch {
            return { ok: false, error: 'INVALID_VALUE' };
          }
        }
        return { ok: false, error: 'INVALID_VALUE' };
      }
      if (typeof raw === 'string') return { ok: true, value: raw };
      if (typeof raw === 'number' || typeof raw === 'boolean') return { ok: true, value: String(raw) };
      return { ok: false, error: 'INVALID_VALUE' };
    }
    case 'number': {
      if (typeof raw === 'number') {
        if (!Number.isFinite(raw)) return { ok: false, error: 'INVALID_VALUE' };
        return { ok: true, value: raw };
      }
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (trimmed === '') return { ok: true, value: null };
        // Rechazar strings no numéricos. `Number('')` daría 0 pero ya filtramos arriba.
        // `Number('abc')` → NaN.
        if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
          return { ok: false, error: 'INVALID_VALUE' };
        }
        const n = Number(trimmed);
        if (!Number.isFinite(n)) return { ok: false, error: 'INVALID_VALUE' };
        return { ok: true, value: n };
      }
      return { ok: false, error: 'INVALID_VALUE' };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw };
      if (typeof raw === 'string') {
        const v = raw.trim();
        if (v === 'true' || v === 'Sí' || v === 'SI' || v === 'sí' || v === 'si' || v === '1') {
          return { ok: true, value: true };
        }
        if (v === 'false' || v === 'No' || v === 'NO' || v === 'no' || v === '0') {
          return { ok: true, value: false };
        }
        return { ok: false, error: 'INVALID_VALUE' };
      }
      if (typeof raw === 'number') {
        if (raw === 1) return { ok: true, value: true };
        if (raw === 0) return { ok: true, value: false };
        return { ok: false, error: 'INVALID_VALUE' };
      }
      return { ok: false, error: 'INVALID_VALUE' };
    }
    case 'date': {
      if (typeof raw !== 'string') return { ok: false, error: 'INVALID_VALUE' };
      // `new Date(raw)` ingiere strings ambiguas (ej. 'Sep 32 2025') sin lanzar;
      // validamos con regex + chequeo de día real antes de aceptar.
      if (!isValidDateString(raw)) return { ok: false, error: 'INVALID_VALUE' };
      return { ok: true, value: raw };
    }
    default:
      return { ok: false, error: 'INVALID_VALUE' };
  }
}

interface AntecedentesPersonales {
  cirugiaOcular?: boolean;
  cirugiaProgramada?: boolean;
  condicionMedica?: boolean;
  dolorCabeza?: boolean;
  dolorEspalda?: boolean;
  embarazo?: boolean;
  enfermedadHigado?: boolean;
  enfermedadPulmonar?: boolean;
  fuma?: boolean;
  consumoLicor?: boolean;
  hernias?: boolean;
  hormigueos?: boolean;
  presionAlta?: boolean;
  problemasAzucar?: boolean;
  problemasCardiacos?: boolean;
  problemasSueno?: boolean;
  usaAnteojos?: boolean;
  usaLentesContacto?: boolean;
  varices?: boolean;
  hepatitis?: boolean;
  trastornoPsicologico?: boolean;
  sintomasPsicologicos?: boolean;
  diagnosticoCancer?: boolean;
  enfermedadesLaborales?: boolean;
  enfermedadOsteomuscular?: boolean;
  enfermedadAutoinmune?: boolean;
  ruidoJaqueca?: boolean;
}

interface AntecedentesFamiliares {
  hereditarias?: boolean;
  geneticas?: boolean;
  diabetes?: boolean;
  hipertension?: boolean;
  infartos?: boolean;
  cancer?: boolean;
  trastornos?: boolean;
  infecciosas?: boolean;
}

interface MedicalHistoryData {
  // Datos del paciente
  _id?: string;
  historiaId?: string; // Alias de _id para compatibilidad con frontend
  numeroId: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  celular: string;
  email?: string;
  fechaNacimiento?: Date;
  edad?: number;
  genero?: string;
  estadoCivil?: string;
  hijos?: string;
  ejercicio?: string;
  foto?: string;

  // Datos de la empresa
  codEmpresa?: string;
  cargo?: string;
  tipoExamen?: string;

  // Encuesta de salud
  encuestaSalud?: string;
  antecedentesFamiliares?: string;
  empresa1?: string;

  // Antecedentes médicos del formulario
  antecedentesPersonales?: AntecedentesPersonales;
  antecedentesFamiliaresDetalle?: AntecedentesFamiliares;

  // Campos médicos editables
  mdAntecedentes?: string;
  mdObsParaMiDocYa?: string;
  mdObservacionesCertificado?: string;
  mdRecomendacionesMedicasAdicionales?: string;
  mdConceptoFinal?: string;
  mdDx1?: string;
  mdDx2?: string;
  talla?: string;
  peso?: string;

  // Datos adicionales
  motivoConsulta?: string;
  ciudad?: string;
  eps?: string;
  datosNutricionales?: any;

  // Fechas y estado
  fechaAtencion?: Date;
  fechaConsulta?: Date;
  atendido?: string;
  medico?: string;
}

interface UpdateMedicalHistoryPayload {
  historiaId: string;
  mdAntecedentes?: string;
  mdObsParaMiDocYa?: string;
  mdObservacionesCertificado?: string;
  mdRecomendacionesMedicasAdicionales?: string;
  mdConceptoFinal?: string;
  mdDx1?: string;
  mdDx2?: string;
  talla?: string;
  peso?: string;
  cargo?: string;
  datosNutricionales?: any;
}

interface PatientHistoryRecord {
  _id: string;
  numeroId: string;
  fechaConsulta: Date | null;
  fechaAtencion: Date | null;
  medico: string | null;
  mdDx1: string | null;
  mdDx2: string | null;
  mdConceptoFinal: string | null;
  mdAntecedentes: string | null;
  mdObsParaMiDocYa: string | null;
  mdObservacionesCertificado: string | null;
  mdRecomendacionesMedicasAdicionales: string | null;
  tipoExamen: string | null;
  talla: string | null;
  peso: string | null;
  atendido: string | null;
}

class MedicalHistoryService {
  private wixBaseUrl: string;

  constructor() {
    this.wixBaseUrl = process.env.WIX_FUNCTIONS_URL || 'https://www.bsl.com.co/_functions';
  }

  /**
   * Obtiene la historia clínica de un paciente desde PostgreSQL (principal)
   * Si no existe en PostgreSQL, intenta obtener de Wix como fallback
   */
  async getMedicalHistory(historiaId: string): Promise<MedicalHistoryData | null> {
    try {
      console.log(`📋 Obteniendo historia clínica para ID: ${historiaId}`);

      // PASO 1: Intentar obtener de PostgreSQL con JOIN a formularios para datos demográficos y antecedentes
      const pgResult = await postgresService.query(
        `SELECT
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
        WHERE h."_id" = $1
        ORDER BY f.fecha_registro DESC
        LIMIT 1`,
        [historiaId]
      );

      if (pgResult && pgResult.length > 0) {
        const row = pgResult[0];
        console.log(`✅ [PostgreSQL] Historia clínica encontrada para ${historiaId}`);

        // Mapeo automático snake_case -> camelCase de TODAS las columnas nuevas Phase 1.
        // Prefiero hacerlo aquí (sin SELECT *) porque ya tenemos el row completo del JOIN.
        const extra: Record<string, unknown> = {};
        for (const snakeKey of SNAKE_KEYS) {
          if (Object.prototype.hasOwnProperty.call(row, snakeKey)) {
            extra[snakeToCamel(snakeKey)] = row[snakeKey];
          }
        }

        return {
          ...extra,
          _id: row._id,
          historiaId: row._id, // Alias para compatibilidad con frontend
          numeroId: row.numeroId,
          primerNombre: row.primerNombre,
          segundoNombre: row.segundoNombre,
          primerApellido: row.primerApellido,
          segundoApellido: row.segundoApellido,
          celular: row.celular,
          // Datos demográficos desde formularios (con fallback a HistoriaClinica)
          email: row.f_email || row.email,
          edad: row.f_edad,
          genero: row.f_genero,
          // Fix bug #2: priorizar nueva columna HistoriaClinica.estado_civil sobre legacy formularios.f_estado_civil.
          // El spread `extra` ya pone estadoCivil desde row.estado_civil; este explicit mapping lo respeta y solo cae al legacy si la nueva está null.
          estadoCivil: row.estado_civil ?? row.f_estado_civil,
          hijos: row.f_hijos?.toString(),
          ejercicio: row.f_ejercicio,
          foto: row.f_foto,
          // Datos de empresa
          codEmpresa: row.codEmpresa,
          cargo: row.cargo,
          tipoExamen: row.tipoExamen,
          // Antecedentes personales (de formularios)
          antecedentesPersonales: {
            cirugiaOcular: row.cirugia_ocular === true || row.cirugia_ocular === 'true' || row.cirugia_ocular === 'Sí' || row.cirugia_ocular === 'SI',
            cirugiaProgramada: row.cirugia_programada === true || row.cirugia_programada === 'true' || row.cirugia_programada === 'Sí' || row.cirugia_programada === 'SI',
            condicionMedica: row.condicion_medica === true || row.condicion_medica === 'true' || row.condicion_medica === 'Sí' || row.condicion_medica === 'SI',
            dolorCabeza: row.dolor_cabeza === true || row.dolor_cabeza === 'true' || row.dolor_cabeza === 'Sí' || row.dolor_cabeza === 'SI',
            dolorEspalda: row.dolor_espalda === true || row.dolor_espalda === 'true' || row.dolor_espalda === 'Sí' || row.dolor_espalda === 'SI',
            embarazo: row.embarazo === true || row.embarazo === 'true' || row.embarazo === 'Sí' || row.embarazo === 'SI',
            enfermedadHigado: row.enfermedad_higado === true || row.enfermedad_higado === 'true' || row.enfermedad_higado === 'Sí' || row.enfermedad_higado === 'SI',
            enfermedadPulmonar: row.enfermedad_pulmonar === true || row.enfermedad_pulmonar === 'true' || row.enfermedad_pulmonar === 'Sí' || row.enfermedad_pulmonar === 'SI',
            fuma: row.fuma === true || row.fuma === 'true' || row.fuma === 'Sí' || row.fuma === 'SI',
            consumoLicor: row.consumo_licor === true || row.consumo_licor === 'true' || row.consumo_licor === 'Sí' || row.consumo_licor === 'SI',
            hernias: row.hernias === true || row.hernias === 'true' || row.hernias === 'Sí' || row.hernias === 'SI',
            hormigueos: row.hormigueos === true || row.hormigueos === 'true' || row.hormigueos === 'Sí' || row.hormigueos === 'SI',
            presionAlta: row.presion_alta === true || row.presion_alta === 'true' || row.presion_alta === 'Sí' || row.presion_alta === 'SI',
            problemasAzucar: row.problemas_azucar === true || row.problemas_azucar === 'true' || row.problemas_azucar === 'Sí' || row.problemas_azucar === 'SI',
            problemasCardiacos: row.problemas_cardiacos === true || row.problemas_cardiacos === 'true' || row.problemas_cardiacos === 'Sí' || row.problemas_cardiacos === 'SI',
            problemasSueno: row.problemas_sueno === true || row.problemas_sueno === 'true' || row.problemas_sueno === 'Sí' || row.problemas_sueno === 'SI',
            usaAnteojos: row.usa_anteojos === true || row.usa_anteojos === 'true' || row.usa_anteojos === 'Sí' || row.usa_anteojos === 'SI',
            usaLentesContacto: row.usa_lentes_contacto === true || row.usa_lentes_contacto === 'true' || row.usa_lentes_contacto === 'Sí' || row.usa_lentes_contacto === 'SI',
            varices: row.varices === true || row.varices === 'true' || row.varices === 'Sí' || row.varices === 'SI',
            hepatitis: row.hepatitis === true || row.hepatitis === 'true' || row.hepatitis === 'Sí' || row.hepatitis === 'SI',
            trastornoPsicologico: row.trastorno_psicologico === true || row.trastorno_psicologico === 'true' || row.trastorno_psicologico === 'Sí' || row.trastorno_psicologico === 'SI',
            sintomasPsicologicos: row.sintomas_psicologicos === true || row.sintomas_psicologicos === 'true' || row.sintomas_psicologicos === 'Sí' || row.sintomas_psicologicos === 'SI',
            diagnosticoCancer: row.diagnostico_cancer === true || row.diagnostico_cancer === 'true' || row.diagnostico_cancer === 'Sí' || row.diagnostico_cancer === 'SI',
            enfermedadesLaborales: row.enfermedades_laborales === true || row.enfermedades_laborales === 'true' || row.enfermedades_laborales === 'Sí' || row.enfermedades_laborales === 'SI',
            enfermedadOsteomuscular: row.enfermedad_osteomuscular === true || row.enfermedad_osteomuscular === 'true' || row.enfermedad_osteomuscular === 'Sí' || row.enfermedad_osteomuscular === 'SI',
            enfermedadAutoinmune: row.enfermedad_autoinmune === true || row.enfermedad_autoinmune === 'true' || row.enfermedad_autoinmune === 'Sí' || row.enfermedad_autoinmune === 'SI',
            ruidoJaqueca: row.ruido_jaqueca === true || row.ruido_jaqueca === 'true' || row.ruido_jaqueca === 'Sí' || row.ruido_jaqueca === 'SI',
          },
          // Antecedentes familiares (de formularios)
          antecedentesFamiliaresDetalle: {
            hereditarias: row.familia_hereditarias === true || row.familia_hereditarias === 'true' || row.familia_hereditarias === 'Sí' || row.familia_hereditarias === 'SI',
            geneticas: row.familia_geneticas === true || row.familia_geneticas === 'true' || row.familia_geneticas === 'Sí' || row.familia_geneticas === 'SI',
            diabetes: row.familia_diabetes === true || row.familia_diabetes === 'true' || row.familia_diabetes === 'Sí' || row.familia_diabetes === 'SI',
            hipertension: row.familia_hipertension === true || row.familia_hipertension === 'true' || row.familia_hipertension === 'Sí' || row.familia_hipertension === 'SI',
            infartos: row.familia_infartos === true || row.familia_infartos === 'true' || row.familia_infartos === 'Sí' || row.familia_infartos === 'SI',
            cancer: row.familia_cancer === true || row.familia_cancer === 'true' || row.familia_cancer === 'Sí' || row.familia_cancer === 'SI',
            trastornos: row.familia_trastornos === true || row.familia_trastornos === 'true' || row.familia_trastornos === 'Sí' || row.familia_trastornos === 'SI',
            infecciosas: row.familia_infecciosas === true || row.familia_infecciosas === 'true' || row.familia_infecciosas === 'Sí' || row.familia_infecciosas === 'SI',
          },
          // Campos médicos
          mdAntecedentes: row.mdAntecedentes,
          mdObsParaMiDocYa: row.mdObsParaMiDocYa,
          mdObservacionesCertificado: row.mdObservacionesCertificado,
          mdRecomendacionesMedicasAdicionales: row.mdRecomendacionesMedicasAdicionales,
          mdConceptoFinal: row.mdConceptoFinal,
          mdDx1: row.mdDx1,
          mdDx2: row.mdDx2,
          talla: row.talla,
          peso: row.peso,
          motivoConsulta: row.motivoConsulta,
          ciudad: row.ciudad,
          eps: row.eps,
          datosNutricionales: row.datosNutricionales || null,
          fechaAtencion: row.fechaAtencion,
          fechaConsulta: row.fechaConsulta,
          atendido: row.atendido,
          medico: row.medico,
        } as MedicalHistoryData;
      }

      // PASO 2: Fallback a Wix si no está en PostgreSQL
      console.log(`⚠️  [PostgreSQL] No encontrado, intentando Wix para ${historiaId}`);
      const response = await axios.get(`${this.wixBaseUrl}/getHistoriaClinica`, {
        params: { historiaId: historiaId },
      });

      if (response.data && response.data.success && response.data.data) {
        console.log(`✅ [Wix] Historia clínica encontrada para ${historiaId}`);
        return response.data.data as MedicalHistoryData;
      }

      console.warn(`⚠️  No se encontró historia clínica para ${historiaId}`);
      return null;
    } catch (error: any) {
      console.error('❌ Error obteniendo historia clínica:', error.message);
      throw new Error('Error al obtener historia clínica del paciente');
    }
  }

  /**
   * Lista historias clínicas de personas atendidas con paginación y búsqueda
   */
  async getAtendidos(options: { page?: number; limit?: number; buscar?: string }): Promise<{
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPaginas: number;
  }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;
      const buscar = options.buscar?.trim();

      console.log(`📋 Listando atendidos (página ${page}, limit ${limit}${buscar ? `, búsqueda: "${buscar}"` : ''})...`);

      let whereClause = 'WHERE h."atendido" = \'ATENDIDO\' AND h."fechaConsulta" IS NOT NULL';
      const params: any[] = [];
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

      // Count total
      const countResult = await postgresService.query(
        `SELECT COUNT(*) as total FROM "HistoriaClinica" h ${whereClause}`,
        params
      );
      const total = parseInt(countResult?.[0]?.total || '0', 10);
      const totalPaginas = Math.ceil(total / limit);

      // Get paginated data with formulario join for extra fields
      const dataResult = await postgresService.query(
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

      const data = (dataResult || []).map((row: any) => ({
        _id: row._id,
        numeroId: row.numeroId,
        primerNombre: row.primerNombre,
        segundoNombre: row.segundoNombre,
        primerApellido: row.primerApellido,
        segundoApellido: row.segundoApellido,
        celular: row.celular,
        email: row.email,
        codEmpresa: row.codEmpresa,
        empresa: row.empresa,
        cargo: row.cargo,
        tipoExamen: row.tipoExamen,
        mdConceptoFinal: row.mdConceptoFinal,
        mdDx1: row.mdDx1,
        mdDx2: row.mdDx2,
        mdAntecedentes: row.mdAntecedentes,
        mdObsParaMiDocYa: row.mdObsParaMiDocYa,
        mdObservacionesCertificado: row.mdObservacionesCertificado,
        mdRecomendacionesMedicasAdicionales: row.mdRecomendacionesMedicasAdicionales,
        talla: row.talla,
        peso: row.peso,
        motivoConsulta: row.motivoConsulta,
        diagnostico: row.diagnostico,
        tratamiento: row.tratamiento,
        fechaAtencion: row.fechaAtencion,
        fechaConsulta: row.fechaConsulta,
        atendido: row.atendido,
        medico: row.medico,
        ciudad: row.ciudad,
        examenes: row.examenes,
        horaAtencion: row.horaAtencion,
        datosNutricionales: row.datosNutricionales,
        edad: row.f_edad,
        genero: row.f_genero,
        foto: row.f_foto,
      }));

      console.log(`✅ Atendidos: ${data.length} registros (página ${page}/${totalPaginas}, total: ${total})`);

      return { data, total, page, limit, totalPaginas };
    } catch (error: any) {
      console.error('❌ Error listando atendidos:', error.message);
      throw new Error('Error al listar historias clínicas de atendidos');
    }
  }

  /**
   * Genera el HTML completo de la historia clínica para preview/impresión
   */
  async getPreviewHTML(historiaId: string): Promise<string | null> {
    try {
      console.log(`📄 Generando preview HTML para historia: ${historiaId}`);

      // 1. Historia Clínica
      const hcResult = await postgresService.query(
        'SELECT * FROM "HistoriaClinica" WHERE "_id" = $1',
        [historiaId]
      );
      if (!hcResult || hcResult.length === 0) return null;
      const historia = hcResult[0];

      // 2. Formulario (datos demográficos + antecedentes + firma)
      let formulario = null;
      const fResult = await postgresService.query(
        `SELECT * FROM formularios
         WHERE wix_id = $1 OR numero_id = $2
         ORDER BY fecha_registro DESC LIMIT 1`,
        [historiaId, historia.numeroId]
      );
      if (fResult && fResult.length > 0) formulario = fResult[0];

      return generarHTMLHistoriaClinica({ historia, formulario });
    } catch (error: any) {
      console.error('❌ Error generando preview HTML:', error.message);
      throw new Error('Error al generar preview de historia clínica');
    }
  }

  /**
   * Obtiene el historial de consultas anteriores de un paciente por su numeroId (documento de identidad)
   * Retorna todas las consultas completadas (atendido = 'ATENDIDO') ordenadas por fecha descendente
   */
  async getPatientHistory(numeroId: string): Promise<PatientHistoryRecord[]> {
    try {
      console.log(`📋 Obteniendo historial de consultas para paciente: ${numeroId}`);

      const pgResult = await postgresService.query(
        `SELECT
          "_id",
          "numeroId",
          "fechaConsulta",
          "fechaAtencion",
          "medico",
          "mdDx1",
          "mdDx2",
          "mdConceptoFinal",
          "mdAntecedentes",
          "mdObsParaMiDocYa",
          "mdObservacionesCertificado",
          "mdRecomendacionesMedicasAdicionales",
          "tipoExamen",
          "talla",
          "peso",
          "atendido"
        FROM "HistoriaClinica"
        WHERE "numeroId" = $1
          AND "atendido" = 'ATENDIDO'
          AND "fechaConsulta" IS NOT NULL
        ORDER BY "fechaConsulta" DESC
        LIMIT 20`,
        [numeroId]
      );

      if (!pgResult || pgResult.length === 0) {
        console.log(`ℹ️  No se encontraron consultas anteriores para ${numeroId}`);
        return [];
      }

      console.log(`✅ Se encontraron ${pgResult.length} consultas anteriores para ${numeroId}`);

      return pgResult.map((row: any) => ({
        _id: row._id,
        numeroId: row.numeroId,
        fechaConsulta: row.fechaConsulta,
        fechaAtencion: row.fechaAtencion,
        medico: row.medico,
        mdDx1: row.mdDx1,
        mdDx2: row.mdDx2,
        mdConceptoFinal: row.mdConceptoFinal,
        mdAntecedentes: row.mdAntecedentes,
        mdObsParaMiDocYa: row.mdObsParaMiDocYa,
        mdObservacionesCertificado: row.mdObservacionesCertificado,
        mdRecomendacionesMedicasAdicionales: row.mdRecomendacionesMedicasAdicionales,
        tipoExamen: row.tipoExamen,
        talla: row.talla,
        peso: row.peso,
        atendido: row.atendido,
      })) as PatientHistoryRecord[];
    } catch (error: any) {
      console.error('❌ Error obteniendo historial del paciente:', error.message);
      throw new Error('Error al obtener historial de consultas del paciente');
    }
  }

  /**
   * Actualiza un solo campo de la historia clínica (auto-save por field).
   * Phase 1 — Foundation.
   *
   * - Valida `field` contra la whitelist EDITABLE_FIELDS (sin esto NO se construye el SQL).
   * - Coerciona el valor según el tipo declarado.
   * - El nombre de columna se concatena luego de la whitelist; no hay riesgo de inyección.
   */
  async updateField(historiaId: string, field: string, rawValue: unknown): Promise<UpdateFieldResult> {
    if (!historiaId) {
      return { success: false, error: 'MISSING_ID', code: 400 };
    }
    if (typeof field !== 'string' || !EDITABLE_FIELDS.includes(field)) {
      return { success: false, error: 'INVALID_FIELD', code: 400 };
    }

    const coerced = coerceValue(field, rawValue);
    if (!coerced.ok) {
      return { success: false, error: coerced.error, code: 400 };
    }

    const value = coerced.value;
    const sql = `UPDATE "HistoriaClinica" SET "${field}" = $1, "_updatedDate" = NOW() WHERE "_id" = $2 RETURNING "_updatedDate"`;

    try {
      const rows = await postgresService.query(sql, [value, historiaId]);
      if (rows === null) {
        return { success: false, error: 'DB_ERROR', code: 500 };
      }
      if (rows.length === 0) {
        return { success: false, error: 'NOT_FOUND', code: 404 };
      }
      const updatedAtRaw = rows[0]?._updatedDate ?? rows[0]?.['_updatedDate'];
      const updatedAt = updatedAtRaw instanceof Date ? updatedAtRaw.toISOString() : new Date().toISOString();
      return {
        success: true,
        field,
        value,
        updatedAt,
      };
    } catch (error: any) {
      console.error('❌ [updateField] Error:', error.message);
      return { success: false, error: 'DB_ERROR', code: 500 };
    }
  }

  async updateMedicalHistory(payload: UpdateMedicalHistoryPayload): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`💾 Actualizando historia clínica para ID: ${payload.historiaId}`);

      if (!payload.mdConceptoFinal) {
        return { success: false, error: 'El campo Concepto Final es obligatorio' };
      }

      // PASO 0: Obtener datos base del paciente
      const historiaBase = await this.getMedicalHistory(payload.historiaId);

      if (!historiaBase) {
        return { success: false, error: 'No se encontró historia clínica' };
      }

      // PASO 1: Guardar en PostgreSQL PRIMERO (fuente principal - OBLIGATORIO)
      console.log(`💾 [PostgreSQL] Guardando historia clínica ${payload.historiaId}...`);

      const pgSuccess = await historiaClinicaPostgresService.upsert({
        _id: payload.historiaId,
        // Datos base del paciente (no cambian)
        numeroId: historiaBase.numeroId,
        primerNombre: historiaBase.primerNombre,
        segundoNombre: historiaBase.segundoNombre,
        primerApellido: historiaBase.primerApellido,
        segundoApellido: historiaBase.segundoApellido,
        celular: historiaBase.celular,
        email: historiaBase.email,
        codEmpresa: historiaBase.codEmpresa,
        tipoExamen: historiaBase.tipoExamen,
        fechaAtencion: historiaBase.fechaAtencion,
        medico: historiaBase.medico,

        // Datos médicos ingresados por el doctor (del payload)
        mdAntecedentes: payload.mdAntecedentes,
        mdObsParaMiDocYa: payload.mdObsParaMiDocYa,
        mdObservacionesCertificado: payload.mdObservacionesCertificado,
        mdRecomendacionesMedicasAdicionales: payload.mdRecomendacionesMedicasAdicionales,
        mdConceptoFinal: payload.mdConceptoFinal,
        mdDx1: payload.mdDx1,
        mdDx2: payload.mdDx2,
        talla: payload.talla,
        peso: payload.peso,
        cargo: payload.cargo,
        datosNutricionales: payload.datosNutricionales,

        // Campos de estado
        fechaConsulta: new Date(),
        atendido: 'ATENDIDO',
      });

      if (!pgSuccess) {
        console.error(`❌ [PostgreSQL] Error guardando historia clínica ${payload.historiaId}`);
        return { success: false, error: 'Error guardando en PostgreSQL' };
      }

      console.log(`✅ [PostgreSQL] Historia clínica guardada exitosamente para ${payload.historiaId}`);

      // PASO 1.5: Enviar link de certificado por WhatsApp para empresas específicas (PARTICULAR o SANITHELP-JJ)
      if (historiaBase.codEmpresa === 'PARTICULAR' || historiaBase.codEmpresa === 'SANITHELP-JJ') {
        console.log(`📜 [Certificado] Enviando link de certificado para ${payload.historiaId} (${historiaBase.codEmpresa})...`);

        // Construir URL del certificado
        const certificadoUrl = `https://bsl-utilidades-yp78a.ondigitalocean.app/generar-certificado-desde-wix/${payload.historiaId}`;

        // Formatear número de celular para WhatsApp
        let celularFormateado = historiaBase.celular
          .replace(/\s+/g, '') // Quitar espacios
          .replace(/[()+-]/g, ''); // Quitar caracteres especiales

        // Detectar si ya tiene código de país (números internacionales empiezan con 1-9, no con 3)
        // Colombia: 57 + 10 dígitos (3001234567)
        // USA/Canada: 1 + 10 dígitos
        // Otros países: código país + número

        const codigosPais = ['1', '52', '57', '54', '55', '34', '44', '49', '33']; // USA, México, Colombia, Argentina, Brasil, España, UK, Alemania, Francia
        const tieneCodigo = codigosPais.some(codigo => celularFormateado.startsWith(codigo));

        // Si no tiene código de país y empieza con 3 (celulares colombianos), agregar 57
        if (!tieneCodigo && celularFormateado.startsWith('3') && celularFormateado.length === 10) {
          celularFormateado = `57${celularFormateado}`;
        }

        // Construir mensaje de WhatsApp
        const nombreCompleto = `${historiaBase.primerNombre} ${historiaBase.primerApellido}`;
        const mensaje = `Hola ${nombreCompleto}! 👋\n\n` +
          `Tu certificado médico ya está listo. Puedes descargarlo en el siguiente enlace:\n\n` +
          `${certificadoUrl}\n\n` +
          `_Este enlace estará disponible por 30 días._`;

        // Enviar WhatsApp en background (fire-and-forget)
        whatsappService.sendTextMessage(celularFormateado, mensaje)
          .then((result) => {
            if (result.success) {
              console.log(`✅ [Certificado] Link enviado por WhatsApp a ${celularFormateado}`);
            } else {
              console.error(`⚠️  [Certificado] Error enviando WhatsApp: ${result.error}`);
            }
          })
          .catch((error: any) => {
            console.error(`⚠️  [Certificado] Error inesperado al enviar WhatsApp: ${error.message}`);
          });

        console.log(`📤 [Certificado] Enviando link por WhatsApp a ${celularFormateado}...`);
      } else {
        console.log(`ℹ️  [Certificado] No se envía certificado para ${historiaBase.codEmpresa || 'N/A'}`);
      }

      // PASO 2: Guardar en Wix como BACKUP (obligatorio pero no bloquea si falla)
      console.log(`💾 [Wix] Guardando backup de historia clínica ${payload.historiaId}...`);

      try {
        const response = await axios.post(`${this.wixBaseUrl}/updateHistoriaClinica`, {
          historiaId: payload.historiaId,
          mdAntecedentes: payload.mdAntecedentes,
          mdObsParaMiDocYa: payload.mdObsParaMiDocYa,
          mdObservacionesCertificado: payload.mdObservacionesCertificado,
          mdRecomendacionesMedicasAdicionales: payload.mdRecomendacionesMedicasAdicionales,
          mdConceptoFinal: payload.mdConceptoFinal,
          mdDx1: payload.mdDx1,
          mdDx2: payload.mdDx2,
          talla: payload.talla,
          peso: payload.peso,
          cargo: payload.cargo,
          atendido: 'ATENDIDO',
        });

        if (response.data && response.data.success) {
          console.log(`✅ [Wix] Backup guardado exitosamente para ${payload.historiaId}`);
        } else {
          console.warn(`⚠️  [Wix] Respuesta inesperada al guardar backup: ${JSON.stringify(response.data)}`);
        }
      } catch (wixError: any) {
        // Log error pero no fallar - PostgreSQL ya tiene los datos
        console.error(`⚠️  [Wix] Error guardando backup (no crítico): ${wixError.message}`);
      }

      return { success: true };
    } catch (error: any) {
      console.error('❌ Error actualizando historia clínica:', error.message);
      return {
        success: false,
        error: error.message || 'Error al actualizar historia clínica'
      };
    }
  }
}

export default new MedicalHistoryService();

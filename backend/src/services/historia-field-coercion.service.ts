// ============================================
// Phase 1 — Foundation: whitelist de campos editables vía PATCH
// La whitelist garantiza que el nombre de columna que se concatena en el
// SQL del UPDATE provenga siempre de una constante hardcodeada.
//
// Este módulo es la INFRAESTRUCTURA COMPARTIDA de coerción / validación
// usada por `historia-mutation.service.ts` (escritura) y `historia-query.service.ts`
// (sólo para snake→camel mapping). Se mantiene como módulo de utilidades
// (named exports, sin singleton), porque no encapsula estado ni IO.
// ============================================

export type EditableFieldType = 'string' | 'number' | 'boolean' | 'date';

export interface EditableFieldDef {
  field: string;
  type: EditableFieldType;
}

export const EDITABLE_FIELD_DEFS: ReadonlyArray<EditableFieldDef> = [
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
  // ─────────────────────────────────────────────────────────────────────────
  // Auditoría EDITABLE_FIELD_DEFS ↔ runMigrations() (Round 1):
  //   - Todos los campos snake_case y camelCase legacy listados arriba tienen
  //     su columna en `postgres.service.ts → runMigrations()` (CREATE TABLE o
  //     `ADD COLUMN IF NOT EXISTS`). Verificado 2026-05-13.
  //   - Excepciones documentadas (columnas SIN entrada en EDITABLE_FIELD_DEFS,
  //     intencionalmente):
  //       · `composition_sid` (Phase 4): escrito directamente por
  //         video.controller.ts → roomCompletedWebhook vía SQL. NO se edita
  //         desde el panel. Mapeado en getMedicalHistory() explícitamente.
  //       · `datosNutricionales` (JSONB): persiste vía
  //         historiaClinicaPostgresService.upsert(), no por whitelist.
  //       · Legacy Wix: `empresa`, `pvEstado`, `examenes`, `horaAtencion`,
  //         `_createdDate`, `_updatedDate`, `numeroId`, `primerNombre`,
  //         `segundoNombre`, `primerApellido`, `segundoApellido`, `celular`,
  //         `email`, `fechaConsulta`, `atendido`, `medico`, `ciudad` — son
  //         identidad / estado de la consulta, no campos del editor.
  // ─────────────────────────────────────────────────────────────────────────
];

export const EDITABLE_FIELDS: ReadonlyArray<string> = EDITABLE_FIELD_DEFS.map((d) => d.field);

export const EDITABLE_FIELD_TYPE_MAP: Readonly<Record<string, EditableFieldType>> =
  EDITABLE_FIELD_DEFS.reduce(
    (acc, def) => {
      acc[def.field] = def.type;
      return acc;
    },
    {} as Record<string, EditableFieldType>
  );

// Fix bug #1: incluir TODOS los campos editables, no solo los snake_case con underscore.
// Antes el filtro excluía `municipio`, `ocupacion`, `eps` etc. del spread y el GET devolvía null.
export const SNAKE_KEYS = new Set<string>(EDITABLE_FIELD_DEFS.map((d) => d.field));

export function snakeToCamel(s: string): string {
  // Soporta `_letra` y `_dígito` para que columnas como `bt_factor_1` mapeen a
  // `btFactor1` (sin guion bajo residual). Si solo manejáramos `_[a-z]`, el
  // frontend leería `btFactor_1` y el campo nunca se reflejaría en la UI.
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export type FieldValue = string | number | boolean | null;

// Subset de campos `string` que en realidad almacenan JSON serializado.
// Para estos aceptamos array/objeto (lo stringificamos) o string ya pre-encoded
// (lo validamos con JSON.parse). El frontend hoy serializa, pero esta puerta
// trasera evita regresiones si en el futuro envía el array directo.
export const JSON_STRING_FIELDS = new Set<string>(['ant_osteomuscular_lista']);

// Reglas para 'date': aceptar YYYY-MM-DD o ISO 8601 con T (con/sin TZ).
// Rechaza strings ambiguos como 'Sep 32' que `new Date()` ingeriría sin chistar.
export const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

export function isValidDateString(raw: string): boolean {
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

export function coerceValue(
  field: string,
  raw: unknown
): { ok: true; value: FieldValue } | { ok: false; error: string } {
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

import type { MedicalHistoryFull } from '../types';
import { camelCampo, tieneValor, type CampoCompletitud } from './completitud';

// ============================================================================
// Qué exige la historia del Médico Corporativo, sección por sección.
//
// Vive aparte del panel para poder probarlo: es lo que decide la lista de "lo
// que falta" al finalizar, y ahí nacieron dos de las quejas del médico — que le
// reclamaba los tests que no hizo, y que el aviso no decía dónde estaba cada
// campo.
//
// Cada campo lleva `destino`: el modal donde se diligencia. El "Ir →" abre esa
// ventana directamente.
//
// Las listas de Sí/Niega también viven acá y las pestañas las importan: si
// cada una tuviera su copia, agregar un antecedente en la pestaña y no acá lo
// dejaría fuera de lo que se exige.
// ============================================================================

export type CorpTabId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7';

export const TAB_LABELS: Record<CorpTabId, string> = {
  c1: 'Identificación',
  c2: 'Anamnesis',
  c3: 'Antecedentes',
  c4: 'Actividad física',
  c5: 'Examen físico',
  c6: 'Diagnóstico y riesgo',
  c7: 'Análisis y prescripción',
};

export interface CampoSiNo {
  label: string;
  field: string;
}

export const SINTOMAS: ReadonlyArray<CampoSiNo> = [
  { label: 'Dolor torácico', field: 'mc_sint_dolor_toracico' },
  { label: 'Palpitaciones', field: 'mc_sint_palpitaciones' },
  { label: 'Disnea', field: 'mc_sint_disnea' },
  { label: 'Edema de MMII', field: 'mc_sint_edema_mmii' },
  { label: 'Síncope', field: 'mc_sint_sincope' },
  { label: 'Claudicación', field: 'mc_sint_claudicacion' },
];

export const FAMILIARES: ReadonlyArray<CampoSiNo> = [
  { label: 'Enfermedad cardiaca', field: 'mc_fam_cardiaca' },
  { label: 'Enfermedad respiratoria', field: 'mc_fam_respiratoria' },
  { label: 'MSC o IAM', field: 'mc_fam_msc_iam' },
  { label: 'Hipertensión arterial', field: 'mc_fam_hta' },
  { label: 'Enfermedad cerebrovascular', field: 'mc_fam_cerebrovascular' },
  { label: 'Diabetes', field: 'mc_fam_diabetes' },
  { label: 'Cáncer', field: 'mc_fam_cancer' },
  { label: 'Otros', field: 'mc_fam_otros' },
];

export const PERSONALES_BOOL: ReadonlyArray<CampoSiNo> = [
  { label: 'Enfermedad cardiaca', field: 'mc_per_cardiaca' },
  { label: 'Enfermedad respiratoria', field: 'mc_per_respiratoria' },
  { label: 'Hipertensión arterial', field: 'mc_per_hta' },
  { label: 'Enfermedad renal', field: 'mc_per_renal' },
  { label: 'Enfermedad metabólica', field: 'mc_per_metabolica' },
  { label: 'Enfermedad cerebrovascular', field: 'mc_per_cerebrovascular' },
  { label: 'Tabaquismo', field: 'mc_per_tabaquismo' },
  { label: 'Alcohol', field: 'mc_per_alcohol' },
];

/**
 * Un grupo de Sí/Niega cuenta como diligenciado solo si TODOS están
 * respondidos. Antes se miraba uno solo (dolor torácico, cardiaca familiar…):
 * con ese marcado, la sección salía completa aunque faltaran los otros.
 */
function grupo(
  data: MedicalHistoryFull | null,
  label: string,
  campos: ReadonlyArray<CampoSiNo>,
  destino: string
): CampoCompletitud {
  const sinResponder = campos.filter((c) => !tieneValor(data?.[camelCampo(c.field)])).length;
  return {
    label: sinResponder > 0 && sinResponder < campos.length ? `${label} (${sinResponder} sin responder)` : label,
    value: sinResponder === 0 ? true : null,
    destino,
  };
}

export function camposPorSeccion(
  data: MedicalHistoryFull | null
): Record<CorpTabId, ReadonlyArray<CampoCompletitud>> {
  const d = data;
  return {
    c1: [
      { label: 'Fecha de nacimiento', value: d?.fechaNacimiento, destino: 'identificacion' },
      { label: 'Género', value: d?.generoBiologico, destino: 'identificacion' },
      { label: 'Empresa', value: d?.mcEmpresa, destino: 'identificacion' },
      { label: 'Ocupación', value: d?.ocupacion, destino: 'identificacion' },
      { label: 'EPS', value: d?.eps, destino: 'identificacion' },
      { label: 'Teléfono', value: d?.telefonoResidencia, destino: 'identificacion' },
      { label: 'Tipo de consulta', value: d?.tipoConsulta, destino: 'identificacion' },
      { label: 'Dirección', value: d?.mcDireccion, opcional: true, destino: 'identificacion' },
      { label: 'Correo', value: d?.email, opcional: true, destino: 'identificacion' },
      { label: 'RH', value: d?.grupoSanguineo, opcional: true, destino: 'identificacion' },
    ],
    c2: [
      { label: 'Motivo de consulta', value: d?.motivoConsultaTexto, destino: 'motivo' },
      { label: 'Enfermedad actual', value: d?.mcEnfermedadActual, destino: 'motivo' },
      grupo(d, 'Síntomas en ejercicio', SINTOMAS, 'sintomas'),
    ],
    c3: [
      grupo(d, 'Antecedentes familiares', FAMILIARES, 'familiares'),
      grupo(d, 'Antecedentes personales', PERSONALES_BOOL, 'personales'),
      { label: 'Osteomusculares', value: d?.mcPerOsteomuscular, destino: 'personales' },
      { label: 'Quirúrgicos', value: d?.mcPerQuirurgicos, destino: 'personales' },
      { label: 'Alérgicos', value: d?.mcPerAlergicos, destino: 'personales' },
      { label: 'Farmacológicos', value: d?.mcPerFarmacologicos, destino: 'personales' },
    ],
    c4: [
      { label: 'Minutos por sesión', value: d?.mcAfMinutosSesion, destino: 'registro' },
      { label: 'Sesiones por semana', value: d?.mcAfSesionesSemana, destino: 'registro' },
      { label: 'Meses de práctica', value: d?.mcAfMeses, destino: 'registro' },
      { label: 'Experiencia en gimnasio', value: d?.mcAfExperienciaGym, destino: 'registro' },
      { label: 'Dónde entrena', value: d?.mcAfModalidad, destino: 'registro' },
      { label: 'Objetivo', value: d?.mcAfObjetivo, destino: 'registro' },
    ],
    c5: [
      { label: 'Peso', value: d?.mcPeso, destino: 'signos' },
      { label: 'Talla', value: d?.mcTalla, destino: 'signos' },
      { label: 'TAS', value: d?.tas, destino: 'signos' },
      { label: 'TAD', value: d?.tad, destino: 'signos' },
      { label: 'Frecuencia cardiaca', value: d?.mcFrecCard, destino: 'signos' },
      { label: 'Revisión por sistemas', value: d?.mcRsTorax, destino: 'examen' },
      // Opcionales por decisión del equipo médico: no se toman de rutina.
      { label: 'SatO2', value: d?.mcSato2, opcional: true, destino: 'signos' },
      { label: 'Frecuencia respiratoria', value: d?.mcFrecResp, opcional: true, destino: 'signos' },
      { label: 'Perímetro abdominal', value: d?.mcPerimetroAbdominal, opcional: true, destino: 'signos' },
      // Los tests no se hacen a todos los pacientes. Eran obligatorios y la
      // lista al finalizar le reclamaba al médico tests que no había hecho
      // (reporte del 15-sep-2026).
      { label: 'Test de Ruffier', value: d?.mcRuffierFc2, opcional: true, destino: 'ruffier' },
      { label: 'Handgrip', value: d?.mcHandgripDer1, opcional: true, destino: 'handgrip' },
      { label: 'Observaciones del examen', value: d?.mcExamenObservaciones, opcional: true, destino: 'examen' },
    ],
    c6: [
      { label: 'Dx nutricional', value: d?.mcDxNutricional, destino: 'diagnosticos' },
      { label: 'Dx cardiovascular', value: d?.mcDxCardiovascular, destino: 'diagnosticos' },
      { label: 'Dx osteomuscular', value: d?.mcDxOsteomuscular, destino: 'diagnosticos' },
      { label: 'Riesgo ACSM', value: d?.mcRiesgoAcsm, destino: 'riesgo' },
      { label: 'Riesgo Bodytech', value: d?.mcRiesgoBodytech, destino: 'riesgo' },
      { label: 'Índice Downton', value: d?.downtonRiesgo, destino: 'downton' },
      { label: 'Aptitud', value: d?.aptitud, destino: 'riesgo' },
    ],
    c7: [
      { label: 'Análisis', value: d?.mcAnalisis, destino: 'analisis' },
      { label: 'Recomendaciones generales', value: d?.prescGenerales, destino: 'generales' },
      { label: 'Cardio', value: d?.prescCardioIntensidad, destino: 'cardio' },
      { label: 'Fuerza', value: d?.prescFuerzaIntensidad, destino: 'fuerza' },
      { label: 'Flexibilidad', value: d?.prescFlexTipo, destino: 'flexibilidad' },
      { label: 'Clase grupal', value: d?.prescClaseModalidad, opcional: true, destino: 'clases' },
      { label: 'Remisión', value: d?.mcRemision, opcional: true, destino: 'remision' },
    ],
  };
}

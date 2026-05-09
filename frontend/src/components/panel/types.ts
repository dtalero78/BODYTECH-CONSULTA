/**
 * Tipos compartidos del panel de consulta médica (Phase 1).
 *
 * NOTA: Este archivo es el "contrato" entre el backend y el panel.
 * Los nombres de campo deben mantenerse en sync con `backend/src/services/medical-history.service.ts`
 * (`EDITABLE_FIELDS`).
 */

export type TabId = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7';

export type CardId =
  | 'identidad'
  | 'residencia'
  | 'info-basica'
  | 'antecedentes'
  | 'composicion'
  | 'acsm'
  | 'downton'
  | string;

export type CardState = 'empty' | 'partial' | 'complete';

export type FieldValue = string | number | boolean | null | undefined;

/**
 * Forma de la respuesta de GET /api/video/medical-history/:id.
 * Incluye campos legacy y campos Phase 1 (camelCase derivado de snake_case).
 */
export interface MedicalHistoryFull {
  _id?: string;
  historiaId?: string;

  // ---- Identidad legacy ----
  numeroId?: string;
  primerNombre?: string;
  segundoNombre?: string;
  primerApellido?: string;
  segundoApellido?: string;
  celular?: string;
  email?: string;
  edad?: number;
  genero?: string;
  foto?: string;

  // ---- Empresa ----
  codEmpresa?: string;
  cargo?: string;
  tipoExamen?: string;

  // ---- Médicos legacy ----
  mdAntecedentes?: string;
  mdObsParaMiDocYa?: string;
  mdObservacionesCertificado?: string;
  mdRecomendacionesMedicasAdicionales?: string;
  mdConceptoFinal?: string;
  mdDx1?: string;
  mdDx2?: string;
  talla?: string;
  peso?: string;
  motivoConsulta?: string;
  diagnostico?: string;
  tratamiento?: string;
  ciudad?: string;
  eps?: string;
  fechaAtencion?: string | Date;
  fechaConsulta?: string | Date;
  atendido?: string;
  medico?: string;

  // ---- Antecedentes legacy (de formularios) ----
  antecedentesPersonales?: Record<string, boolean>;
  antecedentesFamiliaresDetalle?: Record<string, boolean>;

  // ---- Phase 1: Datos Básicos ----
  generoBiologico?: string;
  identidadGenero?: string;
  grupoSanguineo?: string;
  fechaNacimiento?: string | Date | null;
  comunidadEtnica?: string;
  pertenenciaEtnica?: string;
  estadoCivil?: string;
  paisResidencia?: string;
  municipio?: string;
  zonaTerritorial?: string;
  telefonoResidencia?: string;
  contactoEmergenciaNombre?: string;
  contactoEmergenciaTelefono?: string;
  contactoEmergenciaParentesco?: string;
  ocupacion?: string;
  tipoVinculacion?: string;
  entidadTerritorial?: string;
  categoriaDiscapacidad?: string;

  // ---- Phase 1: Anamnesis (placeholder hasta phase 2) ----
  objetivoBodytech?: string;
  modalidad?: string;
  servicioAtencion?: string;
  lugarAtencion?: string;
  puertaEntrada?: string;
  causa?: string;
  tipoConsulta?: string;
  motivoConsultaTexto?: string;
  antPatologicoFlag?: boolean;
  antPatologicoTipo?: string;
  antPatologicoObs?: string;
  antQuirurgicoFlag?: boolean;
  antQuirurgicoTipo?: string;
  antQuirurgicoObs?: string;
  antOsteomuscularFlag?: boolean;
  antOsteomuscularTipo?: string;
  antOsteomuscularObs?: string;
  antFarmacologicoFlag?: boolean;
  antFarmacologicoTipo?: string;
  antFarmacologicoObs?: string;
  antAlergicosFlag?: boolean;
  antAlergicosTipo?: string;
  antAlergicosObs?: string;
  antFamiliaresFlag?: boolean;
  antFamiliaresTipo?: string;
  antFamiliaresObs?: string;
  embarazoActual?: boolean;
  partos?: number;
  cesareas?: number;
  abortos?: number;
  fum?: string | Date | null;
  planificacion?: string;
  planificacionFamiliarFlag?: boolean;
  actividadFrecuencia?: string;
  actividadDuracion?: string;
  actividadDuracionMin?: number;
  actividadFuerzaSemanal?: number;
  actividadFuerzaSemanalLabel?: string;
  antQuirurgicoTiempo?: string;

  // ---- Phase 2: Riesgo ----
  downtonCaidas?: boolean;
  downtonEstadoMental?: boolean;
  downtonMedicamentos?: boolean;
  downtonMedAntiparkinson?: boolean;
  downtonMedAntidepresivos?: boolean;
  downtonMedOtros?: boolean;
  downtonDeficitsSensoriales?: boolean;
  downtonVisual?: boolean;
  downtonAuditivo?: boolean;
  downtonDefExtremidades?: boolean;
  downtonRiesgo?: string;

  acsmSedentarismo?: boolean;
  acsmTabaquismo?: boolean;
  acsmHipertension?: boolean;
  acsmDislipidemia?: boolean;
  acsmObesidad?: boolean;
  acsmEdad?: boolean;
  acsmFamiliarCardiaco?: boolean;
  acsmGenero?: boolean;
  acsmDiabetes?: boolean;
  acsmEnfPulmonar?: boolean;
  acsmEnfCardiovascular?: boolean;
  acsmEnfRenal?: boolean;
  acsmRiesgo?: string;

  btFactor1?: boolean;
  btFactor2?: boolean;
  btFactor3?: boolean;
  riesgoFinal?: string;

  // ---- Phase 2: Examen físico ----
  ccPesoAnterior?: number;
  ccPesoNuevo?: number;
  ccEstaturaAnterior?: number;
  ccEstaturaNuevo?: number;
  ccMasaMuscularAnterior?: number;
  ccMasaMuscularNuevo?: number;
  ccImcAnterior?: number;
  ccImcNuevo?: number;
  ccImmAnterior?: number;
  ccImmNuevo?: number;
  ccGrasaAnterior?: number;
  ccGrasaNuevo?: number;
  ccPerimetroAbdominalAnterior?: number;
  ccPerimetroAbdominalNuevo?: number;
  ccObservacion?: string;
  posturaEspalda?: string;
  posturaCadSup?: string;
  posturaCadInf?: string;
  hallazgosDescripcion?: string;
  hallazgosStretching?: string;
  hallazgosStretchingCm?: number;
  hallazgosObservaciones?: string;
  hallazgosDolor?: string;
  movTrenSuperior?: string;
  fuerzaSuperior?: number;
  fuerzaAbdominal?: number;
  fuerzaInferior?: number;
  tecnicaSentadilla?: string;
  estabilidadPlancha?: number;
  fcr?: number;
  fcm?: number;
  tas?: number;
  tad?: number;
  equilibrioUnipodal?: string;
  riesgoMarcha?: string;
  riesgoOm?: string;
  marchaEstacionaria?: string;

  // ---- Phase 1: Intervención y conducta (placeholder) ----
  intervencionAnalisis?: string;
  intervencionEducacionSi?: boolean;
  aptitud?: string;
  controlFecha?: string | Date | null;
  exoneracionPrograma?: boolean;

  // ---- Phase 3: Transcripción post-llamada ----
  /** 'pending' | 'processing' | 'done' | 'error' | null */
  transcriptionStatus?: string | null;
  transcriptionText?: string | null;

  // Cualquier otro campo que el backend devuelva
  [key: string]: unknown;
}

/**
 * Estado de un guardado en curso (auto-save).
 */
export interface SaveStatus {
  saving: boolean;
  lastSavedAt: Date | null;
  error: string | null;
}

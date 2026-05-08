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
  actividadFrecuencia?: string;
  actividadDuracionMin?: number;
  actividadFuerzaSemanal?: number;

  // ---- Phase 1: Riesgo (placeholder) ----
  downtonRiesgo?: string;
  acsmRiesgo?: string;
  riesgoFinal?: string;

  // ---- Phase 1: Examen físico (placeholder) ----
  ccPesoAnterior?: number;
  ccPesoNuevo?: number;
  ccObservacion?: string;

  // ---- Phase 1: Intervención y conducta (placeholder) ----
  intervencionAnalisis?: string;
  intervencionEducacionSi?: boolean;
  aptitud?: string;
  controlFecha?: string | Date | null;
  exoneracionPrograma?: boolean;

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

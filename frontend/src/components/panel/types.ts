/**
 * Tipos compartidos del panel de consulta médica (Phase 1).
 *
 * NOTA: Este archivo es el "contrato" entre el backend y el panel.
 * Los nombres de campo deben mantenerse en sync con `backend/src/services/medical-history.service.ts`
 * (`EDITABLE_FIELDS`).
 */

export type TabId = 't1' | 't2' | 't3' | 't4' | 't5' | 't6' | 't7' | 't8';

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

  // ---- Phase 5: nuevos campos ----
  antOsteomuscularLateralidad?: string;
  antOsteomuscularEvolucion?: string;
  antOsteomuscularLista?: string;
  antFamiliaresConsanguinidad?: string;
  actividadNivel?: string;
  posturaDescripcion?: string;
  equilibrioUnipodalSegundos?: number;

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
  // Phase 1 Downton (presentes en EDITABLE_FIELDS — agregados al tipo para evitar huérfanos backend).
  downtonDeambulacion?: boolean;
  downtonNeurologico?: boolean;
  downtonCardiovascular?: boolean;
  downtonMarcha?: boolean;
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
  // Phase 1 ACSM (presentes en EDITABLE_FIELDS — agregados al tipo para evitar huérfanos backend).
  acsmEdadHombre?: boolean;
  acsmEdadMujer?: boolean;
  acsmPrediabetes?: boolean;
  acsmSignosSintomas?: boolean;
  acsmEnfermedadConocida?: boolean;
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

  // ---- Phase 1: Intervención y conducta ----
  intervencionAnalisis?: string;
  intervencionTipoTecnologia?: string;
  intervencionEducacionSi?: boolean;
  intervencionEducacionTipo?: string;
  intervencionTipoMeta?: string;
  intervencionMetaTexto?: string;
  dxTecnologiaSalud?: string;
  dxProcedimiento?: string;
  dxTipo?: string;
  aptitud?: string;
  controlFecha?: string | Date | null;
  exoneracionPrograma?: boolean;

  // ---- Phase 3: Transcripción post-llamada ----
  /** 'pending' | 'processing' | 'done' | 'error' | null */
  transcriptionStatus?: string | null;
  transcriptionText?: string | null;

  // ---- Phase 4: Twilio Composition (escrito por backend tras el webhook room-completed) ----
  compositionSid?: string | null;

  // ---- Médico Corporativo (examen ocupacional presencial, sin videollamada) ----
  mcDireccion?: string;
  mcEnfermedadActual?: string;
  mcSintDolorToracico?: boolean;
  mcSintPalpitaciones?: boolean;
  mcSintDisnea?: boolean;
  mcSintEdemaMmii?: boolean;
  mcSintSincope?: boolean;
  mcSintClaudicacion?: boolean;
  mcSintObservaciones?: string;
  mcFamCardiaca?: boolean;
  mcFamRespiratoria?: boolean;
  mcFamMscIam?: boolean;
  mcFamHta?: boolean;
  mcFamCerebrovascular?: boolean;
  mcFamOtros?: boolean;
  mcFamDiabetes?: boolean;
  mcFamCancer?: boolean;
  mcFamObservaciones?: string;
  mcPerCardiaca?: boolean;
  mcPerRespiratoria?: boolean;
  mcPerTabaquismo?: boolean;
  mcPerRenal?: boolean;
  mcPerHta?: boolean;
  mcPerMetabolica?: boolean;
  mcPerCerebrovascular?: boolean;
  mcPerAlcohol?: boolean;
  mcPerVacunasCovid?: string;
  mcPerAntecedenteCovid?: string;
  mcPerOsteomuscular?: string;
  mcPerQuirurgicos?: string;
  mcPerAlergicos?: string;
  mcPerFarmacologicos?: string;
  mcPerParaclinicos?: string;
  mcPerAlimentacion?: string;
  mcPerObservaciones?: string;
  mcAfMinutosSesion?: number;
  mcAfMinutosSemana?: number;
  /** Nivel de ACTIVIDAD FÍSICA: Sedentario | Irregularmente activo | Activo. */
  mcAfClasificacion?: string;
  mcAfExperienciaGym?: boolean;
  mcAfMeses?: number;
  mcAfSesionesSemana?: number;
  mcAfHorasSedentario?: number;
  mcAfModalidad?: string;
  /** Nivel de ENTRENAMIENTO: Principiante | Intermedio | Avanzado. */
  mcAfNivel?: string;
  mcAfObjetivo?: string;
  // Reemplazados en la revisión de 2026-08 (se conservan para historias viejas).
  mcAfHorasDia?: number;
  mcAfHorasSemana?: number;
  mcAfRpe?: number;
  mcAfRecomendacion?: string;
  mcFrecCard?: number;
  mcFrecResp?: number;
  mcSato2?: number;
  mcPerimetroAbdominal?: number;
  mcTalla?: number;
  mcPctGrasa?: number;
  mcPctMusculo?: number;
  mcPeso?: number;
  mcGrasaVisceral?: number;
  mcImc?: number;
  mcTmb?: number;
  mcFcPicoPruebaEsfuerzo?: number;
  mcFcReserva?: number;
  mcFcReserva80?: number;
  mcFcReserva75?: number;
  mcFcReserva70?: number;
  mcFcReserva60?: number;
  mcFcTanaka?: number;
  mcFcPicoPredicha90?: number;
  mcFcPicoPredicha80?: number;
  mcFcPicoPredicha75?: number;
  mcFcPicoPredicha70?: number;
  mcFcPicoPredicha60?: number;
  mcRsCabeza?: string;
  mcRsParesCraneales?: string;
  mcRsFuerzaMmss?: string;
  mcRsFuerzaMmii?: string;
  mcRsCara?: string;
  mcRsAbdPelvis?: string;
  mcRsPushUps?: number;
  mcRsCuello?: string;
  mcRsGenitales?: string;
  mcRsAbdominales?: number;
  mcRsTorax?: string;
  mcRsPiel?: string;
  mcRsAbdomen?: string;
  mcRsPulsos?: string;
  mcRsCorazon?: string;
  mcRsRespiratorio?: string;
  mcRsOsteomuscular?: string;
  mcRuffierFc1?: number;
  mcRuffierFc2?: number;
  mcRuffierFc3?: number;
  mcRuffierResultado?: number;
  mcRuffierCalificacion?: string;
  mcHandgripDer1?: number;
  mcHandgripIzq1?: number;
  mcHandgripDer2?: number;
  mcHandgripIzq2?: number;
  mcHandgripPromedioDer?: number;
  mcHandgripPromedioIzq?: number;
  mcHandgripAsimetriaMm?: number;
  mcHandgripAsimetriaPct?: number;
  mcIcc?: string;
  mcPerimetroCadera?: number;
  mcIndiceCinturaTalla?: number;
  mcPropiocepcion?: string;
  mcPropiocepcionSegundos?: number;
  mcWells?: string;
  mcExamenObservaciones?: string;
  mcDxNutricional?: string;
  mcDxCardiovascular?: string;
  mcDxOsteomuscular?: string;
  mcDxCie10?: string;
  mcDxOsiics?: string;
  mcRiesgoAcsm?: string;
  mcRiesgoFramingham?: string;
  mcRiesgoBodytech?: string;
  /** Cuestionario Riesgo Bodytech (tri-estado: null = sin responder). */
  mcRbSintomasCv?: boolean | null;
  mcRbRazonNoEjercicio?: boolean | null;
  mcRbDolorOsteomuscularAf?: boolean | null;
  mcNivel?: string;
  mcAnalisis?: string;
  mcPrescripcionCardio?: string;
  mcPrescripcionFuerza?: string;
  mcPrescripcionFlexibilidad?: string;
  mcRemision?: string;

  // ---- Prescripción de ejercicio (tab t8, panel de consulta médica) ----
  prescGenerales?: string;
  prescCardioFrecuencia?: string;
  prescCardioIntensidad?: string;
  prescCardioTiempo?: string;
  prescCardioTipo?: string;
  prescCardioNotas?: string;
  prescFuerzaFrecuencia?: string;
  prescFuerzaIntensidad?: string;
  prescFuerzaSeries?: string;
  prescFuerzaRepeticiones?: string;
  /** 'Repeticiones' | 'Tiempo' — cómo se pauta cada serie. */
  prescFuerzaModoSerie?: string;
  prescFuerzaTipo?: string;
  prescFuerzaNotas?: string;
  prescFlexFrecuencia?: string;
  prescFlexTiempo?: string;
  prescFlexTipo?: string;
  prescFlexEnfasis?: string;
  prescClaseModalidad?: string;
  prescClaseNombre?: string;
  prescClaseReemplaza?: string;

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

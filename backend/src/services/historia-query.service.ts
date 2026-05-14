import postgresService from './postgres.service';
import { historiaClinicaRepository } from '../repositories';
import { generarHTMLHistoriaClinica } from '../helpers/historia-clinica-html';
import { SNAKE_KEYS, snakeToCamel } from './historia-field-coercion.service';

export interface AntecedentesPersonales {
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

export interface AntecedentesFamiliares {
  hereditarias?: boolean;
  geneticas?: boolean;
  diabetes?: boolean;
  hipertension?: boolean;
  infartos?: boolean;
  cancer?: boolean;
  trastornos?: boolean;
  infecciosas?: boolean;
}

export interface MedicalHistoryData {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datosNutricionales?: any;

  // Fechas y estado
  fechaAtencion?: Date;
  fechaConsulta?: Date;
  atendido?: string;
  medico?: string;
}

export interface PatientHistoryRecord {
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

class HistoriaQueryService {
  /**
   * Obtiene la historia clínica de un paciente desde PostgreSQL
   */
  async getMedicalHistory(historiaId: string, sedeId?: string): Promise<MedicalHistoryData | null> {
    try {
      console.log(`📋 Obteniendo historia clínica para ID: ${historiaId}`);

      // Run 4 — Multi-tenancy: la lectura se delega al repositorio que aplica
      // `AND h."sede_id" = $N` cuando `sedeId` está definido. El SQL del SELECT
      // (incluyendo el JOIN a `formularios` y todos los alias) vive ahora en
      // `HistoriaClinicaRepository.findById`.
      const row = await historiaClinicaRepository.findById(historiaId, sedeId);

      if (row) {
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
          // Phase 4 — Twilio Composition: la columna `composition_sid` se escribe
          // desde el webhook `roomCompletedWebhook`. NO está en EDITABLE_FIELD_DEFS
          // (no editable por la UI), por eso el spread `extra` (basado en
          // SNAKE_KEYS) no la incluye. Mapeo explícito para que el frontend la lea.
          compositionSid: row.composition_sid ?? null,
          fechaAtencion: row.fechaAtencion,
          fechaConsulta: row.fechaConsulta,
          atendido: row.atendido,
          medico: row.medico,
        } as MedicalHistoryData;
      }

      console.warn(`⚠️  No se encontró historia clínica para ${historiaId}`);
      return null;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('❌ Error obteniendo historia clínica:', msg);
      throw new Error('Error al obtener historia clínica del paciente');
    }
  }

  /**
   * Lista historias clínicas de personas atendidas con paginación y búsqueda
   */
  async getAtendidos(options: { page?: number; limit?: number; buscar?: string; sedeId?: string }): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPaginas: number;
  }> {
    try {
      const page = options.page || 1;
      const limit = options.limit || 20;
      const buscar = options.buscar?.trim();
      const sedeId = options.sedeId;

      console.log(
        `📋 Listando atendidos (página ${page}, limit ${limit}${
          buscar ? `, búsqueda: "${buscar}"` : ''
        })...`
      );

      // Run 4 — Multi-tenancy: delegamos al repositorio las dos queries
      // (count + select paginado). El SQL es idéntico al previo + filtro
      // opcional `AND h."sede_id" = $N`.
      const { rows: dataResult, total } = await historiaClinicaRepository.findAtendidos({
        page,
        limit,
        buscar,
        sedeId,
      });
      const totalPaginas = Math.ceil(total / limit);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

      console.log(
        `✅ Atendidos: ${data.length} registros (página ${page}/${totalPaginas}, total: ${total})`
      );

      return { data, total, page, limit, totalPaginas };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('❌ Error listando atendidos:', msg);
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
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('❌ Error generando preview HTML:', msg);
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('❌ Error obteniendo historial del paciente:', msg);
      throw new Error('Error al obtener historial de consultas del paciente');
    }
  }
}

export default new HistoriaQueryService();

import historiaClinicaPostgresService from './historia-clinica-postgres.service';
import { historiaClinicaRepository } from '../repositories';
import historiaQueryService from './historia-query.service';
import trepsiWebhookService from './trepsi-webhook.service';
import {
  EDITABLE_FIELDS,
  EDITABLE_FIELD_TYPE_MAP,
  coerceValue,
  FieldValue,
} from './historia-field-coercion.service';

export interface UpdateFieldResult {
  success: boolean;
  field?: string;
  value?: FieldValue;
  updatedAt?: string;
  error?: string;
  code?: number;
}

export interface UpdateMedicalHistoryPayload {
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  datosNutricionales?: any;
}

class HistoriaMutationService {
  /**
   * Actualiza un solo campo de la historia clínica (auto-save por field).
   * Phase 1 — Foundation.
   *
   * - Valida `field` contra la whitelist EDITABLE_FIELDS (sin esto NO se construye el SQL).
   * - Coerciona el valor según el tipo declarado.
   * - El nombre de columna se concatena luego de la whitelist; no hay riesgo de inyección.
   */
  async updateField(
    historiaId: string,
    field: string,
    rawValue: unknown,
    sedes?: string[]
  ): Promise<UpdateFieldResult> {
    if (!historiaId) {
      return { success: false, error: 'MISSING_ID', code: 400 };
    }
    if (typeof field !== 'string' || !EDITABLE_FIELDS.includes(field)) {
      return { success: false, error: 'INVALID_FIELD', code: 400 };
    }
    // Defensa adicional: rechazar si el campo no está en el type map (debería
    // ser imposible si EDITABLE_FIELDS y EDITABLE_FIELD_TYPE_MAP están en sync).
    if (!(field in EDITABLE_FIELD_TYPE_MAP)) {
      return { success: false, error: 'INVALID_FIELD', code: 400 };
    }

    const coerced = coerceValue(field, rawValue);
    if (!coerced.ok) {
      return { success: false, error: coerced.error, code: 400 };
    }

    const value = coerced.value;

    // Aislamiento por sede: si llega `sedes` (array), acotamos el UPDATE con
    // `AND COALESCE("sede_id",'bsl') = ANY($3::text[])` para que un usuario no
    // pueda escribir historias fuera de su alcance. `undefined` (caller interno
    // como transcripción) no lleva cláusula de sede.
    let sql: string;
    let params: unknown[];
    if (sedes !== undefined) {
      sql = `UPDATE "HistoriaClinica" SET "${field}" = $1, "_updatedDate" = NOW() WHERE "_id" = $2 AND COALESCE("sede_id", 'bsl') = ANY($3::text[]) RETURNING "_updatedDate"`;
      params = [value, historiaId, sedes];
    } else {
      sql = `UPDATE "HistoriaClinica" SET "${field}" = $1, "_updatedDate" = NOW() WHERE "_id" = $2 RETURNING "_updatedDate"`;
      params = [value, historiaId];
    }

    try {
      // El repo delega a `postgresService.query` vía `queryRaw`. Cuando la DB
      // falla y `query` devuelve `null`, `queryRaw` devuelve `{ rows: [],
      // rowCount: 0 }`. Necesitamos distinguir DB_ERROR (rows === null en el
      // mundo viejo) de NOT_FOUND (rowCount=0 con filas existentes). Para
      // preservar el contrato del test 'UPDATE no afectó filas (rowCount=0)
      // → 404 NOT_FOUND' y el del test que mockea null como DB_ERROR, hacemos
      // la llamada con try/catch envolvente — el repo propaga excepciones, y
      // `postgresService.query` SOLO devuelve null en error de cliente sin
      // throw. El mock de tests devuelve `[]` directamente → rowCount=0 →
      // NOT_FOUND. ✅
      const { rowCount, rows } = await historiaClinicaRepository.updateField(
        historiaId,
        sql,
        params
      );
      if (rowCount === 0) {
        return { success: false, error: 'NOT_FOUND', code: 404 };
      }
      const updatedAtRaw = rows[0]?._updatedDate ?? rows[0]?.['_updatedDate'];
      const updatedAt =
        updatedAtRaw instanceof Date ? updatedAtRaw.toISOString() : new Date().toISOString();
      return {
        success: true,
        field,
        value,
        updatedAt,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('❌ [updateField] Error:', msg);
      return { success: false, error: 'DB_ERROR', code: 500 };
    }
  }

  async updateMedicalHistory(
    payload: UpdateMedicalHistoryPayload,
    sedes?: string[]
  ): Promise<{ success: boolean; error?: string; code?: number }> {
    try {
      console.log(`💾 Actualizando historia clínica para ID: ${payload.historiaId}`);

      if (!payload.mdConceptoFinal) {
        // Validación previa al insert: el controller mapea code=400.
        return { success: false, error: 'CONCEPTO_FINAL_REQUIRED', code: 400 };
      }

      // PASO 0: Obtener datos base del paciente (delegado al query service para
      // mantener una sola fuente de verdad sobre la lectura — mutation→query
      // sin ciclo porque query NO importa mutation).
      // Aislamiento por sede: la carga base se acota a las sedes del actor; si
      // la historia no pertenece a su alcance, devuelve null → NOT_FOUND (no se
      // puede sobrescribir una historia de otra sede).
      const historiaBase = await historiaQueryService.getMedicalHistory(payload.historiaId, sedes);

      if (!historiaBase) {
        // No existe la historia o está fuera de alcance: el controller mapea code=404.
        return { success: false, error: 'NOT_FOUND', code: 404 };
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
        return { success: false, error: 'DB_ERROR', code: 500 };
      }

      console.log(`✅ [PostgreSQL] Historia clínica guardada exitosamente para ${payload.historiaId}`);

      // PASO 2: Si la cita es de Trepsi, encolar los resultados en el outbox
      // del webhook. Fire-and-forget: si falla, el médico ya guardó la HC.
      // El worker se encarga de reintentar.
      trepsiWebhookService
        .enqueue(payload.historiaId)
        .then((res) => {
          if (res.enqueued) {
            console.log(`📨 [Trepsi-Webhook] Encolado para historia ${payload.historiaId}`);
          } else if (res.reason && res.reason !== 'NOT_TREPSI') {
            console.log(`ℹ️  [Trepsi-Webhook] No encolado: ${res.reason}`);
          }
        })
        .catch((e) => {
          console.error(`⚠️  [Trepsi-Webhook] Error encolando: ${e?.message ?? e}`);
        });

      return { success: true };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // No exponer error.message crudo al cliente — el controller traduce a 500
      // genérico. Loguear server-side para diagnóstico.
      console.error('❌ Error actualizando historia clínica:', error?.message);
      return {
        success: false,
        error: 'INTERNAL_ERROR',
        code: 500,
      };
    }
  }
}

export default new HistoriaMutationService();

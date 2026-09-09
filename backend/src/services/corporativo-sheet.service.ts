// ============================================================================
// corporativo-sheet — cada valoración cerrada, una fila en la hoja de cálculo.
//
// ── El problema que resuelve ────────────────────────────────────────────────
// Para revisar las valoraciones del Médico Corporativo había que abrirlas una
// por una: descargar el PDF de cada historia a una carpeta y leerlas de a una.
// Nadie puede contestar "¿cuántas valoraciones hicimos este mes en tal empresa
// y cómo salieron?" sin abrir decenas de archivos.
//
// Cuando el médico aprieta "Finalizar consulta", la valoración entera queda
// como UNA fila de un Google Sheet: una hoja que se filtra, se ordena y se
// exporta. Deja de haber carpeta que revisar.
//
// ── Es un reflejo, no la fuente ────────────────────────────────────────────
// El dato ya quedó guardado en `HistoriaClinica` antes de llegar acá — cada
// campo se auto-guarda mientras el médico escribe. La hoja es una copia para
// leer. Si Google no responde, no se pierde nada: la fila queda pendiente en
// `corporativo_sheet_envio` y el worker reintenta.
//
// Por eso el encolado es fire-and-forget desde el controlador: que la hoja
// falle NO puede impedirle a un médico cerrar una consulta.
//
// ── Sólo Médico Corporativo ────────────────────────────────────────────────
// "Finalizar consulta" es el mismo botón para todos los paneles. El filtro está
// acá adentro (`esCorporativa`), en un solo lugar: se mira el `origen` de la
// cita, que lo elige quien agenda, y sólo si viene vacío se cae al respaldo de
// la especialidad del profesional. Una consulta de Trepsi o de la UMV no toca
// esta hoja.
// ============================================================================

import postgresService from './postgres.service';

const TIMEOUT_MS = 10_000;
const MAX_INTENTOS = 6;
const MAX_POR_CORRIDA = 25;

/** Espera entre reintentos, por número de intento ya hecho. */
const BACKOFF_SEG = [1, 10, 60, 300, 1800, 7200];

type Tipo = 'texto' | 'numero' | 'bool' | 'fecha';

interface Columna {
  /** Expresión SQL que produce el valor (columna de la tabla o cálculo). */
  sql: string;
  /** Encabezado que ve quien lee la hoja. */
  label: string;
  tipo: Tipo;
}

/**
 * Las columnas de la hoja, EN ORDEN. La primera es la llave: el Apps Script
 * busca `historiaId` en la columna A para actualizar la fila en vez de agregar
 * otra, así que mover esa columna de lugar rompería la idempotencia.
 *
 * Se omiten a propósito los campos de actividad física que quedaron fuera de
 * rotación en la revisión de ago-2026 (`mc_af_horas_dia`, `mc_af_horas_semana`,
 * `mc_af_rpe`, `mc_af_recomendacion`): sólo tienen dato en historias viejas y
 * agregarían cuatro columnas vacías a todas las nuevas.
 */
const COLUMNAS: ReadonlyArray<Columna> = [
  // ---- Identificación de la valoración ----
  { sql: 'h."_id"', label: 'historiaId', tipo: 'texto' },
  { sql: 'h."fechaConsulta"', label: 'Fecha del examen', tipo: 'fecha' },
  { sql: 'h."fechaAtencion"', label: 'Fecha agendada', tipo: 'fecha' },
  { sql: 'h."mc_empresa"', label: 'Empresa', tipo: 'texto' },
  { sql: 'h."numeroId"', label: 'Documento', tipo: 'texto' },
  {
    sql: `TRIM(CONCAT_WS(' ', h."primerNombre", h."segundoNombre", h."primerApellido", h."segundoApellido"))`,
    label: 'Paciente',
    tipo: 'texto',
  },
  { sql: 'h."celular"', label: 'Celular', tipo: 'texto' },
  { sql: 'h."email"', label: 'Correo', tipo: 'texto' },
  { sql: 'h."mc_direccion"', label: 'Dirección', tipo: 'texto' },
  { sql: 'p.nombre', label: 'Profesional', tipo: 'texto' },
  { sql: 'h."medico"', label: 'Código profesional', tipo: 'texto' },
  { sql: 'h."sede_id"', label: 'Sede', tipo: 'texto' },

  // ---- Anamnesis ----
  { sql: 'h."mc_enfermedad_actual"', label: 'Enfermedad actual', tipo: 'texto' },
  { sql: 'h."mc_sint_dolor_toracico"', label: 'Síntoma · dolor torácico', tipo: 'bool' },
  { sql: 'h."mc_sint_palpitaciones"', label: 'Síntoma · palpitaciones', tipo: 'bool' },
  { sql: 'h."mc_sint_disnea"', label: 'Síntoma · disnea', tipo: 'bool' },
  { sql: 'h."mc_sint_edema_mmii"', label: 'Síntoma · edema MMII', tipo: 'bool' },
  { sql: 'h."mc_sint_sincope"', label: 'Síntoma · síncope', tipo: 'bool' },
  { sql: 'h."mc_sint_claudicacion"', label: 'Síntoma · claudicación', tipo: 'bool' },
  { sql: 'h."mc_sint_observaciones"', label: 'Síntomas · observaciones', tipo: 'texto' },

  // ---- Antecedentes familiares ----
  { sql: 'h."mc_fam_cardiaca"', label: 'Familiar · cardíaca', tipo: 'bool' },
  { sql: 'h."mc_fam_respiratoria"', label: 'Familiar · respiratoria', tipo: 'bool' },
  { sql: 'h."mc_fam_msc_iam"', label: 'Familiar · MSC/IAM', tipo: 'bool' },
  { sql: 'h."mc_fam_hta"', label: 'Familiar · HTA', tipo: 'bool' },
  { sql: 'h."mc_fam_cerebrovascular"', label: 'Familiar · cerebrovascular', tipo: 'bool' },
  { sql: 'h."mc_fam_diabetes"', label: 'Familiar · diabetes', tipo: 'bool' },
  { sql: 'h."mc_fam_cancer"', label: 'Familiar · cáncer', tipo: 'bool' },
  { sql: 'h."mc_fam_otros"', label: 'Familiar · otros', tipo: 'bool' },
  { sql: 'h."mc_fam_observaciones"', label: 'Familiares · observaciones', tipo: 'texto' },

  // ---- Antecedentes personales ----
  { sql: 'h."mc_per_cardiaca"', label: 'Personal · cardíaca', tipo: 'bool' },
  { sql: 'h."mc_per_respiratoria"', label: 'Personal · respiratoria', tipo: 'bool' },
  { sql: 'h."mc_per_tabaquismo"', label: 'Personal · tabaquismo', tipo: 'bool' },
  { sql: 'h."mc_per_renal"', label: 'Personal · renal', tipo: 'bool' },
  { sql: 'h."mc_per_hta"', label: 'Personal · HTA', tipo: 'bool' },
  { sql: 'h."mc_per_metabolica"', label: 'Personal · metabólica', tipo: 'bool' },
  { sql: 'h."mc_per_cerebrovascular"', label: 'Personal · cerebrovascular', tipo: 'bool' },
  { sql: 'h."mc_per_alcohol"', label: 'Personal · alcohol', tipo: 'bool' },
  { sql: 'h."mc_per_vacunas_covid"', label: 'Vacunas COVID', tipo: 'texto' },
  { sql: 'h."mc_per_antecedente_covid"', label: 'Antecedente COVID', tipo: 'texto' },
  { sql: 'h."mc_per_osteomuscular"', label: 'Personal · osteomuscular', tipo: 'texto' },
  { sql: 'h."mc_per_quirurgicos"', label: 'Quirúrgicos', tipo: 'texto' },
  { sql: 'h."mc_per_alergicos"', label: 'Alérgicos', tipo: 'texto' },
  { sql: 'h."mc_per_farmacologicos"', label: 'Farmacológicos', tipo: 'texto' },
  { sql: 'h."mc_per_paraclinicos"', label: 'Paraclínicos', tipo: 'texto' },
  { sql: 'h."mc_per_alimentacion"', label: 'Alimentación', tipo: 'texto' },
  { sql: 'h."mc_per_observaciones"', label: 'Personales · observaciones', tipo: 'texto' },

  // ---- Actividad física ----
  { sql: 'h."mc_af_minutos_sesion"', label: 'AF · minutos por sesión', tipo: 'numero' },
  { sql: 'h."mc_af_minutos_semana"', label: 'AF · minutos por semana', tipo: 'numero' },
  { sql: 'h."mc_af_sesiones_semana"', label: 'AF · sesiones por semana', tipo: 'numero' },
  { sql: 'h."mc_af_clasificacion"', label: 'AF · clasificación', tipo: 'texto' },
  { sql: 'h."mc_af_experiencia_gym"', label: 'AF · experiencia en gimnasio', tipo: 'bool' },
  { sql: 'h."mc_af_meses"', label: 'AF · meses entrenando', tipo: 'numero' },
  { sql: 'h."mc_af_nivel"', label: 'AF · nivel de entrenamiento', tipo: 'texto' },
  { sql: 'h."mc_af_modalidad"', label: 'AF · modalidad', tipo: 'texto' },
  { sql: 'h."mc_af_objetivo"', label: 'AF · objetivo', tipo: 'texto' },
  { sql: 'h."mc_af_horas_sedentario"', label: 'AF · horas sedentario', tipo: 'numero' },

  // ---- Examen físico · signos ----
  { sql: 'h."mc_frec_card"', label: 'Frecuencia cardíaca', tipo: 'numero' },
  { sql: 'h."mc_frec_resp"', label: 'Frecuencia respiratoria', tipo: 'numero' },
  { sql: 'h."mc_sato2"', label: 'SatO2', tipo: 'numero' },
  { sql: 'h."tas"', label: 'TAS', tipo: 'numero' },
  { sql: 'h."tad"', label: 'TAD', tipo: 'numero' },

  // ---- Examen físico · composición corporal ----
  { sql: 'h."mc_talla"', label: 'Talla', tipo: 'numero' },
  { sql: 'h."mc_peso"', label: 'Peso', tipo: 'numero' },
  { sql: 'h."mc_imc"', label: 'IMC', tipo: 'numero' },
  { sql: 'h."mc_pct_grasa"', label: '% grasa', tipo: 'numero' },
  { sql: 'h."mc_pct_musculo"', label: '% músculo', tipo: 'numero' },
  { sql: 'h."mc_grasa_visceral"', label: 'Grasa visceral', tipo: 'numero' },
  { sql: 'h."mc_tmb"', label: 'TMB', tipo: 'numero' },
  { sql: 'h."mc_perimetro_abdominal"', label: 'Perímetro abdominal', tipo: 'numero' },
  { sql: 'h."mc_perimetro_cadera"', label: 'Perímetro cadera', tipo: 'numero' },
  { sql: 'h."mc_icc"', label: 'ICC', tipo: 'texto' },
  { sql: 'h."mc_indice_cintura_talla"', label: 'Índice cintura-talla', tipo: 'numero' },

  // ---- Examen físico · frecuencia cardíaca ----
  { sql: 'h."mc_fc_pico_prueba_esfuerzo"', label: 'FC pico prueba de esfuerzo', tipo: 'numero' },
  { sql: 'h."mc_fc_tanaka"', label: 'FC máx (Tanaka)', tipo: 'numero' },
  { sql: 'h."mc_fc_reserva"', label: 'FC de reserva', tipo: 'numero' },
  { sql: 'h."mc_fc_reserva_60"', label: 'FCR 60%', tipo: 'numero' },
  { sql: 'h."mc_fc_reserva_70"', label: 'FCR 70%', tipo: 'numero' },
  { sql: 'h."mc_fc_reserva_75"', label: 'FCR 75%', tipo: 'numero' },
  { sql: 'h."mc_fc_reserva_80"', label: 'FCR 80%', tipo: 'numero' },
  { sql: 'h."mc_fc_pico_predicha_60"', label: 'FC pico predicha 60%', tipo: 'numero' },
  { sql: 'h."mc_fc_pico_predicha_70"', label: 'FC pico predicha 70%', tipo: 'numero' },
  { sql: 'h."mc_fc_pico_predicha_75"', label: 'FC pico predicha 75%', tipo: 'numero' },
  { sql: 'h."mc_fc_pico_predicha_80"', label: 'FC pico predicha 80%', tipo: 'numero' },
  { sql: 'h."mc_fc_pico_predicha_90"', label: 'FC pico predicha 90%', tipo: 'numero' },

  // ---- Examen físico · revisión por sistemas ----
  { sql: 'h."mc_rs_cabeza"', label: 'RS · cabeza', tipo: 'texto' },
  { sql: 'h."mc_rs_cara"', label: 'RS · cara', tipo: 'texto' },
  { sql: 'h."mc_rs_cuello"', label: 'RS · cuello', tipo: 'texto' },
  { sql: 'h."mc_rs_torax"', label: 'RS · tórax', tipo: 'texto' },
  { sql: 'h."mc_rs_corazon"', label: 'RS · corazón', tipo: 'texto' },
  { sql: 'h."mc_rs_respiratorio"', label: 'RS · respiratorio', tipo: 'texto' },
  { sql: 'h."mc_rs_abdomen"', label: 'RS · abdomen', tipo: 'texto' },
  { sql: 'h."mc_rs_abd_pelvis"', label: 'RS · abdomen y pelvis', tipo: 'texto' },
  { sql: 'h."mc_rs_genitales"', label: 'RS · genitales', tipo: 'texto' },
  { sql: 'h."mc_rs_piel"', label: 'RS · piel', tipo: 'texto' },
  { sql: 'h."mc_rs_pulsos"', label: 'RS · pulsos', tipo: 'texto' },
  { sql: 'h."mc_rs_pares_craneales"', label: 'RS · pares craneales', tipo: 'texto' },
  { sql: 'h."mc_rs_osteomuscular"', label: 'RS · osteomuscular', tipo: 'texto' },
  { sql: 'h."mc_rs_fuerza_mmss"', label: 'RS · fuerza MMSS', tipo: 'texto' },
  { sql: 'h."mc_rs_fuerza_mmii"', label: 'RS · fuerza MMII', tipo: 'texto' },
  { sql: 'h."mc_rs_push_ups"', label: 'Push ups', tipo: 'numero' },
  { sql: 'h."mc_rs_abdominales"', label: 'Abdominales', tipo: 'numero' },

  // ---- Examen físico · pruebas ----
  { sql: 'h."mc_ruffier_fc1"', label: 'Ruffier FC1', tipo: 'numero' },
  { sql: 'h."mc_ruffier_fc2"', label: 'Ruffier FC2', tipo: 'numero' },
  { sql: 'h."mc_ruffier_fc3"', label: 'Ruffier FC3', tipo: 'numero' },
  { sql: 'h."mc_ruffier_resultado"', label: 'Ruffier resultado', tipo: 'numero' },
  { sql: 'h."mc_ruffier_calificacion"', label: 'Ruffier calificación', tipo: 'texto' },
  { sql: 'h."mc_handgrip_der_1"', label: 'Handgrip der. 1', tipo: 'numero' },
  { sql: 'h."mc_handgrip_der_2"', label: 'Handgrip der. 2', tipo: 'numero' },
  { sql: 'h."mc_handgrip_izq_1"', label: 'Handgrip izq. 1', tipo: 'numero' },
  { sql: 'h."mc_handgrip_izq_2"', label: 'Handgrip izq. 2', tipo: 'numero' },
  { sql: 'h."mc_handgrip_promedio_der"', label: 'Handgrip promedio der.', tipo: 'numero' },
  { sql: 'h."mc_handgrip_promedio_izq"', label: 'Handgrip promedio izq.', tipo: 'numero' },
  { sql: 'h."mc_handgrip_asimetria_mm"', label: 'Handgrip asimetría (mm)', tipo: 'numero' },
  { sql: 'h."mc_handgrip_asimetria_pct"', label: 'Handgrip asimetría (%)', tipo: 'numero' },
  { sql: 'h."mc_propiocepcion"', label: 'Propiocepción', tipo: 'texto' },
  { sql: 'h."mc_propiocepcion_segundos"', label: 'Propiocepción (seg)', tipo: 'numero' },
  { sql: 'h."mc_wells"', label: 'Wells', tipo: 'texto' },
  { sql: 'h."mc_examen_observaciones"', label: 'Examen · observaciones', tipo: 'texto' },

  // ---- Diagnósticos y riesgo ----
  { sql: 'h."mc_dx_nutricional"', label: 'Dx nutricional', tipo: 'texto' },
  { sql: 'h."mc_dx_cardiovascular"', label: 'Dx cardiovascular', tipo: 'texto' },
  { sql: 'h."mc_dx_osteomuscular"', label: 'Dx osteomuscular', tipo: 'texto' },
  { sql: 'h."mc_dx_cie10"', label: 'CIE-10', tipo: 'texto' },
  { sql: 'h."mc_dx_osiics"', label: 'OSIICS', tipo: 'texto' },
  { sql: 'h."mc_riesgo_acsm"', label: 'Riesgo ACSM', tipo: 'texto' },
  { sql: 'h."mc_riesgo_framingham"', label: 'Riesgo Framingham', tipo: 'texto' },
  { sql: 'h."mc_riesgo_bodytech"', label: 'Riesgo Bodytech', tipo: 'texto' },
  { sql: 'h."mc_rb_sintomas_cv"', label: 'RB · síntomas CV', tipo: 'bool' },
  { sql: 'h."mc_rb_razon_no_ejercicio"', label: 'RB · razón para no ejercitarse', tipo: 'bool' },
  { sql: 'h."mc_rb_dolor_osteomuscular_af"', label: 'RB · dolor osteomuscular en AF', tipo: 'bool' },
  { sql: 'h."mc_nivel"', label: 'Nivel', tipo: 'texto' },

  // ---- Análisis y prescripción ----
  { sql: 'h."mc_analisis"', label: 'Análisis', tipo: 'texto' },
  { sql: 'h."mc_prescripcion_cardio"', label: 'Prescripción · cardio', tipo: 'texto' },
  { sql: 'h."mc_prescripcion_fuerza"', label: 'Prescripción · fuerza', tipo: 'texto' },
  { sql: 'h."mc_prescripcion_flexibilidad"', label: 'Prescripción · flexibilidad', tipo: 'texto' },
  { sql: 'h."mc_remision"', label: 'Remisión', tipo: 'texto' },
];

export const ENCABEZADOS: ReadonlyArray<string> = COLUMNAS.map((c) => c.label);

const TZ_COLOMBIA_OFFSET_MIN = -5 * 60;

/**
 * Formatea un instante en hora de Colombia (UTC-5). Producción corre en UTC, así
 * que `new Date()` a secas mostraría el día equivocado después de las 7 p.m.
 */
function formatFecha(raw: unknown): string {
  if (raw == null || raw === '') return '';
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() + TZ_COLOMBIA_OFFSET_MIN * 60_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ` +
    `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`
  );
}

/**
 * Un valor de la base al valor que va en la celda.
 *
 * Los booleanos salen como "Sí"/"No" y no como TRUE/FALSE porque la hoja la lee
 * gente, no un programa. Los números salen como número para que el Sheet pueda
 * promediarlos; convertirlos a texto los volvería inútiles para eso.
 *
 * Las columnas de antecedentes son BOOLEAN DEFAULT FALSE, pero una historia
 * vieja puede tener NULL: eso es "nadie respondió", distinto de "no", y por eso
 * queda en blanco.
 */
export function formatCelda(valor: unknown, tipo: Tipo): string | number {
  if (valor === null || valor === undefined) return '';
  switch (tipo) {
    case 'bool':
      return valor === true || valor === 'true' || valor === 'Sí' || valor === 'SI' ? 'Sí' : 'No';
    case 'numero': {
      if (typeof valor === 'number') return Number.isFinite(valor) ? valor : '';
      // `Number('')` es 0, y un peso o un IMC en 0 se leen como una medición
      // que se tomó. Un campo que nadie llenó tiene que quedar vacío.
      const texto = String(valor).trim();
      if (texto === '') return '';
      const n = Number(texto);
      return Number.isFinite(n) ? n : '';
    }
    case 'fecha':
      return formatFecha(valor);
    default:
      return String(valor).trim();
  }
}

class CorporativoSheetService {
  /**
   * Deja la valoración lista para volcar y dispara el envío de una vez.
   *
   * Se llama al cerrar la consulta y NO se espera su resultado: el médico ya
   * terminó su trabajo, la hoja es un reflejo. Un `ON CONFLICT` que vuelve a
   * poner la fila en pendiente permite re-finalizar (el Apps Script actualiza la
   * fila existente en vez de duplicarla).
   *
   * Devuelve `false` cuando la consulta no es del Médico Corporativo — que es la
   * mayoría de las veces, y no es un error.
   */
  async encolar(historiaId: string): Promise<boolean> {
    if (!historiaId) return false;
    if (!(await this.esCorporativa(historiaId))) return false;

    await postgresService.query(
      `INSERT INTO corporativo_sheet_envio (historia_id, estado, intentos, proximo_intento_at)
            VALUES ($1, 'pendiente', 0, NOW())
       ON CONFLICT (historia_id) DO UPDATE
              SET estado = 'pendiente',
                  intentos = 0,
                  proximo_intento_at = NOW(),
                  ultimo_error = NULL`,
      [historiaId]
    );

    // Inmediato, para que la hoja esté al día en segundos y no en el próximo
    // barrido. Si falla, queda pendiente y el worker lo retoma.
    this.despacharPendientes().catch((e) => {
      console.error('[corporativo-sheet] despacho inmediato falló:', e?.message ?? e);
    });
    return true;
  }

  /**
   * ¿Esta historia es una valoración del Médico Corporativo?
   *
   * El `origen` lo elige quien agenda y es la respuesta correcta. El respaldo por
   * especialidad sólo cubre filas viejas que se crearon antes de que el campo
   * existiera; sin él, esas valoraciones nunca llegarían a la hoja.
   */
  private async esCorporativa(historiaId: string): Promise<boolean> {
    const rows = await postgresService.query(
      `SELECT h."origen",
              TRANSLATE(LOWER(COALESCE(p.especialidad, '')), 'áéíóúü', 'aeiouu') AS esp
         FROM "HistoriaClinica" h
         LEFT JOIN profesionales p ON p.codigo = h."medico" AND p.activo = TRUE
        WHERE h."_id" = $1
        LIMIT 1`,
      [historiaId]
    );
    const row = rows?.[0];
    if (!row) return false;
    const origen = String(row.origen ?? '').trim().toLowerCase();
    if (origen) return origen === 'corporativo';
    return String(row.esp ?? '').trim() === 'medico corporativo';
  }

  /**
   * Vuelca a la hoja las valoraciones pendientes cuyo reintento ya venció.
   *
   * El claim (`UPDATE … RETURNING` que sube `intentos` antes de enviar) evita que
   * dos corridas manden la misma fila: si el proceso muriera en medio del POST,
   * la fila reaparece cuando venza su backoff, no queda en el limbo.
   */
  async despacharPendientes(): Promise<{ enviadas: number; fallidas: number }> {
    const url = process.env.CORPORATIVO_SHEET_URL;
    if (!url) return { enviadas: 0, fallidas: 0 };

    const pendientes = await postgresService.query(
      `UPDATE corporativo_sheet_envio
          SET intentos = intentos + 1,
              proximo_intento_at = NOW() + INTERVAL '2 hours'
        WHERE historia_id IN (
                SELECT historia_id
                  FROM corporativo_sheet_envio
                 WHERE estado = 'pendiente'
                   AND proximo_intento_at <= NOW()
                 ORDER BY proximo_intento_at
                 LIMIT ${MAX_POR_CORRIDA}
                 FOR UPDATE SKIP LOCKED
              )
    RETURNING historia_id, intentos`,
      []
    );
    if (!pendientes || pendientes.length === 0) return { enviadas: 0, fallidas: 0 };

    let enviadas = 0;
    let fallidas = 0;
    for (const p of pendientes) {
      const historiaId = String(p.historia_id);
      const intentos = Number(p.intentos);
      try {
        const fila = await this.construirFila(historiaId);
        if (!fila) {
          // La historia se borró entre el encolado y el envío. No hay nada que
          // reintentar.
          await this.marcar(historiaId, 'fallido', 'La historia ya no existe');
          fallidas++;
          continue;
        }
        await this.enviar(url, fila);
        await this.marcar(historiaId, 'enviado', null);
        enviadas++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        fallidas++;
        if (intentos >= MAX_INTENTOS) {
          await this.marcar(historiaId, 'fallido', msg);
          console.error(
            `[corporativo-sheet] ${historiaId} agotó ${MAX_INTENTOS} intentos: ${msg}`
          );
        } else {
          const seg = BACKOFF_SEG[Math.min(intentos, BACKOFF_SEG.length - 1)];
          await postgresService.query(
            `UPDATE corporativo_sheet_envio
                SET proximo_intento_at = NOW() + ($2 || ' seconds')::interval,
                    ultimo_error = $3
              WHERE historia_id = $1`,
            [historiaId, String(seg), msg.slice(0, 500)]
          );
        }
      }
    }
    return { enviadas, fallidas };
  }

  /** Lee la historia y la convierte en la fila de la hoja, en el orden de COLUMNAS. */
  private async construirFila(historiaId: string): Promise<Array<string | number> | null> {
    const select = COLUMNAS.map((c, i) => `${c.sql} AS c${i}`).join(', ');
    const rows = await postgresService.query(
      `SELECT ${select}
         FROM "HistoriaClinica" h
         LEFT JOIN profesionales p ON p.codigo = h."medico" AND p.activo = TRUE
        WHERE h."_id" = $1
        LIMIT 1`,
      [historiaId]
    );
    const row = rows?.[0];
    if (!row) return null;
    return COLUMNAS.map((c, i) => formatCelda(row[`c${i}`], c.tipo));
  }

  /**
   * POST a la Apps Script web app.
   *
   * `redirect: 'manual'` a propósito: Apps Script responde 302 al /exec hacia
   * googleusercontent.com, y el doPost (con su escritura) YA se ejecutó. Seguir
   * ese redirect de forma anónima devuelve un error de Google que nos haría creer
   * que falló → reintento → fila escrita dos veces. El 302 es el éxito. (Mismo
   * criterio que `whatsapp-leads.service.ts`.)
   */
  private async enviar(url: string, fila: Array<string | number>): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: process.env.CORPORATIVO_SHEET_TOKEN || '',
          encabezados: ENCABEZADOS,
          fila,
        }),
        signal: controller.signal,
      });
      if (res.status >= 200 && res.status < 400) return;
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async marcar(
    historiaId: string,
    estado: 'enviado' | 'fallido',
    error: string | null
  ): Promise<void> {
    await postgresService.query(
      `UPDATE corporativo_sheet_envio
          SET estado = $2,
              ultimo_error = $3,
              enviado_en = CASE WHEN $2 = 'enviado' THEN NOW() ELSE enviado_en END
        WHERE historia_id = $1`,
      [historiaId, estado, error?.slice(0, 500) ?? null]
    );
  }

  /** Bitácora para el endpoint de administración. */
  async estado(limite = 50): Promise<unknown[]> {
    const rows = await postgresService.query(
      `SELECT historia_id, estado, intentos, proximo_intento_at, enviado_en, ultimo_error
         FROM corporativo_sheet_envio
        ORDER BY COALESCE(enviado_en, encolado_en) DESC
        LIMIT $1`,
      [limite]
    );
    return rows ?? [];
  }

  /**
   * Reencola valoraciones ya cerradas — para el arranque (las que se cerraron
   * antes de que existiera la hoja) o para rehacer una tanda que falló.
   */
  async reencolar(desde?: string): Promise<number> {
    const rows = await postgresService.query(
      `INSERT INTO corporativo_sheet_envio (historia_id, estado, intentos, proximo_intento_at)
            SELECT h."_id", 'pendiente', 0, NOW()
              FROM "HistoriaClinica" h
             WHERE h."origen" = 'corporativo'
               AND h."fechaConsulta" IS NOT NULL
               AND ($1::timestamptz IS NULL OR h."fechaConsulta" >= $1::timestamptz)
       ON CONFLICT (historia_id) DO UPDATE
              SET estado = 'pendiente',
                  intentos = 0,
                  proximo_intento_at = NOW(),
                  ultimo_error = NULL
         RETURNING historia_id`,
      [desde ?? null]
    );
    return rows?.length ?? 0;
  }
}

export default new CorporativoSheetService();

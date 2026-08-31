import { Pool, PoolClient } from 'pg';

/**
 * Servicio de conexión a PostgreSQL
 * Maneja la conexión y queries a la base de datos PostgreSQL de Digital Ocean
 */
class PostgresService {
  private pool: Pool | null = null;

  constructor() {
    this.initializePool();
  }

  /**
   * Inicializa el pool de conexiones a PostgreSQL
   */
  private initializePool(): void {
    try {
      this.pool = new Pool({
        user: process.env.POSTGRES_USER || 'doadmin',
        password: process.env.POSTGRES_PASSWORD,
        host: process.env.POSTGRES_HOST || 'bslpostgres-do-user-19197755-0.k.db.ondigitalocean.com',
        port: parseInt(process.env.POSTGRES_PORT || '25060'),
        database: process.env.POSTGRES_DATABASE || 'defaultdb',
        ssl: {
          rejectUnauthorized: false, // Digital Ocean requires SSL
        },
        max: 20, // Máximo de conexiones en el pool
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      });

      this.pool.on('error', (err) => {
        console.error('❌ [PostgreSQL] Error inesperado en el pool:', err);
      });

      console.log('✅ [PostgreSQL] Pool de conexiones inicializado');
    } catch (error) {
      console.error('❌ [PostgreSQL] Error inicializando pool:', error);
      this.pool = null;
    }
  }

  /**
   * Obtiene un cliente del pool
   */
  async getClient(): Promise<PoolClient | null> {
    if (!this.pool) {
      console.error('❌ [PostgreSQL] Pool no inicializado');
      return null;
    }

    try {
      const client = await this.pool.connect();
      return client;
    } catch (error) {
      console.error('❌ [PostgreSQL] Error obteniendo cliente:', error);
      return null;
    }
  }

  /**
   * Ejecuta una query y retorna los resultados
   */
  async query(text: string, params?: any[]): Promise<any[] | null> {
    const client = await this.getClient();
    if (!client) return null;

    try {
      const result = await client.query(text, params);
      return result.rows;
    } catch (error) {
      console.error('❌ [PostgreSQL] Error ejecutando query:', error);
      console.error('Query:', text);
      console.error('Params:', params);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Cierra el pool de conexiones (para cleanup)
   */
  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      console.log('✅ [PostgreSQL] Pool de conexiones cerrado');
    }
  }

  /**
   * Verifica la conectividad con la base de datos
   */
  async testConnection(): Promise<boolean> {
    try {
      const result = await this.query('SELECT NOW()');
      if (result && result.length > 0) {
        console.log('✅ [PostgreSQL] Conexión exitosa');
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ [PostgreSQL] Error de conexión:', error);
      return false;
    }
  }

  /**
   * Ejecuta migraciones automáticas para crear tablas necesarias
   */
  async runMigrations(): Promise<void> {
    try {
      await this.query(`
        CREATE TABLE IF NOT EXISTS "HistoriaClinica" (
          "_id" TEXT PRIMARY KEY,
          "_createdDate" TIMESTAMPTZ DEFAULT NOW(),
          "_updatedDate" TIMESTAMPTZ DEFAULT NOW(),
          "numeroId" TEXT,
          "primerNombre" TEXT,
          "segundoNombre" TEXT,
          "primerApellido" TEXT,
          "segundoApellido" TEXT,
          "celular" TEXT,
          "email" TEXT,
          "codEmpresa" TEXT,
          "empresa" TEXT,
          "cargo" TEXT,
          "tipoExamen" TEXT,
          "mdAntecedentes" TEXT,
          "mdObsParaMiDocYa" TEXT,
          "mdObservacionesCertificado" TEXT,
          "mdRecomendacionesMedicasAdicionales" TEXT,
          "mdConceptoFinal" TEXT,
          "mdDx1" TEXT,
          "mdDx2" TEXT,
          "talla" TEXT,
          "peso" TEXT,
          "motivoConsulta" TEXT,
          "diagnostico" TEXT,
          "tratamiento" TEXT,
          "fechaAtencion" TEXT,
          "fechaConsulta" TIMESTAMPTZ,
          "atendido" TEXT,
          "pvEstado" TEXT,
          "medico" TEXT,
          "ciudad" TEXT,
          "examenes" TEXT,
          "horaAtencion" TEXT,
          "eps" TEXT,
          "datosNutricionales" JSONB DEFAULT NULL
        )
      `);
      // Agregar columna datosNutricionales si no existe (para DBs existentes)
      await this.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'HistoriaClinica' AND column_name = 'datosNutricionales'
          ) THEN
            ALTER TABLE "HistoriaClinica" ADD COLUMN "datosNutricionales" JSONB DEFAULT NULL;
          END IF;
        END $$;
      `);

      // ===== Phase 1 — Foundation: ampliación del esquema HistoriaClinica =====
      // Convención: columnas nuevas en snake_case con DOUBLE QUOTES.
      // Postgres >= 9.6 soporta ADD COLUMN IF NOT EXISTS (idempotente).
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          -- Datos Básicos
          ADD COLUMN IF NOT EXISTS "tipo_documento" VARCHAR(10),
          ADD COLUMN IF NOT EXISTS "genero_biologico" VARCHAR(20),
          ADD COLUMN IF NOT EXISTS "identidad_genero" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "grupo_sanguineo" VARCHAR(5),
          ADD COLUMN IF NOT EXISTS "fecha_nacimiento" DATE,
          ADD COLUMN IF NOT EXISTS "comunidad_etnica" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "pertenencia_etnica" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "estado_civil" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "pais_residencia" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "municipio" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "zona_territorial" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "telefono_residencia" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "contacto_emergencia_nombre" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "contacto_emergencia_telefono" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "contacto_emergencia_parentesco" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "ocupacion" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "tipo_vinculacion" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "entidad_territorial" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "categoria_discapacidad" VARCHAR(30),

          -- Anamnesis
          ADD COLUMN IF NOT EXISTS "objetivo_bodytech" TEXT,
          ADD COLUMN IF NOT EXISTS "modalidad" VARCHAR(40) DEFAULT 'Intramural',
          ADD COLUMN IF NOT EXISTS "servicio_atencion" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "lugar_atencion" VARCHAR(40) DEFAULT 'Institucional',
          ADD COLUMN IF NOT EXISTS "puerta_entrada" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "causa" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "tipo_consulta" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "motivo_consulta_texto" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_patologico_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_patologico_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_patologico_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_quirurgico_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_quirurgico_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_quirurgico_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_farmacologico_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_farmacologico_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_farmacologico_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_alergicos_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_alergicos_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_alergicos_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "ant_familiares_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "ant_familiares_tipo" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "ant_familiares_obs" TEXT,
          ADD COLUMN IF NOT EXISTS "embarazo_actual" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "partos" INTEGER,
          ADD COLUMN IF NOT EXISTS "cesareas" INTEGER,
          ADD COLUMN IF NOT EXISTS "abortos" INTEGER,
          ADD COLUMN IF NOT EXISTS "fum" DATE,
          ADD COLUMN IF NOT EXISTS "planificacion" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "actividad_frecuencia" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "actividad_duracion_min" INTEGER,
          ADD COLUMN IF NOT EXISTS "actividad_fuerza_semanal" INTEGER,

          -- Clasificación de Riesgo (Downton)
          ADD COLUMN IF NOT EXISTS "downton_caidas" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_medicamentos" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_deficits_sensoriales" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_estado_mental" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_deambulacion" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_neurologico" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_cardiovascular" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_visual" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_auditivo" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_marcha" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_riesgo" VARCHAR(20),

          -- Clasificación de Riesgo (ACSM)
          ADD COLUMN IF NOT EXISTS "acsm_edad_hombre" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_edad_mujer" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_familiar_cardiaco" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_tabaquismo" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_sedentarismo" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_obesidad" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_hipertension" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_dislipidemia" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_prediabetes" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_diabetes" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_signos_sintomas" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_enfermedad_conocida" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_riesgo" VARCHAR(20),

          -- Clasificación de Riesgo (Bodytech)
          ADD COLUMN IF NOT EXISTS "bt_factor_1" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "bt_factor_2" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "bt_factor_3" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "riesgo_final" VARCHAR(20),

          -- Examen físico — composición corporal
          ADD COLUMN IF NOT EXISTS "cc_peso_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_peso_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_estatura_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_estatura_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_masa_muscular_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_masa_muscular_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_imc_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_imc_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_imm_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_imm_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_grasa_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_grasa_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_perimetro_abdominal_anterior" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_perimetro_abdominal_nuevo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "cc_observacion" TEXT,

          -- Examen físico — postura y hallazgos
          ADD COLUMN IF NOT EXISTS "postura_espalda" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "postura_cad_sup" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "postura_cad_inf" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "hallazgos_descripcion" TEXT,
          ADD COLUMN IF NOT EXISTS "hallazgos_stretching" TEXT,
          ADD COLUMN IF NOT EXISTS "hallazgos_observaciones" TEXT,
          ADD COLUMN IF NOT EXISTS "hallazgos_dolor" TEXT,
          ADD COLUMN IF NOT EXISTS "mov_tren_superior" VARCHAR(60),

          -- Examen físico — fuerza
          ADD COLUMN IF NOT EXISTS "fuerza_superior" INTEGER,
          ADD COLUMN IF NOT EXISTS "fuerza_abdominal" INTEGER,
          ADD COLUMN IF NOT EXISTS "fuerza_inferior" INTEGER,
          ADD COLUMN IF NOT EXISTS "tecnica_sentadilla" TEXT,
          ADD COLUMN IF NOT EXISTS "estabilidad_plancha" INTEGER,

          -- Examen físico — signos vitales
          ADD COLUMN IF NOT EXISTS "fcr" INTEGER,
          ADD COLUMN IF NOT EXISTS "fcm" INTEGER,
          ADD COLUMN IF NOT EXISTS "tas" INTEGER,
          ADD COLUMN IF NOT EXISTS "tad" INTEGER,

          -- Examen físico — equilibrio / marcha
          ADD COLUMN IF NOT EXISTS "equilibrio_unipodal" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "riesgo_marcha" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "marcha_estacionaria" TEXT,
          ADD COLUMN IF NOT EXISTS "riesgo_om" VARCHAR(20),

          -- Intervención y procedimiento
          ADD COLUMN IF NOT EXISTS "intervencion_analisis" TEXT,
          ADD COLUMN IF NOT EXISTS "intervencion_tipo_tecnologia" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "intervencion_educacion_si" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "intervencion_educacion_tipo" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "intervencion_tipo_meta" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "intervencion_meta_texto" TEXT,
          ADD COLUMN IF NOT EXISTS "dx_tecnologia_salud" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "dx_procedimiento" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "dx_tipo" VARCHAR(60),

          -- Conducta
          ADD COLUMN IF NOT EXISTS "aptitud" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "control_fecha" DATE,
          ADD COLUMN IF NOT EXISTS "exoneracion_programa" BOOLEAN DEFAULT FALSE,

          -- ===== Phase 2 — Anamnesis / Riesgo / Examen físico =====
          -- Anamnesis (campos adicionales)
          ADD COLUMN IF NOT EXISTS "ant_quirurgico_tiempo" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "planificacion_familiar_flag" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "actividad_duracion" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "actividad_fuerza_semanal_label" VARCHAR(40),

          -- Downton (medicamentos detallados + déficits sensoriales detallados)
          ADD COLUMN IF NOT EXISTS "downton_med_antiparkinson" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_med_antidepresivos" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_med_otros" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "downton_def_extremidades" BOOLEAN DEFAULT FALSE,

          -- ACSM (factores Phase 2)
          ADD COLUMN IF NOT EXISTS "acsm_edad" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_genero" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_enf_pulmonar" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_enf_cardiovascular" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "acsm_enf_renal" BOOLEAN DEFAULT FALSE,

          -- Examen físico — stretching numérico
          ADD COLUMN IF NOT EXISTS "hallazgos_stretching_cm" NUMERIC(5,2),

          -- Cuántas veces se reprogramó ESTA cita desde el link del afiliado.
          -- Sostiene el tope de auto-reprogramaciones (ver TOPE_REPROGRAMACIONES).
          ADD COLUMN IF NOT EXISTS "reprogramaciones" INTEGER NOT NULL DEFAULT 0,

          -- ===== Phase 3 — Transcripción post-llamada =====
          ADD COLUMN IF NOT EXISTS "transcription_status" TEXT,
          ADD COLUMN IF NOT EXISTS "transcription_text" TEXT,

          -- ===== Phase 4 — Twilio Compositions =====
          ADD COLUMN IF NOT EXISTS "composition_sid" TEXT,
          ADD COLUMN IF NOT EXISTS "composition_status" TEXT,
          ADD COLUMN IF NOT EXISTS "composition_completed_at" TIMESTAMPTZ,

          -- ===== Phase 5 — Mejoras clínicas historia =====
          -- Antecedente osteomuscular (campos adicionales)
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_lateralidad" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_evolucion" VARCHAR(50),

          -- Antecedente familiar (consanguinidad)
          ADD COLUMN IF NOT EXISTS "ant_familiares_consanguinidad" VARCHAR(100),

          -- Actividad física (nivel calculado)
          ADD COLUMN IF NOT EXISTS "actividad_nivel" VARCHAR(50),

          -- Postura (descripción libre)
          ADD COLUMN IF NOT EXISTS "postura_descripcion" TEXT,

          -- Equilibrio unipodal (segundos)
          ADD COLUMN IF NOT EXISTS "equilibrio_unipodal_segundos" INTEGER,

          -- Phase 5: lista JSON de antecedentes osteomusculares múltiples
          ADD COLUMN IF NOT EXISTS "ant_osteomuscular_lista" TEXT
      `);

      // ===== Médico Corporativo — examen ocupacional presencial (sin videollamada) =====
      // `email` (identificación) ya existe en la tabla base — se whitelistea en
      // historia-field-coercion.service.ts, no requiere migración.
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          -- Identificación
          ADD COLUMN IF NOT EXISTS "mc_direccion" VARCHAR(200),

          -- Enfermedad actual
          ADD COLUMN IF NOT EXISTS "mc_enfermedad_actual" TEXT,

          -- Síntomas en ejercicio
          ADD COLUMN IF NOT EXISTS "mc_sint_dolor_toracico" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_palpitaciones" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_disnea" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_edema_mmii" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_sincope" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_claudicacion" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_sint_observaciones" TEXT,

          -- Antecedentes familiares
          ADD COLUMN IF NOT EXISTS "mc_fam_cardiaca" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_respiratoria" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_msc_iam" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_hta" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_cerebrovascular" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_otros" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_diabetes" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_cancer" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_fam_observaciones" TEXT,

          -- Antecedentes personales
          ADD COLUMN IF NOT EXISTS "mc_per_cardiaca" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_respiratoria" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_tabaquismo" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_renal" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_hta" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_metabolica" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_cerebrovascular" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_alcohol" BOOLEAN DEFAULT FALSE,
          ADD COLUMN IF NOT EXISTS "mc_per_vacunas_covid" VARCHAR(100),
          ADD COLUMN IF NOT EXISTS "mc_per_antecedente_covid" VARCHAR(100),
          ADD COLUMN IF NOT EXISTS "mc_per_osteomuscular" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_quirurgicos" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_alergicos" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_farmacologicos" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_paraclinicos" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_alimentacion" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_per_observaciones" TEXT,

          -- Registro de actividad física
          ADD COLUMN IF NOT EXISTS "mc_af_horas_dia" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_horas_semana" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_meses" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_sesiones_semana" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_rpe" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_horas_sedentario" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_af_modalidad" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_af_recomendacion" VARCHAR(100),
          ADD COLUMN IF NOT EXISTS "mc_af_nivel" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_af_objetivo" VARCHAR(100),

          -- Examen físico — signos
          ADD COLUMN IF NOT EXISTS "mc_frec_card" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_frec_resp" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_sato2" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_perimetro_abdominal" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_talla" NUMERIC(5,2),

          -- Examen físico — composición corporal
          ADD COLUMN IF NOT EXISTS "mc_pct_grasa" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_pct_musculo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_peso" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_grasa_visceral" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_imc" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_tmb" NUMERIC(7,2),

          -- Examen físico — parámetros de frecuencia cardíaca (Tanaka, %FCR, Karvonen)
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_prueba_esfuerzo" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_reserva" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_reserva_80" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_reserva_75" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_reserva_70" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_reserva_60" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_tanaka" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_predicha_90" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_predicha_80" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_predicha_75" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_predicha_70" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_fc_pico_predicha_60" NUMERIC(5,2),

          -- Examen físico — revisión por sistemas
          ADD COLUMN IF NOT EXISTS "mc_rs_cabeza" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_pares_craneales" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_fuerza_mmss" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "mc_rs_fuerza_mmii" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "mc_rs_cara" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_abd_pelvis" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_push_ups" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_rs_cuello" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_genitales" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_abdominales" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_rs_torax" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_piel" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_abdomen" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_pulsos" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_rs_corazon" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_rs_respiratorio" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_rs_osteomuscular" TEXT,

          -- Examen físico — Ruffier
          ADD COLUMN IF NOT EXISTS "mc_ruffier_fc1" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_ruffier_fc2" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_ruffier_fc3" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_ruffier_resultado" NUMERIC(6,2),
          ADD COLUMN IF NOT EXISTS "mc_ruffier_calificacion" VARCHAR(30),

          -- Examen físico — Handgrip (dinamometría)
          ADD COLUMN IF NOT EXISTS "mc_handgrip_der_1" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_izq_1" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_der_2" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_izq_2" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_promedio_der" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_promedio_izq" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_asimetria_mm" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_handgrip_asimetria_pct" NUMERIC(5,2),

          -- Examen físico — observaciones finales
          ADD COLUMN IF NOT EXISTS "mc_icc" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_wells" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_examen_observaciones" TEXT,

          -- Diagnósticos
          ADD COLUMN IF NOT EXISTS "mc_dx_nutricional" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_dx_cardiovascular" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_dx_osteomuscular" VARCHAR(200),
          ADD COLUMN IF NOT EXISTS "mc_dx_cie10" VARCHAR(20),
          ADD COLUMN IF NOT EXISTS "mc_dx_osiics" VARCHAR(20),

          -- Riesgo
          ADD COLUMN IF NOT EXISTS "mc_riesgo_acsm" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_riesgo_framingham" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_riesgo_bodytech" VARCHAR(50),
          ADD COLUMN IF NOT EXISTS "mc_nivel" VARCHAR(50),

          -- Análisis, prescripción de ejercicio y remisión
          ADD COLUMN IF NOT EXISTS "mc_analisis" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_prescripcion_cardio" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_prescripcion_fuerza" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_prescripcion_flexibilidad" TEXT,
          ADD COLUMN IF NOT EXISTS "mc_remision" VARCHAR(150),

          -- Registro de actividad física — revisión con el equipo médico (2026-08).
          -- El volumen se mide en MINUTOS y se separan las dos clasificaciones
          -- (actividad física vs. nivel de entrenamiento). Reemplazan a
          -- mc_af_horas_dia / mc_af_horas_semana / mc_af_rpe / mc_af_recomendacion,
          -- que se conservan por compatibilidad con historias ya diligenciadas.
          ADD COLUMN IF NOT EXISTS "mc_af_minutos_sesion" NUMERIC(6,2),
          ADD COLUMN IF NOT EXISTS "mc_af_minutos_semana" NUMERIC(7,2),
          ADD COLUMN IF NOT EXISTS "mc_af_clasificacion" VARCHAR(40),
          ADD COLUMN IF NOT EXISTS "mc_af_experiencia_gym" BOOLEAN,

          -- Examen físico — misma revisión. El ICC se movió a composición
          -- corporal (necesita perímetro de cadera, que faltaba) y se sumó el
          -- índice cintura-talla. La casilla que ocupaba pasa a propiocepción.
          ADD COLUMN IF NOT EXISTS "mc_perimetro_cadera" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_indice_cintura_talla" NUMERIC(5,2),
          ADD COLUMN IF NOT EXISTS "mc_propiocepcion" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "mc_propiocepcion_segundos" NUMERIC(5,2),

          -- Prescripción de ejercicio (panel de consulta médica, tab t8).
          -- Estructura FIT por bloque (cardio/fuerza/flexibilidad) + clases grupales.
          ADD COLUMN IF NOT EXISTS "presc_generales" TEXT,
          ADD COLUMN IF NOT EXISTS "presc_cardio_frecuencia" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_cardio_intensidad" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "presc_cardio_tiempo" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_cardio_tipo" VARCHAR(150),
          ADD COLUMN IF NOT EXISTS "presc_cardio_notas" TEXT,
          ADD COLUMN IF NOT EXISTS "presc_fuerza_frecuencia" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_intensidad" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_series" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_repeticiones" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_modo_serie" VARCHAR(30),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_tipo" VARCHAR(150),
          ADD COLUMN IF NOT EXISTS "presc_fuerza_notas" TEXT,
          ADD COLUMN IF NOT EXISTS "presc_flex_frecuencia" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_flex_tiempo" VARCHAR(60),
          ADD COLUMN IF NOT EXISTS "presc_flex_tipo" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "presc_flex_enfasis" VARCHAR(150),
          ADD COLUMN IF NOT EXISTS "presc_clase_modalidad" VARCHAR(80),
          ADD COLUMN IF NOT EXISTS "presc_clase_nombre" VARCHAR(120),
          ADD COLUMN IF NOT EXISTS "presc_clase_reemplaza" VARCHAR(80)
      `);

      // Los antecedentes del examen ocupacional nacían con DEFAULT FALSE, así que
      // una historia recién creada mostraba "No" en los 22 toggles como si alguien
      // ya los hubiera respondido. El equipo médico no podía distinguir "no
      // pregunté" de "el paciente dijo que no", ni ver qué le faltaba diligenciar.
      // Se quita el default para que las historias NUEVAS nazcan en NULL (= sin
      // responder). Las filas existentes conservan su `false`: pasarlas a NULL
      // borraría negativos que sí se respondieron a conciencia.
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          ALTER COLUMN "mc_sint_dolor_toracico" DROP DEFAULT,
          ALTER COLUMN "mc_sint_palpitaciones" DROP DEFAULT,
          ALTER COLUMN "mc_sint_disnea" DROP DEFAULT,
          ALTER COLUMN "mc_sint_edema_mmii" DROP DEFAULT,
          ALTER COLUMN "mc_sint_sincope" DROP DEFAULT,
          ALTER COLUMN "mc_sint_claudicacion" DROP DEFAULT,
          ALTER COLUMN "mc_fam_cardiaca" DROP DEFAULT,
          ALTER COLUMN "mc_fam_respiratoria" DROP DEFAULT,
          ALTER COLUMN "mc_fam_msc_iam" DROP DEFAULT,
          ALTER COLUMN "mc_fam_hta" DROP DEFAULT,
          ALTER COLUMN "mc_fam_cerebrovascular" DROP DEFAULT,
          ALTER COLUMN "mc_fam_otros" DROP DEFAULT,
          ALTER COLUMN "mc_fam_diabetes" DROP DEFAULT,
          ALTER COLUMN "mc_fam_cancer" DROP DEFAULT,
          ALTER COLUMN "mc_per_cardiaca" DROP DEFAULT,
          ALTER COLUMN "mc_per_respiratoria" DROP DEFAULT,
          ALTER COLUMN "mc_per_tabaquismo" DROP DEFAULT,
          ALTER COLUMN "mc_per_renal" DROP DEFAULT,
          ALTER COLUMN "mc_per_hta" DROP DEFAULT,
          ALTER COLUMN "mc_per_metabolica" DROP DEFAULT,
          ALTER COLUMN "mc_per_cerebrovascular" DROP DEFAULT,
          ALTER COLUMN "mc_per_alcohol" DROP DEFAULT;
      `);

      // ===== Origen de la cita (departamento / integración) =====
      // Hasta ahora el origen se DEDUCÍA, y cada vista lo deducía distinto: la de
      // Afiliados miraba el prefijo del `_id` ("trepsi_"), el calendario miraba
      // `sede_id`. Las dos reglas ya divergieron — las citas de MyBodytech tienen
      // prefijo `mbt_`, así que Afiliados las mostraba como "Nativa", indistinguibles
      // de las propias. Además `sede_id` estaba haciendo doble trabajo (tenencia
      // multi-sede + origen), lo que obliga a reconstruir la sede real de las Trepsi
      // con un subquery al médico.
      //
      // `origen` es ahora un dato explícito, que cada vía de entrada escribe al crear
      // la historia. UMV (Unidad Médica Virtual) y Trepsi son departamentos distintos
      // de Bodytech y deben poder separarse sin ambigüedad.
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          ADD COLUMN IF NOT EXISTS "origen" VARCHAR(20);
      `);

      // Backfill de lo ya existente, con las mismas señales que usaban las vistas.
      // Sólo toca filas con origen NULL, así que es idempotente y no pisa nada
      // que se haya clasificado a mano después.
      await this.query(`
        UPDATE "HistoriaClinica"
           SET "origen" = CASE
             WHEN "sede_id" = 'trepsi'     OR "_id" LIKE 'trepsi_%' THEN 'trepsi'
             WHEN "sede_id" = 'mybodytech' OR "_id" LIKE 'mbt_%'    THEN 'mybodytech'
             ELSE 'nativa'
           END
         WHERE "origen" IS NULL;
      `);

      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_historia_origen ON "HistoriaClinica" ("origen");
      `);

      // ===== Run 4 — Multi-tenancy Foundation =====
      // sede_id en HistoriaClinica (snake_case con doble comillas, convención
      // de las columnas nuevas Phase 1+). DEFAULT 'bsl' garantiza que las
      // filas existentes sigan haciendo match cuando el middleware default es 'bsl'.
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          ADD COLUMN IF NOT EXISTS "sede_id" VARCHAR(50) NOT NULL DEFAULT 'bsl';
      `);

      // sede_id en formularios (snake plano, sin comillas — convención de
      // la tabla heredada de Wix).
      await this.query(`
        ALTER TABLE formularios
          ADD COLUMN IF NOT EXISTS sede_id VARCHAR(50) NOT NULL DEFAULT 'bsl';
      `);

      // ===== Run 5 — Multi-sede Login =====
      // Tabla de sedes activas. PK = sede_id (varchar slug). Idempotente:
      // CREATE TABLE IF NOT EXISTS + INSERT ... ON CONFLICT DO NOTHING.
      await this.query(`
        CREATE TABLE IF NOT EXISTS sedes (
          sede_id  VARCHAR(50)  PRIMARY KEY,
          nombre   VARCHAR(200) NOT NULL,
          ciudad   VARCHAR(100) NOT NULL,
          activa   BOOLEAN      NOT NULL DEFAULT true
        )
      `);
      await this.query(`
        INSERT INTO sedes (sede_id, nombre, ciudad) VALUES
          ('bsl',          'Bodytech Sede Principal', 'Bogotá'),
          ('bt-chapinero', 'Bodytech Chapinero',      'Bogotá'),
          ('bt-salitre',   'Bodytech Salitre',        'Bogotá'),
          ('bt-medellin',  'Bodytech Medellín',       'Medellín'),
          ('bt-cali',      'Bodytech Cali',           'Cali')
        ON CONFLICT (sede_id) DO NOTHING
      `);

      // Mapping room ↔ historia para resolver el historiaId desde el webhook de Twilio
      await this.query(`
        CREATE TABLE IF NOT EXISTS room_historia_map (
          room_name TEXT PRIMARY KEY,
          historia_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      // room_sid (RMxxx): se guarda al iniciar la sesión (room activo) para poder
      // componer on-demand después — un room COMPLETADO ya no se puede resolver por
      // uniqueName (Twilio devuelve 404), solo por SID.
      await this.query(`ALTER TABLE room_historia_map ADD COLUMN IF NOT EXISTS room_sid TEXT`);

      // ===== Diagnóstico técnico del cliente (video) =====
      // El navegador reporta cómo le fue a la llamada (equipo, red, si el filtro
      // de fondo se degradó). Antes esto vivía SOLO en el log de la app, y el log
      // se borra en CADA despliegue —incluso uno ajeno—, así que la evidencia se
      // evaporaba justo cuando servía para saber si un arreglo funcionó.
      await this.query(`
        CREATE TABLE IF NOT EXISTS client_diag (
          id SERIAL PRIMARY KEY,
          room_name TEXT NOT NULL,
          identity TEXT,
          role TEXT,
          evento TEXT NOT NULL,
          datos JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_client_diag_created ON client_diag (created_at DESC)`
      );
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_client_diag_identity ON client_diag (identity, created_at DESC)`
      );

      // ===== Registro de TODAS las consultas de video (se graben o no) =====
      // chime_recordings solo guarda las que se GRABARON. Las que no (un solo
      // participante, tipos sin grabación) no quedaban en ninguna tabla y no se
      // podían contar ni reportar. Esta fila se inserta SIEMPRE que el médico
      // entra con el id de la orden (ver transcription.linkRoomToHistoria), con
      // recording_enabled como simple bandera. created_at + ended_at dan la
      // duración → minutos por sede sin estimar a ojo.
      await this.query(`
        CREATE TABLE IF NOT EXISTS video_sessions (
          id SERIAL PRIMARY KEY,
          room_name TEXT UNIQUE NOT NULL,
          meeting_id TEXT,
          orden_id TEXT,
          paciente_documento TEXT,
          paciente_nombre TEXT,
          medico TEXT,
          sede TEXT,
          recording_enabled BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_video_sessions_created ON video_sessions (created_at DESC)`
      );
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_video_sessions_orden ON video_sessions (orden_id)`
      );

      // ===== Módulo de evaluación de calidad de consultas =====
      await this.query(`
        CREATE TABLE IF NOT EXISTS consulta_evaluaciones (
          id SERIAL PRIMARY KEY,
          historia_id TEXT NOT NULL,
          estado TEXT NOT NULL DEFAULT 'procesando',
          session_id TEXT,
          puntaje_total NUMERIC,
          evaluacion JSONB,
          transcript TEXT,
          error_msg TEXT,
          pasos JSONB DEFAULT '[]',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // ===== Panel Coordinador — Profesionales (médicos + coaches) =====
      // Una sola tabla para médicos y coaches, diferenciados por `rol`.
      // Multi-sede vía `sede_id` igual que HistoriaClinica.
      await this.query(`
        CREATE TABLE IF NOT EXISTS profesionales (
          id                          SERIAL PRIMARY KEY,
          sede_id                     VARCHAR(50) NOT NULL DEFAULT 'bsl',
          rol                         VARCHAR(20) NOT NULL DEFAULT 'medico',
          codigo                      VARCHAR(80) NOT NULL,
          primer_nombre               VARCHAR(100) NOT NULL,
          segundo_nombre              VARCHAR(100),
          primer_apellido             VARCHAR(100) NOT NULL,
          segundo_apellido            VARCHAR(100),
          alias                       VARCHAR(200),
          especialidad                VARCHAR(120),
          numero_licencia             VARCHAR(80),
          tipo_licencia               VARCHAR(80),
          fecha_vencimiento_licencia  DATE,
          tiempo_consulta             INTEGER NOT NULL DEFAULT 30,
          firma                       TEXT,
          email                       VARCHAR(200),
          celular                     VARCHAR(30),
          activo                      BOOLEAN NOT NULL DEFAULT TRUE,
          created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT profesionales_rol_chk CHECK (rol IN ('medico', 'coach')),
          CONSTRAINT profesionales_codigo_sede_uq UNIQUE (codigo, sede_id)
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_profesionales_sede_rol_activo
          ON profesionales (sede_id, rol, activo)
      `);

      // Foto de perfil del profesional (avatar). Se guarda como data URL base64
      // en TEXT, igual que `firma`. La imagen se reescala a ~450px antes de
      // guardar, por lo que pesa decenas de KB (apta para incluirse en listados).
      await this.query(`
        ALTER TABLE profesionales
          ADD COLUMN IF NOT EXISTS foto TEXT
      `);

      // Disponibilidad horaria: cada fila es UN rango (permite múltiples
      // rangos por día/modalidad, ej. lunes 8-12 y 14-18).
      await this.query(`
        CREATE TABLE IF NOT EXISTS profesionales_disponibilidad (
          id              SERIAL PRIMARY KEY,
          profesional_id  INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
          sede_id         VARCHAR(50) NOT NULL DEFAULT 'bsl',
          dia_semana      SMALLINT NOT NULL,
          hora_inicio     TIME NOT NULL,
          hora_fin        TIME NOT NULL,
          modalidad       VARCHAR(20) NOT NULL DEFAULT 'virtual',
          activo          BOOLEAN NOT NULL DEFAULT TRUE,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT prof_disp_dia_chk CHECK (dia_semana BETWEEN 0 AND 6),
          CONSTRAINT prof_disp_modalidad_chk CHECK (modalidad IN ('presencial', 'virtual')),
          CONSTRAINT prof_disp_rango_chk CHECK (hora_inicio < hora_fin)
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_prof_disp_profesional_modalidad
          ON profesionales_disponibilidad (profesional_id, modalidad, activo)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_prof_disp_sede_modalidad_dia
          ON profesionales_disponibilidad (sede_id, modalidad, dia_semana, activo)
      `);

      // Disponibilidad por FECHA específica (override puntual del patrón semanal).
      // El override existe ⟺ hay ≥1 fila para (profesional_id, sede_id, fecha, modalidad):
      //   - override con horas: N filas con hora_inicio/hora_fin y bloqueado=false.
      //   - override de bloqueo (día libre): 1 fila centinela con bloqueado=true y horas NULL.
      //   - sin override (ninguna fila) → se usa el patrón semanal de profesionales_disponibilidad.
      // El coordinador lo usa para ajustar un día puntual (ej. "este miércoles 3")
      // sin tocar el resto de miércoles.
      await this.query(`
        CREATE TABLE IF NOT EXISTS profesionales_disponibilidad_fecha (
          id              SERIAL PRIMARY KEY,
          profesional_id  INTEGER NOT NULL REFERENCES profesionales(id) ON DELETE CASCADE,
          sede_id         VARCHAR(50) NOT NULL DEFAULT 'bsl',
          fecha           DATE NOT NULL,
          hora_inicio     TIME,
          hora_fin        TIME,
          modalidad       VARCHAR(20) NOT NULL DEFAULT 'virtual',
          bloqueado       BOOLEAN NOT NULL DEFAULT FALSE,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT prof_disp_fecha_modalidad_chk CHECK (modalidad IN ('presencial', 'virtual')),
          CONSTRAINT prof_disp_fecha_rango_chk CHECK (
            (bloqueado = TRUE  AND hora_inicio IS NULL AND hora_fin IS NULL) OR
            (bloqueado = FALSE AND hora_inicio IS NOT NULL AND hora_fin IS NOT NULL AND hora_inicio < hora_fin)
          )
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_prof_disp_fecha_profesional
          ON profesionales_disponibilidad_fecha (profesional_id, modalidad, fecha)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_prof_disp_fecha_sede
          ON profesionales_disponibilidad_fecha (sede_id, modalidad, fecha)
      `);

      // ===== Integración Trepsi <-> Bodytech (spec v2.1) =====
      // Tabla principal del ciclo de vida de citas creadas por Trepsi.
      // - cita_id (PK) es el id que envía Trepsi → llave de idempotencia.
      // - historia_id apunta a HistoriaClinica._id (creada en el mismo insert).
      // - payload conserva el JSON crudo enviado por Trepsi para auditoría /
      //   reconciliación / debugging.
      await this.query(`
        CREATE TABLE IF NOT EXISTS trepsi_appointments (
          cita_id           VARCHAR(120) PRIMARY KEY,
          historia_id       TEXT NOT NULL,
          estado            VARCHAR(30) NOT NULL DEFAULT 'scheduled',
          fecha_atencion    TIMESTAMPTZ,
          duracion_minutos  INTEGER DEFAULT 30,
          medico_codigo     VARCHAR(80),
          medico_nombre     VARCHAR(200),
          tipo_consulta     VARCHAR(80),
          sede_origen       VARCHAR(120),
          observaciones     TEXT,
          reschedule_motivo TEXT,
          payload           JSONB,
          created_at        TIMESTAMPTZ DEFAULT NOW(),
          updated_at        TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_appointments_historia
          ON trepsi_appointments (historia_id)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_appointments_estado_fecha
          ON trepsi_appointments (estado, fecha_atencion)
      `);

      // ===== Webhook BSL → Trepsi (outbox persistente) =====
      // Cuando el médico guarda la HC de una cita Trepsi, se inserta una fila
      // aquí con `estado='pending'`. El worker (setInterval en index.ts) toma
      // las pending listas (`proximo_intento_at <= NOW()`), hace POST al
      // webhook de Trepsi y actualiza la fila. Reintentos con backoff
      // exponencial. Estados: pending | sent | failed | dead.
      await this.query(`
        CREATE TABLE IF NOT EXISTS trepsi_webhook_outbox (
          id                 SERIAL PRIMARY KEY,
          cita_id            VARCHAR(120) NOT NULL,
          historia_id        TEXT NOT NULL,
          payload            JSONB NOT NULL,
          estado             VARCHAR(20) NOT NULL DEFAULT 'pending',
          intentos           INTEGER NOT NULL DEFAULT 0,
          proximo_intento_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_error         TEXT,
          last_status_code   INTEGER,
          response_body      TEXT,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          sent_at            TIMESTAMPTZ,
          updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_webhook_outbox_pending
          ON trepsi_webhook_outbox (estado, proximo_intento_at)
          WHERE estado = 'pending'
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_webhook_outbox_cita
          ON trepsi_webhook_outbox (cita_id)
      `);

      // ===== RBAC — Usuarios + roles + alcance por sede (Fase 1) =====
      // `usuarios` = fuente única de identidad/login/rol para los 6 roles
      // (admin, coordinador, medico, coach, auxiliar, torre). `profesional_id`
      // enlaza (opcional) con la ficha clínica en `profesionales` para
      // medico/coach. `es_global` (admin/torre) cubre TODAS las sedes,
      // incluidas las futuras, sin enumerar. La autenticación es por
      // email+contraseña (bcrypt); el código+sede legacy se retira en el cutover.
      await this.query(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id              SERIAL PRIMARY KEY,
          email           VARCHAR(200) NOT NULL,
          password_hash   TEXT NOT NULL,
          nombre          VARCHAR(200) NOT NULL,
          rol             VARCHAR(20) NOT NULL,
          profesional_id  INTEGER REFERENCES profesionales(id) ON DELETE SET NULL,
          es_global       BOOLEAN NOT NULL DEFAULT FALSE,
          activo          BOOLEAN NOT NULL DEFAULT TRUE,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT usuarios_rol_chk CHECK (
            rol IN ('admin','coordinador','medico','coach','auxiliar','torre')
          )
        )
      `);
      // Unicidad de email case-insensitive (el service normaliza a minúsculas,
      // pero el índice único lo garantiza a nivel de BD).
      await this.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_email_lower
          ON usuarios (LOWER(email))
      `);
      // Celular de contacto del usuario (opcional). Mismo tipo que
      // profesionales.celular para consistencia.
      await this.query(`
        ALTER TABLE usuarios
          ADD COLUMN IF NOT EXISTS celular VARCHAR(30)
      `);

      // Puente usuario↔sedes: 1..N sedes por usuario (coordinador regional).
      // Para es_global=true la lista se ignora (cubre todas). Para clínicos y
      // auxiliar, normalmente una sola fila.
      await this.query(`
        CREATE TABLE IF NOT EXISTS usuario_sedes (
          usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          sede_id     VARCHAR(50) NOT NULL,
          PRIMARY KEY (usuario_id, sede_id)
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_usuario_sedes_sede
          ON usuario_sedes (sede_id)
      `);

      // ===== Torniquete de jornada laboral (control de entrada/salida) =====
      // Registro persistente de cuándo un profesional (médico/coach) está activo
      // en la plataforma durante su jornada. Cada fila es UNA sesión de jornada
      // (entrada → salida). El torniquete NO es la videollamada: mide "el coach
      // está logueado y activo", no "está en consulta con un paciente".
      //
      // Cómo se llena:
      //   - HEARTBEAT: el frontend late cada ~90s mientras el profesional tiene
      //     la plataforma abierta. El primer latido sin jornada abierta reciente
      //     ABRE una fila (entrada_at = NOW). Los latidos siguientes extienden
      //     `ultimo_latido_at`. Un corte > VENTANA de inactividad abre una nueva
      //     fila al reconectar (refleja pausas reales, ej. almuerzo).
      //   - LOGOUT explícito: fija `salida_at` y `cerrada = true`.
      //   - SWEEPER (worker cada 60s): cierra jornadas cuyo último latido superó
      //     la ventana de inactividad (cierre por cierre de pestaña / suspensión).
      //
      // Identidad: (codigo, sede_id) — misma llave que `profesionales`. `fecha`
      // es el día CALENDARIO en Colombia (UTC-5), calculado con AT TIME ZONE
      // 'America/Bogota' para agrupar la jornada sin depender del TZ del server.
      //
      // "Salida efectiva" = COALESCE(salida_at, ultimo_latido_at): si nunca hubo
      // logout, la salida es el último latido conocido.
      await this.query(`
        CREATE TABLE IF NOT EXISTS torniquete_jornadas (
          id                SERIAL PRIMARY KEY,
          codigo            VARCHAR(80) NOT NULL,
          sede_id           VARCHAR(50) NOT NULL,
          rol               VARCHAR(20),
          fecha             DATE NOT NULL,
          entrada_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ultimo_latido_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          salida_at         TIMESTAMPTZ,
          cerrada           BOOLEAN NOT NULL DEFAULT FALSE,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Consulta del tablero (por sede + día) y del heartbeat (jornada abierta
      // por codigo+sede). Índice parcial para localizar rápido las jornadas abiertas.
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_torniquete_sede_fecha
          ON torniquete_jornadas (sede_id, fecha)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_torniquete_codigo_fecha
          ON torniquete_jornadas (codigo, sede_id, fecha)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_torniquete_abiertas
          ON torniquete_jornadas (codigo, sede_id)
          WHERE cerrada = FALSE
      `);

      // ===== Audit log global =====
      // Bitácora transversal de acciones de usuarios (quién + qué + cuándo). La
      // alimenta `auditMiddleware` (global, fire-and-forget) en CADA mutación
      // /api relevante: No Contesta, crear/editar/eliminar cita, editar historia,
      // reasignar, gestión de profesionales/usuarios, login, etc. A diferencia
      // del torniquete (que solo audita la jornada), esta tabla cubre todo.
      await this.query(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id            BIGSERIAL PRIMARY KEY,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          actor_user_id INTEGER,
          actor_email   TEXT,
          actor_nombre  TEXT,
          actor_codigo  VARCHAR(80),
          actor_rol     VARCHAR(30),
          actor_sede    VARCHAR(50),
          metodo        VARCHAR(10) NOT NULL,
          ruta          TEXT NOT NULL,
          accion        VARCHAR(60),
          entidad       VARCHAR(40),
          entidad_id    TEXT,
          status_code   INTEGER,
          ip            VARCHAR(64),
          detalle       JSONB
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at DESC)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_codigo, created_at DESC)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_entidad ON audit_log (entidad, entidad_id)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_audit_log_accion ON audit_log (accion, created_at DESC)
      `);

      // ===== Monitor de integración Trepsi (observabilidad) =====
      // Registro de TODOS los eventos de la integración para mostrarlos en
      // /monitor-integracion en tiempo real. Incluye tanto inbound (Trepsi
      // llamando a Bodytech) como outbound (Bodytech llamando a Trepsi).
      await this.query(`
        CREATE TABLE IF NOT EXISTS trepsi_integration_log (
          id              SERIAL PRIMARY KEY,
          direccion       VARCHAR(10) NOT NULL,
          tipo            VARCHAR(80) NOT NULL,
          metodo          VARCHAR(10),
          path            VARCHAR(300),
          cita_id         VARCHAR(120),
          status_code     INTEGER,
          ok              BOOLEAN NOT NULL DEFAULT TRUE,
          latency_ms      INTEGER,
          request_body    JSONB,
          response_body   JSONB,
          error_code      VARCHAR(80),
          error_message   TEXT,
          ip              VARCHAR(45),
          user_agent      TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT trepsi_log_direccion_chk CHECK (direccion IN ('inbound', 'outbound'))
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_integration_log_created
          ON trepsi_integration_log (created_at DESC)
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_integration_log_cita
          ON trepsi_integration_log (cita_id)
      `);
      // La misma tabla sirve para varias integraciones (trepsi, mybodytech…).
      // Columna `integracion` con default 'trepsi' → retrocompatible con las
      // filas existentes. El monitor filtra por esta columna.
      await this.query(`
        ALTER TABLE trepsi_integration_log
          ADD COLUMN IF NOT EXISTS integracion VARCHAR(20) NOT NULL DEFAULT 'trepsi'
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_trepsi_integration_log_integ
          ON trepsi_integration_log (integracion, id DESC)
      `);
      // Purga eventos viejos (>14 días) para no llenar la DB
      await this.query(`
        DELETE FROM trepsi_integration_log
          WHERE created_at < NOW() - INTERVAL '14 days'
      `);

      // ===== Integración mybodytech — afiliados/citas =====
      // A diferencia de Trepsi, la agenda NO está sincronizada: mybodytech nos
      // envía directamente fecha/hora + el NOMBRE del profesional (texto libre),
      // y creamos el paciente + la cita. `evento_id` es la llave de idempotencia.
      await this.query(`
        CREATE TABLE IF NOT EXISTS mybodytech_afiliados (
          evento_id            VARCHAR(120) PRIMARY KEY,
          historia_id          VARCHAR(64),
          numero_id            VARCHAR(40),
          professional_name    VARCHAR(200),
          user_document_type   VARCHAR(10),
          user_document_number VARCHAR(40),
          fecha_atencion       TIMESTAMPTZ,
          estado               VARCHAR(20) NOT NULL DEFAULT 'scheduled',
          rips_estado          VARCHAR(20),
          payload              JSONB,
          created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Columnas agregadas después de la primera versión de la tabla:
      // documento del profesional que atiende (lo necesita el RIPS de Fase 2) +
      // estado del envío del RIPS.
      await this.query(`ALTER TABLE mybodytech_afiliados ADD COLUMN IF NOT EXISTS user_document_type   VARCHAR(10)`);
      await this.query(`ALTER TABLE mybodytech_afiliados ADD COLUMN IF NOT EXISTS user_document_number VARCHAR(40)`);
      await this.query(`ALTER TABLE mybodytech_afiliados ADD COLUMN IF NOT EXISTS rips_estado          VARCHAR(20)`);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_mybodytech_afiliados_numero
          ON mybodytech_afiliados (numero_id)
      `);

      // ===== WhatsApp Leads — captura de la "entidad" =====
      // Estado efímero por chat para capturar la ENTIDAD que el cliente responde
      // tras la pregunta "¿Para qué entidad?". Cuando el operador envía esa
      // pregunta (from_me) se crea/re-arma una fila; los mensajes entrantes
      // siguientes se acumulan en `buffer`. Un sweeper (cada 30 s) vuelca la
      // entidad a Google Sheets tras una ventana de silencio y borra la fila.
      await this.query(`
        CREATE TABLE IF NOT EXISTS whatsapp_lead_pending (
          chat_id          VARCHAR(80) PRIMARY KEY,
          telefono         VARCHAR(40),
          from_name        VARCHAR(200),
          asked_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_inbound_at  TIMESTAMPTZ,
          buffer           TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_lead_pending_flush
          ON whatsapp_lead_pending (last_inbound_at)
          WHERE buffer IS NOT NULL
      `);

      // ===== Chat de WhatsApp (panel médico) =====
      // Conversación por número de celular + hilo de mensajes (entrante/saliente).
      // Alimenta el "cuadrito" de chat en cada fila de la Agenda del panel médico:
      // el inbound llega por el webhook de Twilio y el saliente por respuestas del
      // panel (o notificaciones de cita). Real-time vía Socket.io.
      await this.query(`
        CREATE TABLE IF NOT EXISTS conversaciones_whatsapp (
          id                     SERIAL PRIMARY KEY,
          celular                VARCHAR(40) NOT NULL,
          nombre_paciente        VARCHAR(200),
          origen                 VARCHAR(60),
          estado                 VARCHAR(30) DEFAULT 'nueva',
          canal                  VARCHAR(30) DEFAULT 'bot',
          estado_actual          VARCHAR(30) DEFAULT 'inicio',
          fecha_inicio           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          fecha_ultima_actividad TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conversaciones_whatsapp_celular
          ON conversaciones_whatsapp (celular)
      `);
      await this.query(`
        CREATE TABLE IF NOT EXISTS mensajes_whatsapp (
          id                SERIAL PRIMARY KEY,
          conversacion_id   INTEGER NOT NULL REFERENCES conversaciones_whatsapp(id) ON DELETE CASCADE,
          direccion         VARCHAR(10) NOT NULL,
          contenido         TEXT,
          tipo_mensaje      VARCHAR(20) DEFAULT 'text',
          media_url         TEXT,
          media_type        TEXT,
          sid_twilio        VARCHAR(100),
          leido_por_agente  BOOLEAN DEFAULT FALSE,
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT mensajes_whatsapp_direccion_chk CHECK (direccion IN ('entrante', 'saliente'))
        )
      `);
      await this.query(`
        CREATE INDEX IF NOT EXISTS idx_mensajes_whatsapp_conv
          ON mensajes_whatsapp (conversacion_id, created_at)
      `);
      // Unique por SID de Twilio → idempotencia del webhook. Nombre exacto usado
      // por el catch de registrarMensajeSaliente/Entrante para ignorar duplicados.
      await this.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mensajes_sid_twilio_unique
          ON mensajes_whatsapp (sid_twilio)
          WHERE sid_twilio IS NOT NULL AND sid_twilio <> ''
      `);

      // ===== Control de envío del Informe de Gestión (WhatsApp a admins) =====
      // Una fila por día (fecha Colombia, PK). El worker reclama el día con
      // INSERT ... ON CONFLICT DO NOTHING → at-most-once por día, aunque el
      // proceso reinicie o corran varias instancias.
      await this.query(`
        CREATE TABLE IF NOT EXISTS gestion_report_log (
          fecha       DATE PRIMARY KEY,
          intentos    INTEGER NOT NULL DEFAULT 0,
          enviados    INTEGER NOT NULL DEFAULT 0,
          enviado_at  TIMESTAMPTZ,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // PNG del tablero de gestión, servido por URL pública a Twilio (header de
      // media de la plantilla). Token aleatorio; se purga a las 24 h.
      await this.query(`
        CREATE TABLE IF NOT EXISTS gestion_report_image (
          token       TEXT PRIMARY KEY,
          png         BYTEA NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);

      // Marca de "link de conexión enviado al paciente". La setea el endpoint
      // POST /api/video/whatsapp/send al enviar el link con éxito (primer envío).
      // Distingue en el Informe de Gestión "No contactó" (cita sin resolver y SIN
      // link enviado) de "Pendiente" (link enviado, aún sin resolver).
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          ADD COLUMN IF NOT EXISTS "link_enviado_at" TIMESTAMPTZ
      `);

      // Sala de la videollamada, persistida al enviar el link (Contactar). Fuente
      // de verdad para que "Atender" entre a la MISMA sala del paciente aunque el
      // coach haya recargado la página (antes el nombre vivía solo en memoria del
      // navegador → salas distintas).
      await this.query(`
        ALTER TABLE "HistoriaClinica"
          ADD COLUMN IF NOT EXISTS "video_room_name" TEXT
      `);

      // ----------------------------------------------------------------------
      // BodyVibeTech — bitácora de LECTURAS.
      //
      // `audit_log` solo registra escrituras (POST/PUT/PATCH/DELETE). Con apps
      // que consultan condiciones médicas de pacientes hace falta el otro lado:
      // quién consultó qué, cuándo y cuántas filas se llevó. En datos de salud
      // eso no es opcional.
      //
      // La escribe `bodyvibe-db.service` con el pool principal — el rol de solo
      // lectura, por definición, no puede escribir ni su propia bitácora.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_query_log (
          id          BIGSERIAL PRIMARY KEY,
          usuario_id  INTEGER,
          email       TEXT,
          app_id      TEXT,
          sql_texto   TEXT NOT NULL,
          filas       INTEGER NOT NULL DEFAULT 0,
          duracion_ms INTEGER NOT NULL DEFAULT 0,
          resultado   TEXT NOT NULL,
          error       TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_query_log_created ON bodyvibe_query_log (created_at DESC)`
      );
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_query_log_usuario ON bodyvibe_query_log (usuario_id, created_at DESC)`
      );
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_query_log_app ON bodyvibe_query_log (app_id, created_at DESC)`
      );

      // ----------------------------------------------------------------------
      // BodyVibeTech — interruptor general (decisión 10, nivel 3).
      //
      // Una sola fila. Cuando `activo = false`, TODA la superficie de
      // BodyVibeTech deja de responder y la plataforma queda exactamente como
      // está hoy. Es lo que hace aceptable todo lo demás: si esto sale mal de
      // una forma que no previmos, hay un botón que lo devuelve en 5 segundos.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_config (
          id           SMALLINT PRIMARY KEY DEFAULT 1,
          activo       BOOLEAN NOT NULL DEFAULT TRUE,
          motivo       TEXT,
          apagado_por  TEXT,
          apagado_at   TIMESTAMPTZ,
          updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT bodyvibe_config_una_fila CHECK (id = 1)
        )
      `);
      await this.query(
        `INSERT INTO bodyvibe_config (id, activo) VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING`
      );

      // ----------------------------------------------------------------------
      // BodyVibeTech — los apps y su historial.
      //
      // `codigo` es el JavaScript que corre dentro del recinto aislado. Se
      // guarda como texto y nunca se ejecuta del lado del servidor.
      //
      // El estado arranca en `borrador`: privado de quien lo creó, sin pedirle
      // permiso a nadie (decisión 05). Publicar es otra cosa y llega después.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_apps (
          id             TEXT PRIMARY KEY,
          titulo         TEXT NOT NULL,
          creador_id     INTEGER,
          creador_email  TEXT,
          sede_id        TEXT,
          estado         TEXT NOT NULL DEFAULT 'borrador',
          codigo         TEXT NOT NULL DEFAULT '',
          notas          TEXT,
          version        INTEGER NOT NULL DEFAULT 1,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_apps_creador ON bodyvibe_apps (creador_id, updated_at DESC)`
      );

      // Cada iteración queda guardada. Sin esto, "vuelva a como estaba antes"
      // no tiene respuesta, y ese pedido llega el primer día.
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_app_versiones (
          id          BIGSERIAL PRIMARY KEY,
          app_id      TEXT NOT NULL,
          version     INTEGER NOT NULL,
          pedido      TEXT,
          codigo      TEXT NOT NULL,
          notas       TEXT,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT bv_app_version_uq UNIQUE (app_id, version)
        )
      `);

      // ----------------------------------------------------------------------
      // Consumo del modelo. Se registra por generación para poder cortar al
      // llegar al tope mensual (decisión 11).
      //
      // El tope no está para controlar a la gente: está para que un error de
      // programación que reintente en bucle no despierte con una factura
      // absurda. Por eso el corte es duro y no una alerta.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_uso (
          id             BIGSERIAL PRIMARY KEY,
          app_id         TEXT,
          usuario_id     INTEGER,
          email          TEXT,
          modelo         TEXT NOT NULL,
          input_tokens   INTEGER NOT NULL DEFAULT 0,
          cache_write    INTEGER NOT NULL DEFAULT 0,
          cache_read     INTEGER NOT NULL DEFAULT 0,
          output_tokens  INTEGER NOT NULL DEFAULT 0,
          costo_usd      NUMERIC(12, 6) NOT NULL DEFAULT 0,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_uso_created ON bodyvibe_uso (created_at DESC)`
      );

      // ----------------------------------------------------------------------
      // BodyVibeTech — publicación (decisiones 04, 05 y 06).
      //
      // `codigo` es el BORRADOR, privado de quien lo creó. `publicado_codigo`
      // es una FOTO de lo que está en vivo. Son dos cosas distintas a propósito:
      // si el público leyera `codigo`, editar el borrador cambiaría en silencio
      // lo que ve todo el mundo — exactamente el atajo que la re-aprobación
      // existe para cerrar.
      //
      // `huella_aprobada` resume QUÉ DATOS consulta la versión aprobada. Si un
      // cambio no la mueve y no toca la audiencia, es cosmético y se republica
      // solo. Si la mueve, vuelve a aprobación.
      // ----------------------------------------------------------------------
      await this.query(`
        ALTER TABLE bodyvibe_apps
          ADD COLUMN IF NOT EXISTS alcance           TEXT NOT NULL DEFAULT 'privado',
          ADD COLUMN IF NOT EXISTS audiencia_roles   TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS audiencia_sedes   TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS publicado_codigo  TEXT,
          ADD COLUMN IF NOT EXISTS publicado_version INTEGER,
          ADD COLUMN IF NOT EXISTS huella_aprobada   TEXT,
          ADD COLUMN IF NOT EXISTS publicado_sqls    TEXT[] NOT NULL DEFAULT '{}',
          ADD COLUMN IF NOT EXISTS publicado_at      TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS publicado_por     TEXT,
          ADD COLUMN IF NOT EXISTS despublicado_por  TEXT,
          ADD COLUMN IF NOT EXISTS despublicado_motivo TEXT,
          -- Dónde queda incrustado el app. NULL = suelto, en /apps.
          ADD COLUMN IF NOT EXISTS anclaje           TEXT
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_apps_publicados ON bodyvibe_apps (estado) WHERE estado = 'publicado'`
      );

      // Solicitudes de publicación. Se guarda la FOTO del código y la audiencia
      // pedida: el revisor aprueba lo que vio, no lo que el borrador sea al
      // momento de hacer clic.
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_solicitudes (
          id               BIGSERIAL PRIMARY KEY,
          app_id           TEXT NOT NULL,
          version          INTEGER NOT NULL,
          codigo           TEXT NOT NULL,
          huella           TEXT NOT NULL,
          estantes         TEXT[] NOT NULL DEFAULT '{}',
          alcance          TEXT NOT NULL,
          audiencia_roles  TEXT[] NOT NULL DEFAULT '{}',
          audiencia_sedes  TEXT[] NOT NULL DEFAULT '{}',
          estado           TEXT NOT NULL DEFAULT 'pendiente',
          solicitante_id   INTEGER,
          solicitante      TEXT,
          revisor          TEXT,
          motivo           TEXT,
          anclaje          TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resuelto_at      TIMESTAMPTZ
        )
      `);
      await this.query(`ALTER TABLE bodyvibe_solicitudes ADD COLUMN IF NOT EXISTS anclaje TEXT`);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_solicitudes_pendientes
           ON bodyvibe_solicitudes (created_at DESC) WHERE estado = 'pendiente'`
      );

      // ----------------------------------------------------------------------
      // BodyVibeTech — apariencia (decisión 07, puerta 2).
      //
      // Una sola fila: la apariencia es de la plataforma, no de cada persona.
      // Guarda el ID de una paleta preaprobada, nunca colores sueltos. El panel
      // médico comparte pantalla con una consulta en vivo, y ahí un color mal
      // elegido no es un detalle estético.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_tema (
          id               SMALLINT PRIMARY KEY DEFAULT 1,
          paleta           TEXT NOT NULL DEFAULT 'bodytech',
          densidad         TEXT NOT NULL DEFAULT 'normal',
          actualizado_por  TEXT,
          actualizado_at   TIMESTAMPTZ,
          CONSTRAINT bodyvibe_tema_una_fila CHECK (id = 1)
        )
      `);
      await this.query(`INSERT INTO bodyvibe_tema (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);

      // ----------------------------------------------------------------------
      // Vistas guardadas. No es BodyVibeTech: no genera nada, no necesita
      // aprobación, no consulta el modelo.
      //
      // Es la función aburrida que probablemente elimine más pedidos que el
      // agente entero: cuando alguien pide "modificame este panel", casi
      // siempre quiere ver otras columnas, filtrar distinto, ordenar distinto o
      // sacarlo a Excel. Eso no necesita construir nada nuevo — necesita que
      // cada tabla recuerde cómo la quiere ver cada persona.
      //
      // `config` es JSONB a propósito: cada tabla guarda lo suyo (columnas
      // visibles, orden, filtros) sin que este esquema tenga que enterarse.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS vistas_guardadas (
          id          BIGSERIAL PRIMARY KEY,
          usuario_id  INTEGER NOT NULL,
          tabla_id    TEXT NOT NULL,
          nombre      TEXT NOT NULL,
          config      JSONB NOT NULL DEFAULT '{}',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT vistas_guardadas_uq UNIQUE (usuario_id, tabla_id, nombre)
        )
      `);
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_vistas_usuario_tabla
           ON vistas_guardadas (usuario_id, tabla_id, updated_at DESC)`
      );

      // ----------------------------------------------------------------------
      // BodyVibeTech — generaciones en curso.
      //
      // Generar tarda entre 30 s y un par de minutos: no cabe en un request
      // HTTP detrás del balanceador, que corta antes. El navegador arranca el
      // trabajo, se va, y pregunta por el resultado.
      //
      // El estado vive acá y no en memoria: si el contenedor se reinicia a
      // mitad de una generación, un trabajo en memoria desaparece sin dejar
      // rastro —y sin dejar constancia de que se pagó.
      // ----------------------------------------------------------------------
      await this.query(`
        CREATE TABLE IF NOT EXISTS bodyvibe_generaciones (
          id          BIGSERIAL PRIMARY KEY,
          app_id      TEXT NOT NULL,
          usuario_id  INTEGER NOT NULL,
          email       TEXT,
          pedido      TEXT NOT NULL,
          estado      TEXT NOT NULL DEFAULT 'procesando',
          mensaje     TEXT,
          notas       TEXT,
          costo_usd   NUMERIC(12, 6),
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Lo que el modelo lleva escrito, para la ventanita de progreso. Va
      // aparte de las columnas de resultado porque es efímero: se pisa cada
      // segundo y deja de importar apenas la generación termina.
      await this.query(
        `ALTER TABLE bodyvibe_generaciones ADD COLUMN IF NOT EXISTS avance JSONB`
      );
      await this.query(
        `CREATE INDEX IF NOT EXISTS idx_bv_generaciones_app
           ON bodyvibe_generaciones (app_id, created_at DESC)`
      );

      // Backfill del contador de reprogramaciones desde la bitácora.
      // La columna nace en 0, así que sin esto quien ya venía reprogramando
      // arrancaría con el cupo entero. Solo toca las filas en 0: una vez que el
      // contador empieza a subir por sí solo, no se vuelve a pisar. Idempotente.
      await this.query(`
        UPDATE "HistoriaClinica" h
           SET "reprogramaciones" = v.n
          FROM (
            SELECT entidad_id, COUNT(*)::int AS n
              FROM audit_log
             WHERE accion = 'reprogramar' AND status_code = 200
             GROUP BY entidad_id
          ) v
         WHERE h."_id" = v.entidad_id AND h."reprogramaciones" = 0
      `);

      console.log('✅ [PostgreSQL] Migraciones ejecutadas correctamente');
    } catch (error) {
      console.error('❌ [PostgreSQL] Error ejecutando migraciones:', error);
    }
  }

  /**
   * Busca una conversación por número de celular, o la crea si no existe
   * @param celular Número de teléfono con formato +573001234567
   * @param nombrePaciente Nombre del paciente (opcional)
   * @returns ID de la conversación
   */
  async getOrCreateConversacion(celular: string, nombrePaciente?: string): Promise<number | null> {
    const client = await this.getClient();
    if (!client) return null;

    try {
      // Buscar conversación existente
      const searchResult = await client.query(
        'SELECT id FROM conversaciones_whatsapp WHERE celular = $1',
        [celular]
      );

      if (searchResult.rows.length > 0) {
        // Actualizar fecha de última actividad
        await client.query(
          'UPDATE conversaciones_whatsapp SET fecha_ultima_actividad = NOW() WHERE id = $1',
          [searchResult.rows[0].id]
        );
        return searchResult.rows[0].id;
      }

      // Crear nueva conversación
      const insertResult = await client.query(
        `INSERT INTO conversaciones_whatsapp (celular, nombre_paciente, origen, estado, canal, estado_actual)
         VALUES ($1, $2, 'BSL-CONSULTAVIDEO', 'nueva', 'bot', 'inicio')
         RETURNING id`,
        [celular, nombrePaciente || null]
      );

      console.log(`✅ [PostgreSQL] Nueva conversación creada para ${celular} con ID: ${insertResult.rows[0].id}`);
      return insertResult.rows[0].id;
    } catch (error) {
      console.error('❌ [PostgreSQL] Error buscando/creando conversación:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Registra un mensaje de WhatsApp saliente en la base de datos
   * @param celular Número de teléfono con formato +573001234567
   * @param contenido Contenido del mensaje
   * @param sidTwilio SID del mensaje de Twilio
   * @param nombrePaciente Nombre del paciente (opcional)
   * @returns true si se registró correctamente
   */
  async registrarMensajeSaliente(
    celular: string,
    contenido: string,
    sidTwilio: string,
    nombrePaciente?: string
  ): Promise<{ mensajeId: number; createdAt: string } | null> {
    const client = await this.getClient();
    if (!client) return null;

    try {
      // Obtener o crear conversación
      const conversacionId = await this.getOrCreateConversacion(celular, nombrePaciente);

      if (!conversacionId) {
        console.error('❌ [PostgreSQL] No se pudo obtener/crear la conversación');
        return null;
      }

      // Insertar mensaje
      const res = await client.query(
        `INSERT INTO mensajes_whatsapp
         (conversacion_id, direccion, contenido, tipo_mensaje, sid_twilio, leido_por_agente)
         VALUES ($1, 'saliente', $2, 'text', $3, true)
         RETURNING id, created_at`,
        [conversacionId, contenido, sidTwilio]
      );

      console.log(`✅ [PostgreSQL] Mensaje registrado para ${celular} (conversacion_id: ${conversacionId})`);
      return { mensajeId: res.rows[0].id, createdAt: res.rows[0].created_at };
    } catch (error: any) {
      // Si el error es por SID duplicado, ignorarlo (mensaje ya registrado)
      if (error.code === '23505' && error.constraint === 'idx_mensajes_sid_twilio_unique') {
        console.log(`ℹ️ [PostgreSQL] Mensaje con SID ${sidTwilio} ya existe en la base de datos`);
        return null;
      }
      console.error('❌ [PostgreSQL] Error registrando mensaje:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Registra un mensaje ENTRANTE (lo que el paciente escribe por WhatsApp).
   * Idempotente por sid_twilio. Devuelve la conversación + mensaje para que el
   * webhook pueda emitir el evento de Socket.io; null si falla.
   */
  async registrarMensajeEntrante(
    celular: string,
    contenido: string,
    sidTwilio: string,
    opts?: { tipoMensaje?: string; mediaUrl?: string; mediaType?: string; nombrePaciente?: string }
  ): Promise<{ conversacionId: number; mensajeId: number; createdAt: string } | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      const conversacionId = await this.getOrCreateConversacion(celular, opts?.nombrePaciente);
      if (!conversacionId) return null;

      const res = await client.query(
        `INSERT INTO mensajes_whatsapp
           (conversacion_id, direccion, contenido, tipo_mensaje, media_url, media_type, sid_twilio, leido_por_agente)
         VALUES ($1, 'entrante', $2, $3, $4, $5, $6, false)
         RETURNING id, created_at`,
        [
          conversacionId,
          contenido,
          opts?.tipoMensaje || 'text',
          opts?.mediaUrl || null,
          opts?.mediaType || null,
          sidTwilio || null,
        ]
      );
      return {
        conversacionId,
        mensajeId: res.rows[0].id,
        createdAt: res.rows[0].created_at,
      };
    } catch (error: any) {
      if (error.code === '23505' && error.constraint === 'idx_mensajes_sid_twilio_unique') {
        console.log(`ℹ️ [PostgreSQL] Mensaje entrante SID ${sidTwilio} ya existe`);
        return null;
      }
      console.error('❌ [PostgreSQL] Error registrando mensaje entrante:', error);
      return null;
    } finally {
      client.release();
    }
  }

  /**
   * Devuelve el hilo de mensajes de una conversación por celular (orden
   * cronológico). Si no existe conversación, devuelve []. Marca los entrantes
   * como leídos (fire-and-forget).
   */
  async getMensajesPorCelular(
    celular: string,
    limit = 200
  ): Promise<
    Array<{
      id: number;
      direccion: string;
      contenido: string;
      tipoMensaje: string;
      mediaUrl: string | null;
      createdAt: string;
    }>
  > {
    const rows = await this.query(
      `SELECT m.id, m.direccion, m.contenido, m.tipo_mensaje, m.media_url, m.created_at
         FROM mensajes_whatsapp m
         JOIN conversaciones_whatsapp c ON c.id = m.conversacion_id
        WHERE c.celular = $1
        ORDER BY m.created_at ASC
        LIMIT $2`,
      [celular, limit]
    );
    if (!rows) return [];

    // Marcar entrantes como leídos (no bloquea la respuesta).
    this.query(
      `UPDATE mensajes_whatsapp m
          SET leido_por_agente = true
         FROM conversaciones_whatsapp c
        WHERE m.conversacion_id = c.id AND c.celular = $1
          AND m.direccion = 'entrante' AND m.leido_por_agente = false`,
      [celular]
    ).catch(() => {});

    return rows.map((r: any) => ({
      id: r.id,
      direccion: r.direccion,
      contenido: r.contenido ?? '',
      tipoMensaje: r.tipo_mensaje ?? 'text',
      mediaUrl: r.media_url ?? null,
      createdAt: r.created_at,
    }));
  }
}

export default new PostgresService();

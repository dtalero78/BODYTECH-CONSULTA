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

          -- ===== Phase 3 — Transcripción post-llamada =====
          ADD COLUMN IF NOT EXISTS "transcription_status" TEXT,
          ADD COLUMN IF NOT EXISTS "transcription_text" TEXT,

          -- ===== Phase 4 — Twilio Compositions =====
          ADD COLUMN IF NOT EXISTS "composition_sid" TEXT,

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

      // Mapping room ↔ historia para resolver el historiaId desde el webhook de Twilio
      await this.query(`
        CREATE TABLE IF NOT EXISTS room_historia_map (
          room_name TEXT PRIMARY KEY,
          historia_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

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
  ): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return false;

    try {
      // Obtener o crear conversación
      const conversacionId = await this.getOrCreateConversacion(celular, nombrePaciente);

      if (!conversacionId) {
        console.error('❌ [PostgreSQL] No se pudo obtener/crear la conversación');
        return false;
      }

      // Insertar mensaje
      await client.query(
        `INSERT INTO mensajes_whatsapp
         (conversacion_id, direccion, contenido, tipo_mensaje, sid_twilio, leido_por_agente)
         VALUES ($1, 'saliente', $2, 'text', $3, true)`,
        [conversacionId, contenido, sidTwilio]
      );

      console.log(`✅ [PostgreSQL] Mensaje registrado para ${celular} (conversacion_id: ${conversacionId})`);
      return true;
    } catch (error: any) {
      // Si el error es por SID duplicado, ignorarlo (mensaje ya registrado)
      if (error.code === '23505' && error.constraint === 'idx_mensajes_sid_twilio_unique') {
        console.log(`ℹ️ [PostgreSQL] Mensaje con SID ${sidTwilio} ya existe en la base de datos`);
        return true;
      }
      console.error('❌ [PostgreSQL] Error registrando mensaje:', error);
      return false;
    } finally {
      client.release();
    }
  }
}

export default new PostgresService();

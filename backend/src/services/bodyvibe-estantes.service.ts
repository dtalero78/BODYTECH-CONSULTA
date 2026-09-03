// ============================================================================
// bodyvibe-estantes.service — Los ESTANTES de BodyVibeTech (decisión 02).
//
// Diez vistas de solo lectura sobre las que el agente consulta libremente. No
// son un atajo de rendimiento: son el lugar donde queda ESCRITO qué significa
// cada número, en vez de vivir en la cabeza de una persona.
//
// Cada estante resuelve cuatro cosas de una vez, para que ningún app tenga que
// resolverlas —ni equivocarse— por su cuenta:
//
//   1) LA FUENTE. Cuál de las tablas tiene el dato de verdad. No es obvio: los
//      antecedentes viven en `HistoriaClinica`, no en `formularios` (que existe
//      con sus 78 columnas y cero filas), y las citas son filas de
//      `HistoriaClinica` — las tablas `citas` y `ordenes` no existen.
//
//   2) EL SIGNIFICADO. Qué cuenta como "cita atendida", qué cuenta como un
//      "sí". Cuando hay dos respuestas en la plataforma, el estante expone las
//      dos y marca la diferencia en vez de elegir una en silencio.
//
//   3) EL ALCANCE. Todos los estantes llevan `sede_id`, para que filtrar por
//      sede sea siempre posible y nunca opcional por accidente.
//
//   4) LA IDENTIDAD. Ningún estante cruza identidad con contenido clínico.
//      `bv_citas` lleva nombre y celular porque es operativo —lo mismo que el
//      coordinador ya ve en su calendario— y no lleva una sola columna
//      clínica. No existe estante de antecedentes, y la razón está escrita
//      abajo: no es una omisión, es una decisión.
//
// Y hay un estante que existe solo para que los otros no mientan:
// `bv_cobertura` dice qué porcentaje de cada campo está realmente diligenciado.
// Un reporte "por ciudad" sobre datos donde el 72% no tiene ciudad se ve
// perfecto y es falso.
//
// El rol `bodyvibe_ro` no es dueño de estas vistas: solo recibe SELECT sobre
// ellas, una por una. Sobre las tablas de abajo no tiene ningún permiso — lee
// a través del estante o no lee.
// ============================================================================

import postgresService from './postgres.service';

const RO_ROLE = 'bodyvibe_ro';

/**
 * Los seis grupos de antecedentes que la plataforma captura HOY, en
 * `HistoriaClinica`. Cada uno tiene `_flag` (booleano) y `_tipo` (la lista de
 * condiciones marcadas).
 *
 * ⚠️ NO se usa la tabla `formularios`. Existe, tiene sus 78 columnas y sus 35
 * antecedentes, y está VACÍA: 0 filas contra 2.883 historias clínicas. El
 * formulario de admisión que la llenaba dejó de usarse, y los antecedentes
 * pasaron a estas columnas de `HistoriaClinica` cuando llegó el panel de 7
 * pestañas. Un estante montado sobre `formularios` habría devuelto cero filas
 * para siempre sin que nadie entendiera por qué.
 *
 * Efecto colateral que conviene tener claro: el famoso problema de los cuatro
 * "sí" (`true`, `'true'`, `'Sí'`, `'SI'`) vive en `formularios`, la tabla
 * vacía. Estas columnas son BOOLEAN de verdad, así que Postgres ni siquiera
 * dejaría entrar un `'Sí'`. La coerción tolerante que había acá se quitó: era
 * una defensa contra un problema que esta tabla no puede tener.
 *
 * Solo se usan para MEDIR LA CAPTURA en `bv_cobertura`. Hoy los seis flags
 * están en `false` en las 2.883 historias — nadie los diligencia.
 */
const GRUPOS_ANTECEDENTES = [
  'patologico',
  'quirurgico',
  'alergicos',
  'farmacologico',
  'familiares',
  'osteomuscular',
] as const;

/**
 * Qué es cada estante, en una línea, para que el agente sepa a cuál ir.
 *
 * Vive acá y no en el catálogo para que quede al lado de la definición: si un
 * estante cambia de contenido, la descripción está en la misma pantalla y es
 * mucho más difícil que se quede mintiendo.
 */
export const DESCRIPCION_ESTANTES: Record<string, string> = {
  bv_citas:
    'La agenda. Una fila por cita (que en esta plataforma es una historia clínica). Trae identidad del paciente, género y estado; NO trae contenido clínico. Usá `estado` para saber si se atendió, y `genero` (ya normalizado) para cortar por sexo — consultá antes `bv_cobertura.con_genero`, porque falta en el 23%.',
  bv_cobertura:
    'Qué tan diligenciado está cada campo, por sede y por mes. Consultalo SIEMPRE que vayas a agrupar por un campo con huecos, y mostrá el porcentaje junto al resultado.',
  bv_profesionales: 'Médicos y coaches: sede, rol, especialidad, duración de consulta, si está activo.',
  bv_disponibilidad: 'Patrón semanal recurrente de cada profesional (día de la semana + franja horaria).',
  bv_disponibilidad_fecha:
    'Excepciones para una fecha puntual. `dia_bloqueado = true` significa día cerrado; pisa al patrón semanal.',
  bv_jornada:
    'Entrada y salida de los coaches (el torniquete). `minutos_jornada` ya viene calculado y contempla las jornadas abiertas.',
  bv_calidad: 'Evaluaciones de calidad de consultas: puntaje y estado. Sin transcripción ni detalle.',
  bv_sedes: 'Catálogo de sedes: id, nombre, ciudad, si está activa.',
  bv_trepsi: 'Ciclo de vida de las citas que llegan de la integración con Trepsi.',
  bv_videollamadas: 'Sesiones de video: cuándo empezó, cuándo terminó, duración en minutos, si se grabó.',
};

interface ResultadoEstante {
  nombre: string;
  ok: boolean;
}

class BodyVibeEstantesService {
  /**
   * Crea (o rehace) un estante y le otorga SELECT al rol de solo lectura.
   *
   * Se usa DROP + CREATE en vez de CREATE OR REPLACE porque este archivo es la
   * fuente de verdad: si acá se quita o renombra una columna, el estante en la
   * base tiene que quedar igual. `CREATE OR REPLACE VIEW` no permite quitar
   * columnas y dejaría el estante viejo conviviendo con la definición nueva.
   */
  private async crearEstante(nombre: string, sql: string): Promise<ResultadoEstante> {
    const drop = await postgresService.query(`DROP VIEW IF EXISTS ${nombre} CASCADE`);
    if (drop === null) return { nombre, ok: false };

    const create = await postgresService.query(`CREATE VIEW ${nombre} AS ${sql}`);
    if (create === null) return { nombre, ok: false };

    // El GRANT va después del CREATE porque el DROP se lleva los permisos.
    const grant = await postgresService.query(`GRANT SELECT ON ${nombre} TO ${RO_ROLE}`);
    return { nombre, ok: grant !== null };
  }

  /**
   * Convierte texto a fecha sin tumbar el estante.
   *
   * `fechaAtencion` se guarda como texto ISO. Una sola fila con una fecha mal
   * formada —y en cinco años de datos migrados desde Wix las hay— haría fallar
   * la consulta entera para todos. Esta función devuelve NULL en vez de lanzar:
   * la fila mala se ve como "sin fecha" en lugar de romper el reporte.
   */
  private async crearHelpers(): Promise<boolean> {
    const r = await postgresService.query(`
      CREATE OR REPLACE FUNCTION bv_a_fecha(t text) RETURNS timestamptz AS $fn$
      BEGIN
        RETURN NULLIF(btrim(t), '')::timestamptz;
      EXCEPTION WHEN others THEN
        RETURN NULL;
      END;
      $fn$ LANGUAGE plpgsql IMMUTABLE;
    `);
    if (r === null) return false;
    return (await postgresService.query(`GRANT EXECUTE ON FUNCTION bv_a_fecha(text) TO ${RO_ROLE}`)) !== null;
  }

  // --------------------------------------------------------------------------

  async ensureEstantes(): Promise<void> {
    if (!(await this.crearHelpers())) {
      console.error('❌ [BodyVibe] No se pudo crear el ayudante de fechas — estantes cancelados.');
      return;
    }

    // Un despliegue anterior pudo haber creado el estante clínico. Retirarlo
    // del código no lo saca de la base: si queda, el rol de solo lectura sigue
    // viéndolo y un app puede armar encima el tablero de ceros que este
    // archivo existe para evitar.
    await postgresService.query('DROP VIEW IF EXISTS bv_condiciones CASCADE');

    const resultados: ResultadoEstante[] = [];

    // ------------------------------------------------------------------------
    // 1. bv_citas — la agenda. Operativo: lleva identidad, no lleva clínica.
    //
    // DEFINICIÓN CANÓNICA DE "CITA ATENDIDA": `fechaConsulta IS NOT NULL`.
    // Decidida por el autor tras medirlo contra la base. Es la que usa
    // `estado`, y es la única que los apps deben usar.
    //
    // La plataforma tiene una segunda definición, en el calendario del
    // coordinador (`calendario.service`): `UPPER(atendido) = 'ATENDIDO'`. No
    // coincide con la canónica en 38 de 2.883 citas (1,3%), y la causa tiene
    // nombre: `atendido = 'REPROGRAMADA'`, un valor que el CASE del calendario
    // no contempla y que cae al ELSE como "pendiente". De esas 38, hay 13
    // consultas que SÍ ocurrieron y el calendario cuenta como pendientes.
    //
    // `estado_calendario` y `estados_discrepan` se conservan por una sola
    // razón: encontrar y depurar esas filas. No son para reportar. Cuando el
    // calendario se corrija y `estados_discrepan` dé cero de forma estable,
    // ambas columnas se pueden quitar de acá.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_citas',
        `
        SELECT
          h."_id"                                   AS historia_id,
          h."sede_id"                               AS sede_id,
          h."ciudad"                                AS ciudad,
          bv_a_fecha(h."fechaAtencion"::text)       AS fecha_atencion,
          (bv_a_fecha(h."fechaAtencion"::text) AT TIME ZONE 'America/Bogota')::date AS fecha_local,
          h."horaAtencion"                          AS hora_atencion,
          h."fechaConsulta"                         AS fecha_consulta,
          h."medico"                                AS medico_codigo,
          h."tipoExamen"                            AS tipo_examen,
          h."empresa"                               AS empresa,
          h."eps"                                   AS eps,
          btrim(
            COALESCE(h."primerNombre",  '') || ' ' || COALESCE(h."segundoNombre",   '') || ' ' ||
            COALESCE(h."primerApellido",'') || ' ' || COALESCE(h."segundoApellido", '')
          )                                         AS paciente_nombre,
          h."celular"                               AS paciente_celular,

          -- Género. La columna guarda 'F'/'M', pero hay filas escritas de otra
          -- forma ('Femenino'): en un GROUP BY crudo aparecerían como una
          -- categoría aparte de un solo paciente. Acá se normalizan las formas
          -- conocidas y CUALQUIER OTRO VALOR SE DEJA PASAR TAL CUAL — así una
          -- forma nueva se ve y alguien la corrige, en vez de desaparecer en
          -- silencio dentro de "sin dato".
          --
          -- 677 de 2.930 historias no lo tienen (23%). Todo reporte por género
          -- debe mostrar esa cobertura: está en bv_cobertura.con_genero.
          CASE
            WHEN lower(btrim(h."genero_biologico"::text)) IN ('f','fem','femenino','mujer')
              THEN 'Femenino'
            WHEN lower(btrim(h."genero_biologico"::text)) IN ('m','masc','masculino','hombre')
              THEN 'Masculino'
            ELSE NULLIF(btrim(h."genero_biologico"::text), '')
          END                                       AS genero,
          h."link_enviado_at"                       AS link_enviado_at,
          -- 'manual' = lo envió el coach; 'auto' = el worker link-auto. Los
          -- indicadores de gestión solo cuentan el manual.
          COALESCE(h."link_enviado_por", 'manual')  AS link_enviado_por,

          -- Criterio del panel médico. Ver la advertencia de arriba.
          CASE
            WHEN h."fechaConsulta" IS NOT NULL THEN 'ATENDIDA'
            WHEN COALESCE(h."pvEstado", '') = 'No Contesta' THEN 'NOCONTESTA'
            ELSE 'PENDIENTE'
          END                                       AS estado,

          -- Criterio del calendario del coordinador.
          CASE
            WHEN UPPER(COALESCE(h."atendido", 'PENDIENTE')) = 'ATENDIDO' THEN 'ATENDIDA'
            WHEN UPPER(COALESCE(h."atendido", 'PENDIENTE')) = 'NO CONTESTA' THEN 'NOCONTESTA'
            WHEN NOT (h."link_enviado_at" IS NOT NULL
                      AND COALESCE(h."link_enviado_por", 'manual') = 'manual')
             AND bv_a_fecha(h."fechaAtencion"::text) < NOW() THEN 'NOCONTACTO'
            ELSE 'PENDIENTE'
          END                                       AS estado_calendario,

          (
            CASE
              WHEN h."fechaConsulta" IS NOT NULL THEN 'ATENDIDA'
              WHEN COALESCE(h."pvEstado", '') = 'No Contesta' THEN 'NOCONTESTA'
              ELSE 'PENDIENTE'
            END
          ) <> (
            CASE
              WHEN UPPER(COALESCE(h."atendido", 'PENDIENTE')) = 'ATENDIDO' THEN 'ATENDIDA'
              WHEN UPPER(COALESCE(h."atendido", 'PENDIENTE')) = 'NO CONTESTA' THEN 'NOCONTESTA'
              WHEN NOT (h."link_enviado_at" IS NOT NULL
                        AND COALESCE(h."link_enviado_por", 'manual') = 'manual')
               AND bv_a_fecha(h."fechaAtencion"::text) < NOW() THEN 'NOCONTACTO'
              ELSE 'PENDIENTE'
            END
          )                                         AS estados_discrepan,

          -- Origen de la cita: nativa de la plataforma vs integración Trepsi.
          CASE WHEN t.cita_id IS NOT NULL THEN 'TREPSI' ELSE 'NATIVA' END AS origen,

          h."_createdDate"                          AS creada_at
        FROM "HistoriaClinica" h
        LEFT JOIN trepsi_appointments t ON t.historia_id = h."_id"
      `
      )
    );

    // ------------------------------------------------------------------------
    // NO HAY ESTANTE CLÍNICO. Es deliberado, y es la decisión más importante
    // de este archivo.
    //
    // Existió un `bv_condiciones` con los antecedentes. Se quitó cuando la
    // base dijo la verdad: de 2.883 historias clínicas, los seis flags de
    // antecedentes están en `false` en las 2.883, y los seis campos de detalle
    // están vacíos en las 2.883. Nadie los diligencia — confirmado con el
    // autor, no inferido.
    //
    // Un estante lleno de `false` es PEOR que no tener estante. Devuelve un
    // resultado con forma de hallazgo: "0 pacientes con antecedentes
    // patológicos" se lee como un dato clínico cuando en realidad significa
    // "nadie llenó el campo". El agente no puede distinguir una cosa de la
    // otra, y quien lea el tablero tampoco. Ese es exactamente el reporte que
    // miente, servido en bandeja.
    //
    // Lo que sí queda es la señal de captura en `bv_cobertura`
    // (`con_antecedentes`, `con_antecedentes_texto`): ahí un cero se lee como
    // lo que es —nadie está capturando— y no como un hallazgo médico.
    //
    // Para volver a tener estante clínico tienen que pasar dos cosas, en este
    // orden: que los antecedentes se empiecen a diligenciar de verdad, y que
    // `bv_cobertura` lo confirme con varios meses de datos. Antes de eso,
    // cualquier reporte de condiciones médicas es ficción con gráficos.
    // ------------------------------------------------------------------------

    // ------------------------------------------------------------------------
    // 3. bv_cobertura — cuánto de cada campo está realmente diligenciado.
    //
    // Este estante existe por el riesgo número uno del proyecto: el reporte
    // que no falla, devuelve un número, y el número está mal.
    //
    // Un tablero de "registros por ciudad" armado sobre estos datos se ve
    // perfecto y es engañoso: 2.072 de 2.883 historias no tienen ciudad. Un
    // reporte de condiciones médicas muestra cero, y ese cero significa "nadie
    // las está capturando", no "nadie tiene antecedentes".
    //
    // Con este estante, un app puede —y debería— decir "esto cubre el 28% de
    // los registros" al lado del gráfico. La diferencia entre un dato y una
    // mentira suele ser esa línea.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_cobertura',
        `
        SELECT
          h."sede_id"                                  AS sede_id,
          EXTRACT(YEAR  FROM bv_a_fecha(h."fechaAtencion"::text) AT TIME ZONE 'America/Bogota')::int AS anio,
          EXTRACT(MONTH FROM bv_a_fecha(h."fechaAtencion"::text) AT TIME ZONE 'America/Bogota')::int AS mes,
          COUNT(*)::int                                AS historias,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."ciudad"), '') IS NOT NULL)::int      AS con_ciudad,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."genero_biologico"), '') IS NOT NULL)::int AS con_genero,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."empresa"), '') IS NOT NULL)::int     AS con_empresa,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."eps"), '') IS NOT NULL)::int         AS con_eps,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."celular"), '') IS NOT NULL)::int     AS con_celular,
          COUNT(*) FILTER (WHERE NULLIF(btrim(h."tipoExamen"), '') IS NOT NULL)::int  AS con_tipo_examen,
          COUNT(*) FILTER (WHERE h."fechaConsulta" IS NOT NULL)::int                  AS atendidas,
          COUNT(*) FILTER (WHERE h."link_enviado_at" IS NOT NULL)::int                AS con_link_enviado,
          COUNT(*) FILTER (WHERE
            ${GRUPOS_ANTECEDENTES.map((g) => `COALESCE(h."ant_${g}_flag", FALSE)`).join(' OR ')}
          )::int                                       AS con_antecedentes,
          COUNT(*) FILTER (WHERE
            ${GRUPOS_ANTECEDENTES.map((g) => `NULLIF(btrim(h."ant_${g}_obs"), '') IS NOT NULL`).join(' OR ')}
          )::int                                       AS con_antecedentes_texto
        FROM "HistoriaClinica" h
        GROUP BY 1, 2, 3
      `
      )
    );

    // ------------------------------------------------------------------------
    // 4. bv_profesionales — sin `firma` (es una imagen de firma real, no es
    //    dato de reporte) y sin la licencia completa.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_profesionales',
        `
        SELECT
          p.id                AS profesional_id,
          p.sede_id           AS sede_id,
          p.rol               AS rol,
          p.codigo            AS codigo,
          btrim(
            COALESCE(p.primer_nombre,  '') || ' ' || COALESCE(p.segundo_nombre,   '') || ' ' ||
            COALESCE(p.primer_apellido,'') || ' ' || COALESCE(p.segundo_apellido, '')
          )                   AS nombre,
          p.alias             AS alias,
          p.especialidad      AS especialidad,
          p.tiempo_consulta   AS minutos_por_consulta,
          p.email             AS email,
          p.celular           AS celular,
          p.activo            AS activo,
          p.fecha_vencimiento_licencia AS licencia_vence,
          p.created_at        AS creado_at
        FROM profesionales p
      `
      )
    );

    // ------------------------------------------------------------------------
    // 5. bv_disponibilidad — patrón semanal recurrente.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_disponibilidad',
        `
        SELECT
          d.id             AS id,
          d.profesional_id AS profesional_id,
          d.sede_id        AS sede_id,
          d.dia_semana     AS dia_semana,
          CASE d.dia_semana
            WHEN 0 THEN 'domingo' WHEN 1 THEN 'lunes'   WHEN 2 THEN 'martes'
            WHEN 3 THEN 'miércoles' WHEN 4 THEN 'jueves' WHEN 5 THEN 'viernes'
            ELSE 'sábado'
          END              AS dia_nombre,
          d.hora_inicio    AS hora_inicio,
          d.hora_fin       AS hora_fin,
          d.modalidad      AS modalidad,
          d.activo         AS activo
        FROM profesionales_disponibilidad d
      `
      )
    );

    // ------------------------------------------------------------------------
    // 6. bv_disponibilidad_fecha — excepciones para un día puntual.
    //    `bloqueado = TRUE` con horas en NULL es el centinela de "día cerrado".
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_disponibilidad_fecha',
        `
        SELECT
          f.id             AS id,
          f.profesional_id AS profesional_id,
          f.sede_id        AS sede_id,
          f.fecha          AS fecha,
          f.hora_inicio    AS hora_inicio,
          f.hora_fin       AS hora_fin,
          f.modalidad      AS modalidad,
          f.bloqueado      AS dia_bloqueado
        FROM profesionales_disponibilidad_fecha f
      `
      )
    );

    // ------------------------------------------------------------------------
    // 7. bv_jornada — torniquete de entrada/salida de los coaches.
    //    `minutos_jornada` se calcula acá para que ningún app tenga que
    //    acordarse de que una jornada abierta se mide contra el último latido,
    //    no contra NOW().
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_jornada',
        `
        SELECT
          j.id               AS id,
          j.codigo           AS codigo,
          j.sede_id          AS sede_id,
          j.rol              AS rol,
          j.fecha            AS fecha,
          j.entrada_at       AS entrada_at,
          j.salida_at        AS salida_at,
          j.ultimo_latido_at AS ultimo_latido_at,
          j.cerrada          AS cerrada,
          ROUND(
            EXTRACT(EPOCH FROM (COALESCE(j.salida_at, j.ultimo_latido_at) - j.entrada_at)) / 60.0
          )::int             AS minutos_jornada
        FROM torniquete_jornadas j
      `
      )
    );

    // ------------------------------------------------------------------------
    // 8. bv_calidad — evaluaciones de calidad. Sin `transcript` (es la
    //    conversación completa entre médico y paciente) y sin el JSON crudo.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_calidad',
        `
        SELECT
          e.id            AS id,
          e.historia_id   AS historia_id,
          h."sede_id"     AS sede_id,
          h."medico"      AS medico_codigo,
          e.estado        AS estado,
          e.puntaje_total AS puntaje_total,
          e.created_at    AS evaluada_at
        FROM consulta_evaluaciones e
        LEFT JOIN "HistoriaClinica" h ON h."_id" = e.historia_id
      `
      )
    );

    // ------------------------------------------------------------------------
    // 9. bv_sedes — la raíz de la multi-sede.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_sedes',
        `SELECT s.sede_id AS sede_id, s.nombre AS nombre, s.ciudad AS ciudad, s.activa AS activa FROM sedes s`
      )
    );

    // ------------------------------------------------------------------------
    // 10. bv_trepsi — ciclo de vida de las citas que llegan de Trepsi.
    //    Sin `payload` (trae el JSON crudo con datos del paciente).
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_trepsi',
        `
        SELECT
          t.cita_id          AS cita_id,
          t.historia_id      AS historia_id,
          t.estado           AS estado,
          t.fecha_atencion   AS fecha_atencion,
          t.duracion_minutos AS duracion_minutos,
          t.medico_codigo    AS medico_codigo,
          t.medico_nombre    AS medico_nombre,
          t.tipo_consulta    AS tipo_consulta,
          t.sede_origen      AS sede_origen,
          t.created_at       AS creada_at,
          t.updated_at       AS actualizada_at
        FROM trepsi_appointments t
      `
      )
    );

    // ------------------------------------------------------------------------
    // 11. bv_videollamadas — sesiones de video. Métrica operativa: cuántas
    //     llamadas, de qué duración, en qué sede.
    // ------------------------------------------------------------------------
    resultados.push(
      await this.crearEstante(
        'bv_videollamadas',
        `
        SELECT
          v.id         AS id,
          v.room_name  AS sala,
          v.sede       AS sede_id,
          v.medico     AS medico_codigo,
          v.created_at AS iniciada_at,
          v.ended_at   AS terminada_at,
          v.recording_enabled AS con_grabacion,
          CASE
            WHEN v.ended_at IS NULL THEN NULL
            ELSE ROUND(EXTRACT(EPOCH FROM (v.ended_at - v.created_at)) / 60.0)::int
          END          AS minutos
        FROM video_sessions v
      `
      )
    );

    const fallidos = resultados.filter((r) => !r.ok).map((r) => r.nombre);
    const listos = resultados.filter((r) => r.ok).length;

    if (fallidos.length === 0) {
      console.log(`📚 [BodyVibe] ${listos} estantes listos y otorgados a ${RO_ROLE}`);
    } else {
      // No es fatal: los estantes que sí quedaron sirven igual. Pero tiene que
      // verse, porque un estante ausente se manifiesta como "el agente no puede
      // hacer ese reporte" y eso se diagnostica muy mal desde afuera.
      console.warn(
        `⚠️  [BodyVibe] ${listos} estantes listos, ${fallidos.length} fallaron: ${fallidos.join(', ')}. ` +
          'Suele ser una tabla que no existe en esta base (p. ej. `formularios` en un entorno de desarrollo).'
      );
    }
  }
}

export const bodyvibeEstantesService = new BodyVibeEstantesService();
export default bodyvibeEstantesService;

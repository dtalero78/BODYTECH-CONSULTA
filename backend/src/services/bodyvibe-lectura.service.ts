// ============================================================================
// bodyvibe-lectura.service — Qué puede LEER el rol de BodyVibeTech.
//
// Cambio de alcance respecto del diseño original: antes el rol solo alcanzaba
// diez vistas (`bv_*`). Ahora alcanza TODAS las tablas de la plataforma, menos
// una lista corta.
//
// El motivo lo dio el uso real. El primer app pedido fue "consultas por
// género"; el estante no traía esa columna, así que el agente respondió —
// correctamente— que no había dato. Pero el dato existía: el hueco era del
// estante, y taparlo requería que una persona editara código y desplegara. Eso
// es exactamente el cuello de botella que este proyecto existe para eliminar.
// Con 719 columnas en 33 tablas, ese episodio se iba a repetir cada semana.
//
// Lo que NO cambia:
//
//   · Sigue siendo SOLO LECTURA. Cero permisos de escritura, en ninguna tabla.
//     El rol no es dueño de nada y cada consulta corre dentro de una
//     transacción de solo lectura.
//   · Siguen los topes: 4 conexiones, corte a 5 segundos.
//   · Siguen existiendo los estantes `bv_*`, y siguen siendo el camino
//     recomendado: son los que llevan escrito qué significa cada número. Las
//     tablas crudas están disponibles para lo que el estante no cubra.
//
// Lo que se queda afuera, y por qué. No es una lista de "datos delicados" —
// media base es delicada. Son cosas cuyo daño no se repara:
//
//   · `usuarios.password_hash` — una credencial no es un dato de reporte.
//   · `HistoriaClinica.transcription_text` y `consulta_evaluaciones.transcript`
//     — la conversación completa entre médico y paciente, palabra por palabra.
//     Ningún reporte necesita eso; una fuga de eso no se arregla.
//   · Las firmas (`profesionales.firma`, `formularios.firma`) — son la imagen
//     de una firma real, reutilizable para firmar otra cosa.
//   · Los `payload` crudos de Trepsi y el token de la imagen del informe.
//   · Las tablas del propio BodyVibeTech: un app no debe leer la cola de
//     aprobación, el gasto, ni el SQL que corrieron los apps de otros.
//
// Todo lo demás está abierto. Si algo de esta lista tiene que abrirse, se saca
// de acá — es una línea.
// ============================================================================

import postgresService from './postgres.service';

const RO_ROLE = 'bodyvibe_ro';

/** Columnas que no se otorgan, aunque su tabla sí. */
export const COLUMNAS_VEDADAS: Record<string, string[]> = {
  usuarios: ['password_hash'],
  HistoriaClinica: ['transcription_text'],
  consulta_evaluaciones: ['transcript'],
  profesionales: ['firma'],
  formularios: ['firma'],
  gestion_report_image: ['token', 'png'],
  trepsi_appointments: ['payload'],
  trepsi_integration_log: ['request_body', 'response_body'],
  trepsi_webhook_outbox: ['payload', 'response_body'],
};

/**
 * Tablas que no se otorgan enteras. Son las de control de BodyVibeTech: un app
 * leyendo la cola de aprobación, el gasto o las consultas de otros apps es un
 * problema distinto y peor que el que este permiso resuelve.
 */
export function tablaVedada(nombre: string): boolean {
  return nombre.startsWith('bodyvibe_') || nombre === 'vistas_guardadas';
}

export interface ResumenLectura {
  tablas: number;
  columnasOtorgadas: number;
  columnasVedadas: number;
  tablasVedadas: string[];
  fallidas: string[];
}

class BodyVibeLecturaService {
  /**
   * Deja los permisos exactamente como los declara este archivo.
   *
   * Empieza revocando: si una columna sale de la lista de vedadas, o si alguien
   * otorgó algo a mano en la consola, el estado anterior no debe sobrevivir.
   * Este archivo es la fuente de verdad, no un acumulado histórico.
   */
  async otorgarLecturaGeneral(): Promise<ResumenLectura> {
    const resumen: ResumenLectura = {
      tablas: 0,
      columnasOtorgadas: 0,
      columnasVedadas: 0,
      tablasVedadas: [],
      fallidas: [],
    };

    const tablas = await postgresService.query(
      `SELECT c.relname AS nombre
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY 1`
    );
    if (!tablas) {
      resumen.fallidas.push('no se pudo listar las tablas');
      return resumen;
    }

    // Borrón y cuenta nueva. Ojo: en Postgres "ALL TABLES IN SCHEMA" incluye
    // las VISTAS, así que esto también borra el permiso de los estantes — por
    // eso esta función corre ANTES de crearlos, y no después.
    await postgresService.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${RO_ROLE}`);

    for (const { nombre } of tablas) {
      if (tablaVedada(nombre)) {
        resumen.tablasVedadas.push(nombre);
        continue;
      }

      const vedadas = COLUMNAS_VEDADAS[nombre] ?? [];

      if (vedadas.length === 0) {
        const r = await postgresService.query(`GRANT SELECT ON "${nombre}" TO ${RO_ROLE}`);
        if (r === null) resumen.fallidas.push(nombre);
        else resumen.tablas += 1;
        continue;
      }

      // Con columnas vedadas hay que enumerar el resto: Postgres permite
      // otorgar SELECT columna por columna, y eso es lo que hace posible abrir
      // `HistoriaClinica` entera menos la transcripción.
      const cols = await postgresService.query(
        `SELECT a.attname AS col
           FROM pg_attribute a
          WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
            AND NOT (a.attname = ANY($2::text[]))
          ORDER BY a.attnum`,
        [`"${nombre}"`, vedadas]
      );
      if (!cols || cols.length === 0) {
        resumen.fallidas.push(nombre);
        continue;
      }

      const lista = cols.map((c: any) => `"${c.col}"`).join(', ');
      const r = await postgresService.query(
        `GRANT SELECT (${lista}) ON "${nombre}" TO ${RO_ROLE}`
      );
      if (r === null) resumen.fallidas.push(nombre);
      else {
        resumen.tablas += 1;
        resumen.columnasVedadas += vedadas.length;
      }
    }

    const otorgadas = await postgresService.query(
      `SELECT COUNT(*)::int AS n
         FROM information_schema.column_privileges
        WHERE grantee = $1 AND table_schema = 'public' AND privilege_type = 'SELECT'`,
      [RO_ROLE]
    );
    resumen.columnasOtorgadas = otorgadas?.[0]?.n ?? 0;

    if (resumen.fallidas.length > 0) {
      console.warn(
        `⚠️  [BodyVibe] No se pudo otorgar lectura sobre: ${resumen.fallidas.join(', ')}`
      );
    }
    console.log(
      `🔓 [BodyVibe] Lectura general: ${resumen.tablas} tablas · ` +
        `${resumen.columnasOtorgadas} columnas · ` +
        `${resumen.columnasVedadas} columnas vedadas · ` +
        `${resumen.tablasVedadas.length} tablas de control fuera`
    );

    return resumen;
  }
}

export const bodyvibeLecturaService = new BodyVibeLecturaService();
export default bodyvibeLecturaService;

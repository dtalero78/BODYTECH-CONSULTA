// ============================================================================
// bodyvibe-catalogo.service — El catálogo completo que ve el agente.
//
// Se arma de dos mitades, y la división no es casual:
//
//   · LO QUE SE DEDUCE del código, en cada compilación. Pantallas, rutas de
//     API, paleta de colores. Nace del código, así que nunca se desactualiza.
//     Vive en `src/generated/catalogo.generado.ts`.
//
//   · LO QUE HAY QUE SABER y ninguna máquina puede deducir: las reglas y las
//     cicatrices. Qué significa "cita atendida", qué datos no existen, qué ya
//     salió mal una vez. Vive en `src/bodyvibe/REGLAS.md`, escrito a mano.
//
// Y una tercera pieza que no se deduce del código sino de la BASE: las columnas
// reales de cada estante. Se leen de `information_schema` al arrancar, porque
// la verdad sobre qué columnas existen la tiene Postgres. Un catálogo que
// declare una columna que la vista no tiene produce SQL que falla, y el agente
// no tiene forma de saber que le mintieron.
//
// El texto que sale de acá es IDÉNTICO entre pedidos: se envía como prefijo
// estable del prompt y se cachea del lado del proveedor, así que a partir del
// segundo pedido cuesta una décima parte. Por eso no lleva fechas, contadores
// ni nada que cambie: un solo byte distinto tira la caché entera y multiplica
// el costo por diez.
// ============================================================================

import postgresService from './postgres.service';
import { DESCRIPCION_ESTANTES } from './bodyvibe-estantes.service';
import { ANCLAJES } from './bodyvibe-anclajes';
import { COLUMNAS_VEDADAS, tablaVedada } from './bodyvibe-lectura.service';
import CATALOGO_GENERADO from '../generated/catalogo.generado';

export interface ColumnaEstante {
  nombre: string;
  tipo: string;
}

export interface EstanteCatalogo {
  nombre: string;
  descripcion: string;
  columnas: ColumnaEstante[];
}

export interface TablaCatalogo {
  nombre: string;
  columnas: ColumnaEstante[];
  /** Columnas que existen pero están (casi) siempre vacías. */
  sinDatos: string[];
}

export interface Catalogo {
  estantes: EstanteCatalogo[];
  /** Todas las tablas base legibles, con sus columnas. */
  tablas: TablaCatalogo[];
  pantallas: typeof CATALOGO_GENERADO.pantallas;
  api: typeof CATALOGO_GENERADO.api;
  visual: typeof CATALOGO_GENERADO.visual;
  reglas: string;
  /** Fuentes que no se pudieron leer al generar o al consultar la base. */
  faltantes: string[];
}

/** Traduce los tipos de Postgres a algo que se entienda sin ser DBA. */
function tipoLegible(dataType: string): string {
  const mapa: Record<string, string> = {
    'character varying': 'texto',
    text: 'texto',
    integer: 'número entero',
    bigint: 'número entero',
    smallint: 'número entero',
    numeric: 'número',
    'double precision': 'número',
    boolean: 'sí/no',
    date: 'fecha',
    'timestamp with time zone': 'fecha y hora',
    'timestamp without time zone': 'fecha y hora',
    'time without time zone': 'hora',
    jsonb: 'JSON',
    json: 'JSON',
  };
  return mapa[dataType] ?? dataType;
}

class BodyVibeCatalogoService {
  private cache: Catalogo | null = null;

  /** Fuerza la relectura. Se llama después de rehacer los estantes. */
  invalidar(): void {
    this.cache = null;
  }

  async obtener(): Promise<Catalogo> {
    if (this.cache) return this.cache;

    const faltantes = [...CATALOGO_GENERADO.faltantes];

    // Las columnas de los estantes se leen de la base, no del código. Es la
    // única fuente que no puede estar desfasada.
    const filas = await postgresService.query(
      `SELECT table_name, column_name, data_type
         FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name LIKE 'bv\\_%'
        ORDER BY table_name, ordinal_position`
    );

    const porEstante = new Map<string, ColumnaEstante[]>();
    if (filas === null) {
      faltantes.push('columnas de los estantes (no se pudo consultar la base)');
    } else {
      for (const f of filas) {
        const lista = porEstante.get(f.table_name) ?? [];
        lista.push({ nombre: f.column_name, tipo: tipoLegible(f.data_type) });
        porEstante.set(f.table_name, lista);
      }
    }

    const estantes: EstanteCatalogo[] = [...porEstante.entries()]
      .map(([nombre, columnas]) => ({
        nombre,
        descripcion: DESCRIPCION_ESTANTES[nombre] ?? '',
        columnas,
      }))
      // Sin descripción, el agente sabe que la vista existe pero no para qué
      // sirve. Se deja igual (mejor que ocultarla) pero se registra, porque
      // significa que alguien creó un estante y olvidó describirlo.
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

    for (const e of estantes) {
      if (!e.descripcion) faltantes.push(`descripción de ${e.nombre}`);
    }

    // Todas las tablas base. `pg_stats.null_frac` dice qué proporción de cada
    // columna es nula, y sale de las estadísticas ya calculadas: no hay que
    // recorrer las tablas. Con eso se separan las columnas que existen de las
    // que además tienen datos — una distinción que importa mucho acá, porque
    // 225 de las 337 de HistoriaClinica están prácticamente vacías y un reporte
    // construido sobre ellas devuelve ceros que parecen hallazgos.
    const columnasBase = await postgresService.query(
      `SELECT c.table_name, c.column_name, c.data_type,
              COALESCE(s.null_frac, 0) AS null_frac
         FROM information_schema.columns c
         JOIN pg_class pc ON pc.relname = c.table_name
         JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
         LEFT JOIN pg_stats s
           ON s.schemaname = 'public' AND s.tablename = c.table_name
          AND s.attname = c.column_name
        WHERE c.table_schema = 'public' AND pc.relkind = 'r'
        ORDER BY c.table_name, c.ordinal_position`
    );

    const porTabla = new Map<string, TablaCatalogo>();
    for (const f of columnasBase ?? []) {
      const tabla: string = f.table_name;
      if (tablaVedada(tabla)) continue;
      if ((COLUMNAS_VEDADAS[tabla] ?? []).includes(f.column_name)) continue;

      const entrada = porTabla.get(tabla) ?? { nombre: tabla, columnas: [], sinDatos: [] };
      if (Number(f.null_frac) >= 0.999) entrada.sinDatos.push(f.column_name);
      else entrada.columnas.push({ nombre: f.column_name, tipo: tipoLegible(f.data_type) });
      porTabla.set(tabla, entrada);
    }
    const tablas = [...porTabla.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));

    this.cache = {
      estantes,
      tablas,
      pantallas: CATALOGO_GENERADO.pantallas,
      api: CATALOGO_GENERADO.api,
      visual: CATALOGO_GENERADO.visual,
      reglas: CATALOGO_GENERADO.reglas,
      faltantes,
    };

    return this.cache;
  }

  /**
   * El catálogo como texto, listo para el prompt.
   *
   * El orden importa: primero lo más consultado (los estantes), al final las
   * reglas, que es lo más largo. Y todo estable — ver la nota de caché arriba.
   */
  async comoTexto(): Promise<string> {
    const c = await this.obtener();
    const p: string[] = [];

    p.push('# Catálogo de la plataforma Bodytech\n');

    // -- Estantes ------------------------------------------------------------
    p.push('## Datos disponibles\n');
    p.push(
      'Estos son los ÚNICOS datos que puede consultar. Son vistas de solo lectura.\n' +
        'No existe forma de escribir, y no hay acceso a ninguna otra tabla.\n'
    );

    if (c.estantes.length === 0) {
      p.push('_No hay estantes disponibles en este momento._\n');
    }

    for (const e of c.estantes) {
      p.push(`### ${e.nombre}`);
      if (e.descripcion) p.push(e.descripcion);
      p.push('');
      p.push('| columna | tipo |');
      p.push('|---|---|');
      for (const col of e.columnas) p.push(`| ${col.nombre} | ${col.tipo} |`);
      p.push('');
    }

    // -- Tablas base ---------------------------------------------------------
    p.push('## Las tablas completas\n');
    p.push(
      'Además de los estantes puede consultar cualquier tabla de la plataforma,\n' +
        'siempre en solo lectura. Los estantes siguen siendo el camino preferido:\n' +
        'traen resueltas las definiciones que acá tiene que resolver usted (qué cuenta\n' +
        'como cita atendida, cómo se normaliza el género, la hora de Colombia).\n' +
        'Use las tablas crudas para lo que el estante no cubra.\n'
    );
    p.push(
      'De cada tabla se listan las columnas QUE TIENEN DATOS. Las que existen pero\n' +
        'están siempre vacías se cuentan al final y **no hay que usarlas**: un reporte\n' +
        'construido sobre una columna vacía devuelve ceros que se leen como hallazgos.\n'
    );

    for (const t of c.tablas) {
      const vacías = t.sinDatos.length ? ` · ${t.sinDatos.length} sin datos` : '';
      p.push(`**${t.nombre}** (${t.columnas.length} con datos${vacías})`);
      p.push('');
      p.push(t.columnas.map((col) => `\`${col.nombre}\` ${col.tipo}`).join(' · ') || '_(ninguna con datos)_');
      p.push('');
    }

    // -- Pantallas -----------------------------------------------------------
    p.push('## Pantallas que ya existen\n');
    p.push('Para ubicarse. No puede modificarlas desde acá salvo en apariencia.\n');
    p.push('| ruta | pantalla | quién entra |');
    p.push('|---|---|---|');
    for (const s of c.pantallas) {
      const destino = s.redirigeA ? `→ ${s.redirigeA}` : (s.componente ?? '—');
      const quien = s.roles ? s.roles.join(', ') : s.protegida ? 'con sesión' : 'público';
      p.push(`| ${s.ruta} | ${destino} | ${quien} |`);
    }
    p.push('');

    // -- Anclajes ------------------------------------------------------------
    p.push('## Dónde puede terminar viviendo lo que construís\n');
    p.push(
      'Una aplicación puede quedar suelta (en la pantalla de Aplicaciones) o INCRUSTADA al pie\n' +
        'de una pantalla que ya existe. Quien publica lo elige. Si va incrustada, su aplicación\n' +
        'comparte pantalla con lo que ya está ahí: manténgala compacta, sin encabezados\n' +
        'gigantes ni márgenes enormes, y que se entienda sin contexto previo.\n'
    );
    p.push('| punto | dónde queda |');
    p.push('|---|---|');
    for (const a of ANCLAJES) p.push(`| ${a.id} | ${a.descripcion} |`);
    p.push('');

    // -- Lenguaje visual -----------------------------------------------------
    p.push('## Lenguaje visual\n');
    p.push(
      'Use estos valores para que lo que construya se vea parte de la plataforma\n' +
        'y no una pantalla pegada al lado. Dentro del recinto ya están disponibles\n' +
        'como variables CSS `--bv-*`; esta tabla es la referencia de origen.\n'
    );
    const visuales = {
      ...c.visual.tokensCoordinador,
      ...c.visual.tipografias,
      ...c.visual.variablesPanel,
    };
    p.push('| token | valor |');
    p.push('|---|---|');
    for (const [k, v] of Object.entries(visuales)) p.push(`| ${k} | ${v} |`);
    p.push('');

    // -- Reglas --------------------------------------------------------------
    p.push('---\n');
    p.push(c.reglas);

    return p.join('\n');
  }
}

export const bodyvibeCatalogoService = new BodyVibeCatalogoService();
export default bodyvibeCatalogoService;

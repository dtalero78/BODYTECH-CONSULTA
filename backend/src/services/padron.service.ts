// ============================================================================
// padronService — Cotejo de identidades de afiliados.
//
// Paso previo al padrón único: en vez de fusionar personas de una, primero se
// MUESTRA cómo están hoy. Es el mismo orden que funcionó con el directorio de
// profesionales — ver antes de escribir — y acá importa más, porque fusionar mal
// dos pacientes le cuelga a alguien la historia clínica de otro.
//
// Solo lectura. No escribe una sola fila.
//
// Mira únicamente los pacientes de ESTA app, no los de ACC. El cruce entre
// programas llega cuando exista el padrón compartido; hacerlo ahora metería a
// consulta a leer la base de otra aplicación, que es justo el acoplamiento que
// el padrón viene a evitar.
// ============================================================================

import postgresService from './postgres.service';
import { sedeFilter } from '../helpers/sede-scope';
import {
  clasificarIdentidad,
  type EstadoIdentidad,
  type IdentidadAgrupada,
} from '../helpers/padron.helper';

export interface AfiliadoCotejado extends IdentidadAgrupada {
  /** Cuántas historias clínicas cuelgan de este documento. */
  historias: number;
  /** En qué programas aparece la persona: nativa, trepsi, umv, corporativo… */
  origenes: string[];
  /** Última atención registrada (ISO), o null si ninguna fecha es legible. */
  ultimaAtencion: string | null;
}

export interface ResumenCotejo {
  documentos: number;
  unico: number;
  unificable: number;
  conflicto: number;
  administrativo: number;
  /** Personas que aparecen en más de un programa: el recorrido del diagrama. */
  enVariosProgramas: number;
}

class PadronService {
  /**
   * Agrupa por documento y clasifica. Devuelve TODO clasificado más el resumen;
   * el filtrado por estado lo hace quien llama, porque el resumen tiene que
   * contar sobre el universo completo, no sobre lo filtrado.
   */
  async cotejo(sedes?: string[]): Promise<{ filas: AfiliadoCotejado[]; resumen: ResumenCotejo }> {
    // Las cédulas de la planta no clasifican por sí solas (un profesional puede
    // atenderse como paciente), pero se informan como contexto a quien revise.
    const profs = await postgresService.query('SELECT codigo FROM profesionales');
    if (profs === null) throw new Error('No se pudo leer la planta para el cotejo.');
    const docsProfesionales = new Set<string>(
      profs.map((r) => String(r.codigo ?? '').replace(/\D/g, '')).filter(Boolean),
    );

    const params: unknown[] = [];
    const sf = sedeFilter(sedes, '"sede_id"', params);

    // La guarda regex va ANTES del ::timestamptz: `fechaAtencion` es TEXT y una
    // fila mal formada abortaría la consulta entera (mismo criterio que el
    // worker de link-auto).
    const rows = await postgresService.query(
      `SELECT "numeroId" AS doc,
              array_agg(DISTINCT trim(
                COALESCE("primerNombre",'')||' '||COALESCE("segundoNombre",'')||' '||
                COALESCE("primerApellido",'')||' '||COALESCE("segundoApellido",''))) AS variantes,
              count(*) AS historias,
              array_agg(DISTINCT COALESCE("origen",'nativa')) AS origenes,
              max(CASE WHEN "fechaAtencion" ~ '^\\d{4}-\\d{2}-\\d{2}'
                       THEN "fechaAtencion"::timestamptz END) AS ultima
         FROM "HistoriaClinica"
        WHERE "numeroId" IS NOT NULL AND trim("numeroId") <> ''${sf}
        GROUP BY "numeroId"`,
      params,
    );
    // `query()` devuelve null cuando la consulta falla. Sin esta guarda el
    // cotejo mostraría "0 afiliados" ante una caída de la base, que se lee
    // como "no hay nada que revisar" — peor que un error.
    if (rows === null) throw new Error('No se pudo leer las historias para el cotejo.');

    const resumen: ResumenCotejo = {
      documentos: 0,
      unico: 0,
      unificable: 0,
      conflicto: 0,
      administrativo: 0,
      enVariosProgramas: 0,
    };

    const filas: AfiliadoCotejado[] = rows.map((r) => {
      const variantes = Array.isArray(r.variantes) ? (r.variantes as string[]) : [];
      const origenes = (Array.isArray(r.origenes) ? (r.origenes as string[]) : []).sort();
      const base = clasificarIdentidad(String(r.doc), variantes, docsProfesionales);

      resumen.documentos += 1;
      resumen[base.estado] += 1;
      if (origenes.length > 1) resumen.enVariosProgramas += 1;

      return {
        ...base,
        historias: Number(r.historias ?? 0),
        origenes,
        ultimaAtencion:
          r.ultima instanceof Date ? (r.ultima as Date).toISOString() : r.ultima ? String(r.ultima) : null,
      };
    });

    // Lo que hay que mirar primero va primero; dentro de cada grupo, quien más
    // historias tiene (es donde más duele equivocarse).
    const orden: Record<EstadoIdentidad, number> = {
      conflicto: 0,
      unificable: 1,
      administrativo: 2,
      unico: 3,
    };
    filas.sort((a, b) => orden[a.estado] - orden[b.estado] || b.historias - a.historias);

    return { filas, resumen };
  }
}

export default new PadronService();

// ============================================================================
// digitalizarService — Las citas de MyBodytech que el coordinador digitaliza
// desde un pantallazo.
//
// Hoy la coordinación copia cédula por cédula de "Citas asignadas" de
// MyBodytech a un Excel, y pega cada una en el buscador de afiliados para ver si
// la persona está activa o si ya tiene cita. Esto reemplaza la primera mitad:
// el pantallazo se convierte en filas, y cada fila abre la ficha de MyBodytech
// con un clic. La integración directa con MyBodytech haría todo esto solo, pero
// no está aprobada todavía; mientras tanto el pantallazo es el puente.
//
// ── Una fila por (fecha, sede, cédula) ──────────────────────────────────────
// La lista del día no cabe en un pantallazo: el coordinador baja y pega otro,
// y el último afiliado de uno es el primero del siguiente. Además cada coach
// puede subir el suyo. Con esa llave, pegar dos veces la misma persona no crea
// dos filas — se actualiza la que había (p. ej. pasa a "Finalizado"). Y si el
// segundo pantallazo leyó OTRA cédula para la misma persona (misma hora y
// mismo nombre), tampoco: la otra lectura queda como alternativa y la cédula
// pasa a verificar.
//
// ── "Repetida" ──────────────────────────────────────────────────────────────
// En el Excel de coordinación las cédulas repetidas se pintan de rojo a mano:
// la persona ya había salido otro día. Acá se calcula contra las fechas
// anteriores de esta misma tabla (dentro de las sedes que el usuario ve).
// ============================================================================

import postgresService from './postgres.service';
import { sedeFilter } from '../helpers/sede-scope';
import { normalizarNombre } from '../helpers/padron.helper';
import { CampoDudoso, CitaConsolidada, urlMyBodytech } from '../helpers/digitalizar.helper';

export interface CitaDigitalizada {
  id: number;
  fecha: string;
  hora: string | null;
  sedeMbt: string | null;
  tipo: string | null;
  nombre: string;
  numeroId: string;
  telefono: string | null;
  modalidad: string | null;
  estadoMbt: string | null;
  dudas: CampoDudoso[];
  alternativas: Partial<Record<CampoDudoso, string[]>>;
  verificadaPor: string | null;
  subidoPor: string | null;
  creadoEn: string;
  revisadoEn: string | null;
  revisadoPor: string | null;
  /** Cuántos días anteriores salió esta cédula (0 = primera vez). */
  vecesAntes: number;
  ultimaVezAntes: string | null;
  urlMyBodytech: string;
}

export type ResultadoEdicion = 'ok' | 'no_encontrada' | 'duplicada';

/** `query()` devuelve null cuando la base falla; acá eso es un error, no "cero filas". */
async function q(text: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const rows = await postgresService.query(text, params);
  if (!rows) throw new Error('Error de base de datos en citas digitalizadas');
  return rows;
}

const iso = (v: unknown): string | null =>
  v instanceof Date ? v.toISOString() : v ? String(v) : null;

class DigitalizarService {
  /**
   * Guarda lo leído de UN pantallazo. Devuelve cuántas filas son nuevas y
   * cuántas ya estaban.
   *
   * Una fila que un humano ya verificó (`verificada_por`) no vuelve a quedar en
   * duda porque otro pantallazo la lea distinto: esa persona ya la comparó.
   */
  async guardar(
    filas: CitaConsolidada[],
    ctx: { fecha: string; sedeId: string; subidoPor: string | null },
  ): Promise<{ nuevas: number; yaEstaban: number }> {
    let nuevas = 0;
    for (const f of filas) {
      const nombreKey = normalizarNombre(f.nombre);

      if (f.hora) {
        const otraLectura = await q(
          `UPDATE citas_digitalizadas SET
             dudas = CASE WHEN 'numeroId' = ANY(dudas) THEN dudas ELSE array_append(dudas, 'numeroId') END,
             alternativas = CASE
               WHEN COALESCE(alternativas->'numeroId', '[]'::jsonb) ? $5 THEN alternativas
               ELSE jsonb_set(alternativas, '{numeroId}',
                              COALESCE(alternativas->'numeroId', '[]'::jsonb) || to_jsonb($5::text))
             END,
             actualizado_en = NOW()
           WHERE fecha = $1 AND sede_id = $2 AND hora = $3 AND nombre_key = $4
             AND numero_id <> $5 AND verificada_por IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM citas_digitalizadas o
                WHERE o.fecha = $1 AND o.sede_id = $2 AND o.numero_id = $5
             )
           RETURNING id`,
          [ctx.fecha, ctx.sedeId, f.hora, nombreKey, f.numeroId],
        );
        if (otraLectura.length > 0) continue;
      }

      // `xmax = 0` sólo es cierto en la fila recién insertada: distingue un
      // alta de una actualización sin una segunda consulta.
      const rows = await q(
        `INSERT INTO citas_digitalizadas
           (fecha, sede_id, numero_id, nombre, nombre_key, hora, sede_mbt, tipo, telefono,
            modalidad, estado_mbt, dudas, alternativas, subido_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::text[], $13::jsonb, $14)
         ON CONFLICT (fecha, sede_id, numero_id) DO UPDATE SET
           hora           = COALESCE(EXCLUDED.hora, citas_digitalizadas.hora),
           sede_mbt       = COALESCE(EXCLUDED.sede_mbt, citas_digitalizadas.sede_mbt),
           tipo           = COALESCE(EXCLUDED.tipo, citas_digitalizadas.tipo),
           telefono       = COALESCE(citas_digitalizadas.telefono, EXCLUDED.telefono),
           modalidad      = COALESCE(EXCLUDED.modalidad, citas_digitalizadas.modalidad),
           estado_mbt     = COALESCE(EXCLUDED.estado_mbt, citas_digitalizadas.estado_mbt),
           -- La misma cédula leída otra vez en otro pantallazo es una segunda
           -- lectura que coincide: deja de estar en duda.
           dudas          = array_remove(citas_digitalizadas.dudas, 'numeroId'),
           actualizado_en = NOW()
         RETURNING (xmax = 0) AS insertada`,
        [
          ctx.fecha,
          ctx.sedeId,
          f.numeroId,
          f.nombre,
          nombreKey,
          f.hora,
          f.sede,
          f.tipo,
          f.telefono,
          f.modalidad,
          f.estado,
          f.dudas,
          JSON.stringify(f.alternativas),
          ctx.subidoPor,
        ],
      );
      if (rows[0]?.insertada) nuevas++;
    }
    return { nuevas, yaEstaban: filas.length - nuevas };
  }

  async listar(fecha: string, sedes: string[] | undefined): Promise<CitaDigitalizada[]> {
    const params: unknown[] = [fecha];
    const filtroC = sedeFilter(sedes, 'c.sede_id', params);
    const filtroP = sedeFilter(sedes, 'p.sede_id', params);
    const rows = await q(
      `SELECT c.id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.hora, c.sede_mbt, c.tipo,
              c.nombre, c.numero_id, c.telefono, c.modalidad, c.estado_mbt,
              c.dudas, c.alternativas, c.verificada_por, c.subido_por,
              c.creado_en, c.revisado_en, c.revisado_por,
              ant.veces, to_char(ant.ultima, 'YYYY-MM-DD') AS ultima
         FROM citas_digitalizadas c
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT p.fecha)::int AS veces, MAX(p.fecha) AS ultima
             FROM citas_digitalizadas p
            WHERE p.numero_id = c.numero_id AND p.fecha < c.fecha ${filtroP}
         ) ant ON TRUE
        WHERE c.fecha = $1 ${filtroC}
        ORDER BY c.hora NULLS LAST, c.nombre`,
      params,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      fecha: String(r.fecha),
      hora: (r.hora as string) ?? null,
      sedeMbt: (r.sede_mbt as string) ?? null,
      tipo: (r.tipo as string) ?? null,
      nombre: String(r.nombre),
      numeroId: String(r.numero_id),
      telefono: (r.telefono as string) ?? null,
      modalidad: (r.modalidad as string) ?? null,
      estadoMbt: (r.estado_mbt as string) ?? null,
      dudas: (r.dudas as CampoDudoso[]) ?? [],
      alternativas: (r.alternativas as CitaDigitalizada['alternativas']) ?? {},
      verificadaPor: (r.verificada_por as string) ?? null,
      subidoPor: (r.subido_por as string) ?? null,
      creadoEn: iso(r.creado_en) ?? '',
      revisadoEn: iso(r.revisado_en),
      revisadoPor: (r.revisado_por as string) ?? null,
      vecesAntes: Number(r.veces ?? 0),
      ultimaVezAntes: (r.ultima as string) ?? null,
      urlMyBodytech: urlMyBodytech(String(r.numero_id)),
    }));
  }

  /**
   * Corrige a mano lo que se leyó mal, o confirma que está bien. En los dos
   * casos la fila deja de estar en duda: una persona la comparó con el
   * pantallazo. Lo que más importa es la cédula — con un dígito cambiado, el
   * clic abre la ficha de otra persona.
   */
  async editar(
    id: number,
    cambios: { numeroId?: string; nombre?: string; telefono?: string | null },
    email: string | null,
    sedes: string[] | undefined,
  ): Promise<ResultadoEdicion> {
    if (cambios.numeroId) {
      // El filtro va sobre la fila que se edita (`c`); `o` queda en la misma
      // sede por el JOIN.
      const params: unknown[] = [id, cambios.numeroId];
      const filtro = sedeFilter(sedes, 'c.sede_id', params);
      const choque = await q(
        `SELECT 1 FROM citas_digitalizadas o
           JOIN citas_digitalizadas c ON c.id = $1
          WHERE o.fecha = c.fecha AND o.sede_id = c.sede_id AND o.numero_id = $2 AND o.id <> $1
                ${filtro}`,
        params,
      );
      if (choque.length > 0) return 'duplicada';
    }
    const params: unknown[] = [
      id,
      cambios.numeroId ?? null,
      cambios.nombre ?? null,
      cambios.nombre ? normalizarNombre(cambios.nombre) : null,
      cambios.telefono !== undefined,
      cambios.telefono ?? null,
      email ?? 'coordinador',
    ];
    const filtro = sedeFilter(sedes, 'sede_id', params);
    const rows = await q(
      `UPDATE citas_digitalizadas SET
         numero_id      = COALESCE($2, numero_id),
         nombre         = COALESCE($3, nombre),
         nombre_key     = COALESCE($4, nombre_key),
         telefono       = CASE WHEN $5 THEN $6 ELSE telefono END,
         dudas          = '{}',
         alternativas   = '{}',
         verificada_por = $7,
         actualizado_en = NOW()
       WHERE id = $1 ${filtro}
       RETURNING id`,
      params,
    );
    return rows.length > 0 ? 'ok' : 'no_encontrada';
  }

  /**
   * Se marca al abrir la ficha en MyBodytech. Queda la PRIMERA vez: lo que
   * sirve saber es si alguien ya la miró, no cuántas veces.
   */
  async marcarRevisada(id: number, email: string | null, sedes: string[] | undefined): Promise<boolean> {
    const params: unknown[] = [id, email];
    const filtro = sedeFilter(sedes, 'sede_id', params);
    const rows = await q(
      `UPDATE citas_digitalizadas
          SET revisado_en = COALESCE(revisado_en, NOW()),
              revisado_por = COALESCE(revisado_por, $2)
        WHERE id = $1 ${filtro}
        RETURNING id`,
      params,
    );
    return rows.length > 0;
  }

  async eliminar(id: number, sedes: string[] | undefined): Promise<boolean> {
    const params: unknown[] = [id];
    const filtro = sedeFilter(sedes, 'sede_id', params);
    const rows = await q(`DELETE FROM citas_digitalizadas WHERE id = $1 ${filtro} RETURNING id`, params);
    return rows.length > 0;
  }
}

export default new DigitalizarService();

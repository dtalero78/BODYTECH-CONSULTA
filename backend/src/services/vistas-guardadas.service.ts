// ============================================================================
// vistas-guardadas.service — "Mi vista" de cualquier tabla de la plataforma.
//
// Esto NO es BodyVibeTech. No genera código, no consulta el modelo, no necesita
// aprobación ni pasa por el recinto aislado. Es la función genérica que resuelve
// el pedido más frecuente sin construir nada.
//
// Cuando alguien dice "modificame este panel", casi siempre quiere una de
// cuatro cosas: ver otras columnas, filtrar distinto, ordenar distinto, o
// sacarlo a Excel. Ninguna de esas necesita un app nuevo — necesita que la
// tabla recuerde cómo la quiere ver esa persona.
//
// Cada vista es de quien la creó. No se comparten: una vista compartida deja de
// ser "mi vista" y se convierte en otra cosa que alguien tiene que mantener.
// ============================================================================

import postgresService from './postgres.service';

export interface VistaGuardada {
  id: number;
  tablaId: string;
  nombre: string;
  config: Record<string, unknown>;
  actualizadaAt: string;
}

/** Tope por persona y por tabla. Cien vistas de una misma tabla no son vistas. */
const MAX_POR_TABLA = 30;

function aVista(f: any): VistaGuardada {
  return {
    id: Number(f.id),
    tablaId: f.tabla_id,
    nombre: f.nombre,
    config: f.config ?? {},
    actualizadaAt: new Date(f.updated_at).toISOString(),
  };
}

class VistasGuardadasService {
  async listar(usuarioId: number, tablaId: string): Promise<VistaGuardada[]> {
    const filas = await postgresService.query(
      `SELECT * FROM vistas_guardadas
        WHERE usuario_id = $1 AND tabla_id = $2
        ORDER BY updated_at DESC`,
      [usuarioId, tablaId]
    );
    return (filas ?? []).map(aVista);
  }

  /**
   * Guarda o pisa una vista por nombre.
   *
   * Guardar con un nombre que ya existe ACTUALIZA en vez de fallar: quien
   * ajusta "Mi vista de Chapinero" y la vuelve a guardar espera que quede
   * actualizada, no un error sobre un nombre repetido.
   */
  async guardar(
    usuarioId: number,
    tablaId: string,
    nombre: string,
    config: Record<string, unknown>
  ): Promise<{ ok: true; vista: VistaGuardada } | { ok: false; mensaje: string }> {
    const limpio = nombre.trim().slice(0, 80);
    if (!limpio) return { ok: false, mensaje: 'Ponele un nombre a la vista.' };

    const actuales = await postgresService.query(
      `SELECT COUNT(*)::int AS n FROM vistas_guardadas
        WHERE usuario_id = $1 AND tabla_id = $2 AND nombre <> $3`,
      [usuarioId, tablaId, limpio]
    );
    if ((actuales?.[0]?.n ?? 0) >= MAX_POR_TABLA) {
      return {
        ok: false,
        mensaje: `Ya tenés ${MAX_POR_TABLA} vistas guardadas en esta tabla. Borrá alguna antes de crear otra.`,
      };
    }

    const filas = await postgresService.query(
      `INSERT INTO vistas_guardadas (usuario_id, tabla_id, nombre, config)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (usuario_id, tabla_id, nombre)
         DO UPDATE SET config = $4, updated_at = NOW()
       RETURNING *`,
      [usuarioId, tablaId, limpio, JSON.stringify(config ?? {})]
    );
    if (!filas?.[0]) return { ok: false, mensaje: 'No se pudo guardar la vista.' };
    return { ok: true, vista: aVista(filas[0]) };
  }

  async eliminar(usuarioId: number, id: number): Promise<boolean> {
    const filas = await postgresService.query(
      `DELETE FROM vistas_guardadas WHERE id = $1 AND usuario_id = $2 RETURNING id`,
      [id, usuarioId]
    );
    return Boolean(filas?.[0]);
  }
}

export const vistasGuardadasService = new VistasGuardadasService();
export default vistasGuardadasService;

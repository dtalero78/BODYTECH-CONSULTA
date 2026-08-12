// ============================================================================
// bodyvibe-apps.service — Los apps y su historial de versiones.
//
// Decisión 05: el borrador es privado de quien lo creó y se itera libremente,
// sin pedirle permiso a nadie. Por eso todo acá filtra por `creador_id`: que la
// ruta sea solo para administradores no significa que un administrador vea los
// borradores de otro.
//
// Cada iteración queda guardada. "Volvé a como estaba antes" es el segundo
// pedido más frecuente después de "cambiame esto", y sin historial no tiene
// respuesta.
// ============================================================================

import postgresService from './postgres.service';

export interface App {
  id: string;
  titulo: string;
  creadorId: number | null;
  creadorEmail: string | null;
  sedeId: string | null;
  estado: string;
  codigo: string;
  notas: string | null;
  version: number;
  creadoAt: string;
  actualizadoAt: string;
}

export interface VersionApp {
  version: number;
  pedido: string | null;
  notas: string | null;
  creadaAt: string;
}

function aApp(f: any): App {
  return {
    id: f.id,
    titulo: f.titulo,
    creadorId: f.creador_id ?? null,
    creadorEmail: f.creador_email ?? null,
    sedeId: f.sede_id ?? null,
    estado: f.estado,
    codigo: f.codigo ?? '',
    notas: f.notas ?? null,
    version: f.version,
    creadoAt: new Date(f.created_at).toISOString(),
    actualizadoAt: new Date(f.updated_at).toISOString(),
  };
}

/**
 * Id corto y legible. Aparece en la bitácora de lecturas y en los mensajes de
 * error, así que conviene que se pueda dictar por teléfono.
 */
function nuevoId(): string {
  const azar = Math.random().toString(36).slice(2, 8);
  return `app-${Date.now().toString(36)}-${azar}`;
}

class BodyVibeAppsService {
  async crear(actor: { usuarioId?: number | null; email?: string | null; sedeId?: string | null }): Promise<App | null> {
    const id = nuevoId();
    const filas = await postgresService.query(
      `INSERT INTO bodyvibe_apps (id, titulo, creador_id, creador_email, sede_id, codigo)
       VALUES ($1, $2, $3, $4, $5, '')
       RETURNING *`,
      [id, 'App sin título', actor.usuarioId ?? null, actor.email ?? null, actor.sedeId ?? null]
    );
    return filas && filas[0] ? aApp(filas[0]) : null;
  }

  async listarDe(usuarioId: number): Promise<App[]> {
    const filas = await postgresService.query(
      `SELECT * FROM bodyvibe_apps WHERE creador_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [usuarioId]
    );
    return (filas ?? []).map(aApp);
  }

  /** Devuelve el app solo si es de quien lo pide. Un borrador es privado. */
  async obtener(id: string, usuarioId: number): Promise<App | null> {
    const filas = await postgresService.query(
      `SELECT * FROM bodyvibe_apps WHERE id = $1 AND creador_id = $2`,
      [id, usuarioId]
    );
    return filas && filas[0] ? aApp(filas[0]) : null;
  }

  /**
   * Guarda una iteración: sube la versión del app y deja la anterior en el
   * historial.
   *
   * El `UPDATE ... RETURNING` calcula la versión nueva en la misma sentencia
   * para no leer-y-después-escribir: dos pedidos simultáneos del mismo usuario
   * (dos pestañas abiertas) generarían la misma versión y una pisaría a la otra.
   */
  async guardarVersion(
    id: string,
    usuarioId: number,
    datos: { titulo: string; codigo: string; notas: string; pedido: string }
  ): Promise<App | null> {
    const filas = await postgresService.query(
      `UPDATE bodyvibe_apps
          SET titulo = $3, codigo = $4, notas = $5,
              version = version + 1, updated_at = NOW()
        WHERE id = $1 AND creador_id = $2
        RETURNING *`,
      [id, usuarioId, datos.titulo, datos.codigo, datos.notas]
    );
    if (!filas || !filas[0]) return null;

    const app = aApp(filas[0]);

    await postgresService.query(
      `INSERT INTO bodyvibe_app_versiones (app_id, version, pedido, codigo, notas)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (app_id, version) DO NOTHING`,
      [id, app.version, datos.pedido, datos.codigo, datos.notas]
    );

    return app;
  }

  async versiones(id: string, usuarioId: number): Promise<VersionApp[]> {
    const filas = await postgresService.query(
      `SELECT v.version, v.pedido, v.notas, v.created_at
         FROM bodyvibe_app_versiones v
         JOIN bodyvibe_apps a ON a.id = v.app_id
        WHERE v.app_id = $1 AND a.creador_id = $2
        ORDER BY v.version DESC
        LIMIT 50`,
      [id, usuarioId]
    );
    return (filas ?? []).map((f: any) => ({
      version: f.version,
      pedido: f.pedido ?? null,
      notas: f.notas ?? null,
      creadaAt: new Date(f.created_at).toISOString(),
    }));
  }

  /**
   * Vuelve a una versión anterior.
   *
   * No borra el historial: restaurar crea una versión NUEVA con el contenido
   * viejo. Deshacer un "volvé atrás" tiene que ser posible, y un historial que
   * se puede perder deja de ser un historial.
   */
  async restaurar(id: string, usuarioId: number, version: number): Promise<App | null> {
    const filas = await postgresService.query(
      `SELECT v.codigo, v.notas, v.pedido
         FROM bodyvibe_app_versiones v
         JOIN bodyvibe_apps a ON a.id = v.app_id
        WHERE v.app_id = $1 AND a.creador_id = $2 AND v.version = $3`,
      [id, usuarioId, version]
    );
    if (!filas || !filas[0]) return null;

    const actual = await this.obtener(id, usuarioId);
    if (!actual) return null;

    return this.guardarVersion(id, usuarioId, {
      titulo: actual.titulo,
      codigo: filas[0].codigo,
      notas: filas[0].notas ?? '',
      pedido: `Restaurado desde la versión ${version}.`,
    });
  }

  async eliminar(id: string, usuarioId: number): Promise<boolean> {
    const filas = await postgresService.query(
      `DELETE FROM bodyvibe_apps WHERE id = $1 AND creador_id = $2 RETURNING id`,
      [id, usuarioId]
    );
    if (!filas || !filas[0]) return false;
    await postgresService.query(`DELETE FROM bodyvibe_app_versiones WHERE app_id = $1`, [id]);
    return true;
  }
}

export const bodyvibeAppsService = new BodyVibeAppsService();
export default bodyvibeAppsService;

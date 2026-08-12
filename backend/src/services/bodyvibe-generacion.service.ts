// ============================================================================
// bodyvibe-generacion.service — Generar un app SIN mantener la petición abierta.
//
// Por qué existe: generar tarda entre 30 segundos y un par de minutos, y eso no
// cabe en un request HTTP detrás del balanceador de Digital Ocean, que corta la
// conexión mucho antes. El navegador se queda sin respuesta, el usuario ve un
// error genérico… y del otro lado la generación siguió corriendo y se cobró.
// Lo peor de los dos mundos: se pagó y no se recibió nada.
//
// Así que generar es un TRABAJO, no una petición:
//
//   1. `iniciar()` crea la fila, devuelve un id al instante y arranca el
//      trabajo en segundo plano.
//   2. El navegador pregunta por ese id cada pocos segundos.
//   3. Al terminar, la fila queda en `listo` (con la versión ya guardada) o en
//      `error` (con el motivo, no con "intentalo de nuevo").
//
// El estado vive en la base y no en memoria: si el contenedor se reinicia a
// mitad de una generación, un trabajo en memoria desaparece sin dejar rastro y
// el navegador pregunta para siempre. En la base, al menos queda la evidencia
// de que se intentó y se pagó.
// ============================================================================

import postgresService from './postgres.service';
import bodyvibeAgenteService from './bodyvibe-agente.service';
import bodyvibeAppsService from './bodyvibe-apps.service';

/**
 * A partir de acá se da por muerto un trabajo que sigue diciendo "procesando".
 * Cubre el caso del contenedor reiniciado: sin esto, el navegador pregunta
 * indefinidamente por algo que ya nadie está haciendo.
 */
const MINUTOS_ABANDONO = 10;

export interface EstadoGeneracion {
  id: number;
  appId: string;
  estado: 'procesando' | 'listo' | 'error';
  mensaje: string | null;
  notas: string | null;
  costoUsd: number | null;
  iniciadaAt: string;
}

class BodyVibeGeneracionService {
  /** Crea el trabajo y lo arranca. Devuelve enseguida, sin esperar al modelo. */
  async iniciar(
    appId: string,
    usuarioId: number,
    email: string,
    pedido: string,
    historial: { pedido: string; titulo: string }[]
  ): Promise<{ ok: true; id: number } | { ok: false; mensaje: string }> {
    const app = await bodyvibeAppsService.obtener(appId, usuarioId);
    if (!app) return { ok: false, mensaje: 'Ese app no existe o no es tuyo.' };

    // Dos generaciones a la vez sobre el mismo app se pisarían la versión.
    const enCurso = await postgresService.query(
      `SELECT id FROM bodyvibe_generaciones
        WHERE app_id = $1 AND estado = 'procesando'
          AND created_at > NOW() - INTERVAL '${MINUTOS_ABANDONO} minutes'
        LIMIT 1`,
      [appId]
    );
    if (enCurso?.[0]) {
      return { ok: false, mensaje: 'Ya hay una generación en curso para este app. Esperá a que termine.' };
    }

    const filas = await postgresService.query(
      `INSERT INTO bodyvibe_generaciones (app_id, usuario_id, email, pedido)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [appId, usuarioId, email, pedido.slice(0, 4000)]
    );
    const id = filas?.[0]?.id;
    if (!id) return { ok: false, mensaje: 'No se pudo registrar la generación.' };

    // Fire-and-forget a propósito: el request tiene que volver ya. El resultado
    // se recoge por el id.
    void this.trabajar(Number(id), app.id, usuarioId, email, pedido, historial, app.codigo || null);

    return { ok: true, id: Number(id) };
  }

  private async trabajar(
    id: number,
    appId: string,
    usuarioId: number,
    email: string,
    pedido: string,
    historial: { pedido: string; titulo: string }[],
    codigoActual: string | null
  ): Promise<void> {
    try {
      const r = await bodyvibeAgenteService.generar({
        pedido,
        codigoActual,
        historial,
        actor: { usuarioId, email, appId },
      });

      if (!r.ok) {
        await this.marcar(id, 'error', r.mensaje);
        return;
      }

      const guardado = await bodyvibeAppsService.guardarVersion(appId, usuarioId, {
        titulo: r.resultado.titulo,
        codigo: r.resultado.codigo,
        notas: r.resultado.notas,
        pedido,
      });

      if (!guardado) {
        // El modelo respondió y se cobró: decirlo, en vez de un error genérico
        // que sugiere que no pasó nada.
        await this.marcar(id, 'error', 'El app se generó pero no se pudo guardar la versión.');
        return;
      }

      await postgresService.query(
        `UPDATE bodyvibe_generaciones
            SET estado = 'listo', notas = $2, costo_usd = $3, updated_at = NOW()
          WHERE id = $1`,
        [id, r.resultado.notas, r.resultado.uso.costoUsd]
      );
    } catch (error: any) {
      console.error('❌ [BodyVibe] Generación fallida:', error?.message ?? error);
      await this.marcar(id, 'error', error?.message ?? 'Error inesperado generando el app.');
    }
  }

  private async marcar(id: number, estado: 'error', mensaje: string): Promise<void> {
    await postgresService.query(
      `UPDATE bodyvibe_generaciones SET estado = $2, mensaje = $3, updated_at = NOW() WHERE id = $1`,
      [id, estado, mensaje.slice(0, 1000)]
    );
  }

  async consultar(id: number, usuarioId: number): Promise<EstadoGeneracion | null> {
    const filas = await postgresService.query(
      `SELECT id, app_id, estado, mensaje, notas, costo_usd, created_at, updated_at
         FROM bodyvibe_generaciones
        WHERE id = $1 AND usuario_id = $2`,
      [id, usuarioId]
    );
    const f = filas?.[0];
    if (!f) return null;

    // Un trabajo que quedó colgado (contenedor reiniciado a mitad) se reporta
    // como error en vez de mantener al navegador preguntando para siempre.
    const viejo =
      f.estado === 'procesando' &&
      Date.now() - new Date(f.created_at).getTime() > MINUTOS_ABANDONO * 60_000;

    return {
      id: Number(f.id),
      appId: f.app_id,
      estado: viejo ? 'error' : f.estado,
      mensaje: viejo
        ? 'La generación se interrumpió (probablemente el servidor se reinició). Volvé a intentarlo.'
        : (f.mensaje ?? null),
      notas: f.notas ?? null,
      costoUsd: f.costo_usd !== null && f.costo_usd !== undefined ? Number(f.costo_usd) : null,
      iniciadaAt: new Date(f.created_at).toISOString(),
    };
  }
}

export const bodyvibeGeneracionService = new BodyVibeGeneracionService();
export default bodyvibeGeneracionService;

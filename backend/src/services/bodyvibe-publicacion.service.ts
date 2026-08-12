// ============================================================================
// bodyvibe-publicacion.service — De borrador privado a app publicado.
//
// Implementa las decisiones 04, 05, 06 y el nivel 2 del interruptor (10):
//
//   · Publicar es un acto deliberado, con audiencia explícita (04).
//   · El borrador se itera libre; la aprobación es solo para publicar (05).
//   · Lo cosmético se republica solo; los datos y la audiencia vuelven a
//     aprobación (06) — ver `bodyvibe-huella.service`.
//   · Cualquier admin puede despublicar cualquier app, incluso ajeno (10).
//
// Quién es "el superadministrador" que aprueba: rol `admin` con acceso global a
// sedes (`esGlobal`). No se inventa un rol nuevo — ese par ya existe en el
// modelo de sesión y significa exactamente lo que hace falta: alguien que
// responde por todas las sedes, no por una.
//
// La misma condición habilita publicar más allá de la propia sede. Un admin de
// una sede publica en su sede; llegar a todas es un privilegio aparte.
// ============================================================================

import postgresService from './postgres.service';
import { calcularHuella, normalizarParaComparar, requiereAprobacion } from './bodyvibe-huella.service';
import { anclajeValido } from './bodyvibe-anclajes';

export type Alcance = 'sede' | 'global';

export interface Audiencia {
  alcance: Alcance;
  roles: string[];
  sedes: string[];
  /** Dónde queda incrustado. `null` = suelto, en la pantalla de Aplicaciones. */
  anclaje?: string | null;
}

export interface Solicitud {
  id: number;
  appId: string;
  titulo?: string;
  version: number;
  codigo: string;
  estantes: string[];
  alcance: string;
  roles: string[];
  sedes: string[];
  anclaje: string | null;
  estado: string;
  solicitante: string | null;
  revisor: string | null;
  motivo: string | null;
  creadaAt: string;
}

export interface AppPublicado {
  id: string;
  titulo: string;
  notas: string | null;
  codigo: string;
  creadorEmail: string | null;
  publicadoAt: string | null;
  anclaje: string | null;
}

/** Quien aprueba y quien puede publicar a todas las sedes. */
export interface Actor {
  usuarioId: number;
  email: string;
  role: string;
  sedes: string[];
  esGlobal: boolean;
}

export function puedeAprobar(actor: Actor): boolean {
  return actor.role === 'admin' && actor.esGlobal;
}

function aSolicitud(f: any): Solicitud {
  return {
    id: Number(f.id),
    appId: f.app_id,
    titulo: f.titulo,
    version: f.version,
    codigo: f.codigo,
    estantes: f.estantes ?? [],
    alcance: f.alcance,
    roles: f.audiencia_roles ?? [],
    sedes: f.audiencia_sedes ?? [],
    anclaje: f.anclaje ?? null,
    estado: f.estado,
    solicitante: f.solicitante ?? null,
    revisor: f.revisor ?? null,
    motivo: f.motivo ?? null,
    creadaAt: new Date(f.created_at).toISOString(),
  };
}

export type ResultadoSolicitud =
  | { ok: true; publicado: true }
  | { ok: true; publicado: false; solicitud: Solicitud }
  | { ok: false; mensaje: string };

class BodyVibePublicacionService {
  /**
   * Pide publicar. Si nada cambió respecto de lo ya aprobado, publica directo;
   * si cambió lo que consulta o a quién llega, abre una solicitud.
   */
  async solicitar(appId: string, actor: Actor, audiencia: Audiencia): Promise<ResultadoSolicitud> {
    if (audiencia.alcance === 'global' && !actor.esGlobal) {
      return {
        ok: false,
        mensaje:
          'Publicar a todas las sedes es un permiso aparte. Puede publicarlo en su sede, o pedirle a quien tenga alcance global que lo amplíe.',
      };
    }
    if (audiencia.roles.length === 0) {
      return { ok: false, mensaje: 'Elija al menos un rol que pueda verlo.' };
    }
    if (!anclajeValido(audiencia.anclaje)) {
      return {
        ok: false,
        mensaje: 'Ese lugar de la plataforma no admite apps incrustados.',
      };
    }

    const filas = await postgresService.query(
      `SELECT * FROM bodyvibe_apps WHERE id = $1 AND creador_id = $2`,
      [appId, actor.usuarioId]
    );
    const app = filas?.[0];
    if (!app) return { ok: false, mensaje: 'Esa aplicación no existe o no es suya.' };
    if (!app.codigo) return { ok: false, mensaje: 'El borrador está vacío: no hay nada que publicar.' };

    // Cuando el alcance es la sede propia y no se indicó cuál, se toman las del
    // solicitante. Publicar "a mi sede" no debería obligar a escribirla.
    const sedes =
      audiencia.alcance === 'global'
        ? []
        : audiencia.sedes.length
          ? audiencia.sedes.filter((s) => actor.esGlobal || actor.sedes.includes(s))
          : actor.sedes;

    if (audiencia.alcance === 'sede' && sedes.length === 0) {
      return { ok: false, mensaje: 'No hay ninguna sede válida sobre la que publicar.' };
    }

    const { huella, estantes } = calcularHuella(app.codigo);

    const veredicto = requiereAprobacion(
      {
        huella: app.huella_aprobada ?? null,
        alcance: app.alcance ?? 'privado',
        roles: app.audiencia_roles ?? [],
        sedes: app.audiencia_sedes ?? [],
        anclaje: app.anclaje ?? null,
      },
      {
        huella,
        alcance: audiencia.alcance,
        roles: audiencia.roles,
        sedes,
        anclaje: audiencia.anclaje ?? null,
      }
    );

    if (!veredicto.requiere) {
      // Cambio cosmético sobre algo ya aprobado: se publica la versión nueva
      // sin molestar a nadie. Es lo que más se itera y lo que menos riesgo tiene.
      await this.publicarFoto(appId, app.codigo, app.version, huella, actor.email, {
        alcance: audiencia.alcance,
        roles: audiencia.roles,
        sedes,
        anclaje: audiencia.anclaje ?? null,
      });
      return { ok: true, publicado: true };
    }

    const nueva = await postgresService.query(
      `INSERT INTO bodyvibe_solicitudes
         (app_id, version, codigo, huella, estantes, alcance, audiencia_roles, audiencia_sedes,
          anclaje, solicitante_id, solicitante)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        appId,
        app.version,
        app.codigo,
        huella,
        estantes,
        audiencia.alcance,
        audiencia.roles,
        sedes,
        audiencia.anclaje ?? null,
        actor.usuarioId,
        actor.email,
      ]
    );
    if (!nueva?.[0]) return { ok: false, mensaje: 'No se pudo registrar la solicitud.' };

    return { ok: true, publicado: false, solicitud: aSolicitud({ ...nueva[0], titulo: app.titulo }) };
  }

  /**
   * Deja en vivo una FOTO del código. Nunca se publica una referencia al
   * borrador: si el público leyera el borrador, editarlo cambiaría en silencio
   * lo que ve todo el mundo.
   */
  private async publicarFoto(
    appId: string,
    codigo: string,
    version: number,
    huella: string,
    quien: string,
    audiencia: Audiencia
  ): Promise<void> {
    // Junto con el código se guardan SUS consultas. Son la lista blanca que
    // acota lo que la audiencia puede pedir por la ventanilla — ver
    // `consultaPermitidaPara`.
    const { sqls } = calcularHuella(codigo);

    await postgresService.query(
      `UPDATE bodyvibe_apps
          SET estado = 'publicado',
              publicado_codigo = $2,
              publicado_version = $3,
              huella_aprobada = $4,
              alcance = $5,
              audiencia_roles = $6,
              audiencia_sedes = $7,
              publicado_at = NOW(),
              publicado_por = $8,
              publicado_sqls = $9,
              anclaje = $10,
              despublicado_por = NULL,
              despublicado_motivo = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [
        appId,
        codigo,
        version,
        huella,
        audiencia.alcance,
        audiencia.roles,
        audiencia.sedes,
        quien,
        sqls,
        audiencia.anclaje ?? null,
      ]
    );
  }

  /**
   * ¿Puede esta persona correr esta consulta a través de este app?
   *
   * Cierra un hueco que no es evidente: la audiencia de un app publicado tiene
   * sesión válida, así que puede llamar a la ventanilla directamente desde las
   * herramientas del navegador. Sin este control, aprobar "un tablero de citas
   * de Chapinero para los coordinadores" les daría de hecho acceso a TODOS los
   * estantes — que no es lo que nadie aprobó.
   *
   * Por eso, para quien solo consume un app, únicamente se admiten las consultas
   * que el app traía escritas cuando se aprobó. Los parámetros siguen siendo
   * libres (van aparte, como `$1`, `$2`); el texto de la consulta no.
   *
   * Quien construye apps (admin) no pasa por acá: su trabajo es escribir
   * consultas nuevas, y su alcance ya está acotado por los estantes.
   */
  async consultaPermitidaPara(appId: string, actor: Actor, sql: string): Promise<boolean> {
    const filas = await postgresService.query(
      `SELECT publicado_sqls, audiencia_roles, audiencia_sedes, alcance
         FROM bodyvibe_apps
        WHERE id = $1 AND estado = 'publicado'`,
      [appId]
    );
    const app = filas?.[0];
    if (!app) return false;

    const enAudiencia =
      (app.audiencia_roles ?? []).includes(actor.role) &&
      (app.alcance === 'global' ||
        actor.esGlobal ||
        (app.audiencia_sedes ?? []).some((s: string) => actor.sedes.includes(s)));
    if (!enAudiencia) return false;

    const permitidas: string[] = app.publicado_sqls ?? [];
    return permitidas.includes(normalizarParaComparar(sql));
  }

  // --------------------------------------------------------------------------
  // Revisión
  // --------------------------------------------------------------------------

  async pendientes(): Promise<Solicitud[]> {
    const filas = await postgresService.query(
      `SELECT s.*, a.titulo
         FROM bodyvibe_solicitudes s
         JOIN bodyvibe_apps a ON a.id = s.app_id
        WHERE s.estado = 'pendiente'
        ORDER BY s.created_at ASC`
    );
    return (filas ?? []).map(aSolicitud);
  }

  async aprobar(solicitudId: number, revisor: string): Promise<{ ok: boolean; mensaje?: string }> {
    const filas = await postgresService.query(
      `UPDATE bodyvibe_solicitudes
          SET estado = 'aprobada', revisor = $2, resuelto_at = NOW()
        WHERE id = $1 AND estado = 'pendiente'
        RETURNING *`,
      [solicitudId, revisor]
    );
    const s = filas?.[0];
    if (!s) return { ok: false, mensaje: 'Esa solicitud ya no está pendiente.' };

    // Se publica la foto que el revisor vio, no lo que el borrador sea ahora.
    await this.publicarFoto(s.app_id, s.codigo, s.version, s.huella, revisor, {
      alcance: s.alcance,
      roles: s.audiencia_roles ?? [],
      sedes: s.audiencia_sedes ?? [],
      anclaje: s.anclaje ?? null,
    });

    return { ok: true };
  }

  async rechazar(
    solicitudId: number,
    revisor: string,
    motivo: string
  ): Promise<{ ok: boolean; mensaje?: string }> {
    const filas = await postgresService.query(
      `UPDATE bodyvibe_solicitudes
          SET estado = 'rechazada', revisor = $2, motivo = $3, resuelto_at = NOW()
        WHERE id = $1 AND estado = 'pendiente'
        RETURNING id`,
      [solicitudId, revisor, motivo]
    );
    return filas?.[0] ? { ok: true } : { ok: false, mensaje: 'Esa solicitud ya no está pendiente.' };
  }

  /**
   * Despublicar. Cualquier admin, incluso sobre un app ajeno (decisión 10).
   *
   * No destruye nada: el app vuelve a ser borrador de su dueño, con su código y
   * su historial intactos. Es una acción barata de tomar y barata de revertir,
   * así que no hay razón para hacerla difícil.
   */
  async despublicar(appId: string, quien: string, motivo: string): Promise<boolean> {
    const filas = await postgresService.query(
      `UPDATE bodyvibe_apps
          SET estado = 'borrador', publicado_codigo = NULL, publicado_at = NULL,
              despublicado_por = $2, despublicado_motivo = $3, updated_at = NOW()
        WHERE id = $1 AND estado = 'publicado'
        RETURNING id`,
      [appId, quien, motivo]
    );
    return Boolean(filas?.[0]);
  }

  // --------------------------------------------------------------------------
  // Consumo
  // --------------------------------------------------------------------------

  /** Apps publicados que este usuario puede ver, según su rol y sus sedes. */
  async visiblesPara(actor: Actor): Promise<AppPublicado[]> {
    // El rol siempre acota. La sede acota salvo que quien mira tenga alcance
    // global: esa persona responde por todas las sedes —es quien aprueba— y
    // dejarla fuera de los apps de sede la cegaría justo sobre lo que aprobó.
    //
    // Ojo con el arreglo de sedes: `audiencia_sedes && NULL` da nulo, no falso,
    // y la fila se descarta en silencio. Por eso el permiso global se resuelve
    // con una bandera aparte y no pasando null acá.
    const filas = await postgresService.query(
      `SELECT id, titulo, notas, publicado_codigo, creador_email, publicado_at, anclaje
         FROM bodyvibe_apps
        WHERE estado = 'publicado'
          AND $1 = ANY(audiencia_roles)
          AND (alcance = 'global' OR $3::boolean OR audiencia_sedes && $2::text[])
        ORDER BY publicado_at DESC`,
      [actor.role, actor.sedes ?? [], actor.esGlobal]
    );
    return (filas ?? []).map((f: any) => ({
      id: f.id,
      titulo: f.titulo,
      notas: f.notas ?? null,
      codigo: f.publicado_codigo ?? '',
      creadorEmail: f.creador_email ?? null,
      publicadoAt: f.publicado_at ? new Date(f.publicado_at).toISOString() : null,
      anclaje: f.anclaje ?? null,
    }));
  }

  async obtenerPublicado(appId: string, actor: Actor): Promise<AppPublicado | null> {
    const visibles = await this.visiblesPara(actor);
    return visibles.find((a) => a.id === appId) ?? null;
  }
}

export const bodyvibePublicacionService = new BodyVibePublicacionService();
export default bodyvibePublicacionService;

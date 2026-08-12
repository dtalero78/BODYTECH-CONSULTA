// ============================================================================
// bodyvibe.controller — Ventanilla de datos + interruptor general.
//
// El RBAC se aplica al montar en index.ts. El interruptor se consulta acá y no
// en un middleware global, para que las rutas de encender/apagar sigan
// respondiendo aunque BodyVibeTech esté apagado — si no, apagarlo sería
// irreversible desde la propia interfaz.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import bodyvibeService from '../services/bodyvibe.service';
import bodyvibeDbService from '../services/bodyvibe-db.service';
import bodyvibeCatalogoService from '../services/bodyvibe-catalogo.service';
import bodyvibeAppsService from '../services/bodyvibe-apps.service';
import bodyvibeAgenteService from '../services/bodyvibe-agente.service';
import bodyvibeTemaService, { Densidad } from '../services/bodyvibe-tema.service';
import { ANCLAJES } from '../services/bodyvibe-anclajes';
import { puedeConstruir } from '../services/bodyvibe-acceso';
import bodyvibePublicacionService, {
  Actor,
  puedeAprobar,
} from '../services/bodyvibe-publicacion.service';
import { getSession } from '../middleware/rbac.middleware';

/** La sesión RBAC, con la forma que espera el servicio de publicación. */
function actorDe(req: Request): Actor | null {
  const s = getSession(req);
  if (!s) return null;
  return {
    usuarioId: s.userId,
    email: s.email,
    role: s.role,
    sedes: s.sedes ?? [],
    esGlobal: Boolean(s.esGlobal),
  };
}

class BodyVibeController {
  /** POST /api/bodyvibe/query — la ventanilla. */
  async query(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { sql, params, appId } = req.body ?? {};

      if (typeof sql !== 'string' || !sql.trim()) {
        res.status(400).json({ ok: false, mensaje: 'Falta el texto de la consulta.' });
        return;
      }
      if (params !== undefined && !Array.isArray(params)) {
        res.status(400).json({ ok: false, mensaje: 'Los parámetros deben venir como lista.' });
        return;
      }

      const actor = actorDe(req);
      if (!actor) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }

      // Quien construye apps escribe consultas nuevas: ese es su trabajo, y su
      // alcance ya lo acotan los estantes. Quien solo CONSUME un app publicado
      // tiene sesión válida y podría llamar a esta ventanilla desde las
      // herramientas del navegador — así que ahí solo se admiten las consultas
      // que el app traía escritas cuando se aprobó.
      const idApp = typeof appId === 'string' ? appId.slice(0, 64) : null;
      if (actor.role !== 'admin') {
        const permitida = idApp
          ? await bodyvibePublicacionService.consultaPermitidaPara(idApp, actor, sql)
          : false;
        if (!permitida) {
          res.json({
            ok: false,
            code: 'no_permitida',
            mensaje: 'Esa consulta no forma parte del app publicado.',
          });
          return;
        }
      }

      const r = await bodyvibeService.consultar(sql, Array.isArray(params) ? params : [], {
        usuarioId: actor.usuarioId,
        email: actor.email,
        appId: idApp,
      });

      // Siempre 200: el recinto necesita una respuesta que pueda mostrar, no un
      // código de estado que se le pierda en el puente. El `ok` lleva el veredicto.
      res.json(r);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/estado — para pintar el tablero de admin. */
  async estado(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const estado = await bodyvibeService.estado();
      res.json({
        ...estado,
        // Distingue "lo apagó alguien" de "nunca arrancó por falta de
        // configuración". Sin esta señal, un despliegue sin la contraseña del
        // rol de solo lectura parece un apagado manual.
        rolDisponible: bodyvibeDbService.isEnabled(),
        configurado: bodyvibeDbService.isConfigured(),
        // El frontend pregunta en vez de repetir la lista de correos: una
        // segunda copia de esa lista es una copia que se desactualiza.
        puedoConstruir: puedeConstruir(getSession(_req)?.email),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/bodyvibe/catalogo — lo que el agente ve, exactamente igual.
   *
   * Con `?formato=texto` devuelve el prompt literal. Es la forma de auditar por
   * qué el agente generó algo raro: casi siempre la respuesta está acá, en un
   * estante que falta o una regla que no se escribió.
   */
  async catalogo(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (req.query.formato === 'texto') {
        res.type('text/plain; charset=utf-8').send(await bodyvibeCatalogoService.comoTexto());
        return;
      }
      res.json(await bodyvibeCatalogoService.obtener());
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Apps: borradores privados de quien los crea (decisión 05).
  // ---------------------------------------------------------------------------

  /** GET /api/bodyvibe/apps — los míos, no los de todos. */
  async listarApps(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      res.json(await bodyvibeAppsService.listarDe(sesion.userId));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/apps — arranca un borrador vacío. */
  async crearApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const app = await bodyvibeAppsService.crear({
        usuarioId: sesion.userId,
        email: sesion.email,
        sedeId: sesion.sedes?.[0] ?? null,
      });
      if (!app) {
        res.status(500).json({ ok: false, mensaje: 'No se pudo crear el app.' });
        return;
      }
      res.status(201).json(app);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/apps/:id */
  async obtenerApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const app = await bodyvibeAppsService.obtener(req.params.id, sesion.userId);
      if (!app) {
        res.status(404).json({ ok: false, mensaje: 'Ese app no existe o no es tuyo.' });
        return;
      }
      res.json(app);
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/bodyvibe/apps/:id */
  async eliminarApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const ok = await bodyvibeAppsService.eliminar(req.params.id, sesion.userId);
      res.status(ok ? 204 : 404).end();
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/apps/:id/versiones */
  async versionesApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      res.json(await bodyvibeAppsService.versiones(req.params.id, sesion.userId));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/apps/:id/restaurar — vuelve a una versión anterior. */
  async restaurarApp(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const version = Number(req.body?.version);
      if (!Number.isFinite(version)) {
        res.status(400).json({ ok: false, mensaje: 'Falta el número de versión.' });
        return;
      }
      const app = await bodyvibeAppsService.restaurar(req.params.id, sesion.userId, version);
      if (!app) {
        res.status(404).json({ ok: false, mensaje: 'No se encontró esa versión.' });
        return;
      }
      res.json(app);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/bodyvibe/apps/:id/generar — el agente construye o modifica.
   *
   * Devuelve el app ya guardado con su versión nueva, para que el frontend no
   * tenga que volver a pedirlo.
   */
  async generar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }

      if (!(await bodyvibeService.operativo())) {
        const e = await bodyvibeService.estado();
        res.status(503).json({
          ok: false,
          code: 'apagado',
          mensaje: e.motivo ? `BodyVibeTech está apagado: ${e.motivo}` : 'BodyVibeTech está apagado.',
        });
        return;
      }

      const pedido = typeof req.body?.pedido === 'string' ? req.body.pedido.trim() : '';
      if (!pedido) {
        res.status(400).json({ ok: false, mensaje: 'Contame qué querés construir.' });
        return;
      }

      const app = await bodyvibeAppsService.obtener(req.params.id, sesion.userId);
      if (!app) {
        res.status(404).json({ ok: false, mensaje: 'Ese app no existe o no es tuyo.' });
        return;
      }

      const r = await bodyvibeAgenteService.generar({
        pedido,
        codigoActual: app.codigo || null,
        historial: Array.isArray(req.body?.historial) ? req.body.historial.slice(-6) : [],
        actor: { usuarioId: sesion.userId, email: sesion.email, appId: app.id },
      });

      if (!r.ok) {
        res.status(r.code === 'tope_alcanzado' ? 429 : 502).json(r);
        return;
      }

      const guardado = await bodyvibeAppsService.guardarVersion(app.id, sesion.userId, {
        titulo: r.resultado.titulo,
        codigo: r.resultado.codigo,
        notas: r.resultado.notas,
        pedido,
      });

      res.json({ ok: true, app: guardado, notas: r.resultado.notas, uso: r.resultado.uso });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Publicación, aprobación y consumo.
  // ---------------------------------------------------------------------------

  /** POST /api/bodyvibe/apps/:id/publicar — pide publicar (o publica, si es cosmético). */
  async publicar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const { alcance, roles, sedes, anclaje } = req.body ?? {};
      if (alcance !== 'sede' && alcance !== 'global') {
        res.status(400).json({ ok: false, mensaje: 'El alcance debe ser "sede" o "global".' });
        return;
      }
      const r = await bodyvibePublicacionService.solicitar(req.params.id, actor, {
        alcance,
        roles: Array.isArray(roles) ? roles : [],
        sedes: Array.isArray(sedes) ? sedes : [],
        anclaje: typeof anclaje === 'string' && anclaje ? anclaje : null,
      });
      res.status(r.ok ? 200 : 400).json(r);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/apps/:id/despublicar — cualquier admin, incluso ajeno. */
  async despublicar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.slice(0, 500) : '';
      const ok = await bodyvibePublicacionService.despublicar(req.params.id, actor.email, motivo);
      res.status(ok ? 200 : 404).json({ ok });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/solicitudes — la bandeja de quien aprueba. */
  async solicitudes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor || !puedeAprobar(actor)) {
        res.status(403).json({ ok: false, mensaje: 'Solo quien tiene alcance global puede aprobar.' });
        return;
      }
      res.json(await bodyvibePublicacionService.pendientes());
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/solicitudes/:id/aprobar */
  async aprobar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor || !puedeAprobar(actor)) {
        res.status(403).json({ ok: false, mensaje: 'Solo quien tiene alcance global puede aprobar.' });
        return;
      }
      const r = await bodyvibePublicacionService.aprobar(Number(req.params.id), actor.email);
      res.status(r.ok ? 200 : 409).json(r);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/solicitudes/:id/rechazar */
  async rechazar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor || !puedeAprobar(actor)) {
        res.status(403).json({ ok: false, mensaje: 'Solo quien tiene alcance global puede aprobar.' });
        return;
      }
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.slice(0, 500) : '';
      if (!motivo.trim()) {
        res.status(400).json({ ok: false, mensaje: 'Decile por qué lo rechazás: sin eso no puede corregirlo.' });
        return;
      }
      const r = await bodyvibePublicacionService.rechazar(Number(req.params.id), actor.email, motivo);
      res.status(r.ok ? 200 : 409).json(r);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/bodyvibe/publicados — lo que ESTA persona puede ver.
   *
   * Con `?anclaje=x` devuelve solo los incrustados en ese punto; con
   * `?anclaje=sueltos`, los que viven en la pantalla de Aplicaciones. Es lo que
   * consultan los anclajes de cada pantalla.
   */
  async publicados(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const todos = await bodyvibePublicacionService.visiblesPara(actor);
      const filtro = typeof req.query.anclaje === 'string' ? req.query.anclaje : null;

      if (!filtro) {
        res.json(todos);
        return;
      }
      res.json(
        filtro === 'sueltos'
          ? todos.filter((a) => !a.anclaje)
          : todos.filter((a) => a.anclaje === filtro)
      );
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/anclajes — dónde se puede incrustar un app. */
  async anclajes(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(ANCLAJES);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/publicados/:id */
  async publicado(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const actor = actorDe(req);
      if (!actor) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const app = await bodyvibePublicacionService.obtenerPublicado(req.params.id, actor);
      if (!app) {
        res.status(404).json({ ok: false, mensaje: 'Ese app no está publicado para vos.' });
        return;
      }
      res.json(app);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Apariencia (puerta 2).
  // ---------------------------------------------------------------------------

  /**
   * GET /api/bodyvibe/tema — la apariencia activa y las opciones elegibles.
   *
   * Lo consulta CUALQUIER sesión, no solo quien la configura: toda la
   * plataforma tiene que pintar con la paleta vigente.
   */
  async tema(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json({ ...(await bodyvibeTemaService.obtener()), ...bodyvibeTemaService.opciones() });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/bodyvibe/tema — cambia la apariencia. Solo paletas preaprobadas. */
  async guardarTema(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      if (!sesion) {
        res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
        return;
      }
      const r = await bodyvibeTemaService.guardar(
        String(req.body?.paleta ?? ''),
        String(req.body?.densidad ?? 'normal') as Densidad,
        sesion.email
      );
      res.status(r.ok ? 200 : 400).json(r);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/bodyvibe/gasto — cuánto va del tope del mes. */
  async gasto(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      res.json(await bodyvibeAgenteService.estadoDeGasto());
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/apagar — el interruptor general. */
  async apagar(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      const quien = sesion?.email ?? 'desconocido';
      const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.slice(0, 500) : undefined;
      res.json(await bodyvibeService.apagar(quien, motivo));
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/bodyvibe/encender */
  async encender(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const sesion = getSession(req);
      res.json(await bodyvibeService.encender(sesion?.email ?? 'desconocido'));
    } catch (error) {
      next(error);
    }
  }
}

export default new BodyVibeController();

import { Router, Request, Response, NextFunction } from 'express';
import bodyvibeController from '../controllers/bodyvibe.controller';
import { getSession } from '../middleware/rbac.middleware';
import { puedeConstruir } from '../services/bodyvibe-acceso';

// /api/bodyvibe — BodyVibeTech.
//
// El control de acceso vive ACÁ, por ruta, y no al montar en index.ts: los apps
// publicados los consume gente que no construye apps (coordinadores, médicos,
// coaches). Un `requireRole('admin')` sobre todo el grupo dejaría publicar y no
// dejaría ver, que es justo lo contrario de lo que se busca.
//
// Tres niveles:
//
//   · Cualquier sesión válida  → ver apps publicados y consultar sus datos.
//   · admin                    → construir, publicar, despublicar, interruptor.
//   · admin con alcance global → aprobar. Se verifica en el controlador, que es
//                                donde se conoce `esGlobal`.
const router = Router();

/** Sesión válida, sin importar el rol. */
function requireSesion(req: Request, res: Response, next: NextFunction): void {
  if (!getSession(req)) {
    res.status(401).json({ ok: false, mensaje: 'Sesión requerida.' });
    return;
  }
  next();
}

/**
 * Construir apps. Ser `admin` es necesario pero no suficiente: además hay que
 * estar en la lista de constructores, porque cada generación consume del cupo
 * de Anthropic compartido con el resto de la plataforma.
 */
function requireConstructor(req: Request, res: Response, next: NextFunction): void {
  const sesion = getSession(req);
  if (!sesion || sesion.role !== 'admin' || !puedeConstruir(sesion.email)) {
    res.status(403).json({
      ok: false,
      mensaje: 'BodyVibeTech está habilitado para un grupo reducido de personas por ahora.',
    });
    return;
  }
  next();
}



// --- Cualquier sesión ---------------------------------------------------------
router.get('/estado', requireSesion, bodyvibeController.estado);
router.get('/publicados', requireSesion, bodyvibeController.publicados);
router.get('/publicados/:id', requireSesion, bodyvibeController.publicado);
// La ventanilla la usan tanto quien construye como quien consume. La distinción
// —y la lista blanca de consultas para quien solo consume— se aplica adentro.
router.post('/query', requireSesion, bodyvibeController.query);
// La apariencia la LEE cualquiera —toda la plataforma pinta con ella— y la
// CAMBIA solo un administrador.
router.get('/tema', requireSesion, bodyvibeController.tema);
router.get('/anclajes', requireSesion, bodyvibeController.anclajes);

// --- Construcción (admin + lista de constructores) -----------------------------------------------------
router.get('/catalogo', requireConstructor, bodyvibeController.catalogo);
router.get('/gasto', requireConstructor, bodyvibeController.gasto);
router.put('/tema', requireConstructor, bodyvibeController.guardarTema);

// Los apps filtran por creador dentro del servicio: un borrador es privado
// aunque quien lo pida también sea administrador.
router.get('/apps', requireConstructor, bodyvibeController.listarApps);
router.post('/apps', requireConstructor, bodyvibeController.crearApp);
router.get('/apps/:id', requireConstructor, bodyvibeController.obtenerApp);
router.delete('/apps/:id', requireConstructor, bodyvibeController.eliminarApp);
router.get('/apps/:id/versiones', requireConstructor, bodyvibeController.versionesApp);
router.post('/apps/:id/restaurar', requireConstructor, bodyvibeController.restaurarApp);
router.post('/apps/:id/generar', requireConstructor, bodyvibeController.generar);
router.post('/apps/:id/publicar', requireConstructor, bodyvibeController.publicar);
// Despublicar no exige ser el dueño: cualquier admin puede bajar cualquier app
// (decisión 10). No destruye nada — vuelve a ser borrador de su dueño.
router.post('/apps/:id/despublicar', requireConstructor, bodyvibeController.despublicar);

// --- Aprobación ---------------------------------------------------------------
router.get('/solicitudes', requireConstructor, bodyvibeController.solicitudes);
router.post('/solicitudes/:id/aprobar', requireConstructor, bodyvibeController.aprobar);
router.post('/solicitudes/:id/rechazar', requireConstructor, bodyvibeController.rechazar);

// --- Interruptor general ------------------------------------------------------
router.post('/apagar', requireConstructor, bodyvibeController.apagar);
router.post('/encender', requireConstructor, bodyvibeController.encender);

export default router;

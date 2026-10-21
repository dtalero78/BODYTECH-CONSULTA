// ============================================================================
// /api/integracion-crm/v1/* — Lo que el CRM de Bodytech lee de Consulta (SPEC
// del CRM, §5: una API de integración por app hermana, con token de servicio).
//
// Sin sesión de persona: entra el CRM con `CRM_SERVICE_TOKEN` (Bearer). Sin esa
// variable la puerta no existe (404), para que un despliegue sin configurar no
// quede abierto.
//
// Hoy: los Indicadores del Panel Coordinador para el Panorama del CRM. Usa la
// MISMA función de la pantalla (`calendarioService.getIndicadores`), sobre todas
// las sedes activas —lo que ve un admin—, así el CRM no puede mostrar otra cifra.
// Solo agregados y el desglose por profesional; ningún dato de pacientes.
// ============================================================================

import { timingSafeEqual } from 'crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import calendarioService from '../services/calendario.service';
import postgresService from '../services/postgres.service';
import { PROGRAMAS_VALIDOS, normalizarProgramas } from '../helpers/programa-scope';

const router = Router();

function tokenValido(recibido: string, esperado: string): boolean {
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requiereCrm(req: Request, res: Response, next: NextFunction): void {
  const esperado = (process.env.CRM_SERVICE_TOKEN ?? '').trim();
  if (!esperado) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
    return;
  }
  const cabecera = req.headers.authorization ?? '';
  const recibido = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : '';
  if (!recibido || !tokenValido(recibido, esperado)) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED' } });
    return;
  }
  next();
}

router.use(rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }), requiereCrm);

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /indicadores?from=YYYY-MM-DD&to=YYYY-MM-DD&programa=trepsi,nativa
 * `programa` es opcional: uno o varios de PROGRAMAS_VALIDOS separados por coma; sin él, todos.
 */
router.get('/indicadores', async (req, res, next) => {
  try {
    const from = String(req.query.from ?? '');
    const to = String(req.query.to ?? '');
    if (!FECHA.test(from) || !FECHA.test(to)) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PARAMS', message: 'from y to (YYYY-MM-DD) son requeridos.' } });
      return;
    }
    const pedidos = String(req.query.programa ?? '')
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (pedidos.some((p) => !(PROGRAMAS_VALIDOS as readonly string[]).includes(p))) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PARAMS', message: 'programa inválido.' } });
      return;
    }
    const programas = pedidos.length ? normalizarProgramas(pedidos) : undefined;

    // Lo que ve un admin sin filtro: todas las sedes activas (resolveSedes del calendario).
    const filas = await postgresService.query(`SELECT sede_id FROM sedes WHERE activa = true`);
    const sedes = filas ? filas.map((r: { sede_id: string }) => r.sede_id) : [];

    const r = await calendarioService.getIndicadores(from, to, sedes, undefined, programas);
    if (!r.ok) {
      res.status(r.status).json({ success: false, error: r.error });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: r.data });
  } catch (e) {
    next(e);
  }
});

export default router;

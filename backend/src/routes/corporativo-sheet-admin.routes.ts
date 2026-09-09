// ============================================================================
// corporativo-sheet-admin.routes — /api/admin/corporativo-sheet
//
// Operación del volcado de valoraciones del Médico Corporativo a Google Sheets.
// El RBAC (requireRole 'admin') se aplica en el mount de index.ts.
//
//   GET  /estado?limit=N          → bitácora: qué se envió, qué falló y por qué
//   POST /dispatch                → fuerza una pasada de los pendientes
//   POST /reencolar?desde=YYYY-MM-DD → vuelve a mandar valoraciones ya cerradas
//
// `reencolar` es lo que se usa para poblar la hoja la primera vez (las
// valoraciones cerradas antes de que existiera) y para rehacer una tanda que
// quedó en 'fallido'. No duplica: el Apps Script actualiza la fila que ya está.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import corporativoSheetService from '../services/corporativo-sheet.service';

const router = Router();

router.get('/estado', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limite = Math.min(Number(req.query.limit) || 50, 500);
    res.json({ success: true, data: await corporativoSheetService.estado(limite) });
  } catch (e) {
    next(e);
  }
});

router.post('/dispatch', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await corporativoSheetService.despacharPendientes() });
  } catch (e) {
    next(e);
  }
});

router.post('/reencolar', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const desde = typeof req.query.desde === 'string' ? req.query.desde : undefined;
    if (desde && !/^\d{4}-\d{2}-\d{2}$/.test(desde)) {
      res.status(400).json({ success: false, error: 'desde debe ser YYYY-MM-DD' });
      return;
    }
    const encoladas = await corporativoSheetService.reencolar(desde);
    // El despacho corre solo (worker cada minuto); se dispara acá para que la
    // respuesta no obligue a esperar el próximo barrido.
    corporativoSheetService.despacharPendientes().catch(() => {});
    res.json({ success: true, encoladas });
  } catch (e) {
    next(e);
  }
});

export default router;

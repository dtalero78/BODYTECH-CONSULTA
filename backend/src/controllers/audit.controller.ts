// ============================================================================
// audit.controller — Lectura de la bitácora (`audit_log`). Solo lectura; el
// RBAC (admin/coordinador) se aplica al montar la ruta en index.ts.
// GET /api/admin/audit?actor=&accion=&entidad=&entidadId=&from=&to=&limit=&offset=
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import auditService from '../services/audit.service';

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

class AuditController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const q = req.query;
      const result = await auditService.query({
        actorCodigo: str(q.actor),
        accion: str(q.accion),
        entidad: str(q.entidad),
        entidadId: str(q.entidadId),
        from: str(q.from),
        to: str(q.to),
        limit: num(q.limit),
        offset: num(q.offset),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}

export default new AuditController();

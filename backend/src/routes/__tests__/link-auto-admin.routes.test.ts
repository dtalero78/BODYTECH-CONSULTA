// ============================================================================
// La puerta de /api/admin/link-auto.
//
// Estos endpoints disparan WhatsApps a pacientes reales y exponen sus celulares
// y nombres en la bitácora. El candado es el `requireRole('admin')` del mount de
// index.ts, no el router — así que lo que se prueba acá es que ese mount siga
// puesto y que ningún otro rol clínico pueda entrar.
// ============================================================================

jest.mock('../../services/link-auto.service', () => ({
  __esModule: true,
  default: { dispatch: jest.fn(), getEstado: jest.fn() },
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import linkAutoAdminRoutes from '../link-auto-admin.routes';
import linkAutoService from '../../services/link-auto.service';
import { requireRole } from '../../middleware/rbac.middleware';

const dispatch = linkAutoService.dispatch as jest.Mock;
const getEstado = linkAutoService.getEstado as jest.Mock;

/** Mini-app con el MISMO mount que index.ts, y una sesión inyectable. */
function appConRol(role?: string) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (role) (req as any).session = { role, userId: 'u1', sedes: [], global: true };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('/api/admin/link-auto', requireRole('admin' as any), linkAutoAdminRoutes);
  return app;
}

describe('/api/admin/link-auto', () => {
  beforeEach(() => {
    dispatch.mockResolvedValue({ fecha: '2026-09-03', dryRun: true, items: [] });
    getEstado.mockResolvedValue({ fecha: '2026-09-03', porEstado: {}, filas: [] });
  });

  describe('sin permisos', () => {
    it('401 sin sesión', async () => {
      await request(appConRol()).post('/api/admin/link-auto/dispatch').expect(401);
      expect(dispatch).not.toHaveBeenCalled();
    });

    it.each(['medico', 'coordinador', 'coach'])('403 con rol %s', async (rol) => {
      await request(appConRol(rol)).post('/api/admin/link-auto/dispatch').expect(403);
      await request(appConRol(rol)).get('/api/admin/link-auto/estado').expect(403);
      expect(dispatch).not.toHaveBeenCalled();
      expect(getEstado).not.toHaveBeenCalled();
    });
  });

  describe('como admin', () => {
    it('dispatch en seco no envía: pasa dryRun al servicio', async () => {
      await request(appConRol('admin'))
        .post('/api/admin/link-auto/dispatch?fecha=2026-09-03&dryRun=1')
        .expect(200);

      expect(dispatch).toHaveBeenCalledWith('2026-09-03', {
        dryRun: true,
        limit: undefined,
        historiaId: undefined,
      });
    });

    it('sin dryRun explícito, NO es dry-run (envía de verdad)', async () => {
      await request(appConRol('admin')).post('/api/admin/link-auto/dispatch').expect(200);
      expect(dispatch.mock.calls[0][1].dryRun).toBe(false);
    });

    it('acota a una sola cita con historiaId', async () => {
      await request(appConRol('admin'))
        .post('/api/admin/link-auto/dispatch?historiaId=hc-1&limit=5')
        .expect(200);

      expect(dispatch.mock.calls[0][1]).toMatchObject({ historiaId: 'hc-1', limit: 5 });
    });

    it('una fecha inválida cae al día de hoy, no rompe', async () => {
      await request(appConRol('admin'))
        .post('/api/admin/link-auto/dispatch?fecha=ayer')
        .expect(200);

      expect(dispatch.mock.calls[0][0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('estado devuelve la bitácora', async () => {
      const res = await request(appConRol('admin'))
        .get('/api/admin/link-auto/estado?fecha=2026-09-03')
        .expect(200);

      expect(res.body).toMatchObject({ success: true, data: { fecha: '2026-09-03' } });
    });

    it('estado responde 500 si la bitácora no se pudo leer', async () => {
      getEstado.mockResolvedValue(null);
      const res = await request(appConRol('admin'))
        .get('/api/admin/link-auto/estado')
        .expect(500);

      expect(res.body.error.code).toBe('DB_ERROR');
    });
  });
});

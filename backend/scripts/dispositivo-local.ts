// ============================================================================
// Servidor de pruebas del dispositivo de consulta presencial, en el Mac.
//
//   cd backend && npx ts-node scripts/dispositivo-local.ts      (puerto 3100)
//
// Monta SOLO /api/dispositivo (con la sesión y la auditoría de siempre) y crea
// solo sus tablas. No arranca index.ts a propósito: ese arranca los workers de
// WhatsApp, alarmas, Trepsi e informes, y con el .env local (que apunta a la
// base de PRODUCCIÓN) duplicaría los de la nube y le escribiría a pacientes.
//
// Ojo: igual usa la base real. Probar con la cuenta de prueba (código y nombre
// con "prueba"), nunca con un médico de verdad.
// ============================================================================

import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import postgresService from '../src/services/postgres.service';
import { sessionContextMiddleware } from '../src/middleware/rbac.middleware';
import { auditMiddleware } from '../src/middleware/audit.middleware';
import dispositivoRoutes from '../src/routes/dispositivo.routes';

const PUERTO = Number(process.env.DISPOSITIVO_LOCAL_PORT || 3100);

async function main() {
  await postgresService.migrarDispositivo();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`${new Date().toISOString().slice(11, 19)} ${req.method} ${req.path}`);
    next();
  });
  app.use(sessionContextMiddleware);
  app.use(auditMiddleware);
  app.use('/api/dispositivo', dispositivoRoutes);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[dispositivo-local]', err);
    res.status(500).json({ success: false, error: 'INTERNAL' });
  });

  app.listen(PUERTO, '0.0.0.0', () => {
    console.log(`Dispositivo local en http://0.0.0.0:${PUERTO}/api/dispositivo (base REAL, sin workers)`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// ============================================================================
// Apagar a alguien le corta la sesión que ya tenía abierta.
//
// El token de sesión se valida con la firma y, con «recordarme», dura 30 días.
// Un coach apagado el 22-sep-2026 siguió entrando hasta el 27 con su sesión
// vieja. Lo que se fija: el mismo token deja de servir apenas la cuenta se
// apaga, y vuelve a servir si se enciende.
// ============================================================================

jest.mock('../../services/auth.service', () => ({
  __esModule: true,
  default: {
    verifySessionToken: (token: string) =>
      token === 'token-de-juan'
        ? {
            kind: 'session',
            userId: 10,
            email: 'juan.mendez@bodytechcorp.com',
            nombre: 'Juan Mendez',
            role: 'coach',
            sedes: ['bdt-nutricion'],
            esGlobal: false,
          }
        : null,
  },
}));

import express from 'express';
import request from 'supertest';
import { sessionContextMiddleware, requireRole } from '../rbac.middleware';
import cuentasApagadas from '../../services/cuentas-apagadas.service';

function app() {
  const a = express();
  a.use(sessionContextMiddleware);
  a.get('/api/panel', requireRole('coach'), (_req, res) => {
    res.json({ success: true });
  });
  return a;
}

afterEach(() => cuentasApagadas.desmarcar('juan.mendez@bodytechcorp.com'));

it('con la cuenta activa, el token sirve', async () => {
  const r = await request(app()).get('/api/panel').set('Authorization', 'Bearer token-de-juan');
  expect(r.status).toBe(200);
});

it('apagada la cuenta, el MISMO token responde 401', async () => {
  cuentasApagadas.marcar('juan.mendez@bodytechcorp.com');
  const r = await request(app()).get('/api/panel').set('Authorization', 'Bearer token-de-juan');
  expect(r.status).toBe(401);
  expect(r.body.error).toBe('NO_SESSION');
});

it('encendida de nuevo, vuelve a servir sin volver a iniciar sesión', async () => {
  cuentasApagadas.marcar('juan.mendez@bodytechcorp.com');
  cuentasApagadas.desmarcar('juan.mendez@bodytechcorp.com');
  const r = await request(app()).get('/api/panel').set('Authorization', 'Bearer token-de-juan');
  expect(r.status).toBe(200);
});

// ============================================================================
// La puerta de /api/paneles: solo el creador de la plataforma.
//
// Desde /paneles se entra a ACC y a Prepagadas como admin sin volver a escribir
// la contraseña. Lo que se fija acá es el MISMO mount que index.ts
// (requireRole admin) más el candado por correo; que `/acceso` le conteste
// "no" a otro admin en vez de un 403; y que `/entrar` use el correo de la
// SESIÓN —nunca uno del cuerpo— y le pase la contraseña solo a la app elegida.
// ============================================================================

jest.mock('../../services/auth.service', () => ({
  __esModule: true,
  default: { tokensHermanas: jest.fn() },
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import panelesRoutes from '../paneles.routes';
import authService from '../../services/auth.service';
import { requireRole } from '../../middleware/rbac.middleware';
import { esSuperusuario } from '../../services/paneles-acceso';

const tokensHermanas = authService.tokensHermanas as jest.Mock;

const DANIEL = 'danieltalero78@gmail.com';
const OTRO_ADMIN = 'admin@bodytechcorp.com';

/** Mini-app con el MISMO mount que index.ts, y una sesión inyectable. */
function app(sesion?: { role: string; email: string }) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (sesion) (req as any).session = { ...sesion, kind: 'session', userId: 1, sedes: [], esGlobal: true };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a.use('/api/paneles', requireRole('admin' as any), panelesRoutes);
  return a;
}

const guardado = process.env.SUPERUSUARIOS;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SUPERUSUARIOS;
  tokensHermanas.mockResolvedValue([
    { programa: 'acc', token: 'token-de-acc', redirectUrl: 'https://acc.bodytech.app/sso' },
  ]);
});

afterAll(() => {
  if (guardado === undefined) delete process.env.SUPERUSUARIOS;
  else process.env.SUPERUSUARIOS = guardado;
});

describe('/api/paneles/acceso — lo que el panel pregunta para dibujar la entrada', () => {
  it('al creador le dice que sí', async () => {
    const r = await request(app({ role: 'admin', email: DANIEL })).get('/api/paneles/acceso');
    expect(r.status).toBe(200);
    expect(r.body.data.puede).toBe(true);
  });

  it('a otro admin le dice que no, sin 403', async () => {
    const r = await request(app({ role: 'admin', email: OTRO_ADMIN })).get('/api/paneles/acceso');
    expect(r.status).toBe(200);
    expect(r.body.data.puede).toBe(false);
  });
});

describe('/api/paneles/entrar', () => {
  it('sin sesión es 401', async () => {
    const r = await request(app()).post('/api/paneles/entrar').send({ programa: 'acc', password: 'x' });
    expect(r.status).toBe(401);
    expect(tokensHermanas).not.toHaveBeenCalled();
  });

  it('un coordinador no pasa, aunque su correo esté en la lista', async () => {
    process.env.SUPERUSUARIOS = 'coord@bodytechcorp.com';
    const r = await request(app({ role: 'coordinador', email: 'coord@bodytechcorp.com' }))
      .post('/api/paneles/entrar')
      .send({ programa: 'acc', password: 'x' });
    expect(r.status).toBe(403);
    expect(tokensHermanas).not.toHaveBeenCalled();
  });

  it('otro admin recibe 403 y su contraseña no viaja a ninguna app', async () => {
    const r = await request(app({ role: 'admin', email: OTRO_ADMIN }))
      .post('/api/paneles/entrar')
      .send({ programa: 'acc', password: 'x' });
    expect(r.status).toBe(403);
    expect(tokensHermanas).not.toHaveBeenCalled();
  });

  it('pide el token con el correo de la SESIÓN y solo a la app elegida', async () => {
    const r = await request(app({ role: 'admin', email: DANIEL }))
      .post('/api/paneles/entrar')
      // Un `email` en el cuerpo no puede servir para probar claves ajenas.
      .send({ programa: 'acc', password: 'mi-clave', email: OTRO_ADMIN });
    expect(r.status).toBe(200);
    expect(tokensHermanas).toHaveBeenCalledWith(DANIEL, 'mi-clave', ['acc']);
    expect(r.body.data).toEqual({ programa: 'acc', token: 'token-de-acc', redirectUrl: 'https://acc.bodytech.app/sso' });
  });

  it('contraseña mala o app caída: 422, no 401 — la sesión de Consulta sigue bien', async () => {
    tokensHermanas.mockResolvedValue([]);
    const r = await request(app({ role: 'admin', email: DANIEL }))
      .post('/api/paneles/entrar')
      .send({ programa: 'prepagadas', password: 'mala' });
    expect(r.status).toBe(422);
    expect(r.body.error).toBe('NO_ENTRO');
  });

  it('solo apps hermanas: Consulta no es un salto', async () => {
    const r = await request(app({ role: 'admin', email: DANIEL }))
      .post('/api/paneles/entrar')
      .send({ programa: 'consulta', password: 'x' });
    expect(r.status).toBe(400);
    expect(tokensHermanas).not.toHaveBeenCalled();
  });
});

describe('SUPERUSUARIOS', () => {
  it('sin variable, o vacía, solo el autor — nunca todos', () => {
    expect(esSuperusuario(DANIEL)).toBe(true);
    expect(esSuperusuario(OTRO_ADMIN)).toBe(false);
    process.env.SUPERUSUARIOS = ' , ';
    expect(esSuperusuario(DANIEL)).toBe(true);
    expect(esSuperusuario(OTRO_ADMIN)).toBe(false);
  });

  it('la lista reemplaza al autor y no distingue mayúsculas', () => {
    process.env.SUPERUSUARIOS = 'Otra.Persona@bodytechcorp.com';
    expect(esSuperusuario('otra.persona@BODYTECHCORP.com')).toBe(true);
    expect(esSuperusuario(DANIEL)).toBe(false);
    expect(esSuperusuario(null)).toBe(false);
  });
});

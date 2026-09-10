// ============================================================================
// La puerta de /api/digitalizar: solo la coordinación de la UMV.
//
// Digitalizar muestra nombres, cédulas y teléfonos de afiliados de MyBodytech.
// Se abría a todo `coordinador`, de cualquier programa; se pidió que sea solo
// para la coordinación de la UMV. Lo que se prueba acá es el MISMO mount que
// index.ts (requireRole admin/coordinador) más el candado por correo del
// router, y que `/acceso` le conteste "no" a quien no está en la lista en vez
// de devolverle un 403: es lo que el panel pregunta para dibujar la pestaña.
// ============================================================================

jest.mock('../../services/digitalizar.service', () => ({
  __esModule: true,
  default: {
    listar: jest.fn(),
    editar: jest.fn(),
    marcarRevisada: jest.fn(),
    eliminar: jest.fn(),
  },
}));
jest.mock('../../services/digitalizar-ocr.service', () => ({
  __esModule: true,
  leerFranjas: jest.fn(),
  leerPantallazo: jest.fn(),
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import digitalizarRoutes from '../digitalizar.routes';
import digitalizarService from '../../services/digitalizar.service';
import { requireRole } from '../../middleware/rbac.middleware';

const listar = digitalizarService.listar as jest.Mock;

const UMV = 'coordinadora.umv@bodytechcorp.com';
const OTRO = 'coordinador.trepsi@bodytechcorp.com';
const FECHA = '2026-09-10';

/** Mini-app con el MISMO mount que index.ts, y una sesión inyectable. */
function app(sesion?: { role: string; email: string }) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (sesion) (req as any).session = { ...sesion, userId: 'u1', sedes: [], global: true };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a.use('/api/digitalizar', requireRole('admin' as any, 'coordinador' as any), digitalizarRoutes);
  return a;
}

const guardado = process.env.DIGITALIZAR_PERMITIDOS;

beforeEach(() => {
  jest.clearAllMocks();
  listar.mockResolvedValue([]);
  process.env.DIGITALIZAR_PERMITIDOS = UMV;
});

afterAll(() => {
  if (guardado === undefined) delete process.env.DIGITALIZAR_PERMITIDOS;
  else process.env.DIGITALIZAR_PERMITIDOS = guardado;
});

describe('/api/digitalizar — solo la coordinación de la UMV', () => {
  it('la coordinadora de la UMV entra', async () => {
    const r = await request(app({ role: 'coordinador', email: UMV })).get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(200);
    expect(listar).toHaveBeenCalled();
  });

  it('otro coordinador recibe 403 y no se consulta nada', async () => {
    const r = await request(app({ role: 'coordinador', email: OTRO })).get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(403);
    expect(listar).not.toHaveBeenCalled();
  });

  it('el candado cubre también leer, editar y quitar', async () => {
    const a = app({ role: 'coordinador', email: OTRO });
    expect((await request(a).post('/api/digitalizar/leer').send({ fecha: FECHA, franjas: [] })).status).toBe(403);
    expect((await request(a).patch('/api/digitalizar/1').send({ nombre: 'Ana Pérez' })).status).toBe(403);
    expect((await request(a).delete('/api/digitalizar/1')).status).toBe(403);
  });

  it('el correo se compara sin mayúsculas ni espacios', async () => {
    const r = await request(app({ role: 'coordinador', email: '  Coordinadora.UMV@BodytechCorp.com ' }))
      .get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(200);
  });

  it('sin sesión: 401', async () => {
    expect((await request(app()).get('/api/digitalizar').query({ fecha: FECHA })).status).toBe(401);
  });

  it('un médico no pasa ni el mount, aunque su correo esté en la lista', async () => {
    const r = await request(app({ role: 'medico', email: UMV })).get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(403);
  });
});

describe('/api/digitalizar/acceso — lo que pregunta el panel', () => {
  it('a la coordinadora de la UMV le contesta que sí', async () => {
    const r = await request(app({ role: 'coordinador', email: UMV })).get('/api/digitalizar/acceso');
    expect(r.status).toBe(200);
    expect(r.body.data.puede).toBe(true);
  });

  it('a otro coordinador le contesta que no, sin 403: así el panel no dibuja la pestaña', async () => {
    const r = await request(app({ role: 'coordinador', email: OTRO })).get('/api/digitalizar/acceso');
    expect(r.status).toBe(200);
    expect(r.body.data.puede).toBe(false);
  });
});

describe('DIGITALIZAR_PERMITIDOS mal configurada no abre la puerta', () => {
  it('sin la variable entra solo el autor, no cualquier coordinador', async () => {
    delete process.env.DIGITALIZAR_PERMITIDOS;
    const otro = await request(app({ role: 'coordinador', email: OTRO })).get('/api/digitalizar/acceso');
    const autor = await request(app({ role: 'admin', email: 'danieltalero78@gmail.com' })).get('/api/digitalizar/acceso');
    expect(otro.body.data.puede).toBe(false);
    expect(autor.body.data.puede).toBe(true);
  });

  it('con la variable vacía tampoco', async () => {
    process.env.DIGITALIZAR_PERMITIDOS = ' , ';
    const r = await request(app({ role: 'coordinador', email: OTRO })).get('/api/digitalizar/acceso');
    expect(r.body.data.puede).toBe(false);
  });

  it('acepta varios correos separados por coma', async () => {
    process.env.DIGITALIZAR_PERMITIDOS = `${UMV}, otra.umv@bodytechcorp.com`;
    const r = await request(app({ role: 'coordinador', email: 'otra.umv@bodytechcorp.com' })).get('/api/digitalizar/acceso');
    expect(r.body.data.puede).toBe(true);
  });
});

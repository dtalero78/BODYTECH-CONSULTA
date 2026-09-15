// ============================================================================
// La puerta de /api/digitalizar: la coordinación nombrada y los médicos de la UMV.
//
// Digitalizar muestra nombres, cédulas y teléfonos de afiliados de MyBodytech.
// Se abría a todo `coordinador`, de cualquier programa; se pidió que sea solo
// para la UMV: su coordinación (por correo, DIGITALIZAR_PERMITIDOS) y, desde el
// 15-sep-2026, sus médicos desde el panel de atención (por `usuarios.programas`).
// Lo que se prueba acá es el MISMO mount que index.ts más el candado del
// router, y que `/acceso` le conteste "no" a quien no puede en vez de devolverle
// un 403: es lo que los paneles preguntan para dibujar el botón.
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
jest.mock('../../services/postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import digitalizarRoutes from '../digitalizar.routes';
import digitalizarService from '../../services/digitalizar.service';
import postgresService from '../../services/postgres.service';
import { requireRole } from '../../middleware/rbac.middleware';
import { esMedicoDelPrograma } from '../../services/digitalizar-acceso';

const listar = digitalizarService.listar as jest.Mock;
const query = postgresService.query as jest.Mock;

const UMV = 'coordinadora.umv@bodytechcorp.com';
const OTRO = 'coordinador.trepsi@bodytechcorp.com';
const FECHA = '2026-09-10';

/** Programas de cada usuario, como los devolvería `usuarios`. */
const USUARIOS: Record<number, { rol: string; programas: string[] }> = {
  10: { rol: 'medico', programas: ['umv'] },
  11: { rol: 'medico', programas: ['corporativo'] },
  12: { rol: 'medico', programas: [] },
};

/** Mini-app con el MISMO mount que index.ts, y una sesión inyectable. */
function app(sesion?: { role: string; email: string; userId?: number }) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (sesion) (req as any).session = { userId: 1, ...sesion, sedes: [], esGlobal: true };
    next();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a.use('/api/digitalizar', requireRole('admin' as any, 'coordinador' as any, 'medico' as any), digitalizarRoutes);
  return a;
}

const guardado = process.env.DIGITALIZAR_PERMITIDOS;

beforeEach(() => {
  jest.clearAllMocks();
  listar.mockResolvedValue([]);
  query.mockImplementation(async (_sql: string, params: unknown[]) => {
    const u = USUARIOS[Number(params?.[0])];
    return u ? [u] : [];
  });
  process.env.DIGITALIZAR_PERMITIDOS = UMV;
});

afterAll(() => {
  if (guardado === undefined) delete process.env.DIGITALIZAR_PERMITIDOS;
  else process.env.DIGITALIZAR_PERMITIDOS = guardado;
});

describe('/api/digitalizar — la coordinación de la UMV', () => {
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

  it('un coach no pasa ni el mount', async () => {
    const r = await request(app({ role: 'coach', email: UMV })).get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(403);
  });
});

describe('/api/digitalizar — los médicos de la UMV, desde su panel', () => {
  it('un médico del programa UMV entra, aunque su correo no esté en la lista', async () => {
    const r = await request(app({ role: 'medico', email: 'medica.umv@gmail.com', userId: 10 }))
      .get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(200);
    expect(listar).toHaveBeenCalled();
  });

  it('un médico de otro programa, o sin programa, recibe 403', async () => {
    for (const userId of [11, 12]) {
      const r = await request(app({ role: 'medico', email: 'medico@bodytechcorp.com', userId }))
        .get('/api/digitalizar').query({ fecha: FECHA });
      expect(r.status).toBe(403);
    }
    expect(listar).not.toHaveBeenCalled();
  });

  it('una cuenta inactiva o inexistente no entra', async () => {
    const r = await request(app({ role: 'medico', email: 'medica.umv@gmail.com', userId: 999 }))
      .get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(403);
  });

  it('si la base no responde, no entra: ante la duda no se muestran cédulas', async () => {
    query.mockResolvedValueOnce(null);
    const r = await request(app({ role: 'medico', email: 'medica.umv@gmail.com', userId: 10 }))
      .get('/api/digitalizar').query({ fecha: FECHA });
    expect(r.status).toBe(403);
  });

  it('el programa se reconoce sin mayúsculas, y solo para el rol médico', () => {
    expect(esMedicoDelPrograma('medico', ['UMV '])).toBe(true);
    expect(esMedicoDelPrograma('coordinador', ['umv'])).toBe(false);
    expect(esMedicoDelPrograma('medico', 'umv')).toBe(false);
  });
});

describe('/api/digitalizar/acceso — lo que preguntan los paneles', () => {
  it('a la coordinadora de la UMV le contesta que sí', async () => {
    const r = await request(app({ role: 'coordinador', email: UMV })).get('/api/digitalizar/acceso');
    expect(r.status).toBe(200);
    expect(r.body.data.puede).toBe(true);
  });

  it('al médico de la UMV le contesta que sí', async () => {
    const r = await request(app({ role: 'medico', email: 'medica.umv@gmail.com', userId: 10 })).get('/api/digitalizar/acceso');
    expect(r.body.data.puede).toBe(true);
  });

  it('a otro coordinador o médico le contesta que no, sin 403: así el panel no dibuja el botón', async () => {
    const coord = await request(app({ role: 'coordinador', email: OTRO })).get('/api/digitalizar/acceso');
    const medico = await request(app({ role: 'medico', email: 'medico@bodytechcorp.com', userId: 11 })).get('/api/digitalizar/acceso');
    expect(coord.status).toBe(200);
    expect(coord.body.data.puede).toBe(false);
    expect(medico.status).toBe(200);
    expect(medico.body.data.puede).toBe(false);
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

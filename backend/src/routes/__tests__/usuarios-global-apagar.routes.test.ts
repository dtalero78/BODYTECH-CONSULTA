// ============================================================================
// Apagar en Creación de Usuarios apaga también en Consulta.
//
// Hasta el 1-oct-2026 apagar solo escribía `personas.activo` en la tabla
// global. La cuenta local seguía activa (y el login de respaldo lo dejaba
// entrar), y la ficha de profesional seguía con su disponibilidad: los
// pacientes de Trepsi que reprogramaban le seguían cayendo a un coach que ya no
// trabajaba. Lo que se fija acá:
//   - apagar → cuenta local y ficha apagadas, sesión cortada;
//   - quitarle SOLO Consulta → lo mismo en Consulta, sin reflejar a la persona
//     entera (la apagaría también en ACC y prepagadas);
//   - encender → vuelve la cuenta, pero la ficha NO (recibe citas: se decide en
//     Profesionales);
//   - tocar otra aplicación o editar el nombre no toca Consulta.
// ============================================================================

const mockShared = jest.fn();
const mockLocal = jest.fn();

jest.mock('../../services/shared-db', () => ({
  __esModule: true,
  getSharedPool: () => ({ query: mockShared }),
}));
jest.mock('../../services/postgres.service', () => ({
  __esModule: true,
  default: { query: mockLocal },
}));
jest.mock('../../services/usuarios-global.service', () => ({
  __esModule: true,
  default: { editar: jest.fn().mockResolvedValue(true) },
}));
jest.mock('../../services/usuarios.service', () => ({
  __esModule: true,
  default: { update: jest.fn(), setPassword: jest.fn(), create: jest.fn() },
}));
jest.mock('../../services/bajas.service', () => ({
  __esModule: true,
  default: { darDeBaja: jest.fn(), reactivar: jest.fn() },
}));
jest.mock('../../services/auth.service', () => ({
  __esModule: true,
  default: {},
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import usuariosGlobalRoutes from '../usuarios-global.routes';
import usuariosGlobalService from '../../services/usuarios-global.service';
import { requireRole } from '../../middleware/rbac.middleware';
import cuentasApagadas from '../../services/cuentas-apagadas.service';

const JUAN = 'juan.mendez@bodytechcorp.com';

/** Mini-app con el MISMO mount que index.ts y una sesión de admin. */
function app() {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = {
      kind: 'session',
      userId: 1,
      email: 'admin@bodytechcorp.com',
      role: 'admin',
      sedes: [],
      esGlobal: true,
    };
    next();
  });
  a.use('/api/usuarios-global', requireRole('admin', 'coordinador'), usuariosGlobalRoutes);
  return a;
}

/** La tabla global, después de `editar`: cómo quedó la persona. */
function globalQueda(estado: { persona: boolean; acceso: boolean | null }) {
  mockShared.mockImplementation(async (sql: string) => {
    if (sql.includes('pa.rol')) {
      return { rows: [{ email: JUAN, rol: 'coach', alcance: { sedes: ['bdt-nutricion'] } }] };
    }
    if (sql.includes('AS persona')) {
      return { rows: [{ email: JUAN, persona: estado.persona, acceso: estado.acceso }] };
    }
    if (sql.includes('usuarioIdLocal')) return { rows: [{ id: 10 }] };
    return { rows: [] };
  });
}

/** La base local: la cuenta 10 está vinculada a la ficha 30. */
function localResponde() {
  mockLocal.mockImplementation(async (sql: string) => {
    if (sql.includes('UPDATE usuarios') && sql.includes('RETURNING profesional_id')) {
      return [{ profesional_id: 30 }];
    }
    return [];
  });
}

/** Las sentencias que llegaron a la base local, con sus parámetros. */
function sentenciasLocales(): Array<{ sql: string; params: unknown[] }> {
  return mockLocal.mock.calls.map(([sql, params]) => ({ sql: String(sql), params }));
}

beforeEach(() => {
  mockShared.mockReset();
  mockLocal.mockReset();
  localResponde();
  cuentasApagadas.desmarcar(JUAN);
});

describe('PATCH /api/usuarios-global/:id — apagar', () => {
  it('apaga la cuenta local y la ficha, y le corta la sesión', async () => {
    globalQueda({ persona: false, acceso: true });

    const r = await request(app()).patch('/api/usuarios-global/7').send({ activo: false });

    expect(r.status).toBe(200);
    expect(usuariosGlobalService.editar).toHaveBeenCalledWith(7, { activo: false });
    const s = sentenciasLocales();
    expect(s).toContainEqual({
      sql: expect.stringMatching(/UPDATE usuarios SET activo = FALSE/),
      params: [10],
    });
    expect(s).toContainEqual({
      sql: expect.stringMatching(/UPDATE profesionales SET activo = FALSE/),
      params: [30],
    });
    expect(cuentasApagadas.estaApagada(JUAN)).toBe(true);
  });

  it('quitarle solo Consulta también lo apaga en Consulta', async () => {
    globalQueda({ persona: true, acceso: false });

    const r = await request(app())
      .patch('/api/usuarios-global/7')
      .send({ app: 'consulta', accesoActivo: false });

    expect(r.status).toBe(200);
    const s = sentenciasLocales();
    expect(s.some((x) => /UPDATE usuarios SET activo = FALSE/.test(x.sql))).toBe(true);
    expect(s.some((x) => /UPDATE profesionales SET activo = FALSE/.test(x.sql))).toBe(true);
    expect(cuentasApagadas.estaApagada(JUAN)).toBe(true);
  });

  it('una cuenta sin ficha se apaga igual, sin tocar profesionales', async () => {
    globalQueda({ persona: false, acceso: true });
    mockLocal.mockImplementation(async () => [{ profesional_id: null }]);

    const r = await request(app()).patch('/api/usuarios-global/7').send({ activo: false });

    expect(r.status).toBe(200);
    expect(sentenciasLocales().some((x) => /UPDATE profesionales/.test(x.sql))).toBe(false);
  });

  it('si el reflejo en Consulta falla, el apagado global igual responde 200', async () => {
    mockShared.mockImplementation(async (sql: string) => {
      if (sql.includes('pa.rol')) return { rows: [{ email: JUAN, rol: 'coach', alcance: {} }] };
      throw new Error('base compartida caída');
    });

    const r = await request(app()).patch('/api/usuarios-global/7').send({ activo: false });

    expect(r.status).toBe(200);
    expect(usuariosGlobalService.editar).toHaveBeenCalled();
  });
});

describe('PATCH /api/usuarios-global/:id — encender', () => {
  it('reactiva la cuenta local y le devuelve la sesión, pero NO la ficha', async () => {
    cuentasApagadas.marcar(JUAN);
    globalQueda({ persona: true, acceso: true });

    const r = await request(app()).patch('/api/usuarios-global/7').send({ activo: true });

    expect(r.status).toBe(200);
    const s = sentenciasLocales();
    expect(s).toContainEqual({
      sql: expect.stringMatching(/UPDATE usuarios SET activo = TRUE/),
      params: [10],
    });
    expect(s.some((x) => /UPDATE profesionales/.test(x.sql))).toBe(false);
    expect(cuentasApagadas.estaApagada(JUAN)).toBe(false);
  });

  it('encender a la persona con Consulta todavía quitada la deja apagada en Consulta', async () => {
    globalQueda({ persona: true, acceso: false });

    await request(app()).patch('/api/usuarios-global/7').send({ activo: true });

    expect(sentenciasLocales().some((x) => /UPDATE usuarios SET activo = TRUE/.test(x.sql))).toBe(false);
    expect(cuentasApagadas.estaApagada(JUAN)).toBe(true);
  });
});

describe('PATCH /api/usuarios-global/:id — lo que no toca Consulta', () => {
  it('quitarle ACC no apaga nada en Consulta', async () => {
    globalQueda({ persona: true, acceso: true });

    const r = await request(app())
      .patch('/api/usuarios-global/7')
      .send({ app: 'acc', accesoActivo: false });

    expect(r.status).toBe(200);
    expect(mockLocal).not.toHaveBeenCalled();
    expect(cuentasApagadas.estaApagada(JUAN)).toBe(false);
  });

  it('cambiar el nombre no toca la vigencia', async () => {
    globalQueda({ persona: true, acceso: true });

    await request(app()).patch('/api/usuarios-global/7').send({ nombre: 'Juan Méndez' });

    expect(mockLocal).not.toHaveBeenCalled();
  });
});

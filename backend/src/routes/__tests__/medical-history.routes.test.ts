// ============================================================================
// Integration tests del router de /api/video/medical-history.
//
// Monta una mini-app Express (sin levantar index.ts, sin Socket.io, sin
// migrations) y mockea `postgres.service` para que ninguna llamada llegue a
// la DB real. Los servicios siguen siendo el código real — solo cortamos en
// la capa IO.
// ============================================================================

// IMPORTANTE: jest.mock(...) ANTES de cualquier `import` real del SUT para
// que jest pueda hoistearlo. El path es relativo a este archivo de test.

const mockQuery = jest.fn();
const mockRunMigrations = jest.fn();

jest.mock('../../services/postgres.service', () => {
  // El módulo real exporta `export default new PostgresService()`. Replicamos
  // el shape exacto: un default export con `query()` y `getClient()`.
  return {
    __esModule: true,
    default: {
      query: mockQuery,
      runMigrations: mockRunMigrations,
      getClient: jest.fn().mockResolvedValue(null),
    },
  };
});

// Mockear servicios IO-pesados que el controller importa pero que no
// participan en estos tests (whatsapp / openai / transcription).
jest.mock('../../services/whatsapp.service', () => ({
  __esModule: true,
  default: {
    sendTextMessage: jest.fn().mockResolvedValue({ success: true }),
  },
}));

jest.mock('../../services/openai.service', () => ({
  __esModule: true,
  default: {
    generateMedicalRecommendations: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../../services/transcription.service', () => ({
  __esModule: true,
  default: {
    linkRoomToHistoria: jest.fn(),
    processRecording: jest.fn(),
  },
}));

// Twilio se inicializa lazy en twilio.service — mockeamos por seguridad para
// que cualquier import indirecto no intente conectarse con credenciales
// inválidas del entorno de test.
jest.mock('../../services/twilio.service', () => ({
  __esModule: true,
  default: {
    generateAccessToken: jest.fn(),
    createRoom: jest.fn(),
    getRoom: jest.fn(),
    endRoom: jest.fn(),
    listParticipants: jest.fn(),
    disconnectParticipant: jest.fn(),
  },
}));

// session-tracker construye un cliente Twilio al cargar el módulo y
// mantiene referencias internas (no abre handles persistentes hoy, pero
// inicializa estructuras que el controller importa). Mock para aislar.
jest.mock('../../services/session-tracker.service', () => ({
  __esModule: true,
  sessionTracker: {
    addParticipant: jest.fn(),
    removeParticipant: jest.fn(),
    getConnectedPatients: jest.fn().mockReturnValue([]),
  },
}));

import express from 'express';
import request from 'supertest';
import videoRoutes from '../video.routes';

// Las rutas de historia clínica ahora exigen sesión RBAC con rol clínico
// (requireRole). Inyectamos directamente `req.session` (rol medico, una sede)
// — equivale a lo que hace sessionContextMiddleware con un token válido — y
// `req.sedeId` (el puente single-sede) para que el scoping por sede aplique.
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).session = {
      kind: 'session',
      userId: 1,
      email: 'test@bsl.co',
      nombre: 'Test',
      role: 'medico',
      sedes: ['bsl'],
      esGlobal: false,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).sedeId = 'bsl';
    // sedeScope es lo que lee effectiveSedes() para acotar las lecturas/escrituras.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as any).sedeScope = { all: false, sedes: ['bsl'] };
    next();
  });
  app.use('/api/video', videoRoutes);
  return app;
}

/** Mini-app SIN sesión — para verificar que requireRole corta el paso. */
function makeAppNoAuth() {
  const app = express();
  app.use(express.json());
  app.use('/api/video', videoRoutes);
  return app;
}

describe('RBAC — rutas de historia clínica exigen sesión con rol clínico', () => {
  test('GET /medical-history/:id sin sesión → 401', async () => {
    const res = await request(makeAppNoAuth()).get('/api/video/medical-history/abc');
    expect(res.status).toBe(401);
  });

  test('PATCH /medical-history/:id/field sin sesión → 401', async () => {
    const res = await request(makeAppNoAuth())
      .patch('/api/video/medical-history/abc/field')
      .send({ field: 'cc_imc_nuevo', value: 23.4 });
    expect(res.status).toBe(401);
  });

  test('GET /medical-history/atendidos sin sesión → 401', async () => {
    const res = await request(makeAppNoAuth()).get('/api/video/medical-history/atendidos');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/video/medical-history/:id/field', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('sin body → 400 VALIDATION_ERROR', async () => {
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('VALIDATION_ERROR');
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  test('body { value: "x" } sin field → 400 VALIDATION_ERROR', async () => {
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({ value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  test('field fuera del whitelist → 400 INVALID_FIELD', async () => {
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({ field: 'campo_inexistente', value: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('INVALID_FIELD');
    // El query no se llama: la validación corta antes.
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('value que no coerce al tipo declarado → 400 INVALID_VALUE', async () => {
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({ field: 'cc_imc_nuevo', value: 'no_es_numero' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_VALUE');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('UPDATE no afectó filas (rowCount=0) → 404 NOT_FOUND', async () => {
    mockQuery.mockResolvedValueOnce([]); // postgresService.query() devuelve filas[] vacío
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({ field: 'cc_imc_nuevo', value: 23.4 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('UPDATE exitoso → 200 con success:true y value coercionado', async () => {
    const now = new Date('2025-09-15T10:00:00Z');
    mockQuery.mockResolvedValueOnce([{ _updatedDate: now }]);
    const app = makeApp();
    const res = await request(app)
      .patch('/api/video/medical-history/abc/field')
      .send({ field: 'cc_imc_nuevo', value: 23.4 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.field).toBe('cc_imc_nuevo');
    expect(res.body.value).toBe(23.4);
    expect(res.body.updatedAt).toBe(now.toISOString());

    // Sanidad de la query: se construye con el nombre de la columna del whitelist
    // y queda scopeada por la sede del JWT (`requireAuthMiddleware` setea
    // req.sedeId='bsl' desde el token de prueba) → WHERE ... AND "sede_id" = $3.
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toMatch(/UPDATE\s+"HistoriaClinica"\s+SET\s+"cc_imc_nuevo"\s*=\s*\$1/);
    // Aislamiento por sede: ahora se filtra con ANY($3::text[]) sobre las sedes
    // del actor (effectiveSedes → ['bsl'] en el test).
    expect(sql).toMatch(/COALESCE\("sede_id",\s*'bsl'\)\s*=\s*ANY\(\$3::text\[\]\)/);
    expect(params).toEqual([23.4, 'abc', ['bsl']]);
  });
});

describe('GET /api/video/medical-history/:historiaId', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('historia no existe → 404', async () => {
    mockQuery.mockResolvedValueOnce([]);
    const app = makeApp();
    const res = await request(app).get('/api/video/medical-history/abc');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBe('No se encontró historia clínica para este paciente');
  });

  test('historia existe → 200 con data._id correcto', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 'abc',
        numeroId: '123456',
        primerNombre: 'Juan',
        primerApellido: 'Pérez',
        celular: '3001234567',
        email: 'juan@example.com',
      },
    ]);
    const app = makeApp();
    const res = await request(app).get('/api/video/medical-history/abc');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data._id).toBe('abc');
    expect(res.body.data.historiaId).toBe('abc');
    expect(res.body.data.numeroId).toBe('123456');
  });
});

describe('GET /api/video/medical-history/atendidos', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('200 con shape { data, total, page, limit, totalPaginas }', async () => {
    // El service hace 2 queries: count + rows. El mock las discrimina por SQL.
    mockQuery.mockImplementation((sql: string) => {
      if (/SELECT\s+COUNT/i.test(sql)) {
        return Promise.resolve([{ total: '2' }]);
      }
      return Promise.resolve([
        {
          _id: 'h1',
          numeroId: '111',
          primerNombre: 'Ana',
          primerApellido: 'García',
          celular: '3001111111',
          email: 'ana@example.com',
          fechaConsulta: new Date('2025-09-14'),
          atendido: 'ATENDIDO',
        },
        {
          _id: 'h2',
          numeroId: '222',
          primerNombre: 'Beto',
          primerApellido: 'López',
          celular: '3002222222',
          email: 'beto@example.com',
          fechaConsulta: new Date('2025-09-13'),
          atendido: 'ATENDIDO',
        },
      ]);
    });

    const app = makeApp();
    const res = await request(app).get('/api/video/medical-history/atendidos');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.total).toBe(2);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(res.body.totalPaginas).toBe(1);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]._id).toBe('h1');
  });
});

// ============================================================================
// La lista de cuentas apagadas: la que le corta la sesión a quien ya no trabaja.
//
// Se fija que la lista se lea de las DOS tablas (la local y la global), que un
// fallo de una base deje la última lista conocida en vez de vaciarla —vaciarla
// le devolvería la sesión a todos los apagados—, y que el login pregunte a la
// base por el correo en vez de fiarse de una lista que recién arrancada está
// vacía.
// ============================================================================

const mockShared = jest.fn();
const mockLocal = jest.fn();

jest.mock('../shared-db', () => ({
  __esModule: true,
  getSharedPool: () => ({ query: mockShared }),
}));
jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: mockLocal },
}));

type Servicio = typeof import('../cuentas-apagadas.service').default;

/** Una instancia nueva por test: el servicio es un singleton con estado. */
function nuevo(): Servicio {
  let s: Servicio | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    s = require('../cuentas-apagadas.service').default;
  });
  return s as Servicio;
}

beforeEach(() => {
  mockShared.mockReset();
  mockLocal.mockReset();
});

describe('estaApagada / marcar / desmarcar', () => {
  it('nadie está apagado hasta que se marca', () => {
    const s = nuevo();
    expect(s.estaApagada('juan.mendez@bodytechcorp.com')).toBe(false);
    expect(s.estaApagada('')).toBe(false);
    expect(s.estaApagada(undefined)).toBe(false);
  });

  it('marcar corta en el acto, sin importar mayúsculas ni espacios', () => {
    const s = nuevo();
    s.marcar('  Juan.Mendez@BodytechCorp.com ');
    expect(s.estaApagada('juan.mendez@bodytechcorp.com')).toBe(true);
    s.desmarcar('juan.mendez@bodytechcorp.com');
    expect(s.estaApagada('juan.mendez@bodytechcorp.com')).toBe(false);
  });
});

describe('refrescar', () => {
  it('junta las apagadas de la tabla local y de la global', async () => {
    const s = nuevo();
    mockLocal.mockResolvedValue([{ email: 'local@bodytechcorp.com' }]);
    mockShared.mockResolvedValue({ rows: [{ email: 'global@bodytechcorp.com' }] });

    await s.refrescar();

    expect(s.estaApagada('local@bodytechcorp.com')).toBe(true);
    expect(s.estaApagada('global@bodytechcorp.com')).toBe(true);
    expect(s.estaApagada('activo@bodytechcorp.com')).toBe(false);
  });

  it('encender a alguien lo saca de la lista en el siguiente refresco', async () => {
    const s = nuevo();
    mockLocal.mockResolvedValue([]);
    mockShared.mockResolvedValueOnce({ rows: [{ email: 'juan@bodytechcorp.com' }] });
    await s.refrescar();
    expect(s.estaApagada('juan@bodytechcorp.com')).toBe(true);

    mockShared.mockResolvedValueOnce({ rows: [] });
    await s.refrescar();
    expect(s.estaApagada('juan@bodytechcorp.com')).toBe(false);
  });

  it('si la base global no responde, se queda con la última lista (no le devuelve la sesión a nadie)', async () => {
    const s = nuevo();
    mockLocal.mockResolvedValue([]);
    mockShared.mockResolvedValueOnce({ rows: [{ email: 'juan@bodytechcorp.com' }] });
    await s.refrescar();

    mockShared.mockRejectedValueOnce(new Error('base compartida caída'));
    await s.refrescar();

    expect(s.estaApagada('juan@bodytechcorp.com')).toBe(true);
  });

  it('si la base local devuelve error (null), conserva la lista local anterior', async () => {
    const s = nuevo();
    mockShared.mockResolvedValue({ rows: [] });
    mockLocal.mockResolvedValueOnce([{ email: 'local@bodytechcorp.com' }]);
    await s.refrescar();

    mockLocal.mockResolvedValueOnce(null);
    await s.refrescar();

    expect(s.estaApagada('local@bodytechcorp.com')).toBe(true);
  });
});

describe('apagadaAhora — lo que pregunta el login', () => {
  it('pregunta a la base por ESE correo, aunque la lista en memoria esté vacía', async () => {
    const s = nuevo();
    mockShared.mockResolvedValue({ rows: [{ '?column?': 1 }] });

    expect(await s.apagadaAhora('Juan.Mendez@bodytechcorp.com')).toBe(true);
    expect(mockShared.mock.calls[0][1]).toEqual(['juan.mendez@bodytechcorp.com']);
  });

  it('quien está activo en la global entra', async () => {
    const s = nuevo();
    mockShared.mockResolvedValue({ rows: [] });
    expect(await s.apagadaAhora('activo@bodytechcorp.com')).toBe(false);
  });

  it('si la global no responde, decide con la lista en memoria', async () => {
    const s = nuevo();
    s.marcar('juan@bodytechcorp.com');
    mockShared.mockRejectedValue(new Error('caída'));

    expect(await s.apagadaAhora('juan@bodytechcorp.com')).toBe(true);
    expect(await s.apagadaAhora('otro@bodytechcorp.com')).toBe(false);
  });
});

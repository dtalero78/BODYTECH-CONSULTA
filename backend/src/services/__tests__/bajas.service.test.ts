// ============================================================================
// La baja organizacional se prueba, no se promete.
//
// Es lo único del sistema que puede negarle el trabajo a alguien, así que sus
// dos fronteras tienen que estar fijadas:
//
//   1. Dar de baja tiene efecto INMEDIATO, sin esperar al refresco.
//   2. Si el armario compartido se cae, se conserva la última lista conocida.
//      Ni bloquea a todo el mundo (fallar cerrado tumbaría el login entero por
//      una base secundaria), ni suelta a quien ya estaba de baja.
// ============================================================================

import { getSharedPool } from '../shared-db';
import bajasService from '../bajas.service';

jest.mock('../shared-db', () => ({
  __esModule: true,
  getSharedPool: jest.fn(),
}));

const queryMock = jest.fn();
(getSharedPool as jest.Mock).mockReturnValue({ query: queryMock });

/** El servicio guarda la lista en memoria; cada caso arranca en limpio. */
function reiniciarCache() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = bajasService as any;
  svc.cache = new Set<string>();
  svc.cacheAt = 0;
  svc.cargando = null;
}

/** `emails` es lo que devuelve la tabla; `falla` simula el armario caído. */
function armarioDevuelve(emails: string[], falla = false) {
  queryMock.mockReset();
  queryMock.mockImplementation(async (sql: string) => {
    if (falla && sql.includes('SELECT email FROM bajas_organizacion')) {
      throw new Error('armario caído');
    }
    if (sql.includes('SELECT email FROM bajas_organizacion')) {
      return { rows: emails.map((e) => ({ email: e })) };
    }
    return { rows: [] };
  });
}

beforeEach(reiniciarCache);

describe('bajasService', () => {
  it('deja entrar a quien no está de baja', async () => {
    armarioDevuelve(['exempleado@bodytechcorp.com']);
    expect(await bajasService.estaDeBaja('coach@bodytechcorp.com')).toBe(false);
  });

  it('bloquea a quien sí lo está, sin importar mayúsculas ni espacios', async () => {
    armarioDevuelve(['exempleado@bodytechcorp.com']);
    expect(await bajasService.estaDeBaja('  ExEmpleado@BodytechCorp.com  ')).toBe(true);
  });

  it('dar de baja tiene efecto INMEDIATO, sin esperar el refresco', async () => {
    armarioDevuelve([]);
    expect(await bajasService.estaDeBaja('alguien@bodytechcorp.com')).toBe(false);

    await bajasService.darDeBaja('alguien@bodytechcorp.com', 'renunció', 'admin@bodytech.app');

    // La tabla todavía devolvería vacío; igual debe quedar bloqueada ya.
    expect(await bajasService.estaDeBaja('alguien@bodytechcorp.com')).toBe(true);
  });

  it('el reingreso también es inmediato', async () => {
    armarioDevuelve(['volvio@bodytechcorp.com']);
    expect(await bajasService.estaDeBaja('volvio@bodytechcorp.com')).toBe(true);

    await bajasService.reactivar('volvio@bodytechcorp.com');
    expect(await bajasService.estaDeBaja('volvio@bodytechcorp.com')).toBe(false);
  });

  it('si el armario se cae, conserva la última lista: el de baja sigue afuera', async () => {
    armarioDevuelve(['exempleado@bodytechcorp.com']);
    expect(await bajasService.estaDeBaja('exempleado@bodytechcorp.com')).toBe(true);

    // Se cae el armario y vence el refresco.
    armarioDevuelve([], true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bajasService as any).cacheAt = 0;

    expect(await bajasService.estaDeBaja('exempleado@bodytechcorp.com')).toBe(true);
  });

  it('si el armario se cae, NO bloquea a los demás', async () => {
    armarioDevuelve(['exempleado@bodytechcorp.com']);
    await bajasService.estaDeBaja('exempleado@bodytechcorp.com');

    armarioDevuelve([], true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (bajasService as any).cacheAt = 0;

    // Una caída de una base secundaria no puede dejar sin trabajar a nadie más.
    expect(await bajasService.estaDeBaja('coach@bodytechcorp.com')).toBe(false);
  });

  it('en arranque en frío con el armario caído, no bloquea a nadie', async () => {
    armarioDevuelve([], true);
    expect(await bajasService.estaDeBaja('cualquiera@bodytechcorp.com')).toBe(false);
  });

  it('un correo vacío nunca cuenta como baja', async () => {
    armarioDevuelve(['']);
    expect(await bajasService.estaDeBaja('')).toBe(false);
  });
});

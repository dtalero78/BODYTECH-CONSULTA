import { requireApiKey } from '../api-key.middleware';
import type { Request, Response } from 'express';

/**
 * La llave de pruebas existe para que un cambio no aprobado NUNCA toque a
 * quien entra con la llave de producción. El 8-oct-2026 se prendió el control
 * de cupo para todos sin probarlo y en 17 horas se rechazaron 178 citas de
 * Trepsi. Estas pruebas cuidan esa separación.
 */
function correr(key: string | undefined) {
  const req = { headers: key ? { authorization: `Bearer ${key}` } : {} } as unknown as Request;
  let status = 0;
  const res = {
    status(c: number) { status = c; return this; },
    json() { return this; },
  } as unknown as Response;
  let paso = false;
  requireApiKey('TREPSI_API_KEY', 'trepsi')(req, res, () => { paso = true; });
  return {
    paso,
    status,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pruebas: (req as any).integrationPruebas,
  };
}

describe('llave de pruebas de la integración', () => {
  const previo = { ...process.env };
  beforeEach(() => {
    process.env.TREPSI_API_KEY = 'clave-de-produccion';
    process.env.TREPSI_API_KEY_PRUEBAS = 'clave-de-pruebas';
  });
  afterAll(() => { process.env = previo; });

  it('la llave de producción entra y NO queda marcada como pruebas', () => {
    const r = correr('clave-de-produccion');
    expect(r.paso).toBe(true);
    expect(r.pruebas).toBe(false);
  });

  it('la llave de pruebas entra y queda marcada', () => {
    const r = correr('clave-de-pruebas');
    expect(r.paso).toBe(true);
    expect(r.pruebas).toBe(true);
  });

  it('cualquier otra clave sigue siendo 401', () => {
    const r = correr('otra-cosa');
    expect(r.paso).toBe(false);
    expect(r.status).toBe(401);
  });

  it('sin llave de pruebas configurada, nadie entra en modo pruebas', () => {
    delete process.env.TREPSI_API_KEY_PRUEBAS;
    expect(correr('clave-de-pruebas').status).toBe(401);
    const prod = correr('clave-de-produccion');
    expect(prod.paso).toBe(true);
    expect(prod.pruebas).toBe(false);
  });

  it('una llave de pruebas vacía no abre la puerta a un token vacío', () => {
    process.env.TREPSI_API_KEY_PRUEBAS = '   ';
    expect(correr('   ').status).toBe(401);
  });
});

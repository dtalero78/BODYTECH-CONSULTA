import { beforeEach, describe, expect, it } from 'vitest';
import { guardar, olvidar, tokenDe, urlDeSalto, vigente, type TokenPanel } from '../paneles.service';

/** Un JWT de forma real (base64url, sin relleno) con el `exp` pedido. */
function jwtCon(exp: number): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ rol: 'admin', exp })}.firma`;
}

const enSegundos = (s: number) => Math.floor(Date.now() / 1000) + s;

const acc = (exp: number): TokenPanel => ({
  programa: 'acc',
  token: jwtCon(exp),
  redirectUrl: 'https://acc.bodytech.app/sso',
});

beforeEach(() => localStorage.clear());

describe('vigencia del token de una app hermana', () => {
  it('con horas por delante, sirve', () => {
    expect(vigente(acc(enSegundos(3600)))).toBe(true);
  });

  it('vencido o a punto de vencer, no: no alcanza a llegar a la otra app', () => {
    expect(vigente(acc(enSegundos(-10)))).toBe(false);
    expect(vigente(acc(enSegundos(30)))).toBe(false);
  });

  it('algo que no es un JWT no es un token', () => {
    expect(vigente({ programa: 'acc', token: 'basura', redirectUrl: '' })).toBe(false);
    expect(vigente(null)).toBe(false);
  });
});

describe('guardado', () => {
  it('guarda por app y solo devuelve lo que todavía sirve', () => {
    guardar([
      acc(enSegundos(3600)),
      { programa: 'prepagadas', token: jwtCon(enSegundos(-5)), redirectUrl: 'https://prepagadas.bodytech.app/sso' },
    ]);
    expect(tokenDe('acc')?.redirectUrl).toBe('https://acc.bodytech.app/sso');
    expect(tokenDe('prepagadas')).toBeNull();
  });

  it('olvidar borra todo — lo llama el logout', () => {
    guardar([acc(enSegundos(3600))]);
    olvidar();
    expect(tokenDe('acc')).toBeNull();
  });

  it('un localStorage corrupto no rompe la página', () => {
    localStorage.setItem('bsl_paneles', '{no es json');
    expect(tokenDe('acc')).toBeNull();
  });
});

describe('el salto a la otra app', () => {
  it('el token va en el fragmento, nunca en la querystring', () => {
    const t = acc(enSegundos(3600));
    const url = urlDeSalto(t, '/valoraciones');
    expect(url.startsWith('https://acc.bodytech.app/sso#')).toBe(true);
    expect(url).not.toContain('?');
    const fragmento = new URLSearchParams(url.split('#')[1]);
    expect(fragmento.get('t')).toBe(t.token);
    expect(fragmento.get('ir')).toBe('/valoraciones');
  });

  it('sin pantalla pedida, solo el token', () => {
    const url = urlDeSalto(acc(enSegundos(3600)));
    expect(new URLSearchParams(url.split('#')[1]).has('ir')).toBe(false);
  });
});

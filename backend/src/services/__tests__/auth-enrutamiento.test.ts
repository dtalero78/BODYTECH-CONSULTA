// ============================================================================
// El enrutamiento del login se prueba, no se promete.
//
// Cuando alguien inicia sesión y no es de Consulta, la contraseña se reenvía a
// las aplicaciones hermanas. Antes se probaban TODAS en orden: la clave de una
// persona de ACC viajaba primero a Prepagadas, y un login podía tardar hasta
// 8 s por hermana descartada.
//
// Ahora el espejo de accesos dice a cuál pertenece el correo y se prueba sólo
// esa. Lo que estos casos fijan es la frontera que no se puede cruzar: el
// espejo puede hacer perder tiempo, pero JAMÁS puede dejar a alguien sin poder
// entrar. Si no sabe, si se equivoca, o si está caído, el login tiene que
// comportarse exactamente como antes.
// ============================================================================

import accesosSyncService from '../accesos-sync.service';
import authService from '../auth.service';

jest.mock('../accesos-sync.service', () => ({
  __esModule: true,
  default: { appsDe: jest.fn() },
}));

const appsDeMock = accesosSyncService.appsDe as jest.Mock;

/** URLs a las que se intentó autenticar, en orden. */
let intentos: string[] = [];

/** `acierta` es la URL que devuelve un token; el resto rechaza. */
function fetchQueAcierta(acierta: string | null) {
  return jest.fn(async (url: string) => {
    intentos.push(url);
    if (acierta && url.startsWith(acierta)) {
      return { ok: true, json: async () => ({ token: 'token-de-la-hermana' }) } as unknown as Response;
    }
    return { ok: false, json: async () => ({}) } as unknown as Response;
  });
}

const PREPAGADAS = 'https://prepagadas.bodytech.app';
const ACC = 'https://bodytech-acc-f9hd6.ondigitalocean.app';

beforeEach(() => {
  intentos = [];
  appsDeMock.mockReset();
});

describe('loginHermanas — enrutamiento por correo', () => {
  it('va DIRECTO a la aplicación que el espejo indica, sin pasar por las otras', async () => {
    appsDeMock.mockResolvedValue(['acc']);
    global.fetch = fetchQueAcierta(ACC) as unknown as typeof fetch;

    const r = await authService.loginHermanas('adnerys@bodytech.app', 'clave');

    expect(r.ok).toBe(true);
    expect(r.programa).toBe('acc');
    // Lo que importa: la contraseña NO viajó a prepagadas.
    expect(intentos).toHaveLength(1);
    expect(intentos[0]).toContain('bodytech-acc');
  });

  it('si el espejo no conoce el correo, prueba todas como siempre', async () => {
    appsDeMock.mockResolvedValue([]);
    global.fetch = fetchQueAcierta(ACC) as unknown as typeof fetch;

    const r = await authService.loginHermanas('desconocido@bodytech.app', 'clave');

    expect(r.ok).toBe(true);
    expect(intentos).toHaveLength(2);
    expect(intentos[0]).toContain('prepagadas');
    expect(intentos[1]).toContain('bodytech-acc');
  });

  it('si el espejo está CAÍDO, el login sigue funcionando igual', async () => {
    appsDeMock.mockRejectedValue(new Error('base compartida caída'));
    global.fetch = fetchQueAcierta(PREPAGADAS) as unknown as typeof fetch;

    const r = await authService.loginHermanas('alguien@bodytech.app', 'clave');

    expect(r.ok).toBe(true);
    expect(r.programa).toBe('prepagadas');
  });

  it('si el espejo se EQUIVOCA, no deja a nadie afuera: cae a las demás', async () => {
    // El espejo dice prepagadas, pero la cuenta vive en ACC (espejo viejo).
    appsDeMock.mockResolvedValue(['prepagadas']);
    global.fetch = fetchQueAcierta(ACC) as unknown as typeof fetch;

    const r = await authService.loginHermanas('recien.creado@bodytech.app', 'clave');

    expect(r.ok).toBe(true);
    expect(r.programa).toBe('acc');
    // Probó la equivocada primero y después la correcta. Perdió tiempo, no acceso.
    expect(intentos).toHaveLength(2);
  });

  it('credenciales inválidas siguen fallando, sin importar el espejo', async () => {
    appsDeMock.mockResolvedValue(['acc']);
    global.fetch = fetchQueAcierta(null) as unknown as typeof fetch;

    const r = await authService.loginHermanas('alguien@bodytech.app', 'mala');

    expect(r.ok).toBe(false);
  });

  it('una cuenta que sólo existe en Consulta no repite la que ya falló', async () => {
    // El espejo la conoce, pero 'consulta' no es hermana: no hay a dónde dirigir.
    appsDeMock.mockResolvedValue(['consulta']);
    global.fetch = fetchQueAcierta(null) as unknown as typeof fetch;

    const r = await authService.loginHermanas('coach@bodytechcorp.com', 'clave');

    expect(r.ok).toBe(false);
    // Se comporta como antes: prueba las hermanas por si el espejo está viejo.
    expect(intentos).toHaveLength(2);
  });
});

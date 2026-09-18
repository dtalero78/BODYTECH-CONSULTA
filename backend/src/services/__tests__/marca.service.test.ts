// ============================================================================
// La lectura de la marca de una historia. Lo que se protege acá es que nunca
// impida un envío: ante cualquier duda, el paciente recibe su mensaje desde
// Bodytech, que es lo que pasaba antes de que existiera Athletic.
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import postgresService from '../postgres.service';
import { marcaDeEnvioParaHistoria } from '../marca.service';

const query = postgresService.query as jest.Mock;

describe('marcaDeEnvioParaHistoria', () => {
  const envOriginal = process.env;

  beforeEach(() => {
    process.env = {
      ...envOriginal,
      ATHLETIC_WHATSAPP_ENABLED: 'true',
      ATHLETIC_PLATAFORMA_USER: 'athletic@bodytech.app',
      ATHLETIC_PLATAFORMA_PASS: 'x',
    };
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = envOriginal;
    jest.restoreAllMocks();
  });

  it('con Athletic apagado ni consulta la base: todo sale por Bodytech', async () => {
    process.env.ATHLETIC_WHATSAPP_ENABLED = 'false';
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('bodytech');
    expect(query).not.toHaveBeenCalled();
  });

  it('lee codEmpresa de la historia', async () => {
    query.mockResolvedValue([{ codEmpresa: 'ATHLETIC' }]);
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('athletic');
    expect(query.mock.calls[0][1]).toEqual(['hc-1']);
  });

  it('una historia de Bodytech, o sin marca, es Bodytech', async () => {
    query.mockResolvedValue([{ codEmpresa: 'BODYTECH-COLOMBIA' }]);
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('bodytech');
    query.mockResolvedValue([{ codEmpresa: null }]);
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('bodytech');
  });

  it('una historia que no existe es Bodytech', async () => {
    query.mockResolvedValue([]);
    expect(await marcaDeEnvioParaHistoria('no-existe')).toBe('bodytech');
  });

  // postgresService.query devuelve null cuando la base falla.
  it('si la base no responde, Bodytech: el paciente recibe igual', async () => {
    query.mockResolvedValue(null);
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('bodytech');
  });

  it('si la consulta lanza, Bodytech: nunca impide el envío', async () => {
    query.mockRejectedValue(new Error('conexión perdida'));
    expect(await marcaDeEnvioParaHistoria('hc-1')).toBe('bodytech');
  });
});

// ============================================================================
// Que la marca de programa acote de verdad — y que no acote a quien no la tiene.
//
// La trampa de este filtro es la lista vacía: casi todas las cuentas la tienen
// así, y confundir "sin límite" con "sin acceso" deja al equipo entero mirando
// una pantalla en blanco. Por eso el vacío se prueba tanto como el lleno.
// ============================================================================

const mockQuery = jest.fn();
jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: mockQuery, getClient: jest.fn() },
}));

import { programaFilter, normalizarProgramas } from '../../helpers/programa-scope';
import medicalPanelService from '../medical-panel.service';

describe('programaFilter', () => {
  it('sin programas no agrega nada ni toca los parámetros', () => {
    const params: unknown[] = ['x'];
    expect(programaFilter(undefined, '"origen"', params)).toBe('');
    expect(programaFilter([], '"origen"', params)).toBe('');
    expect(params).toEqual(['x']);
  });

  it('con programas agrega la cláusula con el índice que toca', () => {
    const params: unknown[] = ['a', 'b'];
    const sql = programaFilter(['trepsi'], '"origen"', params);
    expect(sql).toBe(` AND LOWER(COALESCE("origen", 'nativa')) = ANY($3::text[])`);
    expect(params[2]).toEqual(['trepsi']);
  });

  it('una cita sin origen cuenta como agenda propia', () => {
    const params: unknown[] = [];
    expect(programaFilter(['nativa'], 'h."origen"', params)).toContain(`COALESCE(h."origen", 'nativa')`);
  });

  it('marcar UMV alcanza también las citas de MyBodytech, que son las suyas', () => {
    // La UMV no tiene citas con origen 'umv': llegan por la integración de
    // MyBodytech. Sin esto, su coordinación marcaría "UMV" y no vería nada.
    expect(normalizarProgramas(['umv'])).toEqual(['umv', 'mybodytech']);
    expect(normalizarProgramas(['mybodytech'])).toEqual(['mybodytech', 'umv']);
    expect(normalizarProgramas(['trepsi'])).toEqual(['trepsi']);
  });

  it('descarta lo que no es un programa y no se queda con duplicados', () => {
    expect(normalizarProgramas(['TREPSI', 'trepsi', 'inventado'])).toEqual(['trepsi']);
    expect(normalizarProgramas(['inventado'])).toBeUndefined();
    expect(normalizarProgramas('trepsi')).toBeUndefined();
    expect(normalizarProgramas(null)).toBeUndefined();
  });
});

describe('la lista de Afiliados', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([]);
  });

  it('acota por programa cuando la persona tiene uno marcado', async () => {
    await medicalPanelService.listOrdenes({ programas: ['trepsi'] });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain(`LOWER(COALESCE("origen", 'nativa'))`);
    expect(params).toContainEqual(['trepsi']);
  });

  it('sin programa marcado, la consulta sale como siempre', async () => {
    await medicalPanelService.listOrdenes({});
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('origen');
  });
});

// ============================================================================
// Indicadores: quién cuenta como profesional.
//
// Las citas de MyBodytech llegan con el nombre de la persona escrito a mano en
// `medico`, así que cada una salía en el desglose como un "coach" con 0% y
// hundía el promedio del equipo (22-sep-2026). La regla es tener ficha, no
// estar activa: hay quien atiende con la ficha inactiva.
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import calendarioService from '../calendario.service';
import postgresService from '../postgres.service';

const query = postgresService.query as jest.Mock;

/** El SQL del agregado por médico (el otro de la tanda calcula cupos). */
function sqlDelDesglose(): string {
  const call = query.mock.calls.find(([sql]) => String(sql).includes('GROUP BY medico_codigo'));
  return String(call?.[0] ?? '');
}

describe('getIndicadores', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([]);
  });

  it('solo cuenta citas cuyo profesional tiene ficha, y le basta con tenerla', async () => {
    await calendarioService.getIndicadores('2026-09-01', '2026-09-30', ['bsl']);
    const sql = sqlDelDesglose();
    expect(sql).toContain('FROM profesionales pf WHERE pf.codigo = "HistoriaClinica"."medico"');
    // Nada de exigir `activo`: eso borraría el trabajo de quien atiende con la
    // ficha inactiva.
    expect(sql).not.toMatch(/pf\.activo/);
  });

  it('un rango al revés no llega a la base', async () => {
    const r = await calendarioService.getIndicadores('2026-09-30', '2026-09-01', ['bsl']);
    expect(r.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });
});

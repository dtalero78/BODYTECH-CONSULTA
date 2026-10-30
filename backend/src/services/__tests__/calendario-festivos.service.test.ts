// ============================================================================
// Los festivos de Colombia no ofrecen ni aceptan horarios.
//
// 30-oct-2026: el lunes 2-nov (Todos los Santos, corrido por Ley Emiliani)
// aparecía con cupos, porque solo la API de Trepsi miraba los festivos. El
// bloqueo vive en getHorariosDisponibles (de ahí leen el panel, /reprogramar,
// /agendar y Trepsi) y en validarSlotDisponible (lo que acepta el agendar).
// ============================================================================

jest.mock('../postgres.service', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../disponibilidad-fecha.service', () => ({
  __esModule: true,
  default: { getRangosEfectivos: jest.fn() },
}));

import calendarioService from '../calendario.service';
import postgresService from '../postgres.service';
import disponibilidadFechaService from '../disponibilidad-fecha.service';

const query = postgresService.query as jest.Mock;
const rangos = disponibilidadFechaService.getRangosEfectivos as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  query.mockImplementation(async (sql: string) =>
    sql.includes('FROM profesionales')
      ? [{ id: 25, codigo: 'C1', tiempo_consulta: 20, sede_id: 'bdt-nutricion' }]
      : []
  );
  rangos.mockResolvedValue({
    ok: true,
    data: { source: 'semanal', rangos: [{ horaInicio: '08:00', horaFin: '10:00' }] },
  });
});

describe('festivos', () => {
  it('el lunes 2-nov-2026 (festivo) no ofrece horarios aunque el patrón semanal tenga horas', async () => {
    const r = await calendarioService.getHorariosDisponibles('2026-11-02', 25, 'bdt-nutricion', 'virtual');
    expect(r.ok).toBe(true);
    expect(r.data?.horarios).toEqual([]);
  });

  it('un lunes hábil (9-nov-2026) sí ofrece horarios', async () => {
    const r = await calendarioService.getHorariosDisponibles('2026-11-09', 25, 'bdt-nutricion', 'virtual');
    expect(r.ok).toBe(true);
    expect(r.data?.horarios.length).toBeGreaterThan(0);
  });

  it('agendar en festivo se rechaza con SLOT_FESTIVO, sin tocar la base', async () => {
    const r = await calendarioService.validarSlotDisponible('bdt-nutricion', 'C1', '2026-11-02', '08:00', 'virtual');
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error?.code).toBe('SLOT_FESTIVO');
    expect(query).not.toHaveBeenCalled();
  });
});

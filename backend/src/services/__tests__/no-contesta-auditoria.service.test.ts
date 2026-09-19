// ============================================================================
// Auditoría de "No contesta": en cuáles el paciente SÍ entró a la sala.
//
// Este número se va a usar para hablar con coaches con nombre propio, así que
// lo que más importa probar es que NO acuse de más: si el coach entró a la
// sala, no es un caso; si el paciente se conectó más de 15 min tarde, tampoco.
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import noContestaAuditoriaService, {
  llegoATiempo,
  resumirAuditoria,
  FilaNoContesta,
} from '../no-contesta-auditoria.service';
import postgresService from '../postgres.service';

const query = postgresService.query as jest.Mock;

const CITA = new Date('2026-09-16T14:00:00Z'); // 09:00 en Colombia
const min = (n: number) => new Date(CITA.getTime() + n * 60_000);

function fila(over: Partial<FilaNoContesta> = {}): FilaNoContesta {
  return {
    historia_id: 'hc-1',
    medico: 'C1',
    primer_nombre: 'Ana',
    primer_apellido: 'Rojas',
    cita: CITA,
    marcado_at: min(10),
    paciente_entro_at: min(-2),
    coach_entro: false,
    llamadas_antes: 0,
    atendia_otro: false,
    ...over,
  };
}

describe('llegoATiempo', () => {
  const t = CITA.getTime();

  it('conectarse antes de la hora o hasta 15 min después es a tiempo', () => {
    expect(llegoATiempo(t, min(-10).getTime())).toBe(true);
    expect(llegoATiempo(t, min(15).getTime())).toBe(true);
  });

  it('más de 15 min después ya es tarde', () => {
    expect(llegoATiempo(t, min(16).getTime())).toBe(false);
  });
});

describe('resumirAuditoria', () => {
  const nombres = new Map([['C1', 'Juan Mendez'], ['C2', 'Ana Navas']]);

  it('si el coach entró a la sala no es un caso, aunque el paciente también haya entrado', () => {
    const r = resumirAuditoria('d', 'h', [{ medico: 'C1', citas: 5, no_contesta: 1 }], [
      fila({ coach_entro: true }),
    ], nombres);
    expect(r.casos).toBe(0);
    expect(r.casosDetalle).toEqual([]);
    expect(r.noContesta).toBe(1);
  });

  it('si el paciente nunca entró cuenta como "nunca se conectó", y la llamada previa también cuenta', () => {
    const r = resumirAuditoria('d', 'h', [{ medico: 'C1', citas: 5, no_contesta: 1 }], [
      fila({ paciente_entro_at: null, llamadas_antes: 2 }),
    ], nombres);
    expect(r).toMatchObject({ casos: 0, nuncaSeConecto: 1, tarde: 0, llamadosAntes: 1 });
    expect(r.porCoach[0]).toMatchObject({ nuncaSeConecto: 1, llamadosAntes: 1 });
  });

  it('si el paciente se conectó más de 15 min tarde cuenta como "tarde", no como caso', () => {
    const r = resumirAuditoria('d', 'h', [{ medico: 'C1', citas: 5, no_contesta: 1 }], [
      fila({ paciente_entro_at: min(40), marcado_at: min(5) }),
    ], nombres);
    expect(r).toMatchObject({ casos: 0, tarde: 1, nuncaSeConecto: 0 });
  });

  it('si los dos se conectaron no cae en ninguna de las partes, aunque el paciente haya llegado tarde', () => {
    const r = resumirAuditoria('d', 'h', [{ medico: 'C1', citas: 5, no_contesta: 1 }], [
      fila({ paciente_entro_at: min(40), coach_entro: true }),
    ], nombres);
    expect(r).toMatchObject({ casos: 0, tarde: 0, nuncaSeConecto: 0 });
  });

  it('no importa si el coach marcó antes o después de que el paciente llegara', () => {
    const r = resumirAuditoria(
      'd',
      'h',
      [
        { medico: 'C1', citas: 10, no_contesta: 2 },
        { medico: 'C2', citas: 8, no_contesta: 1 },
      ],
      [
        // Llegó antes de la marca.
        fila({ historia_id: 'a', paciente_entro_at: min(-2), marcado_at: min(10), atendia_otro: true }),
        // Llegó después de la marca, pero a tiempo.
        fila({ historia_id: 'b', paciente_entro_at: min(8), marcado_at: min(5) }),
        fila({ historia_id: 'd', medico: 'C2', paciente_entro_at: min(1), marcado_at: min(6), llamadas_antes: 1 }),
      ],
      nombres
    );
    expect(r).toMatchObject({ casos: 3, atendiaOtro: 1, llamadosAntes: 1 });
    const c1 = r.porCoach.find((c) => c.medicoCodigo === 'C1')!;
    expect(c1).toMatchObject({ nombre: 'Juan Mendez', casos: 2, atendiaOtro: 1 });
    expect(r.casosDetalle.find((c) => c.historiaId === 'd')).toMatchObject({
      medicoCodigo: 'C2',
      paciente: 'Ana Rojas',
      llamo: true,
    });
  });

  it('los totales cuentan también a los coaches sin "No contesta", que no salen en la tabla', () => {
    const r = resumirAuditoria('d', 'h', [
      { medico: 'C1', citas: 10, no_contesta: 2 },
      { medico: 'C3', citas: 30, no_contesta: 0 },
    ], [], nombres);
    expect(r.citas).toBe(40);
    expect(r.porCoach.map((c) => c.medicoCodigo)).toEqual(['C1']);
  });

  it('ordena por pacientes que esperaron; sin nombre registrado usa el código', () => {
    const r = resumirAuditoria('d', 'h', [
      { medico: 'C2', citas: 10, no_contesta: 5 },
      { medico: 'C9', citas: 10, no_contesta: 1 },
      { medico: null, citas: 1, no_contesta: 1 },
    ], [fila({ medico: 'C9' })], nombres);
    expect(r.porCoach.map((c) => c.nombre)).toEqual(['C9', 'Ana Navas', 'Sin asignar']);
  });
});

describe('getAuditoria', () => {
  beforeEach(() => query.mockReset());

  it('rechaza fechas mal formadas y rangos al revés sin tocar la base', async () => {
    expect((await noContestaAuditoriaService.getAuditoria('16-09-2026', '2026-09-18', ['bsl'])).status).toBe(400);
    expect((await noContestaAuditoriaService.getAuditoria('2026-09-18', '2026-09-01', ['bsl'])).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it('un error de base es 500, no un tablero en cero', async () => {
    query.mockResolvedValueOnce(null).mockResolvedValueOnce([]);
    const r = await noContestaAuditoriaService.getAuditoria('2026-09-05', '2026-09-18', ['bsl']);
    expect(r).toMatchObject({ ok: false, status: 500 });
  });

  it('acota ambas consultas por sede, rango en hora Colombia y coach', async () => {
    query
      .mockResolvedValueOnce([{ medico: 'C1', citas: 3, no_contesta: 1 }])
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([{ codigo: 'C1', alias: null, primer_nombre: 'Juan', primer_apellido: 'Mendez' }]);

    const r = await noContestaAuditoriaService.getAuditoria('2026-09-05', '2026-09-18', ['bsl'], 'C1');

    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ casos: 1 });
    expect(r.data!.porCoach[0].nombre).toBe('Juan Mendez');
    for (const [sql, params] of query.mock.calls.slice(0, 2)) {
      expect(params).toEqual([
        ['bsl'],
        '2026-09-05T05:00:00.000Z',
        '2026-09-19T05:00:00.000Z',
        'C1',
      ]);
      expect(sql).toContain('"HistoriaClinica"."medico" = $4');
    }
  });
});

// ============================================================================
// Auditoría de "No contesta": en cuáles el paciente SÍ entró a la sala.
//
// Este número se va a usar para hablar con coaches con nombre propio, así que
// lo que más importa probar es que NO acuse de más: si el coach entró a la
// sala, no es un caso; si el paciente llegó después de la marca, no se cuenta
// como "ya estaba en la sala".
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import noContestaAuditoriaService, {
  clasificarLlegada,
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

describe('clasificarLlegada', () => {
  const t = CITA.getTime();

  it('entró antes de la marca → ya estaba en la sala', () => {
    expect(clasificarLlegada(t, min(3).getTime(), min(8).getTime())).toBe('en_sala');
  });

  it('entró a tiempo pero después de la marca → llegó después', () => {
    expect(clasificarLlegada(t, min(9).getTime(), min(5).getTime())).toBe('despues');
  });

  it('entrar en el mismo instante de la marca no cuenta como "ya estaba"', () => {
    expect(clasificarLlegada(t, min(5).getTime(), min(5).getTime())).toBe('despues');
  });

  it('entró más de 15 min tarde, ya marcado → tarde', () => {
    expect(clasificarLlegada(t, min(16).getTime(), min(5).getTime())).toBe('tarde');
  });

  it('sin hora de marca se juzga solo por la hora de llegada', () => {
    expect(clasificarLlegada(t, min(15).getTime(), null)).toBe('en_sala');
    expect(clasificarLlegada(t, min(16).getTime(), null)).toBe('tarde');
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

  it('si el paciente nunca entró no es un caso, pero la llamada previa sí cuenta', () => {
    const r = resumirAuditoria('d', 'h', [{ medico: 'C1', citas: 5, no_contesta: 1 }], [
      fila({ paciente_entro_at: null, llamadas_antes: 2 }),
    ], nombres);
    expect(r.casos).toBe(0);
    expect(r.llamadosAntes).toBe(1);
    expect(r.porCoach[0].llamadosAntes).toBe(1);
  });

  it('clasifica cada caso y lo atribuye a su coach', () => {
    const r = resumirAuditoria(
      'd',
      'h',
      [
        { medico: 'C1', citas: 10, no_contesta: 3 },
        { medico: 'C2', citas: 8, no_contesta: 1 },
      ],
      [
        fila({ historia_id: 'a', paciente_entro_at: min(-2), marcado_at: min(10), atendia_otro: true }),
        fila({ historia_id: 'b', paciente_entro_at: min(8), marcado_at: min(5) }),
        fila({ historia_id: 'c', paciente_entro_at: min(40), marcado_at: min(5) }),
        fila({ historia_id: 'd', medico: 'C2', paciente_entro_at: min(1), marcado_at: min(6), llamadas_antes: 1 }),
      ],
      nombres
    );
    expect(r).toMatchObject({ casos: 4, enSala: 2, despues: 1, tarde: 1, atendiaOtro: 1, llamadosAntes: 1 });
    const c1 = r.porCoach.find((c) => c.medicoCodigo === 'C1')!;
    expect(c1).toMatchObject({ nombre: 'Juan Mendez', casos: 3, enSala: 1, atendiaOtro: 1 });
    expect(r.casosDetalle.find((c) => c.historiaId === 'd')).toMatchObject({
      medicoCodigo: 'C2',
      paciente: 'Ana Rojas',
      llegada: 'en_sala',
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
    expect(r.data).toMatchObject({ casos: 1, enSala: 1 });
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

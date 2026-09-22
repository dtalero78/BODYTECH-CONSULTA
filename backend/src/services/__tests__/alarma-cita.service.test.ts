// ============================================================================
// La alarma que avisa al grupo de soporte que una cita empezó sin profesional.
//
// Lo que se prueba no es "que avise": es CUÁNDO NO AVISA. Un aviso de más le
// llega a un grupo de gente real y, repetido, se vuelve ruido que nadie mira —
// que es exactamente la falla que esta alarma viene a corregir. Por eso la
// mayoría de los casos son negativos: apagada, sin grupo, cita ya reclamada,
// y el tope de cordura que corta una pasada absurda.
// ============================================================================

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock('../whapi.service', () => ({
  __esModule: true,
  default: { enviarTexto: jest.fn(), configurado: true },
}));

import alarmaCitaService, { construirMensaje, CitaSinCoach } from '../alarma-cita.service';
import postgresService from '../postgres.service';
import whapiService from '../whapi.service';

const query = postgresService.query as jest.Mock;
const enviar = whapiService.enviarTexto as jest.Mock;

const ENV_BASE = {
  ALARMA_CITA_ENABLED: 'true',
  ALARMA_CITA_GRUPO: '120363000000000000@g.us',
  WHAPI_TOKEN: 'tok',
};

let envOriginal: NodeJS.ProcessEnv;

beforeEach(() => {
  envOriginal = process.env;
  process.env = { ...envOriginal, ...ENV_BASE };
  query.mockReset();
  enviar.mockReset();
  enviar.mockResolvedValue({ success: true, messageId: 'wamid.1' });
  (whapiService as unknown as { configurado: boolean }).configurado = true;
});

afterEach(() => {
  process.env = envOriginal;
});

/** Una fila de cita como la devuelve la query de candidatas. */
function fila(over: Record<string, unknown> = {}) {
  return {
    historia_id: 'hc-1',
    medico: 'JMENDEZ',
    medico_nombre: 'Juan Méndez',
    sede_id: 'bdt-nutricion',
    celular: '3001234567',
    hora_cita: '08:00',
    paciente: 'María Restrepo',
    ...over,
  };
}

const cita = (over: Partial<CitaSinCoach> = {}): CitaSinCoach => ({
  historiaId: 'hc-1',
  medico: 'JMENDEZ',
  medicoNombre: 'Juan Méndez',
  sedeId: 'bdt-nutricion',
  horaCita: '08:00',
  paciente: 'María Restrepo',
  celular: null,
  ...over,
});

describe('construirMensaje', () => {
  it('con una sola cita habla en singular y dice hora, profesional y afiliado', () => {
    const m = construirMensaje([cita()]);
    expect(m).toContain('🔴 Cita sin profesional conectado');
    expect(m).toContain('08:00');
    expect(m).toContain('Juan Méndez');
    expect(m).toContain('María Restrepo');
  });

  it('con varias, el título las cuenta', () => {
    const m = construirMensaje([cita(), cita({ historiaId: 'hc-2', horaCita: '08:20' })]);
    expect(m).toContain('🔴 2 citas sin profesional conectado');
    expect(m).toContain('08:20');
  });

  it('resume el exceso en vez de escupir una lista interminable al grupo', () => {
    const muchas = Array.from({ length: 12 }, (_, i) =>
      cita({ historiaId: `hc-${i}`, horaCita: `09:${String(i).padStart(2, '0')}` })
    );
    const m = construirMensaje(muchas);
    expect(m).toContain('🔴 12 citas sin profesional conectado');
    expect(m).toContain('…y 4 citas más.');
  });

  it('sin citas no hay mensaje', () => {
    expect(construirMensaje([])).toBe('');
  });
});

describe('maybeDispatch — cuándo ni siquiera consulta', () => {
  it('apagada: no toca la base', async () => {
    process.env.ALARMA_CITA_ENABLED = 'false';
    await alarmaCitaService.maybeDispatch();
    expect(query).not.toHaveBeenCalled();
    expect(enviar).not.toHaveBeenCalled();
  });

  it('sin grupo configurado no hace nada (el aviso no tendría a dónde ir)', async () => {
    process.env.ALARMA_CITA_GRUPO = '';
    await alarmaCitaService.maybeDispatch();
    expect(query).not.toHaveBeenCalled();
  });

  it('sin token de WHAPI no hace nada', async () => {
    (whapiService as unknown as { configurado: boolean }).configurado = false;
    await alarmaCitaService.maybeDispatch();
    expect(query).not.toHaveBeenCalled();
  });
});

describe('dispatch', () => {
  it('reclama la cita y manda UN mensaje al grupo', async () => {
    query
      .mockResolvedValueOnce([fila()]) // candidatas
      .mockResolvedValueOnce([{ historia_id: 'hc-1' }]) // claim
      .mockResolvedValueOnce([]); // marcarEnviadas

    const r = await alarmaCitaService.dispatch('2026-09-22', {});

    expect(r.alarmadas).toBe(1);
    expect(r.enviado).toBe(true);
    expect(enviar).toHaveBeenCalledTimes(1);
    const [destino, texto] = enviar.mock.calls[0];
    expect(destino).toBe('120363000000000000@g.us');
    expect(texto).toContain('Juan Méndez');
  });

  it('dos citas en la misma pasada van en un solo mensaje, no en dos', async () => {
    query
      .mockResolvedValueOnce([fila(), fila({ historia_id: 'hc-2', hora_cita: '08:20' })])
      .mockResolvedValueOnce([{ historia_id: 'hc-1' }])
      .mockResolvedValueOnce([{ historia_id: 'hc-2' }])
      .mockResolvedValueOnce([]);

    const r = await alarmaCitaService.dispatch('2026-09-22', {});

    expect(r.alarmadas).toBe(2);
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('si el claim no la toma (ya avisada), no se vuelve a avisar', async () => {
    query
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([]); // claim vacío = otra pasada la tiene

    const r = await alarmaCitaService.dispatch('2026-09-22', {});

    expect(r.yaReclamadas).toBe(1);
    expect(r.alarmadas).toBe(0);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('un error de base aborta la pasada en vez de leerse como "nadie faltó"', async () => {
    query.mockResolvedValueOnce(null);
    const r = await alarmaCitaService.dispatch('2026-09-22', {});
    expect(r.abortado).toBe('DB_ERROR');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('una pasada absurda no se envía: es un dato roto, no 50 ausencias', async () => {
    const muchas = Array.from({ length: 41 }, (_, i) => fila({ historia_id: `hc-${i}` }));
    query.mockResolvedValueOnce(muchas);
    const r = await alarmaCitaService.dispatch('2026-09-22', {});
    expect(r.abortado).toBe('TOPE_CORDURA');
    expect(enviar).not.toHaveBeenCalled();
  });

  it('dryRun arma el mensaje pero no reclama ni envía', async () => {
    query.mockResolvedValueOnce([fila()]);
    const r = await alarmaCitaService.dispatch('2026-09-22', { dryRun: true });

    expect(r.alarmadas).toBe(1);
    expect(r.enviado).toBe(false);
    expect(r.mensaje).toContain('08:00');
    expect(query).toHaveBeenCalledTimes(1); // solo la de candidatas
    expect(enviar).not.toHaveBeenCalled();
  });

  it('si WHAPI falla, la cita queda en error y se puede reintentar', async () => {
    enviar.mockResolvedValue({ success: false, error: 'HTTP 401' });
    query
      .mockResolvedValueOnce([fila()])
      .mockResolvedValueOnce([{ historia_id: 'hc-1' }])
      .mockResolvedValueOnce([]); // marcarError

    const r = await alarmaCitaService.dispatch('2026-09-22', {});

    expect(r.enviado).toBe(false);
    expect(r.error).toBe('HTTP 401');
    const ultima = query.mock.calls[query.mock.calls.length - 1][0] as string;
    expect(ultima).toContain("estado = 'error'");
  });
});

// ============================================================================
// La llamada del coach al paciente: lo que se decide sin tocar Twilio.
//
// Casi todo el riesgo está en dos lugares puros: la máquina de estados (los
// webhooks de Twilio llegan repetidos y desordenados) y el TwiML (un atributo
// mal escrito y la llamada se corta sin explicación, o peor: se conecta SIN
// grabar). Por eso se prueban solos, sin red ni base.
// ============================================================================

jest.mock('../postgres.service', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../usuarios.service', () => ({ __esModule: true, default: { findActiveById: jest.fn() } }));
jest.mock('../link-paciente.service', () => ({ __esModule: true, formatCelularE164: jest.fn() }));
jest.mock('../twilio-media.service', () => ({ __esModule: true, descargarGrabacionVozComoBuffer: jest.fn() }));
jest.mock('../openai.service', () => ({ __esModule: true, openai: { audio: { transcriptions: { create: jest.fn() } } } }));
jest.mock('openai', () => ({ __esModule: true, toFile: jest.fn(async (b: Buffer) => b) }));

import postgresService from '../postgres.service';
import { descargarGrabacionVozComoBuffer } from '../twilio-media.service';
import { openai } from '../openai.service';
import llamadasVozService, {
  aplicarEvento,
  identidadCoach,
  esTerminal,
  twimlParaCoach,
  twimlAvisoPaciente,
  twimlDialFin,
  type EstadoLlamada,
} from '../llamadas-voz.service';

describe('aplicarEvento — la máquina de estados', () => {
  // `null` = "no se mueve": así lo consume el servicio (no escribe estado). Acá
  // se encadena igual que allá, conservando el anterior cuando no hay cambio.
  const paso = (e: EstadoLlamada, ev: Parameters<typeof aplicarEvento>[1]) => aplicarEvento(e, ev) ?? e;

  it('sigue el camino feliz de punta a punta', () => {
    let e: EstadoLlamada = 'iniciando';
    e = paso(e, { tipo: 'coach', status: 'ringing' });
    expect(e).toBe('llamando_coach');
    e = paso(e, { tipo: 'coach', status: 'in-progress' });
    expect(e).toBe('llamando_paciente');
    // El "ringing" del paciente llega cuando ya estamos llamándolo: no mueve nada.
    expect(aplicarEvento(e, { tipo: 'paciente', status: 'ringing' })).toBeNull();
    e = paso(e, { tipo: 'paciente', status: 'in-progress' });
    expect(e).toBe('en_llamada');
    e = paso(e, { tipo: 'dial_fin', dialStatus: 'completed' });
    expect(e).toBe('completada');
  });

  it('el coach que no atiende su celular es SU no-respuesta, no del paciente', () => {
    expect(aplicarEvento('llamando_coach', { tipo: 'coach', status: 'no-answer' })).toBe('coach_no_contesto');
    expect(aplicarEvento('llamando_coach', { tipo: 'coach', status: 'busy' })).toBe('coach_no_contesto');
  });

  it('el paciente que no contesta queda como sin_respuesta', () => {
    expect(aplicarEvento('llamando_paciente', { tipo: 'dial_fin', dialStatus: 'no-answer' })).toBe('sin_respuesta');
    expect(aplicarEvento('llamando_paciente', { tipo: 'paciente', status: 'busy' })).toBe('sin_respuesta');
  });

  // Twilio reintenta los webhooks: el mismo evento dos veces no puede mover nada.
  it('un evento repetido no mueve el estado', () => {
    expect(aplicarEvento('llamando_paciente', { tipo: 'coach', status: 'in-progress' })).toBeNull();
    expect(aplicarEvento('en_llamada', { tipo: 'paciente', status: 'in-progress' })).toBeNull();
  });

  it('nada retrocede desde un estado terminal', () => {
    for (const t of ['completada', 'sin_respuesta', 'coach_no_contesto', 'fallida'] as EstadoLlamada[]) {
      expect(aplicarEvento(t, { tipo: 'coach', status: 'ringing' })).toBeNull();
      expect(aplicarEvento(t, { tipo: 'paciente', status: 'in-progress' })).toBeNull();
      expect(aplicarEvento(t, { tipo: 'dial_fin', dialStatus: 'completed' })).toBeNull();
    }
  });

  // Fuera de orden: el "completed" del tramo del coach puede llegar antes que el
  // dial-fin. Si ya estaban hablando, es completada; si no, el paciente no atendió.
  it('un completed del coach cierra bien aunque llegue antes que dial-fin', () => {
    expect(aplicarEvento('en_llamada', { tipo: 'coach', status: 'completed' })).toBe('completada');
    expect(aplicarEvento('llamando_paciente', { tipo: 'coach', status: 'completed' })).toBe('sin_respuesta');
  });

  it('un colgado del paciente durante la llamada es completada, no fallida', () => {
    expect(aplicarEvento('en_llamada', { tipo: 'paciente', status: 'canceled' })).toBe('completada');
    expect(aplicarEvento('en_llamada', { tipo: 'dial_fin', dialStatus: 'failed' })).toBe('completada');
  });

  it('esTerminal reconoce exactamente los cuatro finales', () => {
    expect(['completada', 'sin_respuesta', 'coach_no_contesto', 'fallida'].every(esTerminal)).toBe(true);
    expect(['iniciando', 'llamando_coach', 'llamando_paciente', 'en_llamada'].some(esTerminal)).toBe(false);
  });
});

describe('TwiML', () => {
  const base = 'https://bodytech.app';
  const coach = twimlParaCoach({
    llamadaId: 42,
    pacienteNombre: 'Juan "El Flaco" <Pérez> & Cía',
    pacienteCelular: '+573001234567',
    base,
  });

  it('graba los dos canales desde que contesta el paciente', () => {
    expect(coach).toContain('record="record-from-answer-dual"');
    expect(coach).toContain('recordingStatusCallback="https://bodytech.app/api/twilio/llamadas/42/grabacion"');
  });

  // Sin el aviso NO hay bridge legal: el <Number url> es lo que lo reproduce.
  it('el paciente oye el aviso de grabación antes de que lo unan', () => {
    expect(coach).toContain('<Number url="https://bodytech.app/api/twilio/llamadas/42/aviso"');
    expect(twimlAvisoPaciente({ pacienteNombre: 'Juan' })).toContain('Esta llamada será grabada');
    expect(twimlAvisoPaciente({ pacienteNombre: 'Juan' })).toContain('Hola Juan,');
    expect(twimlAvisoPaciente({ pacienteNombre: '' })).toContain('Hola, te habla');
  });

  it('declara los callbacks de estado y el cierre del Dial', () => {
    expect(coach).toContain('statusCallback="https://bodytech.app/api/twilio/llamadas/42/estado?leg=paciente"');
    expect(coach).toContain('action="https://bodytech.app/api/twilio/llamadas/42/dial-fin"');
    expect(coach).toContain('>+573001234567</Number>');
  });

  // Un nombre con comillas o "&" sin escapar rompe el XML y la llamada muere
  // apenas el coach contesta.
  it('escapa el nombre del paciente en el XML', () => {
    expect(coach).toContain('&quot;El Flaco&quot; &lt;Pérez&gt; &amp; Cía');
    expect(coach).not.toContain('"El Flaco"');
  });

  it('el cierre del Dial le explica al coach qué pasó', () => {
    expect(twimlDialFin('no-answer')).toContain('no contestó');
    expect(twimlDialFin('busy')).toContain('ocupada');
    expect(twimlDialFin('completed')).not.toContain('<Say');
    expect(twimlDialFin('completed')).toContain('<Hangup/>');
  });
});

describe('token de voz (softphone)', () => {
  const envOriginal = process.env;
  const sesion = { kind: 'session', userId: 7, email: 'c@x', nombre: 'Coach', role: 'coach', sedes: [], esGlobal: false } as const;
  afterEach(() => {
    process.env = envOriginal;
  });

  it('sin TwiML App o API Key no emite token', () => {
    process.env = { ...envOriginal, TWILIO_ACCOUNT_SID: 'ACx', TWILIO_API_KEY_SID: 'SKx', TWILIO_API_KEY_SECRET: 's', TWILIO_VOICE_APP_SID: '' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(llamadasVozService.tokenVoz(sesion as any)).toBeNull();
  });

  // El token es lo único que le da al navegador permiso de hablar por Twilio:
  // tiene que ser del coach, solo saliente y atado a la TwiML App de Bodytech.
  it('emite un token solo-saliente, con la identidad del coach y la TwiML App', () => {
    process.env = { ...envOriginal, TWILIO_ACCOUNT_SID: 'ACx', TWILIO_API_KEY_SID: 'SKx', TWILIO_API_KEY_SECRET: 'secreto', TWILIO_VOICE_APP_SID: 'APbodytech' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = llamadasVozService.tokenVoz(sesion as any)!;
    expect(t.identity).toBe('coach-7');
    const payload = JSON.parse(Buffer.from(t.token.split('.')[1], 'base64url').toString());
    expect(payload.grants.identity).toBe('coach-7');
    expect(payload.grants.voice.outgoing.application_sid).toBe('APbodytech');
    expect(payload.grants.voice.incoming).toBeUndefined();
  });

  it('la identidad del coach es estable por usuario', () => {
    expect(identidadCoach(7)).toBe('coach-7');
  });
});

describe('transcribirGrabacion — automática y sin pagar dos veces', () => {
  const query = postgresService.query as jest.Mock;
  const descargar = descargarGrabacionVozComoBuffer as jest.Mock;
  const whisper = openai.audio.transcriptions.create as jest.Mock;
  beforeEach(() => {
    query.mockReset(); descargar.mockReset(); whisper.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('transcribe y guarda el texto en la llamada', async () => {
    query.mockResolvedValueOnce([{ recording_sid: 'RE1' }]).mockResolvedValueOnce([]);
    descargar.mockResolvedValue(Buffer.from('mp3'));
    whisper.mockResolvedValue({ text: ' Hola, te habla Bodytech. ' });
    expect(await llamadasVozService.transcribirGrabacion(5)).toBe(true);
    expect(descargar).toHaveBeenCalledWith('RE1');
    expect(query.mock.calls[1][0]).toContain("transcription_status = 'done'");
    expect(query.mock.calls[1][1]).toEqual([5, 'Hola, te habla Bodytech.']);
  });

  // El claim del UPDATE es lo que evita que el webhook y el barrido paguen
  // Whisper dos veces por la misma grabación.
  it('si otra pasada ya la tomó (o ya está hecha), no descarga ni transcribe', async () => {
    query.mockResolvedValueOnce([]);
    expect(await llamadasVozService.transcribirGrabacion(5)).toBe(false);
    expect(descargar).not.toHaveBeenCalled();
    expect(whisper).not.toHaveBeenCalled();
  });

  it('un fallo de Whisper queda registrado como error, no cuelga la fila en processing', async () => {
    query.mockResolvedValueOnce([{ recording_sid: 'RE1' }]).mockResolvedValueOnce([]);
    descargar.mockResolvedValue(Buffer.from('mp3'));
    whisper.mockRejectedValue(new Error('Whisper caído'));
    expect(await llamadasVozService.transcribirGrabacion(5)).toBe(false);
    expect(query.mock.calls[1][0]).toContain("transcription_status = 'error'");
    expect(query.mock.calls[1][1][1]).toContain('Whisper caído');
  });
});

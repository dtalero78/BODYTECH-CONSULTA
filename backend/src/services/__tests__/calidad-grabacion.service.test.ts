// ============================================================================
// De dónde sale (o no sale) el video de una consulta.
//
// Solo se graba una MUESTRA de consultas (N por coach al mes): el 86% de las
// atendidas no tiene MP4 y nunca lo va a tener. Antes ese caso se devolvía como
// 'processing' —"el video viene en camino"— y la pantalla de Calidad se quedaba
// girando para siempre esperando algo que no existía.
//
// Estos casos fijan la diferencia entre "todavía no está" y "nunca va a estar",
// que es lo único que separa un spinner honesto de uno infinito.
// ============================================================================

jest.mock('../postgres.service', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../llamadas-voz.service', () => ({ __esModule: true, default: { get: jest.fn(), listarPorHistoria: jest.fn() } }));
jest.mock('../twilio.service', () => ({ __esModule: true, default: { getCompositionStatus: jest.fn() } }));
jest.mock('../managed-agents-calidad.service', () => ({ __esModule: true, evaluarConsulta: jest.fn() }));
jest.mock('../openai-calidad.service', () => ({ __esModule: true, evaluarConsultaOpenAI: jest.fn() }));
jest.mock('../openai.service', () => ({ __esModule: true, openai: { audio: { transcriptions: { create: jest.fn() } } } }));
jest.mock('../twilio-media.service', () => ({ __esModule: true, obtenerUrlMediaTwilio: jest.fn(), descargarMp4ComoBuffer: jest.fn(), extraerAudio: jest.fn() }));
jest.mock('../video/chime-recording.service', () => ({ __esModule: true, chimeRecordingService: { getRecordingUrl: jest.fn() } }));
jest.mock('../video/transcribe.service', () => ({ __esModule: true, transcribeService: { getOrStartTranscription: jest.fn() } }));
jest.mock('../video', () => ({ __esModule: true, videoProvider: { name: 'chime' } }));

import calidadService from '../calidad.service';
import postgresService from '../postgres.service';
import { chimeRecordingService } from '../video/chime-recording.service';

const query = postgresService.query as jest.Mock;
const getRecordingUrl = chimeRecordingService.getRecordingUrl as jest.Mock;

/**
 * Fila de HistoriaClinica. Ojo con el orden de los mocks de `query`: las
 * llamadas de voz salen de `llamadasVozService` (mockeado), así que NO consumen
 * un query. La secuencia real es: historia → room_historia_map → video_sessions.
 */
function base(over: Record<string, unknown> = {}) {
  return {
    _id: 'hc-1', primerNombre: 'Dany', primerApellido: 'Ortegon', numeroId: '1020802998',
    empresa: null, fechaConsulta: '2026-09-04', fechaAtencion: '2026-09-04T16:20:00.000Z',
    medico: '52793592', composition_sid: null, transcription_text: 'hola doctor…', ...over,
  };
}

describe('ensureComposition — Chime', () => {
  beforeEach(() => {
    query.mockReset(); getRecordingUrl.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // El caso que colgaba la pantalla: el muestreo la descartó, así que la fila de
  // `chime_recordings` no existe ni va a existir.
  it('una consulta descartada por muestreo devuelve no_recording, no processing', async () => {
    query
      .mockResolvedValueOnce([base()])                      // getSession → HistoriaClinica
      .mockResolvedValueOnce([{ room_name: 'consulta-x' }])  // room_historia_map
      .mockResolvedValueOnce([{ recording_enabled: false, ended_at: null }]); // video_sessions
    getRecordingUrl.mockResolvedValue(null);

    const r = await calidadService.ensureComposition('hc-1');
    expect(r.status).toBe('no_recording');
    expect(r.videoUrl).toBeNull();
  });

  // Sala terminada y sin fila de grabación: la fila se crea AL EMPEZAR a grabar,
  // así que si terminó sin ella, no hubo grabación.
  it('una sala que ya terminó sin grabación también devuelve no_recording', async () => {
    query
      .mockResolvedValueOnce([base()])
      .mockResolvedValueOnce([{ room_name: 'consulta-x' }])
      .mockResolvedValueOnce([{ recording_enabled: true, ended_at: new Date() }]);
    getRecordingUrl.mockResolvedValue(null);

    expect((await calidadService.ensureComposition('hc-1')).status).toBe('no_recording');
  });

  // Lo contrario: sí se está grabando y la llamada sigue viva → esperar es correcto.
  it('una sala viva que sí se está grabando sigue en processing', async () => {
    query
      .mockResolvedValueOnce([base()])
      .mockResolvedValueOnce([{ room_name: 'consulta-x' }])
      .mockResolvedValueOnce([{ recording_enabled: true, ended_at: null }]);
    getRecordingUrl.mockResolvedValue(null);

    expect((await calidadService.ensureComposition('hc-1')).status).toBe('processing');
  });

  it('con el MP4 listo devuelve el link firmado', async () => {
    query
      .mockResolvedValueOnce([base()])
      .mockResolvedValueOnce([{ room_name: 'consulta-x' }]);
    getRecordingUrl.mockResolvedValue({ status: 'ready', url: 'https://s3/video.mp4' });

    const r = await calidadService.ensureComposition('hc-1');
    expect(r).toMatchObject({ status: 'completed', videoUrl: 'https://s3/video.mp4' });
  });
});

describe('getSession — qué material hay para auditar', () => {
  beforeEach(() => {
    query.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  // Es lo que habilita el botón "Analizar" en una consulta sin grabación.
  it('avisa que hay transcripción aunque no haya video', async () => {
    query.mockResolvedValueOnce([base()]);
    const s = await calidadService.getSession('hc-1');
    expect(s).toMatchObject({ found: true, compositionSid: null, tieneTranscripcion: true });
  });

  it('una transcripción vacía no cuenta como material', async () => {
    query.mockResolvedValueOnce([base({ transcription_text: '   ' })]);
    expect((await calidadService.getSession('hc-1')).tieneTranscripcion).toBe(false);
  });
});

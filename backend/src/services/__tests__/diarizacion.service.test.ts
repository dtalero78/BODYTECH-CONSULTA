// ============================================================================
// El diálogo con hablantes separados.
//
// Whisper devuelve un bloque corrido: las dos voces están, pero sin saber quién
// dijo qué. Varios ítems de la rúbrica dependen justamente de eso. Esta vía le
// pasa el MISMO audio a Amazon Transcribe, que sí separa.
//
// Lo que se prueba: que sea BEST-EFFORT de verdad. Corre en paralelo al camino
// clínico (Whisper → autollenado de la historia), así que si S3 o Transcribe
// fallan no puede romper nada ni dejar el audio del paciente colgado en S3.
// ============================================================================

// Los mocks viven FUERA de las factories: `cargar()` hace resetModules para
// releer el bucket del env, y eso vuelve a ejecutar cada factory — una jest.fn()
// creada adentro quedaría huérfana y las aserciones mirarían al espía viejo.
const send = jest.fn();
const query = jest.fn();
const arrancar = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  __esModule: true,
  S3Client: jest.fn(() => ({ send })),
  PutObjectCommand: jest.fn((i) => ({ __cmd: 'Put', ...i })),
  DeleteObjectCommand: jest.fn((i) => ({ __cmd: 'Delete', ...i })),
}));
jest.mock('../postgres.service', () => ({ __esModule: true, default: { query } }));
jest.mock('../video/transcribe.service', () => ({
  __esModule: true,
  transcribeService: { getOrStartFromS3: arrancar },
}));

/**
 * El módulo lee bucket y flag al importarse: hay que setearlos antes del
 * require. Se parte de un env limpio en cada carga — si no, el caso "apagado
 * por env" dejaría DIARIZACION_ENABLED=false para los tests siguientes.
 */
function cargar(env: Record<string, string> = {}) {
  jest.resetModules();
  process.env.RECORDINGS_BUCKET = 'bucket-test';
  process.env.AWS_REGION = 'us-east-1';
  delete process.env.DIARIZACION_ENABLED;
  Object.assign(process.env, env);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../video/diarizacion.service').diarizacionService;
}

const cmds = () => send.mock.calls.map((c) => c[0].__cmd);

describe('diarizacion', () => {
  beforeEach(() => {
    send.mockReset(); query.mockReset(); arrancar.mockReset();
    query.mockResolvedValue([]);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('iniciar', () => {
    it('sube el audio y arranca el job pidiendo 2 hablantes', async () => {
      send.mockResolvedValue({});
      arrancar.mockResolvedValue({ status: 'in_progress' });

      await cargar().iniciar('hc-1', Buffer.from('audio'), 'audio/webm;codecs=opus');

      expect(cmds()).toEqual(['Put']);
      expect(send.mock.calls[0][0]).toMatchObject({ Bucket: 'bucket-test', Key: 'audio-consulta/hc-1.webm' });
      expect(arrancar).toHaveBeenCalledWith('bodytech-dz-hc-1', 's3://bucket-test/audio-consulta/hc-1.webm', 'webm');
      expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['hc-1', 'processing']));
    });

    // El caso más probable en producción: la credencial de DO puede no tener
    // PutObject. No puede tumbar la transcripción de Whisper, que ya corrió.
    it('si S3 rechaza la subida, lo registra y no lanza', async () => {
      send.mockRejectedValue(Object.assign(new Error('Access Denied'), { name: 'AccessDenied' }));

      await expect(
        cargar().iniciar('hc-1', Buffer.from('audio'), 'audio/webm')
      ).resolves.toBeUndefined();

      expect(arrancar).not.toHaveBeenCalled();
      expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['hc-1', 'error']));
    });

    // Si el job no arranca, el audio del paciente no puede quedarse en S3.
    it('si Transcribe rechaza el job, borra el audio que acababa de subir', async () => {
      send.mockResolvedValue({});
      arrancar.mockResolvedValue({ status: 'failed', reason: 'formato inválido' });

      await cargar().iniciar('hc-1', Buffer.from('audio'), 'audio/webm');

      expect(cmds()).toEqual(['Put', 'Delete']);
    });

    it('un mime que Transcribe no acepta no sube nada', async () => {
      await cargar().iniciar('hc-1', Buffer.from('audio'), 'video/x-matroska');
      expect(send).not.toHaveBeenCalled();
    });

    it('apagado por env, no toca S3', async () => {
      await cargar({ DIARIZACION_ENABLED: 'false' }).iniciar('hc-1', Buffer.from('a'), 'audio/webm');
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('procesarPendientes', () => {
    it('guarda el diálogo y borra el audio cuando el job termina', async () => {
      query.mockResolvedValueOnce([{ _id: 'hc-1', key: 'audio-consulta/hc-1.webm' }]).mockResolvedValue([]);
      arrancar.mockResolvedValue({ status: 'completed', transcript: 'Hablante 1: hola\nHablante 2: buenas' });
      send.mockResolvedValue({});

      expect(await cargar().procesarPendientes()).toBe(1);
      expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['hc-1', 'done']));
      expect(query.mock.calls[1][1]).toContain('Hablante 1: hola\nHablante 2: buenas');
      expect(cmds()).toEqual(['Delete']); // el audio es PHI: no se queda
    });

    it('un job en curso no se toca ni se borra su audio', async () => {
      query.mockResolvedValueOnce([{ _id: 'hc-1', key: 'k' }]).mockResolvedValue([]);
      arrancar.mockResolvedValue({ status: 'in_progress' });

      expect(await cargar().procesarPendientes()).toBe(0);
      expect(send).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(1); // solo la lectura
    });

    it('un job fallido queda en error y libera el audio', async () => {
      query.mockResolvedValueOnce([{ _id: 'hc-1', key: 'k' }]).mockResolvedValue([]);
      arrancar.mockResolvedValue({ status: 'failed', reason: 'audio corrupto' });
      send.mockResolvedValue({});

      await cargar().procesarPendientes();
      expect(query.mock.calls[1][1]).toEqual(expect.arrayContaining(['hc-1', 'error']));
      expect(cmds()).toEqual(['Delete']);
    });

    it('una consulta que falla no frena a las siguientes', async () => {
      query.mockResolvedValueOnce([{ _id: 'hc-1', key: 'k1' }, { _id: 'hc-2', key: 'k2' }]).mockResolvedValue([]);
      arrancar
        .mockRejectedValueOnce(new Error('AWS caído'))
        .mockResolvedValueOnce({ status: 'completed', transcript: 'Hablante 1: ok' });
      send.mockResolvedValue({});

      expect(await cargar().procesarPendientes()).toBe(1);
    });
  });
});

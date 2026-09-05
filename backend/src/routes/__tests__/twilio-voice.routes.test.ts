// ============================================================================
// La puerta de /api/twilio.
//
// Acá conviven cosas con permisos muy distintos: iniciar una llamada desde el
// número de Bodytech (clínico), escuchar audio de pacientes (solo auditoría) y
// webhooks que cualquiera podría intentar falsificar (firma de Twilio). Un
// error de una línea en el router abre alguna de esas tres puertas.
// ============================================================================

jest.mock('../../services/llamadas-voz.service', () => ({
  __esModule: true,
  default: {
    iniciar: jest.fn(),
    get: jest.fn(),
    listarPorHistoria: jest.fn(),
    abrirAudio: jest.fn(),
    cerrarHuerfanas: jest.fn().mockResolvedValue(undefined),
    puedeVer: (s: { role: string; userId: number }, l: { coachUsuarioId: number | null }) =>
      s.role === 'admin' || s.role === 'coordinador' || l.coachUsuarioId === s.userId,
    puedeEscuchar: (s: { role: string }) => s.role === 'admin' || s.role === 'coordinador',
    registrarEstadoLeg: jest.fn().mockResolvedValue(undefined),
    registrarDialFin: jest.fn().mockResolvedValue(undefined),
    registrarGrabacion: jest.fn().mockResolvedValue(undefined),
  },
  credencialesVoz: () => ({ accountSid: 'ACtest', authToken: 'token-de-prueba' }),
  baseUrlPublica: () => 'https://bodytech.app',
  twimlParaCoach: () => '<Response/>',
  twimlAvisoPaciente: () => '<Response/>',
  twimlDialFin: () => '<Response/>',
}));
jest.mock('../../services/twilio-voice.service', () => ({
  __esModule: true,
  default: { makeVoiceCall: jest.fn() },
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import twilioVoiceRoutes from '../twilio-voice.routes';
import llamadasVozService from '../../services/llamadas-voz.service';

const svc = llamadasVozService as unknown as Record<string, jest.Mock>;

function appConRol(role?: string, userId = 7) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (role) (req as any).session = { role, userId, sedes: [], esGlobal: true, codigo: 'C1' };
    next();
  });
  app.use('/api/twilio', twilioVoiceRoutes);
  return app;
}

const llamadaDe = (coachUsuarioId: number) => ({
  id: 1, historiaId: 'hc-1', coachUsuarioId, estado: 'completada',
  recordingSid: 'RE1', recordingEstado: 'lista', pacienteCelular: '+573001234567',
});

describe('/api/twilio/llamadas', () => {
  beforeEach(() => {
    svc.iniciar.mockResolvedValue({ ok: true, llamada: llamadaDe(7) });
    svc.get.mockResolvedValue(llamadaDe(7));
    svc.listarPorHistoria.mockResolvedValue([llamadaDe(7)]);
  });

  describe('iniciar', () => {
    it('401 sin sesión: nadie llama desde el número de Bodytech sin entrar', async () => {
      await request(appConRol()).post('/api/twilio/llamadas').send({ historiaId: 'hc-1' }).expect(401);
      expect(svc.iniciar).not.toHaveBeenCalled();
    });

    it('un coach sí puede, y solo manda la cita (los celulares los resuelve el servidor)', async () => {
      const res = await request(appConRol('coach'))
        .post('/api/twilio/llamadas')
        .send({ historiaId: 'hc-1', phone: '+573009999999' })
        .expect(201);
      expect(svc.iniciar.mock.calls[0][0]).toBe('hc-1');
      expect(res.body.llamada.id).toBe(1);
    });

    it('traduce los motivos de rechazo a 409', async () => {
      svc.iniciar.mockResolvedValue({ ok: false, error: 'SIN_CELULAR_COACH' });
      const res = await request(appConRol('coach')).post('/api/twilio/llamadas').send({ historiaId: 'hc-1' }).expect(409);
      expect(res.body.error).toBe('SIN_CELULAR_COACH');
    });
  });

  describe('ver el estado', () => {
    it('el coach ve la suya', async () => {
      await request(appConRol('coach', 7)).get('/api/twilio/llamadas/1').expect(200);
    });

    it('el coach NO ve la de otro (404, sin revelar que existe)', async () => {
      await request(appConRol('coach', 99)).get('/api/twilio/llamadas/1').expect(404);
    });

    it('el coordinador ve cualquiera', async () => {
      await request(appConRol('coordinador', 99)).get('/api/twilio/llamadas/1').expect(200);
    });
  });

  describe('escuchar la grabación', () => {
    it.each(['coach', 'medico'])('403 para %s — ni la propia', async (rol) => {
      await request(appConRol(rol, 7)).get('/api/twilio/llamadas/1/audio').expect(403);
      expect(svc.abrirAudio).not.toHaveBeenCalled();
    });

    it('el historial por historia también es solo de auditoría', async () => {
      await request(appConRol('coach')).get('/api/twilio/llamadas?historiaId=hc-1').expect(403);
      await request(appConRol('admin')).get('/api/twilio/llamadas?historiaId=hc-1').expect(200);
    });
  });

  describe('webhooks de Twilio', () => {
    it.each(['twiml', 'aviso', 'estado', 'dial-fin', 'grabacion'])(
      'POST /llamadas/1/%s sin firma válida → 403 y no toca nada',
      async (hook) => {
        await request(appConRol())
          .post(`/api/twilio/llamadas/1/${hook}`)
          .set('X-Twilio-Signature', 'falsa')
          .type('form')
          .send({ CallStatus: 'completed', RecordingSid: 'RE1' })
          .expect(403);
        expect(svc.registrarEstadoLeg).not.toHaveBeenCalled();
        expect(svc.registrarGrabacion).not.toHaveBeenCalled();
      }
    );
  });

  describe('robot legado', () => {
    it('/voice-call ya no es público', async () => {
      await request(appConRol()).post('/api/twilio/voice-call').send({ phoneNumber: '+57300' }).expect(401);
    });
  });
});

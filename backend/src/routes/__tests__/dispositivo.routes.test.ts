// ============================================================================
// Las puertas de /api/dispositivo: la placa sin vincular, el médico desde su
// panel y la placa vinculada. Lo que se fija acá es quién entra por cada una,
// que la placa solo abra citas agendadas con SU médico, y que una consulta
// ajena o ya cerrada no se pueda tocar.
// ============================================================================

jest.mock('../../services/dispositivo.service', () => ({
  __esModule: true,
  default: {
    iniciarEmparejamiento: jest.fn(),
    confirmarEmparejamiento: jest.fn(),
    reclamar: jest.fn(),
    autenticar: jest.fn(),
    listar: jest.fn(),
    revocar: jest.fn(),
    buscarCitaHoy: jest.fn(),
    historiaDelMedico: jest.fn(),
    visitasAnteriores: jest.fn(),
    armarConsulta: jest.fn(),
    guardarSegmentos: jest.fn(),
    segmentos: jest.fn(),
    transcripcion: jest.fn(),
    borrador: jest.fn(),
    finalizar: jest.fn(),
  },
}));
jest.mock('../../services/transcription.service', () => ({
  __esModule: true,
  default: {},
  crearTokenRealtime: jest.fn(),
}));

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import dispositivoRoutes from '../dispositivo.routes';
import dispositivoService from '../../services/dispositivo.service';
import { crearTokenRealtime } from '../../services/transcription.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc = dispositivoService as any as Record<string, jest.Mock>;

const SESION_MEDICO = {
  kind: 'session',
  userId: 7,
  email: 'medica@bodytech.app',
  nombre: 'Dra. Prueba',
  role: 'medico',
  sedes: ['bsl'],
  esGlobal: false,
  codigo: 'MED-PRUEBA',
  especialidad: null,
};

function app(sesionPanel?: Record<string, unknown>) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (sesionPanel) (req as any).session = sesionPanel;
    next();
  });
  a.use('/api/dispositivo', dispositivoRoutes);
  return a;
}

const TOKEN = 'Bearer dsp_token-de-prueba';

beforeEach(() => {
  jest.clearAllMocks();
  svc.autenticar.mockResolvedValue({ dispositivoId: 3, sesion: SESION_MEDICO });
});

describe('la placa sin vincular', () => {
  it('pide un código', async () => {
    svc.iniciarEmparejamiento.mockResolvedValue({ codigo: 'K7P4QM2X', mostrar: 'K7P4-QM2X', secreto: 's'.repeat(43) });
    const r = await request(app()).post('/api/dispositivo/emparejar');
    expect(r.status).toBe(200);
    expect(r.body.data.mostrar).toBe('K7P4-QM2X');
  });

  it('reclama con el código como lo muestra la pantalla', async () => {
    svc.reclamar.mockResolvedValue({ estado: 'pendiente' });
    const r = await request(app())
      .post('/api/dispositivo/emparejar/reclamar')
      .send({ codigo: 'k7p4-qm2x', secreto: 's'.repeat(43) });
    expect(r.status).toBe(200);
    expect(svc.reclamar).toHaveBeenCalledWith('K7P4QM2X', 's'.repeat(43));
  });

  it('sin secreto no hay reclamo', async () => {
    const r = await request(app()).post('/api/dispositivo/emparejar/reclamar').send({ codigo: 'K7P4QM2X' });
    expect(r.status).toBe(400);
    expect(svc.reclamar).not.toHaveBeenCalled();
  });
});

describe('el médico desde su panel', () => {
  it('sin sesión no vincula', async () => {
    const r = await request(app()).post('/api/dispositivo/vincular').send({ codigo: 'K7P4QM2X' });
    expect(r.status).toBe(401);
  });

  it('una coordinación no vincula: el dispositivo abre consultas a nombre de un médico', async () => {
    const r = await request(app({ ...SESION_MEDICO, role: 'coordinador' }))
      .post('/api/dispositivo/vincular')
      .send({ codigo: 'K7P4QM2X' });
    expect(r.status).toBe(403);
  });

  it('vincula a SU usuario, nunca a uno del cuerpo', async () => {
    svc.confirmarEmparejamiento.mockResolvedValue('ok');
    const r = await request(app(SESION_MEDICO))
      .post('/api/dispositivo/vincular')
      .send({ codigo: 'K7P4-QM2X', usuarioId: 1 });
    expect(r.status).toBe(200);
    expect(svc.confirmarEmparejamiento).toHaveBeenCalledWith('K7P4QM2X', 7);
  });

  it('el código vencido se explica', async () => {
    svc.confirmarEmparejamiento.mockResolvedValue('VENCIDO');
    const r = await request(app(SESION_MEDICO)).post('/api/dispositivo/vincular').send({ codigo: 'K7P4QM2X' });
    expect(r.status).toBe(410);
    expect(r.body.message).toMatch(/venció/);
  });

  it('solo revoca los suyos', async () => {
    svc.revocar.mockResolvedValue(false);
    const r = await request(app(SESION_MEDICO)).delete('/api/dispositivo/mios/99');
    expect(r.status).toBe(404);
    expect(svc.revocar).toHaveBeenCalledWith(99, 7);
  });
});

describe('la placa vinculada', () => {
  it('sin token no entra', async () => {
    const r = await request(app()).post('/api/dispositivo/consulta').send({ cedula: '1023456789' });
    expect(r.status).toBe(401);
    expect(svc.autenticar).not.toHaveBeenCalled();
  });

  it('un JWT del panel no sirve como token de dispositivo', async () => {
    const r = await request(app())
      .post('/api/dispositivo/consulta')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y')
      .send({ cedula: '1023456789' });
    expect(r.status).toBe(401);
  });

  it('un dispositivo revocado no entra', async () => {
    svc.autenticar.mockResolvedValue(null);
    const r = await request(app()).post('/api/dispositivo/consulta').set('Authorization', TOKEN).send({ cedula: '1023456789' });
    expect(r.status).toBe(401);
  });

  it('una cuenta que no es de médico no abre consultas', async () => {
    svc.autenticar.mockResolvedValue({ dispositivoId: 3, sesion: { ...SESION_MEDICO, role: 'coordinador' } });
    const r = await request(app()).post('/api/dispositivo/consulta').set('Authorization', TOKEN).send({ cedula: '1023456789' });
    expect(r.status).toBe(403);
  });

  it('busca la cita de hoy con el código del médico de la placa', async () => {
    svc.buscarCitaHoy.mockResolvedValue({ estado: 'SIN_CITA' });
    const r = await request(app()).post('/api/dispositivo/consulta').set('Authorization', TOKEN).send({ cedula: '1.023.456.789' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('SIN_CITA');
    expect(svc.buscarCitaHoy).toHaveBeenCalledWith('MED-PRUEBA', '1023456789');
  });

  it('con cita, devuelve la consulta armada', async () => {
    svc.buscarCitaHoy.mockResolvedValue({ estado: 'ok', historia: { _id: 'h1' } });
    svc.visitasAnteriores.mockResolvedValue([]);
    svc.armarConsulta.mockReturnValue({ historiaId: 'h1', pasos: [] });
    const r = await request(app()).post('/api/dispositivo/consulta').set('Authorization', TOKEN).send({ cedula: '1023456789' });
    expect(r.status).toBe(200);
    expect(r.body.data.historiaId).toBe('h1');
    expect(svc.armarConsulta).toHaveBeenCalledWith({ _id: 'h1' }, 'umv', []);
  });

  it('una historia de otro médico no se toca', async () => {
    svc.historiaDelMedico.mockResolvedValue(null);
    const r = await request(app())
      .post('/api/dispositivo/consulta/h-ajena/segmentos')
      .set('Authorization', TOKEN)
      .send({ segmentos: [{ seq: 0, paso: 'motivo', texto: 'hola' }] });
    expect(r.status).toBe(404);
    expect(svc.historiaDelMedico).toHaveBeenCalledWith('h-ajena', 'MED-PRUEBA');
    expect(svc.guardarSegmentos).not.toHaveBeenCalled();
  });

  it('una consulta ya cerrada no recibe más', async () => {
    svc.historiaDelMedico.mockResolvedValue({ _id: 'h1', fechaConsulta: new Date() });
    const r = await request(app()).post('/api/dispositivo/consulta/h1/realtime-token').set('Authorization', TOKEN);
    expect(r.status).toBe(409);
    expect(crearTokenRealtime).not.toHaveBeenCalled();
  });

  it('guarda las frases con el dispositivo que las mandó', async () => {
    svc.historiaDelMedico.mockResolvedValue({ _id: 'h1', fechaConsulta: null });
    svc.guardarSegmentos.mockResolvedValue(1);
    const segmentos = [{ seq: 4, paso: 'ant_alergicos', texto: 'Alérgica a la penicilina.' }];
    const r = await request(app()).post('/api/dispositivo/consulta/h1/segmentos').set('Authorization', TOKEN).send({ segmentos });
    expect(r.status).toBe(200);
    expect(svc.guardarSegmentos).toHaveBeenCalledWith('h1', 3, segmentos);
  });

  it('finaliza con los campos que aprobó el médico', async () => {
    const historia = { _id: 'h1', fechaConsulta: null };
    svc.historiaDelMedico.mockResolvedValue(historia);
    svc.segmentos.mockResolvedValue([]);
    svc.transcripcion.mockReturnValue('');
    svc.finalizar.mockResolvedValue({ guardados: ['tas'], omitidos: [] });
    const r = await request(app())
      .post('/api/dispositivo/consulta/h1/finalizar')
      .set('Authorization', TOKEN)
      .send({ campos: { tas: 120 } });
    expect(r.status).toBe(200);
    expect(svc.finalizar).toHaveBeenCalledWith(historia, 'umv', { tas: 120 }, '');
  });
});

// ============================================================================
// Quién puede pedir entrar a una sala de video.
//
// El paciente no tiene cuenta: su link de WhatsApp lo lleva a /patient y de ahí
// pide su token. Esa puerta tiene que seguir abierta. Todo lo demás de una sala
// —entrar como médico, saber qué sala tiene una historia, crearla, cerrarla,
// ver quién está dentro, sacar a alguien, atar la sala a la historia— es del
// profesional y exige sesión. Antes no la exigía: con el nombre de una sala
// (o con el id de una historia, que lo devolvía cualquiera) se entraba al
// consultorio.
//
// Se mockea el controller: lo que se prueba acá es el candado, no lo que hace
// cada endpoint después de pasarlo.
// ============================================================================

jest.mock('../../controllers/video.controller', () => {
  const ok = (_req: unknown, res: { json: (b: unknown) => void }) => res.json({ ok: true });
  return {
    __esModule: true,
    default: new Proxy({}, { get: () => ok }),
  };
});

import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import videoRoutes from '../video.routes';

type Sesion = { role: string };

/** Mini-app con el mismo mount que index.ts y una sesión inyectable. */
function app(sesion?: Sesion) {
  const a = express();
  a.use(express.json());
  a.use((req: Request, _res: Response, next: NextFunction) => {
    if (sesion) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (req as any).session = {
        ...sesion,
        kind: 'session',
        userId: 1,
        email: 'coach@bodytechcorp.com',
        sedes: ['bdt-nutricion'],
        esGlobal: false,
      };
    }
    next();
  });
  a.use('/api/video', videoRoutes);
  return a;
}

const COACH: Sesion = { role: 'coach' };

describe('la puerta de la sala de video', () => {
  it('el paciente pide su token sin cuenta', async () => {
    await request(app())
      .post('/api/video/token')
      .send({ identity: 'Ana', roomName: 'consulta-x1', role: 'patient' })
      .expect(200);
  });

  it('y también quien no manda rol (el link viejo del paciente)', async () => {
    await request(app())
      .post('/api/video/token')
      .send({ identity: 'Ana', roomName: 'consulta-x1' })
      .expect(200);
  });

  it('entrar como médico sin cuenta ya no se puede', async () => {
    await request(app())
      .post('/api/video/token')
      .send({ identity: 'Dr', roomName: 'consulta-x1', role: 'doctor' })
      .expect(401);
  });

  it('con sesión del profesional, sí', async () => {
    await request(app(COACH))
      .post('/api/video/token')
      .send({ identity: 'Dr', roomName: 'consulta-x1', role: 'doctor' })
      .expect(200);
  });

  it('la sala de una historia no se le dice a cualquiera', async () => {
    await request(app()).get('/api/video/room/trepsi_123').expect(401);
    await request(app(COACH)).get('/api/video/room/trepsi_123').expect(200);
  });

  it('crear, mirar y cerrar una sala exige sesión', async () => {
    await request(app()).post('/api/video/rooms').send({ roomName: 'consulta-x1' }).expect(401);
    await request(app()).get('/api/video/rooms/consulta-x1').expect(401);
    await request(app()).post('/api/video/rooms/consulta-x1/end').expect(401);
    await request(app(COACH)).post('/api/video/rooms/consulta-x1/end').expect(200);
  });

  it('ver quién está en la sala, y sacarlo, exige sesión', async () => {
    await request(app()).get('/api/video/rooms/consulta-x1/participants').expect(401);
    await request(app())
      .post('/api/video/rooms/consulta-x1/participants/PA123/disconnect')
      .expect(401);
    await request(app(COACH)).get('/api/video/rooms/consulta-x1/participants').expect(200);
  });

  it('atar la sala a una historia exige sesión', async () => {
    await request(app())
      .post('/api/video/events/session-start')
      .send({ roomName: 'consulta-x1', historiaId: 'trepsi_123' })
      .expect(401);
    await request(app(COACH))
      .post('/api/video/events/session-start')
      .send({ roomName: 'consulta-x1', historiaId: 'trepsi_123' })
      .expect(200);
  });

  it('avisar que alguien entró o salió sigue abierto: lo manda el navegador del paciente', async () => {
    await request(app())
      .post('/api/video/events/participant-connected')
      .send({ roomName: 'consulta-x1', identity: 'Ana', role: 'patient' })
      .expect(200);
    await request(app())
      .post('/api/video/events/participant-disconnected')
      .send({ roomName: 'consulta-x1', identity: 'Ana' })
      .expect(200);
  });
});

// ============================================================================
// "Agendar Cita": a qué unidad va la cita y a quién se le puede agendar.
//
// 29-oct-2026: las citas que una admin global agendaba a coaches de Coach
// Nutrición Trepsi quedaban en la UMV ('bsl'), porque la cita tomaba la unidad
// de QUIEN AGENDA y una cuenta global no tiene ninguna. El coach las veía en su
// panel y el calendario de su unidad no (Wilmer González: 16 vs 5).
// Lo que se fija: la cita va a la unidad del profesional, y una cuenta acotada
// no le agenda a un profesional de otra unidad.
// ============================================================================

jest.mock('../../services/medical-panel.service', () => ({
  __esModule: true,
  default: { createOrden: jest.fn() },
  ORIGENES_AGENDABLES: ['nativa', 'umv', 'corporativo'],
}));
// El controlador arrastra Twilio y la base al cargarse; nada de eso se usa acá.
jest.mock('../../services/link-paciente.service', () => ({
  __esModule: true,
  formatCelularE164: (c: string) => `+57${c}`,
}));
jest.mock('../../services/postgres.service', () => ({ __esModule: true, default: { query: jest.fn() } }));
jest.mock('../../services/calendario.service', () => ({
  __esModule: true,
  default: { resolveSedeMedico: jest.fn(), validarSlotDisponible: jest.fn() },
}));

import { Request, Response } from 'express';
import controller from '../medical-panel.controller';
import medicalPanelService from '../../services/medical-panel.service';
import calendarioService from '../../services/calendario.service';

const createOrden = medicalPanelService.createOrden as jest.Mock;
const resolveSedeMedico = calendarioService.resolveSedeMedico as jest.Mock;
const validarSlot = calendarioService.validarSlotDisponible as jest.Mock;

const BODY = {
  primerNombre: 'Ana',
  primerApellido: 'Pérez',
  numeroId: '123',
  celular: '3001234567',
  medico: 'COACH-TREPSI',
  fechaAtencion: '2026-11-03',
  horaAtencion: '10:20',
};

function req(sesion: { esGlobal: boolean; sedes: string[] }): Request {
  return {
    body: { ...BODY },
    query: {},
    session: { kind: 'session', userId: 24, role: 'admin', email: 'a@b.co', ...sesion },
    sedeScope: sesion.esGlobal ? { all: true } : { all: false, sedes: sesion.sedes },
  } as unknown as Request;
}

function res() {
  const r = { status: jest.fn(), json: jest.fn() };
  r.status.mockReturnValue(r);
  return r as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  validarSlot.mockResolvedValue({ ok: true, status: 200 });
  createOrden.mockResolvedValue({ _id: 'h1' });
});

describe('Agendar Cita — unidad de la cita', () => {
  it('una admin global agenda a un coach de Trepsi → la cita queda en la unidad del coach, no en bsl', async () => {
    resolveSedeMedico.mockResolvedValue('bdt-nutricion');
    const r = res();
    await controller.createOrden(req({ esGlobal: true, sedes: [] }), r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(201);
    expect(createOrden).toHaveBeenCalledWith(expect.objectContaining({ medico: 'COACH-TREPSI' }), 'bdt-nutricion');
  });

  it('si el médico no tiene ficha activa, queda la unidad de quien agenda (como antes)', async () => {
    resolveSedeMedico.mockResolvedValue(null);
    const r = res();
    await controller.createOrden(req({ esGlobal: false, sedes: ['bdt-nutricion'] }), r, jest.fn());
    expect(createOrden).toHaveBeenCalledWith(expect.anything(), 'bdt-nutricion');
  });
});

describe('Agendar Cita — solo profesionales de las unidades propias', () => {
  it('una cuenta de Coach Nutrición Trepsi no le agenda a la UMV: 403 y no crea nada', async () => {
    resolveSedeMedico.mockResolvedValue('bsl');
    const r = res();
    await controller.createOrden(req({ esGlobal: false, sedes: ['bdt-nutricion'] }), r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(403);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'PROFESIONAL_FUERA_DE_ALCANCE' }));
    expect(validarSlot).not.toHaveBeenCalled();
    expect(createOrden).not.toHaveBeenCalled();
  });

  it('la misma cuenta sí le agenda a un coach de su unidad', async () => {
    resolveSedeMedico.mockResolvedValue('bdt-nutricion');
    const r = res();
    await controller.createOrden(req({ esGlobal: false, sedes: ['bdt-nutricion'] }), r, jest.fn());
    expect(r.status).toHaveBeenCalledWith(201);
  });
});

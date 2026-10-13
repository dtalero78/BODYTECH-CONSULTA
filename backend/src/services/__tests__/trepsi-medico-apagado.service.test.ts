// Un profesional apagado no recibe citas de Trepsi. Antes pasaban: la
// validación del cupo lee solo fichas activas y a una apagada la tomaba por
// "médico legacy sin ficha", que no se valida (13-oct-2026: un coach que había
// renunciado tenía 11 citas nuevas).

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock('../mybodytech-enlace.service', () => ({ __esModule: true, default: {} }));
jest.mock('../cupo-claim.service', () => ({ __esModule: true, default: {} }));

import trepsiService from '../trepsi.service';
import postgresService from '../postgres.service';

const query = postgresService.query as jest.Mock;

const cita = {
  citaId: 'cita-1',
  fechaAtencion: '2099-01-01T15:00:00.000Z',
  medico: { codigo: '1013630904', nombre: 'Juan Mendez' },
  historiaClinica: { consentimientoInformado: true },
} as any;

beforeEach(() => query.mockReset());

describe('Trepsi no agenda con un profesional apagado', () => {
  it('rechaza crear la cita si la ficha existe y está apagada', async () => {
    query
      .mockResolvedValueOnce([]) // la cita no existe todavía
      .mockResolvedValueOnce([{ activo: false }]); // ficha apagada
    const r = await trepsiService.createAppointment(cita);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(422);
    expect(r.error?.code).toBe('MEDICO_INACTIVO');
  });

  it('un reenvío de una cita que ya existe sigue devolviendo 200', async () => {
    query.mockResolvedValueOnce([{ cita_id: 'cita-1', historia_id: 'h1', estado: 'scheduled' }]);
    const r = await trepsiService.createAppointment(cita);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });

  it('rechaza mover una cita a un profesional apagado', async () => {
    query
      .mockResolvedValueOnce([{ cita_id: 'cita-1', historia_id: 'h1', estado: 'scheduled' }])
      .mockResolvedValueOnce([{ activo: false }]);
    const r = await trepsiService.reschedule('cita-1', { medico: { codigo: '1013630904' } } as any);
    expect(r.status).toBe(422);
    expect(r.error?.code).toBe('MEDICO_INACTIVO');
  });
});

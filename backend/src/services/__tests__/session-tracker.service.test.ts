// ============================================================================
// La presencia del afiliado: lo que le dice al coach que puede entrar a atender.
//
// El caso que originó esto (7-sep, afiliada de las 7:20): el link llega por
// WhatsApp, se abre en el navegador interno de WhatsApp y a los 40 segundos en
// el navegador de verdad. Son DOS entradas con el mismo nombre. Cuando la
// primera terminó de cerrarse, su salida borró la presencia de la segunda: a la
// coach el aviso se le prendió un segundo y desapareció, con la afiliada
// todavía esperando. Nunca le sonó el aviso de voz ni le quedó el tag.
//
// Estos casos fijan que una salida vieja no pueda apagar una entrada vigente.
// ============================================================================

jest.mock('../video', () => ({
  __esModule: true,
  videoProvider: { startRecording: jest.fn().mockResolvedValue(undefined), endRoom: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../postgres.service', () => ({ __esModule: true, default: { query: jest.fn().mockResolvedValue([]) } }));

import { sessionTracker } from '../session-tracker.service';

const SALA = 'consulta-abc';
const PACIENTE = 'Daniela Gaviria';
const DOC = '1143401261';
const MEDICO = '1024537588';

/** ¿El coach ve al afiliado como presente? Es lo que alimenta el tag y el aviso. */
function presente(sala = SALA): boolean {
  const s = sessionTracker.getActiveSessions().find((x) => x.roomName === sala);
  return !!s?.patientConnected;
}

/** Eventos emitidos al canal del coach. */
let emitidos: Array<{ evento: string; documento?: string }>;

beforeEach(() => {
  emitidos = [];
  const io = {
    to: () => ({
      emit: (evento: string, data: { documento?: string }) => {
        emitidos.push({ evento, documento: data?.documento });
      },
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionTracker.initialize(io as any);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('presencia con dos entradas de la misma persona', () => {
  it('la salida de la entrada vieja NO apaga a quien sigue en la sala', () => {
    const sala = 'consulta-reentrada';
    // 1) Entra desde el navegador de WhatsApp.
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-1');
    expect(presente(sala)).toBe(true);

    // 2) Vuelve a entrar desde su navegador de verdad.
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-2');
    expect(presente(sala)).toBe(true);

    // 3) La pestaña de WhatsApp termina de cerrarse. Antes, esto la borraba.
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-1');
    expect(presente(sala)).toBe(true);

    // Y al coach no se le avisó que se fue.
    expect(emitidos.filter((e) => e.evento === 'patient-disconnected')).toHaveLength(0);
  });

  it('la salida de la entrada vigente sí la apaga', () => {
    const sala = 'consulta-salida-real';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-1');
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-2');

    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-2');

    expect(presente(sala)).toBe(false);
    expect(emitidos.filter((e) => e.evento === 'patient-disconnected')).toHaveLength(1);
  });

  it('volver a entrar después de irse la deja presente otra vez', () => {
    const sala = 'consulta-vuelve';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-1');
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-1');
    expect(presente(sala)).toBe(false);

    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-2');
    expect(presente(sala)).toBe(true);
  });

  // Durante el despliegue conviven pestañas con el bundle viejo, que no manda id.
  it('un navegador sin id se comporta como antes (no rompe)', () => {
    const sala = 'consulta-legacy';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO);
    expect(presente(sala)).toBe(true);
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE);
    expect(presente(sala)).toBe(false);
  });

  it('una salida con id sobre una entrada sin id se aplica (no se ignora de más)', () => {
    const sala = 'consulta-mixta';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO);
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-x');
    expect(presente(sala)).toBe(false);
  });

  // Colgar + beforeunload + cleanup disparan la misma salida 2-3 veces.
  it('la misma salida repetida solo avisa una vez', () => {
    const sala = 'consulta-repetida';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-1');
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-1');
    sessionTracker.trackParticipantDisconnected(sala, PACIENTE, 'conn-1');
    expect(emitidos.filter((e) => e.evento === 'patient-disconnected')).toHaveLength(1);
  });

  it('el coach recibe el aviso de entrada en cada reingreso', () => {
    const sala = 'consulta-avisos';
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-1');
    sessionTracker.trackParticipantConnected(sala, PACIENTE, 'patient', DOC, MEDICO, 'conn-2');
    expect(emitidos.filter((e) => e.evento === 'patient-connected')).toHaveLength(2);
    expect(emitidos[0].documento).toBe(DOC);
  });
});

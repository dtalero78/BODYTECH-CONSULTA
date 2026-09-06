// ============================================================================
// Cómo se arma el diálogo a partir de los dos canales.
//
// Transcribe devuelve palabras sueltas con marca de tiempo, una lista por canal.
// Intercalarlas palabra por palabra parece lo más fiel, pero cuando las dos
// personas hablan encimadas —un "sí", un saludo que se pisa— las frases se
// entreveran y el diálogo queda ilegible:
//   Paciente: Me encanta / Coach: Listo. / Paciente: la que utilizan.
// Eso pasó con una llamada real. Estos casos fijan que cada intervención quede
// entera y en su lugar.
// ============================================================================

jest.mock('./../chime-recording.service', () => ({
  __esModule: true,
  chimeRecordingService: { getRecordingS3Uri: jest.fn() },
}));

import { transcribeService } from '../transcribe.service';

/** Palabra como la devuelve Transcribe. */
const w = (texto: string, t: number, dur = 0.3) => ({
  type: 'pronunciation',
  start_time: String(t),
  end_time: String(t + dur),
  alternatives: [{ content: texto }],
});
const punto = (t: string = '.') => ({ type: 'punctuation', alternatives: [{ content: t }] });

/** Invoca el parser privado con un JSON de Transcribe por canales. */
async function parsear(canal0: any[], canal1: any[]): Promise<string> {
  const data = {
    results: {
      channel_labels: {
        channels: [
          { channel_label: 'ch_0', items: canal0 },
          { channel_label: 'ch_1', items: canal1 },
        ],
      },
      items: [],
      transcripts: [{ transcript: 'plano' }],
    },
  };
  const fetchOriginal = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data }) as never;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (transcribeService as any).fetchTranscript('https://x', {
      ch0: 'Coach',
      ch1: 'Paciente',
    });
  } finally {
    global.fetch = fetchOriginal;
  }
}

describe('diálogo por canales', () => {
  it('cada intervención queda entera, aunque se hablen encima', async () => {
    // El paciente arranca y sigue tras un "Listo" del coach que se le pisa.
    const coach = [w('Listo', 1.0), punto()];
    const paciente = [w('Me', 0.5), w('encanta', 0.8), w('la', 1.1), w('que', 1.3), w('utilizan', 1.5), punto()];

    expect(await parsear(coach, paciente)).toBe(
      'Paciente: Me encanta la que utilizan.\nCoach: Listo.'
    );
  });

  it('los turnos van en el orden en que ocurrieron', async () => {
    const coach = [w('Hola', 0.0), punto(','), w('buenas', 0.5), w('noches', 0.8), punto()];
    const paciente = [w('Buenas', 2.0), w('noches', 2.3), punto()];

    expect(await parsear(coach, paciente)).toBe(
      'Coach: Hola, buenas noches.\nPaciente: Buenas noches.'
    );
  });

  // Un silencio largo dentro del mismo canal separa dos intervenciones.
  it('un silencio corta el turno, pero si nadie interrumpió se vuelve a unir', async () => {
    const coach = [w('Primera', 0.0), punto(), w('Segunda', 5.0), punto()];
    expect(await parsear(coach, [])).toBe('Coach: Primera. Segunda.');
  });

  it('con alguien interrumpiendo en el medio, los turnos no se funden', async () => {
    const coach = [w('Primera', 0.0), punto(), w('Segunda', 5.0), punto()];
    const paciente = [w('Sí', 2.5), punto()];

    expect(await parsear(coach, paciente)).toBe(
      'Coach: Primera.\nPaciente: Sí.\nCoach: Segunda.'
    );
  });

  it('la puntuación se pega a la palabra, sin espacio', async () => {
    const coach = [w('Hola', 0.0), punto('?')];
    expect(await parsear(coach, [])).toBe('Coach: Hola?');
  });

  it('un canal vacío no rompe nada', async () => {
    expect(await parsear([], [])).toBe('');
  });
});

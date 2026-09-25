// ============================================================================
// Quién recibe la plantilla de la UMV y cómo se le escribe la fecha. Una fecha
// mal armada le dice al paciente que su consulta es otro día.
// ============================================================================

import { esCitaUmv, formatFechaCita, textoLinkUmv } from '../unidad-envio.helper';

describe('esCitaUmv', () => {
  it('la UMV son las citas de MyBodytech y las pocas marcadas umv', () => {
    expect(esCitaUmv('mybodytech')).toBe(true);
    expect(esCitaUmv('umv')).toBe(true);
    expect(esCitaUmv(' MyBodytech ')).toBe(true);
  });

  it('Trepsi, corporativo, nativa o vacío siguen con la plantilla de siempre', () => {
    for (const o of ['trepsi', 'corporativo', 'nativa', '', null, undefined]) {
      expect(esCitaUmv(o)).toBe(false);
    }
  });
});

describe('formatFechaCita', () => {
  it('escribe el día de la semana y el mes en castellano', () => {
    expect(formatFechaCita('2026-09-25')).toBe('viernes 25 de septiembre');
    expect(formatFechaCita('2026-09-27')).toBe('domingo 27 de septiembre');
    expect(formatFechaCita('2027-01-01')).toBe('viernes 1 de enero');
  });

  it('una fecha que no existe o mal formada no se inventa', () => {
    expect(formatFechaCita('2026-02-30')).toBeNull();
    expect(formatFechaCita('25/09/2026')).toBeNull();
    expect(formatFechaCita('')).toBeNull();
    expect(formatFechaCita(null)).toBeNull();
  });
});

describe('textoLinkUmv', () => {
  it('es el texto aprobado, con las variables puestas', () => {
    const t = textoLinkUmv({ nombre: 'Ana', fecha: 'viernes 25 de septiembre', hora: '09:00 a. m.', link: 'https://x/y' });
    expect(t.startsWith('Hola, Ana 👋')).toBe(true);
    expect(t).toContain('📅 Fecha: viernes 25 de septiembre\n🕐 Hora: 09:00 a. m.');
    expect(t).toContain('¡Te esperamos!\nUnidad Médica Virtual');
    expect(t.endsWith('Contáctame: https://x/y')).toBe(true);
  });
});

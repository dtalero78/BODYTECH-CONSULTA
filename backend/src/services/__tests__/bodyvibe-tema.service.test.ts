// ============================================================================
// El contraste de las paletas se prueba, no se promete.
//
// Este test es la razón por la que la puerta de apariencia se puede abrir al
// panel médico sin que dé miedo: agregar una paleta ilegible rompe el build,
// no llega a producción y no termina en un médico leyendo mal una tensión
// arterial sobre un gris demasiado claro.
// ============================================================================

import {
  CONTRASTE_MINIMO,
  PALETAS,
  PARES_CONTRASTE,
  contraste,
  verificarContraste,
} from '../bodyvibe-tema.service';

describe('contraste (WCAG 2.1)', () => {
  it('negro sobre blanco da el máximo (21:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('un color contra sí mismo da 1:1', () => {
    expect(contraste('#3f3f46', '#3f3f46')).toBeCloseTo(1, 5);
  });

  it('es simétrico: no importa cuál va de texto y cuál de fondo', () => {
    const a = contraste('#18181b', '#fafaf9');
    const b = contraste('#fafaf9', '#18181b');
    expect(a).toBeCloseTo(b as number, 6);
  });

  it('acepta el hex con o sin numeral', () => {
    expect(contraste('18181b', '#ffffff')).toBeCloseTo(
      contraste('#18181b', '#ffffff') as number,
      6
    );
  });

  it('devuelve null si el color no es un hex de seis dígitos', () => {
    expect(contraste('rojo', '#ffffff')).toBeNull();
    expect(contraste('#fff', '#000000')).toBeNull();
  });
});

describe('todas las paletas preaprobadas son legibles', () => {
  it.each(PALETAS.map((p) => [p.id, p] as const))('%s', (_id, paleta) => {
    expect(verificarContraste(paleta.tokens)).toEqual([]);
  });

  it.each(PALETAS.map((p) => [p.id, p] as const))(
    '%s — cada par supera el mínimo AA',
    (_id, paleta) => {
      for (const [texto, fondo] of PARES_CONTRASTE) {
        const ratio = contraste(paleta.tokens[texto], paleta.tokens[fondo]);
        expect(ratio).not.toBeNull();
        expect(ratio as number).toBeGreaterThanOrEqual(CONTRASTE_MINIMO);
      }
    }
  );

  it('los identificadores no se repiten', () => {
    const ids = PALETAS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('verificarContraste rechaza lo ilegible', () => {
  it('detecta el caso clásico: gris claro sobre blanco', () => {
    const problemas = verificarContraste({
      '--p-text': '#b8b8bd',
      '--p-text-2': '#c9c9ce',
      '--p-surface': '#ffffff',
      '--p-bg': '#ffffff',
    });
    expect(problemas.length).toBeGreaterThan(0);
  });

  it('marca como problema un token que falta', () => {
    const problemas = verificarContraste({ '--p-text': '#000000' });
    expect(problemas.some((p) => p.ratio === null)).toBe(true);
  });
});

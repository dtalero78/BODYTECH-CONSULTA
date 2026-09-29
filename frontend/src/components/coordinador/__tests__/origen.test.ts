import { describe, it, expect } from 'vitest';
import { origenSugerido } from '../origen';

describe('origenSugerido (departamento propuesto al agendar)', () => {
  it('la evaluadora de la UMV (unidad bsl, rol medico) propone UMV', () => {
    expect(origenSugerido({ sedeId: 'bsl', rol: 'medico', especialidad: null })).toBe('umv');
  });
  it('el médico corporativo propone Médico Corporativo, viva donde viva', () => {
    expect(origenSugerido({ sedeId: 'corporativo', rol: 'medico', especialidad: 'Médico Corporativo' })).toBe('corporativo');
    expect(origenSugerido({ sedeId: 'bsl', rol: 'medico', especialidad: 'medico corporativo' })).toBe('corporativo');
  });
  it('un coach de nutrición que vive en bsl NO es UMV', () => {
    expect(origenSugerido({ sedeId: 'bsl', rol: 'coach', especialidad: 'Nutricion Deportiva' })).toBe('nativa');
  });
  it('los coaches de Trepsi siguen en agenda propia', () => {
    expect(origenSugerido({ sedeId: 'bdt-nutricion', rol: 'coach', especialidad: null })).toBe('nativa');
  });
});

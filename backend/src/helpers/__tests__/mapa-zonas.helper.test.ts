import { zonaDe } from '../mapa-zonas.helper';

describe('zonaDe', () => {
  it('una cita de Trepsi va a Coach Nutrición Trepsi, la atienda quien la atienda', () => {
    expect(zonaDe({ esTrepsi: true, rol: 'medico' })).toBe('nutricion-trepsi');
    expect(zonaDe({ esTrepsi: false, origen: 'trepsi' })).toBe('nutricion-trepsi');
  });

  it('el origen corporativo va a Médico Corporativo', () => {
    expect(zonaDe({ esTrepsi: false, origen: 'corporativo', rol: 'medico' })).toBe('corporativo');
  });

  it('sin origen, la especialidad del médico corporativo decide (filas viejas)', () => {
    expect(zonaDe({ esTrepsi: false, origen: '', especialidad: 'Médico Corporativo' })).toBe('corporativo');
  });

  it('con origen, la especialidad no manda', () => {
    expect(zonaDe({ esTrepsi: false, origen: 'umv', especialidad: 'Médico Corporativo' })).toBe('umv');
  });

  it('el origen UMV va a Unidad Médica Virtual', () => {
    expect(zonaDe({ esTrepsi: false, origen: 'UMV', rol: 'coach' })).toBe('umv');
  });

  it('agenda propia o MyBodytech: coach → nutrición, el resto → UMV', () => {
    expect(zonaDe({ esTrepsi: false, origen: 'nativa', rol: 'coach' })).toBe('nutricion-trepsi');
    expect(zonaDe({ esTrepsi: false, origen: 'mybodytech', rol: 'medico' })).toBe('umv');
    expect(zonaDe({ esTrepsi: false, origen: null, rol: null })).toBe('umv');
  });
});

import {
  cumpleHoraOfrecida,
  cumpleProximoDisponible,
  horaColombiaDe,
} from '../cumplimiento-trepsi';

/**
 * Los casos son los reales del 8 y 9 de octubre de 2026, que son los que
 * motivaron la regla. Si el monitor va a decir "cumple" o "no cumple" en
 * pantalla, el veredicto tiene que estar fijado.
 */
describe('cumpleHoraOfrecida', () => {
  it('cumple cuando la hora estaba en la lista', () => {
    const r = cumpleHoraOfrecida('2026-10-09T13:20:00.000Z', ['07:20', '08:20', '09:20']);
    expect(r.cumple).toBe(true);
    expect(r.detalle).toContain('08:20');
  });

  it('NO cumple cuando la hora no estaba — caso Silvia Prieto, 08:00 con Lina', () => {
    // Le dimos la lista sin las 08:00 (las tenía Sofía Moreno) y agendó ahí.
    const r = cumpleHoraOfrecida('2026-10-09T13:00:00.000Z', [
      '07:20', '09:20', '09:40', '10:00', '13:00',
    ]);
    expect(r.cumple).toBe(false);
    expect(r.detalle).toContain('08:00');
    expect(r.detalle).toContain('NO estaban');
  });

  it('NO cumple cuando le dijimos que no había NINGÚN cupo — caso Gabriela Estupiñán', () => {
    const r = cumpleHoraOfrecida('2026-10-09T21:00:00.000Z', []);
    expect(r.cumple).toBe(false);
    expect(r.detalle).toContain('NO tenía ningún cupo');
  });

  it('NO cumple cuando nunca preguntó: agendar sin mirar no es "no se sabe"', () => {
    const r = cumpleHoraOfrecida('2026-10-09T21:00:00.000Z', null);
    expect(r.cumple).toBe(false);
    expect(r.detalle).toContain('Nunca nos consultó');
  });

  it('una fecha ilegible no da veredicto', () => {
    expect(cumpleHoraOfrecida('mañana', ['07:00']).cumple).toBeNull();
  });

  it('da igual el formato de la fecha: Z y -05:00 son la misma hora', () => {
    expect(horaColombiaDe('2026-10-08T21:00:00.000Z')).toBe('16:00');
    expect(horaColombiaDe('2026-10-08T16:00:00-05:00')).toBe('16:00');
  });
});

describe('cumpleProximoDisponible', () => {
  it('no opina cuando el día sí tenía cupos', () => {
    expect(cumpleProximoDisponible({ horariosDisponibles: ['07:00'] })).toBeNull();
  });

  it('cumple si la respuesta vacía trae el siguiente día', () => {
    const r = cumpleProximoDisponible({
      horariosDisponibles: [],
      proximoDisponible: { fecha: '2026-10-09', horariosDisponibles: ['07:20', '09:20'] },
    })!;
    expect(r.cumple).toBe(true);
    expect(r.detalle).toContain('2026-10-09');
  });

  it('NO cumple si la respuesta vacía deja al paciente sin alternativa', () => {
    const r = cumpleProximoDisponible({ horariosDisponibles: [], motivoBloqueo: 'mismo_dia' })!;
    expect(r.cumple).toBe(false);
  });
});

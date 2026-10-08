import { fechaHoraColombia } from '../trepsi.service';

/**
 * De esta conversión depende CUÁL cupo validamos. Trepsi manda `fechaAtencion`
 * en varios formatos (unas veces en Z, otras con el offset de Colombia) y si
 * la hora se corre, la guarda revisaría un cupo distinto del que se va a
 * ocupar: diría "libre" sobre las 11:00 y escribiría la cita a las 16:00.
 */
describe('fechaHoraColombia', () => {
  it('convierte un instante en Z a la hora de Colombia', () => {
    expect(fechaHoraColombia('2026-10-08T21:00:00.000Z')).toEqual({
      fecha: '2026-10-08',
      hora: '16:00',
    });
  });

  it('respeta un offset -05:00 ya escrito', () => {
    expect(fechaHoraColombia('2026-10-08T16:00:00-05:00')).toEqual({
      fecha: '2026-10-08',
      hora: '16:00',
    });
  });

  it('los dos formatos del mismo instante dan el mismo cupo', () => {
    expect(fechaHoraColombia('2026-10-08T21:00:00.000Z')).toEqual(
      fechaHoraColombia('2026-10-08T16:00:00-05:00')
    );
  });

  it('cruza el día hacia atrás cuando el instante UTC es de madrugada', () => {
    // 09-oct 02:00 UTC = 08-oct 21:00 en Colombia: el cupo es del día ANTERIOR.
    expect(fechaHoraColombia('2026-10-09T02:00:00.000Z')).toEqual({
      fecha: '2026-10-08',
      hora: '21:00',
    });
  });

  it('una fecha ilegible no inventa un cupo', () => {
    expect(fechaHoraColombia('no es fecha')).toBeNull();
    // `Date.parse` es laxo y a esta la mide como año 2001: sin la guarda de
    // formato habríamos validado un cupo que nadie pidió.
    expect(fechaHoraColombia('mañana a las 4')).toBeNull();
  });
});

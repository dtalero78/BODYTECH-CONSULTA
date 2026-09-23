// ============================================================================
// Fusión de tramos del tablero de Latidos de Asistencia.
//
// La jornada se abre por (código, sede) y los tramos se buscan solo por
// código: un profesional cuya sesión cambia de sede tenía DOS jornadas en
// paralelo, y la pantalla mostraba el mismo rato dos veces y lo sumaba dos
// veces en "Conectado hoy" (22-sep-2026: un coach con 16 tramos de los cuales
// 3 eran repetidos, y 3h 11m donde había estado 2h 48m).
//
// Lo que NO se puede perder: el hueco. Dos tramos separados, por chico que sea
// el hueco, se dejan como están — mostrar ese hueco es para lo que existe la
// pantalla.
// ============================================================================

import { fusionarTramos, minutosDeTramos } from '../torniquete.service';

const t = (desde: string, hasta: string) => ({ desde, hasta });
const hhmm = (tr: Array<{ desde: string; hasta: string }>) =>
  tr.map((x) => `${x.desde.slice(11, 16)}-${x.hasta.slice(11, 16)}`);

describe('fusionarTramos', () => {
  it('colapsa el tramo duplicado exacto', () => {
    const r = fusionarTramos([
      t('2026-09-22T13:59:00.000Z', '2026-09-22T14:07:00.000Z'),
      t('2026-09-22T13:59:00.000Z', '2026-09-22T14:07:00.000Z'),
    ]);
    expect(hhmm(r)).toEqual(['13:59-14:07']);
  });

  it('fusiona los que se solapan parcialmente y se queda con el final más lejano', () => {
    const r = fusionarTramos([
      t('2026-09-22T13:00:00.000Z', '2026-09-22T13:20:00.000Z'),
      t('2026-09-22T13:10:00.000Z', '2026-09-22T13:45:00.000Z'),
    ]);
    expect(hhmm(r)).toEqual(['13:00-13:45']);
  });

  it('NO fusiona dos tramos separados por un hueco: el hueco es el dato', () => {
    const r = fusionarTramos([
      t('2026-09-22T13:05:00.000Z', '2026-09-22T13:11:00.000Z'),
      t('2026-09-22T16:03:00.000Z', '2026-09-22T17:42:00.000Z'),
    ]);
    expect(hhmm(r)).toEqual(['13:05-13:11', '16:03-17:42']);
  });

  it('ordena aunque lleguen desordenados', () => {
    const r = fusionarTramos([
      t('2026-09-22T16:00:00.000Z', '2026-09-22T16:30:00.000Z'),
      t('2026-09-22T09:00:00.000Z', '2026-09-22T09:10:00.000Z'),
    ]);
    expect(hhmm(r)).toEqual(['09:00-09:10', '16:00-16:30']);
  });

  it('descarta fechas basura en vez de romper el tablero entero', () => {
    const r = fusionarTramos([t('no-es-fecha', 'tampoco'), t('2026-09-22T09:00:00.000Z', '2026-09-22T09:10:00.000Z')]);
    expect(hhmm(r)).toEqual(['09:00-09:10']);
  });

  it('el tramo de menos de un minuto sobrevive: es una entrada real', () => {
    const r = fusionarTramos([t('2026-09-22T13:12:00.000Z', '2026-09-22T13:12:30.000Z')]);
    expect(r).toHaveLength(1);
  });
});

describe('minutosDeTramos', () => {
  it('no cuenta dos veces el rato duplicado', () => {
    const crudos = [
      t('2026-09-22T13:59:00.000Z', '2026-09-22T14:07:00.000Z'),
      t('2026-09-22T13:59:00.000Z', '2026-09-22T14:07:00.000Z'),
      t('2026-09-22T15:05:00.000Z', '2026-09-22T15:12:00.000Z'),
    ];
    expect(minutosDeTramos(crudos)).toBe(23); // 8 + 8 + 7, inflado
    expect(minutosDeTramos(fusionarTramos(crudos))).toBe(15); // 8 + 7, real
  });
});

jest.mock('../postgres.service', () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));

import postgresService from '../postgres.service';
import corporativoSheetService, { ENCABEZADOS, formatCelda, huellaColumnas } from '../corporativo-sheet.service';

describe('corporativo-sheet · formato de celdas', () => {
  it('los booleanos salen como Sí/No, porque la hoja la lee gente', () => {
    expect(formatCelda(true, 'bool')).toBe('Sí');
    expect(formatCelda(false, 'bool')).toBe('No');
  });

  it('acepta las cuatro formas en que la base guarda un positivo', () => {
    // Las columnas de antecedentes se llenaron por vías distintas a lo largo de
    // los años: true booleano, 'true' texto, 'Sí' y 'SI'. Perder una escondería
    // una condición del paciente en la hoja.
    for (const v of [true, 'true', 'Sí', 'SI']) {
      expect(formatCelda(v, 'bool')).toBe('Sí');
    }
  });

  it('un antecedente sin responder queda en blanco, no en "No"', () => {
    // NULL es "nadie lo preguntó"; escribir "No" afirmaría algo que el médico
    // nunca dijo.
    expect(formatCelda(null, 'bool')).toBe('');
    expect(formatCelda(undefined, 'bool')).toBe('');
  });

  it('los números salen como número para que el Sheet pueda promediarlos', () => {
    expect(formatCelda(72, 'numero')).toBe(72);
    expect(formatCelda('72.5', 'numero')).toBe(72.5);
    expect(formatCelda('', 'numero')).toBe('');
    expect(formatCelda('no aplica', 'numero')).toBe('');
  });

  it('las fechas se muestran en hora de Colombia, no en UTC', () => {
    // Producción corre en UTC: un examen de las 20:30 COT del 9-sep es el
    // 10-sep 01:30 UTC. Sin la conversión, la hoja lo pondría al día siguiente.
    expect(formatCelda(new Date('2026-09-10T01:30:00.000Z'), 'fecha')).toBe('2026-09-09 20:30');
    expect(formatCelda(null, 'fecha')).toBe('');
    expect(formatCelda('no es una fecha', 'fecha')).toBe('');
  });

  it('el texto va sin espacios sobrantes', () => {
    expect(formatCelda('  Bancolombia  ', 'texto')).toBe('Bancolombia');
  });
});

describe('corporativo-sheet · encabezados', () => {
  it('historiaId es la primera columna', () => {
    // El Apps Script busca la historia en la columna A para ACTUALIZAR su fila.
    // Moverla de lugar haría que cada cierre agregue una fila nueva.
    expect(ENCABEZADOS[0]).toBe('historiaId');
  });

  it('no hay encabezados repetidos', () => {
    expect(new Set(ENCABEZADOS).size).toBe(ENCABEZADOS.length);
  });

  it('las columnas nuevas van después de las que ya tenía la hoja', () => {
    // La hoja se definió con 135 columnas terminando en Remisión. Una columna
    // insertada antes correría todas las celdas siguientes de las filas ya
    // escritas; por eso lo nuevo solo se agrega al final.
    expect(ENCABEZADOS.indexOf('Remisión')).toBe(134);
    for (const nueva of ['Recomendaciones generales', 'Prescripción · clases grupales', 'Aptitud', 'Riesgo de caídas (Downton)']) {
      expect(ENCABEZADOS.indexOf(nueva)).toBeGreaterThan(134);
    }
  });

  it('lo que necesitan los entrenadores está en la hoja', () => {
    for (const col of ['Prescripción · cardio', 'Prescripción · fuerza', 'Prescripción · flexibilidad', 'Recomendaciones generales', 'Aptitud']) {
      expect(ENCABEZADOS).toContain(col);
    }
  });

  it('la huella cambia si cambia una columna o cómo se calcula', () => {
    // Es lo que dispara el reenvío de las valoraciones ya cerradas. Que cuente
    // también el SQL importa: corregir el cálculo de una columna deja las filas
    // viejas tan desactualizadas como agregar una nueva.
    const base = [{ label: 'Profesional', sql: 'p.a' }];
    expect(huellaColumnas()).toBe(huellaColumnas());
    expect(huellaColumnas(base)).not.toBe(huellaColumnas([{ label: 'Profesional', sql: 'p.b' }]));
    expect(huellaColumnas(base)).not.toBe(huellaColumnas([...base, { label: 'Otra', sql: 'p.a' }]));
  });
});

describe('corporativo-sheet · despacho', () => {
  const query = postgresService.query as jest.Mock;

  beforeEach(() => {
    query.mockReset();
    process.env.CORPORATIVO_SHEET_URL = 'https://ejemplo.invalid/exec';
  });

  afterEach(() => {
    delete process.env.CORPORATIVO_SHEET_URL;
  });

  it('si la base falla al leer la historia, se reintenta — no se marca "la historia ya no existe"', async () => {
    // Así se perdieron todas las valoraciones desde el 9-sep: la consulta de la
    // fila fallaba (`p.nombre` no existe), `query()` devolvía null, y eso se
    // tomaba como historia borrada → `fallido`, sin reintento y con un error
    // que apuntaba a otro lado.
    query
      .mockResolvedValueOnce([{ historia_id: 'h1', intentos: 1 }]) // claim
      .mockResolvedValueOnce(null) // la lectura de la fila: error de base
      .mockResolvedValue([]);

    const r = await corporativoSheetService.despacharPendientes();

    expect(r).toEqual({ enviadas: 0, fallidas: 1 });
    const sqls = query.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes('SET estado = $2'))).toBe(false);
    expect(sqls.some((s) => s.includes("NOW() + ($2 || ' seconds')"))).toBe(true);
  });

  it('una historia que de verdad no existe sí se marca fallida', async () => {
    query
      .mockResolvedValueOnce([{ historia_id: 'h1', intentos: 1 }])
      .mockResolvedValueOnce([]) // la consulta funcionó y no trajo nada
      .mockResolvedValue([]);

    await corporativoSheetService.despacharPendientes();

    const marcado = query.mock.calls.find((c) => String(c[0]).includes('SET estado = $2'));
    expect(marcado?.[1]).toEqual(['h1', 'fallido', 'La historia ya no existe']);
  });
});

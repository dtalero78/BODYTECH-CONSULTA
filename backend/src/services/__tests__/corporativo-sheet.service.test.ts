import { ENCABEZADOS, formatCelda } from '../corporativo-sheet.service';

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
});

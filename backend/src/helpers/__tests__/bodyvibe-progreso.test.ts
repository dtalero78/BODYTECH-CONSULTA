import { leerAvance } from '../bodyvibe-progreso';

/**
 * Lo que se prueba acá es el caso incómodo: texto cortado en cualquier lugar.
 * El streaming no respeta límites de token ni de escape, así que la garantía
 * que importa es que NINGÚN corte lance una excepción ni devuelva basura.
 */
describe('leerAvance', () => {
  it('no devuelve título hasta que la cadena esté cerrada', () => {
    expect(leerAvance('{"titulo": "Citas por se').titulo).toBeNull();
    expect(leerAvance('{"titulo": "Citas por sede",').titulo).toBe('Citas por sede');
  });

  it('decodifica el código a medio escribir', () => {
    const parcial = '{"titulo": "X", "codigo": "const a = 1;\\nconst b = 2;';
    const a = leerAvance(parcial);
    expect(a.cola).toBe('const a = 1;\nconst b = 2;');
    expect(a.lineas).toBe(2);
    expect(a.caracteres).toBe(25);
  });

  it('traduce los escapes de JSON', () => {
    const a = leerAvance('{"codigo": "dice \\"hola\\"\\ty \\\\ fin"');
    expect(a.cola).toBe('dice "hola"\ty \\ fin');
  });

  it('descarta un escape partido al final en vez de romperse', () => {
    expect(leerAvance('{"codigo": "linea\\').cola).toBe('linea');
    expect(leerAvance('{"codigo": "raro \\u00').cola).toBe('raro ');
    expect(leerAvance('{"codigo": "eñe \\u00f1"').cola).toBe('eñe ñ');
  });

  it('recorta la cola pero cuenta el total', () => {
    const largo = 'x'.repeat(5000);
    const a = leerAvance(`{"codigo": "${largo}`);
    expect(a.caracteres).toBe(5000);
    expect(a.cola.length).toBe(1400);
    // Es la COLA: lo último escrito, que es lo que uno quiere ver.
    expect(a.cola).toBe('x'.repeat(1400));
  });

  it('aguanta cualquier punto de corte sin lanzar', () => {
    const completo = JSON.stringify({
      titulo: 'Tablero de citas',
      codigo: 'const r = await bv.q("SELECT 1");\nel.innerHTML = "<b>ok</b>";\n',
      notas: 'Sin novedades.',
    });
    for (let i = 0; i <= completo.length; i++) {
      const a = leerAvance(completo.slice(0, i));
      expect(typeof a.cola).toBe('string');
      expect(a.caracteres).toBeGreaterThanOrEqual(0);
    }
  });

  it('no se confunde si el modelo escribe las claves en otro orden', () => {
    const a = leerAvance('{"codigo": "abc", "titulo": "Después"');
    expect(a.titulo).toBe('Después');
    expect(a.cola).toBe('abc');
  });

  it('con texto vacío o sin las claves devuelve algo usable', () => {
    expect(leerAvance('')).toEqual({ titulo: null, cola: '', lineas: 0, caracteres: 0 });
    expect(leerAvance('{"notas": "nada"}').cola).toBe('');
  });
});

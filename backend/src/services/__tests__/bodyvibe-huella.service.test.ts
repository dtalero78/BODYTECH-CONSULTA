// ============================================================================
// La huella decide qué se republica solo y qué vuelve a aprobación. Si se
// mueve de más, todo pasa por el revisor y la aprobación se vuelve trámite. Si
// se mueve de menos, alguien publica datos que nadie revisó. Las dos fallas son
// silenciosas, así que van con red.
// ============================================================================

import { calcularHuella, requiereAprobacion } from '../bodyvibe-huella.service';

const APP_BASE = `
(async () => {
  const filas = await bv.query(\`
    SELECT sede_id, COUNT(*) AS n
      FROM bv_citas
     WHERE estado = 'ATENDIDA'
     GROUP BY sede_id
  \`);
  bv.el.innerHTML = filas.map(f => '<p>' + f.sede_id + ': ' + f.n + '</p>').join('');
  bv.ready();
})();
`;

describe('calcularHuella', () => {
  it('detecta los estantes que el código consulta', () => {
    expect(calcularHuella(APP_BASE).estantes).toEqual(['bv_citas']);
  });

  it('detecta varios estantes, ordenados y sin repetir', () => {
    const codigo = 'bv.query("SELECT 1 FROM bv_citas"); bv.query("SELECT 2 FROM bv_cobertura"); // bv_citas';
    expect(calcularHuella(codigo).estantes).toEqual(['bv_citas', 'bv_cobertura']);
  });

  it('es estable: el mismo código da la misma huella', () => {
    expect(calcularHuella(APP_BASE).huella).toBe(calcularHuella(APP_BASE).huella);
  });
});

describe('cambios que NO deben volver a aprobación', () => {
  const original = calcularHuella(APP_BASE).huella;

  it('cambiar los textos que se muestran', () => {
    const nuevo = APP_BASE.replace("': ' + f.n", "' → ' + f.n + ' citas'");
    expect(calcularHuella(nuevo).huella).toBe(original);
  });

  it('cambiar la sangría o los saltos de línea del SQL', () => {
    const nuevo = APP_BASE.replace(/\s+FROM bv_citas/, '\n\n        FROM   bv_citas');
    expect(calcularHuella(nuevo).huella).toBe(original);
  });

  it('agregar estilos y clases', () => {
    const nuevo = APP_BASE.replace("'<p>'", "'<p class=\"bv-tarjeta\" style=\"color:red\">'");
    expect(calcularHuella(nuevo).huella).toBe(original);
  });
});

describe('cambios que SÍ deben volver a aprobación', () => {
  const original = calcularHuella(APP_BASE).huella;

  it('agregar una columna al SELECT', () => {
    const nuevo = APP_BASE.replace('SELECT sede_id, COUNT(*) AS n', 'SELECT sede_id, paciente_celular, COUNT(*) AS n');
    expect(calcularHuella(nuevo).huella).not.toBe(original);
  });

  it('cambiar el filtro', () => {
    const nuevo = APP_BASE.replace("estado = 'ATENDIDA'", "estado <> 'ATENDIDA'");
    expect(calcularHuella(nuevo).huella).not.toBe(original);
  });

  it('consultar otro estante', () => {
    const nuevo = APP_BASE.replace('bv_citas', 'bv_jornada');
    expect(calcularHuella(nuevo).huella).not.toBe(original);
  });

  it('agregar una segunda consulta', () => {
    const nuevo = APP_BASE + '\nbv.query("SELECT codigo FROM bv_profesionales");';
    expect(calcularHuella(nuevo).huella).not.toBe(original);
  });
});

describe('requiereAprobacion', () => {
  const aprobada = { huella: 'abc', alcance: 'sede', roles: ['coordinador'], sedes: ['bsl'] };

  it('la primera publicación siempre pasa por aprobación', () => {
    const r = requiereAprobacion(null, { huella: 'abc', alcance: 'sede', roles: [], sedes: [] });
    expect(r.requiere).toBe(true);
  });

  it('sin cambios, se republica solo', () => {
    const r = requiereAprobacion(aprobada, { ...aprobada, huella: 'abc' });
    expect(r.requiere).toBe(false);
  });

  it('el orden de los roles no cuenta como cambio', () => {
    const r = requiereAprobacion(
      { ...aprobada, roles: ['coordinador', 'medico'] },
      { ...aprobada, roles: ['medico', 'coordinador'] }
    );
    expect(r.requiere).toBe(false);
  });

  it('cambiar los datos vuelve a aprobación', () => {
    const r = requiereAprobacion(aprobada, { ...aprobada, huella: 'otra' });
    expect(r.requiere).toBe(true);
    expect(r.motivo).toMatch(/datos/i);
  });

  it('ampliar la audiencia vuelve a aprobación', () => {
    const r = requiereAprobacion(aprobada, { ...aprobada, roles: ['coordinador', 'medico'] });
    expect(r.requiere).toBe(true);
    expect(r.motivo).toMatch(/quién/i);
  });

  it('pasar de sede a global vuelve a aprobación', () => {
    const r = requiereAprobacion(aprobada, { ...aprobada, alcance: 'global' });
    expect(r.requiere).toBe(true);
    expect(r.motivo).toMatch(/alcance/i);
  });
});

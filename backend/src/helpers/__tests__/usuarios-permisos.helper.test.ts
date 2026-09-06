import {
  revisarAlta,
  revisarEdicion,
  visibleEnListado,
  puedeDarDeBaja,
  Actor,
  Destino,
} from '../usuarios-permisos.helper';

const admin: Actor = { role: 'admin', email: 'admin@bodytech.com', sedes: [] };
const coord: Actor = { role: 'coordinador', email: 'coord@bodytech.com', sedes: ['chapinero', 'colina'] };

const enSuAlcance: Destino = { email: 'ana@bodytech.com', rolConsulta: 'coach', sedes: ['chapinero'] };

describe('revisarAlta', () => {
  it('un admin crea en cualquier aplicación', () => {
    expect(revisarAlta(admin, { app: 'acc', rol: 'fisioterapeuta' })).toBeNull();
    expect(revisarAlta(admin, { app: 'prepagadas', rol: 'asesor' })).toBeNull();
  });

  it('un coordinador NO crea fuera de Consulta', () => {
    expect(revisarAlta(coord, { app: 'acc', rol: 'fisioterapeuta' })?.code).toBe('FORBIDDEN');
    expect(revisarAlta(coord, { app: 'prepagadas', rol: 'admin' })?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO crea admins ni coordinadores', () => {
    for (const rol of ['admin', 'coordinador', 'torre']) {
      expect(revisarAlta(coord, { app: 'consulta', rol, sedes: ['chapinero'] })?.code).toBe('FORBIDDEN');
    }
  });

  it('un coordinador NO marca acceso a todas las sedes', () => {
    expect(revisarAlta(coord, { app: 'consulta', rol: 'auxiliar', esGlobal: true })?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO asigna sedes ajenas', () => {
    const r = revisarAlta(coord, { app: 'consulta', rol: 'auxiliar', sedes: ['chapinero', 'cedritos'] });
    expect(r?.code).toBe('FORBIDDEN');
    expect(r?.message).toMatch(/fuera de tu alcance/);
  });

  it('un coordinador crea un auxiliar en su propia sede', () => {
    expect(revisarAlta(coord, { app: 'consulta', rol: 'auxiliar', sedes: ['colina'] })).toBeNull();
  });

  // Estas dos NO son de privilegio: son de que la cuenta sirva.
  it('un médico o coach sin ficha se rechaza, aunque lo cree un admin', () => {
    expect(revisarAlta(admin, { app: 'consulta', rol: 'medico', sedes: ['x'] })?.code).toBe(
      'PROFESIONAL_REQUERIDO',
    );
    expect(revisarAlta(admin, { app: 'consulta', rol: 'coach', sedes: ['x'] })?.code).toBe(
      'PROFESIONAL_REQUERIDO',
    );
    expect(
      revisarAlta(admin, { app: 'consulta', rol: 'coach', sedes: ['x'], profesionalId: 7 }),
    ).toBeNull();
  });

  it('un usuario de Consulta sin sedes se rechaza; con acceso global no', () => {
    expect(revisarAlta(admin, { app: 'consulta', rol: 'auxiliar', sedes: [] })?.code).toBe(
      'SEDES_REQUERIDAS',
    );
    expect(revisarAlta(admin, { app: 'consulta', rol: 'auxiliar', esGlobal: true })).toBeNull();
  });

  it('las otras aplicaciones no exigen sedes ni ficha', () => {
    expect(revisarAlta(admin, { app: 'acc', rol: 'admin', sedes: [] })).toBeNull();
  });
});

describe('revisarEdicion', () => {
  it('nadie se inhabilita a sí mismo, ni siquiera un admin', () => {
    const yo: Destino = { email: 'ADMIN@bodytech.com', rolConsulta: 'admin', sedes: [] };
    expect(revisarEdicion(admin, yo, { activo: false })?.message).toMatch(/tu propia cuenta/);
  });

  it('inhabilitar a otro sí se puede', () => {
    expect(revisarEdicion(admin, enSuAlcance, { activo: false })).toBeNull();
  });

  it('un coordinador edita a quien cae en su alcance', () => {
    expect(revisarEdicion(coord, enSuAlcance, { rol: 'coach', sedes: ['chapinero'] })).toBeNull();
  });

  it('un coordinador NO toca a un admin', () => {
    const jefe: Destino = { email: 'j@bodytech.com', rolConsulta: 'admin', sedes: ['chapinero'] };
    expect(revisarEdicion(coord, jefe, {})?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO toca a alguien de una sede ajena', () => {
    const ajeno: Destino = { email: 'x@bodytech.com', rolConsulta: 'coach', sedes: ['cedritos'] };
    expect(revisarEdicion(coord, ajeno, {})?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO toca a alguien que sólo existe en otra aplicación', () => {
    const soloAcc: Destino = { email: 'f@bodytech.com', rolConsulta: null, sedes: [] };
    expect(revisarEdicion(coord, soloAcc, {})?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO asciende a nadie a admin', () => {
    expect(revisarEdicion(coord, enSuAlcance, { rol: 'admin' })?.code).toBe('FORBIDDEN');
    expect(revisarEdicion(coord, enSuAlcance, { rol: 'coordinador' })?.code).toBe('FORBIDDEN');
    expect(revisarEdicion(coord, enSuAlcance, { rol: 'medico' })).toBeNull();
  });

  it('un coordinador NO mueve a nadie a otra aplicación', () => {
    expect(revisarEdicion(coord, enSuAlcance, { app: 'acc', rol: 'admin' })?.code).toBe('FORBIDDEN');
  });

  it('un coordinador NO reparte sedes ajenas al editar', () => {
    expect(revisarEdicion(coord, enSuAlcance, { sedes: ['cedritos'] })?.code).toBe('FORBIDDEN');
    expect(revisarEdicion(coord, enSuAlcance, { sedes: ['colina'] })).toBeNull();
  });

  it('un coordinador NO marca acceso a todas las sedes', () => {
    expect(revisarEdicion(coord, enSuAlcance, { esGlobal: true })?.code).toBe('FORBIDDEN');
  });
});

describe('visibleEnListado', () => {
  it('el admin ve a todos', () => {
    expect(visibleEnListado(admin, { email: 'a@b.c', rolConsulta: null, sedes: [] })).toBe(true);
  });

  it('el coordinador ve sólo lo que puede gestionar', () => {
    expect(visibleEnListado(coord, enSuAlcance)).toBe(true);
    expect(visibleEnListado(coord, { email: 'a@b.c', rolConsulta: 'admin', sedes: ['chapinero'] })).toBe(false);
    expect(visibleEnListado(coord, { email: 'a@b.c', rolConsulta: 'coach', sedes: ['cedritos'] })).toBe(false);
    // Sólo de ACC: no aparece.
    expect(visibleEnListado(coord, { email: 'a@b.c', rolConsulta: null, sedes: [] })).toBe(false);
    // Sin sedes no hay forma de saber si cae en su alcance.
    expect(visibleEnListado(coord, { email: 'a@b.c', rolConsulta: 'coach', sedes: [] })).toBe(false);
  });
});

describe('puedeDarDeBaja', () => {
  it('sólo el admin: la baja saca de las tres aplicaciones', () => {
    expect(puedeDarDeBaja(admin)).toBe(true);
    expect(puedeDarDeBaja(coord)).toBe(false);
    expect(puedeDarDeBaja(null)).toBe(false);
  });
});

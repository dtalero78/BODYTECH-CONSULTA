import { describe, it, expect } from 'vitest';
import {
  PERFILES,
  perfilPorId,
  pideSedes,
  resumenAlta,
  tieneAgenda,
  ROLES_APP,
} from '../perfilesAlta';

describe('perfiles de alta', () => {
  it('cada perfil propone un rol válido para su aplicación', () => {
    for (const p of PERFILES) {
      if (!p.preset.app) continue;
      expect(ROLES_APP[p.preset.app]).toContain(p.preset.rolApp);
    }
  });

  it('solo médicos y coaches tienen agenda, y son los únicos con sede de ficha', () => {
    for (const p of PERFILES) {
      if (p.preset.sedeFicha) expect(tieneAgenda(p.preset.rolFicha)).toBe(true);
    }
    expect(tieneAgenda('coach')).toBe(true);
    expect(tieneAgenda('administrativo')).toBe(false);
  });

  it('el coach de nutrición queda completo sin preguntar nada más', () => {
    const p = perfilPorId('coach-nutricion').preset;
    expect(p).toMatchObject({
      rolFicha: 'coach',
      app: 'consulta',
      rolApp: 'coach',
      programas: ['trepsi'],
      sedeFicha: 'bdt-nutricion',
    });
    expect(pideSedes(p)).toBe(false);
  });

  it('a la coordinación hay que preguntarle las sedes; al administrador no', () => {
    expect(pideSedes(perfilPorId('coordinacion').preset)).toBe(true);
    expect(pideSedes(perfilPorId('admin').preset)).toBe(false);
  });

  it('a quien entra a ACC no se le preguntan sedes de Consulta', () => {
    expect(pideSedes(perfilPorId('acc').preset)).toBe(false);
  });

  it('el resumen dice en castellano qué va a poder hacer', () => {
    const lineas = resumenAlta(perfilPorId('medico-corporativo').preset, {
      nombre: 'Ingrith Ortiz',
      correo: 'ingrith@bodytechcorp.com',
      sedesElegidas: ['Médico Corporativo'],
      codigo: 'MED-CORP-001',
    });
    expect(lineas[0]).toContain('entra a Consulta');
    expect(lineas.join(' ')).toContain('agenda propia');
    expect(lineas.join(' ')).toContain('Corporativo');
  });

  it('sin correo, el resumen avisa que queda sin cuenta', () => {
    const lineas = resumenAlta(perfilPorId('coach-nutricion').preset, {
      nombre: 'Ana Navas',
      correo: '',
      sedesElegidas: [],
      codigo: '123',
    });
    expect(lineas[0]).toContain('sin cuenta');
  });
});

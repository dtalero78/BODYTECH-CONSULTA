// ============================================================================
// Las reglas del agendamiento de la UMV (agenda-umv.helper), fijadas.
// ============================================================================

import {
  agendaUmvActiva,
  celularHabilitadoUmv,
  codigosEquipoUmv,
  dentroDeHorarioEnvio,
  elegirProfesional,
  textoInvitacionUmv,
  unirCupos,
} from '../agenda-umv.helper';

describe('agendaUmvActiva', () => {
  it('necesita el interruptor Y la plantilla: sin plantilla nadie recibiría el botón', () => {
    expect(agendaUmvActiva({ UMV_AGENDA_ENABLED: 'true' } as any)).toBe(false);
    expect(agendaUmvActiva({ TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID: 'HX1' } as any)).toBe(false);
    expect(
      agendaUmvActiva({ UMV_AGENDA_ENABLED: 'true', TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID: 'HX1' } as any)
    ).toBe(true);
    expect(
      agendaUmvActiva({ UMV_AGENDA_ENABLED: '1', TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID: ' ' } as any)
    ).toBe(false);
  });
});

describe('codigosEquipoUmv', () => {
  it('lee el CSV sin espacios ni vacíos', () => {
    expect(codigosEquipoUmv({ UMV_AGENDA_PROFESIONALES: ' KAREN, 52887191 ,,' } as any)).toEqual([
      'KAREN',
      '52887191',
    ]);
  });
  it('sin variable, lista vacía (= regla por defecto del servicio)', () => {
    expect(codigosEquipoUmv({} as any)).toEqual([]);
  });
});

describe('dentroDeHorarioEnvio', () => {
  it('por defecto de 07:00 a 20:00 Colombia', () => {
    expect(dentroDeHorarioEnvio(6 * 60 + 59, {} as any)).toBe(false);
    expect(dentroDeHorarioEnvio(7 * 60, {} as any)).toBe(true);
    expect(dentroDeHorarioEnvio(19 * 60 + 59, {} as any)).toBe(true);
    expect(dentroDeHorarioEnvio(20 * 60, {} as any)).toBe(false);
  });
  it('respeta la franja configurada, y un valor mal escrito cae al default', () => {
    const env = { UMV_AGENDA_HORA_DESDE: '08:30', UMV_AGENDA_HORA_HASTA: 'nueve' } as any;
    expect(dentroDeHorarioEnvio(8 * 60 + 29, env)).toBe(false);
    expect(dentroDeHorarioEnvio(8 * 60 + 30, env)).toBe(true);
    expect(dentroDeHorarioEnvio(20 * 60, env)).toBe(false);
  });
});

describe('unirCupos', () => {
  it('una hora aparece si al menos uno la tiene libre, sin repetir y en orden', () => {
    expect(
      unirCupos([
        { codigo: 'A', libres: ['09:00', '08:00'] },
        { codigo: 'B', libres: ['08:00', '10:00'] },
        { codigo: 'C', libres: [] },
      ])
    ).toEqual(['08:00', '09:00', '10:00']);
  });
});

describe('elegirProfesional', () => {
  it('le toca al que menos citas tiene ese día', () => {
    expect(
      elegirProfesional([
        { codigo: 'A', citasDelDia: 5 },
        { codigo: 'B', citasDelDia: 2 },
        { codigo: 'C', citasDelDia: 3 },
      ])
    ).toBe('B');
  });
  it('el empate se rompe por código, así es estable', () => {
    expect(
      elegirProfesional([
        { codigo: 'Z', citasDelDia: 1 },
        { codigo: 'M', citasDelDia: 1 },
      ])
    ).toBe('M');
  });
  it('sin candidatos, nadie', () => {
    expect(elegirProfesional([])).toBeNull();
  });
});

describe('textoInvitacionUmv', () => {
  it('lleva el nombre y el link del botón al final', () => {
    const t = textoInvitacionUmv({ nombre: 'Ana', link: 'https://bodytech.app/agendar/abc' });
    expect(t.startsWith('¡Hola Ana! Ahora eres parte de Bodytech.')).toBe(true);
    expect(t).toContain('fisioterapia');
    expect(t.endsWith('https://bodytech.app/agendar/abc')).toBe(true);
  });
});

describe('celularHabilitadoUmv (modo pruebas)', () => {
  it('sin lista no le escribe a NADIE: olvidarse la variable nunca llega a un paciente real', () => {
    expect(celularHabilitadoUmv('3001234567', {} as any)).toBe(false);
    expect(celularHabilitadoUmv('3001234567', { UMV_SOLO_CELULARES: ' ' } as any)).toBe(false);
  });
  it('solo los de la lista, en cualquier formato', () => {
    const env = { UMV_SOLO_CELULARES: '+57 300 123 4567, 573009998877' } as any;
    expect(celularHabilitadoUmv('3001234567', env)).toBe(true);
    expect(celularHabilitadoUmv('+573009998877', env)).toBe(true);
    expect(celularHabilitadoUmv('3005550000', env)).toBe(false);
    expect(celularHabilitadoUmv(null, env)).toBe(false);
  });
  it('"*" lo abre a todos, y solo a propósito', () => {
    expect(celularHabilitadoUmv('3005550000', { UMV_SOLO_CELULARES: '*' } as any)).toBe(true);
  });
});

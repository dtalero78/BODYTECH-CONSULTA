// ============================================================================
// La regla que decide desde qué número de WhatsApp se le escribe a un paciente.
// Un error acá no rompe nada visible: simplemente a un paciente de Athletic le
// escribe Bodytech, o al revés.
// ============================================================================

import {
  ATHLETIC_WHATSAPP_FROM_DEFAULT,
  athleticActivo,
  marcaDeCodEmpresa,
  marcaDeEnvio,
  whatsappFromDeMarca,
} from '../marca.helper';

/** Athletic encendido y con su usuario de plataforma: lo mínimo para usarlo. */
const ENCENDIDO = {
  ATHLETIC_WHATSAPP_ENABLED: 'true',
  ATHLETIC_PLATAFORMA_USER: 'athletic@bodytech.app',
  ATHLETIC_PLATAFORMA_PASS: 'x',
};

describe('marcaDeCodEmpresa', () => {
  // Los valores que manda Trepsi, más lo que dejan los demás orígenes.
  it.each([
    ['ATHLETIC', 'athletic'],
    ['athletic', 'athletic'],
    ['  Athletic ', 'athletic'],
    ['BODYTECH-COLOMBIA', 'bodytech'],
    ['', 'bodytech'],
    [null, 'bodytech'],
    [undefined, 'bodytech'],
    // Empresas legacy que también viven en codEmpresa: no son Athletic.
    ['PARTICULAR', 'bodytech'],
    ['ATHLETIC-GYM', 'bodytech'],
  ])('%p → %s', (cod, esperado) => {
    expect(marcaDeCodEmpresa(cod as string | null | undefined)).toBe(esperado);
  });
});

describe('athleticActivo', () => {
  it('apagado por defecto: desplegar el código no cambia nada', () => {
    expect(athleticActivo({})).toBe(false);
  });

  it('encendido con la bandera y el usuario de la plataforma', () => {
    expect(athleticActivo(ENCENDIDO)).toBe(true);
  });

  it("solo 'true' enciende: '1', 'TRUE' o 'si' no", () => {
    for (const v of ['1', 'TRUE', 'si', 'yes']) {
      expect(athleticActivo({ ...ENCENDIDO, ATHLETIC_WHATSAPP_ENABLED: v })).toBe(false);
    }
  });

  // Sin usuario, cada paciente de Athletic caería a Twilio, y el worker de
  // link-auto apagaría la plataforma también para los de Bodytech.
  it('sin usuario de la plataforma queda apagado aunque la bandera diga true', () => {
    expect(athleticActivo({ ...ENCENDIDO, ATHLETIC_PLATAFORMA_USER: '' })).toBe(false);
    expect(athleticActivo({ ...ENCENDIDO, ATHLETIC_PLATAFORMA_PASS: undefined })).toBe(false);
  });
});

describe('marcaDeEnvio', () => {
  it('un paciente de Athletic sale por Athletic cuando su canal está encendido', () => {
    expect(marcaDeEnvio('ATHLETIC', ENCENDIDO)).toBe('athletic');
  });

  it('con Athletic apagado, sus pacientes salen por Bodytech — como antes', () => {
    expect(marcaDeEnvio('ATHLETIC', {})).toBe('bodytech');
  });

  it('un paciente de Bodytech sale por Bodytech siempre', () => {
    expect(marcaDeEnvio('BODYTECH-COLOMBIA', ENCENDIDO)).toBe('bodytech');
    expect(marcaDeEnvio(null, ENCENDIDO)).toBe('bodytech');
  });
});

describe('whatsappFromDeMarca', () => {
  it('Bodytech no fuerza número: whatsapp.service usa el suyo de siempre', () => {
    expect(whatsappFromDeMarca('bodytech', ENCENDIDO)).toBeUndefined();
  });

  it('Athletic sale por +1 505 587-1860 salvo que el entorno diga otro', () => {
    expect(whatsappFromDeMarca('athletic', {})).toBe('whatsapp:+15055871860');
    expect(ATHLETIC_WHATSAPP_FROM_DEFAULT).toBe('whatsapp:+15055871860');
    expect(whatsappFromDeMarca('athletic', { ATHLETIC_WHATSAPP_FROM: 'whatsapp:+10000000000' })).toBe(
      'whatsapp:+10000000000'
    );
  });
});

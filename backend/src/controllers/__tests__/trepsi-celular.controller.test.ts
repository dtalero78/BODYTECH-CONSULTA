/**
 * La regla del celular tiene que poder prenderse SIN desplegar: el cambio sale
 * coordinado con Trepsi —su app sube su mínimo primero— y al revés
 * rechazaríamos citas que su pantalla todavía deja pasar.
 */
const reglaActual = () =>
  process.env.TREPSI_CELULAR_MIN_10 === 'true' || process.env.TREPSI_CELULAR_MIN_10 === '1'
    ? /^\+\d{10,15}$/
    : /^\+\d{8,15}$/;

/** El mismo preprocesado del esquema: el móvil colombiano local lleva +57. */
const normalizar = (v: string) => {
  const clean = v.replace(/\s+/g, '').trim();
  return /^3\d{9}$/.test(clean) ? `+57${clean}` : clean;
};

const acepta = (v: string) => reglaActual().test(normalizar(v));

describe('celular que llega de Trepsi', () => {
  const previo = { ...process.env };
  afterEach(() => { process.env = { ...previo }; });

  describe('con la regla vieja (8 dígitos)', () => {
    beforeEach(() => { delete process.env.TREPSI_CELULAR_MIN_10; });

    it('deja pasar un número de 9 dígitos que después NO se puede contactar', () => {
      // Éste es el caso que motivó el cambio: la cita se crea y el WhatsApp
      // nunca se entrega, así que el paciente no se entera de nada.
      expect(acepta('+572272823')).toBe(true);
    });
  });

  describe('con la regla nueva (10 dígitos)', () => {
    beforeEach(() => { process.env.TREPSI_CELULAR_MIN_10 = 'true'; });

    it('rechaza ese mismo número corto', () => {
      expect(acepta('+572272823')).toBe(false);
    });

    it('acepta un celular colombiano completo', () => {
      expect(acepta('+573001234567')).toBe(true);
    });

    it('sigue aceptando el móvil colombiano local sin indicativo', () => {
      expect(acepta('3001234567')).toBe(true);
    });

    it('sigue aceptando números de otros países', () => {
      expect(acepta('+13053334444')).toBe(true);  // Estados Unidos
      expect(acepta('+56912345678')).toBe(true);  // Chile
    });

    it('no acepta un número sin indicativo que no sea móvil colombiano', () => {
      expect(acepta('6012345678')).toBe(false);
    });
  });
});

import { firmarId, leerIdDeLink, exigeFirma } from '../reprogramar-firma.helper';

const SECRETO = 'secreto-de-prueba';

describe('la firma del link de reprogramar', () => {
  it('firma un id y lo vuelve a leer', () => {
    const link = firmarId('trepsi_123', SECRETO);
    expect(link).toContain('trepsi_123~');
    expect(leerIdDeLink(link, SECRETO)).toEqual({ id: 'trepsi_123', firmado: true });
  });

  it('la firma de una cita no sirve para otra', () => {
    const ajena = firmarId('trepsi_123', SECRETO).split('~')[1];
    expect(leerIdDeLink(`trepsi_999~${ajena}`, SECRETO).firmado).toBe(false);
  });

  it('un id pelado se lee igual, pero sin firma', () => {
    expect(leerIdDeLink('trepsi_123', SECRETO)).toEqual({ id: 'trepsi_123', firmado: false });
  });

  it('una firma inventada no pasa', () => {
    expect(leerIdDeLink('trepsi_123~0000000000', SECRETO).firmado).toBe(false);
    expect(leerIdDeLink('trepsi_123~corta', SECRETO).firmado).toBe(false);
  });

  it('otro secreto no valida', () => {
    const link = firmarId('trepsi_123', SECRETO);
    expect(leerIdDeLink(link, 'otro-secreto').firmado).toBe(false);
  });

  it('sin secreto el link sale pelado, y no finge estar firmado', () => {
    expect(firmarId('trepsi_123', undefined)).toBe('trepsi_123');
    expect(leerIdDeLink('trepsi_123~9f2a1c7b55', undefined).firmado).toBe(false);
  });

  it('un id con guion bajo o puntos conserva su forma', () => {
    const link = firmarId('mbt_2026.09.23_7', SECRETO);
    expect(leerIdDeLink(link, SECRETO)).toEqual({ id: 'mbt_2026.09.23_7', firmado: true });
  });

  it('exigir la firma es una decisión del entorno, apagada por defecto', () => {
    expect(exigeFirma({})).toBe(false);
    expect(exigeFirma({ REPROGRAMAR_EXIGIR_FIRMA: 'false' })).toBe(false);
    expect(exigeFirma({ REPROGRAMAR_EXIGIR_FIRMA: 'true' })).toBe(true);
  });
});

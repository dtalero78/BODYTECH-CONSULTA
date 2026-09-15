import { useEffect } from 'react';

/**
 * Abre el modal que pidió el panel — el "Ir →" de la lista de lo que falta al
 * finalizar lleva al campo, no solo a la sección.
 *
 * Antes el salto cambiaba de pestaña y ahí se quedaba: el médico tenía que
 * adivinar en cuál de los cards estaba el campo y abrirlos de a uno (lo reportó
 * así: "me tocó devolverme varias veces… y mirar cada subsegmento").
 *
 * El panel pone la solicitud y el tab la consume con `onAbierto`. Sin ese
 * consumo, volver a la pestaña más tarde reabriría el modal sin que nadie lo
 * pidiera.
 */
export function useAbrirSolicitado<K extends string>(
  abrir: string | null | undefined,
  validos: ReadonlyArray<K>,
  abrirModal: (k: K) => void,
  onAbierto?: () => void
): void {
  useEffect(() => {
    if (!abrir || !(validos as ReadonlyArray<string>).includes(abrir)) return;
    abrirModal(abrir as K);
    onAbierto?.();
    // Solo reacciona a una solicitud nueva; `abrirModal` y `onAbierto` cambian
    // de referencia en cada render y no son una solicitud.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrir]);
}

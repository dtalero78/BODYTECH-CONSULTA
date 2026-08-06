import { useEffect, useState, type RefObject } from 'react';

/**
 * Ancho de layout del elemento observado, en px del sistema de coordenadas del
 * propio elemento. Se usa `clientWidth` (no `getBoundingClientRect`) a propósito:
 * el panel Corporativo se renderiza dentro de un `zoom`, y `clientWidth` devuelve
 * el ancho pre-zoom — que es el mismo espacio en el que están expresados los
 * anchos de Tailwind con los que hay que compararlo.
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return width;
}

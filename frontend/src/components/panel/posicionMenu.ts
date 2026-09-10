import type { CSSProperties } from 'react';

const SEPARACION = 6; // entre el campo y el menú
const MARGEN = 8; // aire contra el borde de la ventana

/**
 * Dónde abrir un menú flotante pegado a su campo.
 *
 * Los menús del panel se portalean a `document.body` con `position: fixed` para
 * escapar del `overflow: hidden` de los modales. Eso los saca del flujo, y nada
 * les impedía salirse por debajo de la ventana: en el último campo de un modal
 * (el "Objetivo" de Actividad física) el menú abría hacia abajo y las opciones
 * quedaban fuera de la pantalla, sin forma de llegar a ellas.
 *
 * Abre hacia abajo si cabe; si no, hacia el lado con más espacio. En los dos
 * casos la altura queda limitada a lo visible, y la lista hace scroll adentro.
 */
export function posicionMenu(ancla: DOMRect, altoDeseado: number): CSSProperties {
  const abajo = window.innerHeight - ancla.bottom - SEPARACION - MARGEN;
  const arriba = ancla.top - SEPARACION - MARGEN;
  const base: CSSProperties = { position: 'fixed', left: ancla.left, width: ancla.width, zIndex: 9999 };

  if (abajo < altoDeseado && arriba > abajo) {
    return {
      ...base,
      bottom: window.innerHeight - ancla.top + SEPARACION,
      maxHeight: arriba,
      transformOrigin: 'bottom center',
    };
  }
  return { ...base, top: ancla.bottom + SEPARACION, maxHeight: abajo, transformOrigin: 'top center' };
}

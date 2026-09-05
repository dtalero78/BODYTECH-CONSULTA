import { useState } from 'react';

/**
 * Encadena los modales de un tab: al terminar una sección, el pie ofrece
 * "Siguiente: <la que sigue>" y la abre, en vez de cerrar y obligar a buscar el
 * card. Pedido del equipo médico tras ver una plataforma que lo hace así.
 *
 * `order` es el recorrido clínico de la sección (no el orden en que están
 * escritos los modales en el archivo). `labels` es el nombre corto que se
 * muestra en el botón.
 *
 * `chainEnd` permite que la cadena continúe en OTRO componente — lo necesita
 * Prescripción, donde las 5 secciones FIT viven en `PrescripcionTab` y Remisión
 * en `CorpPrescripcionTab`, cada uno con su propio estado.
 *
 * Ojo: esto es sólo navegación. Los campos se auto-guardan uno por uno, así que
 * salirse de la cadena a la mitad no pierde nada.
 */
export function useModalChain<K extends string>(
  order: ReadonlyArray<K>,
  labels: Record<K, string>,
  chainEnd?: { label: string; onNext: () => void },
  /** "Atrás" del PRIMER paso, cuando la cadena viene de otro componente. */
  chainStart?: { onBack: () => void },
  /**
   * Modo controlado: el padre maneja qué modal está abierto. Lo usa Prescripción,
   * donde el recorrido entra y sale de `PrescripcionTab` (Análisis vive fuera,
   * las 5 secciones FIT adentro, Remisión fuera otra vez).
   */
  controlled?: { open: K | null; setOpen: (k: K | null) => void }
) {
  // El useState se declara siempre (regla de hooks); en modo controlado se ignora.
  const [internal, setInternal] = useState<K | null>(null);
  const open = controlled ? controlled.open : internal;
  const setOpen = controlled ? controlled.setOpen : setInternal;

  /** Props de encadenado para el modal `k`. Se esparcen sobre `<Modal>`. */
  function chain(k: K) {
    const i = order.indexOf(k);
    const siguiente = i >= 0 && i < order.length - 1 ? order[i + 1] : null;
    const anterior = i > 0 ? order[i - 1] : null;
    const esUltimo = i === order.length - 1;

    return {
      open: open === k,
      onClose: () => setOpen(null),
      nextLabel: siguiente ? labels[siguiente] : esUltimo && chainEnd ? chainEnd.label : undefined,
      onNext: siguiente
        ? () => setOpen(siguiente)
        : esUltimo && chainEnd
          ? () => {
              setOpen(null);
              chainEnd.onNext();
            }
          : undefined,
      onBack: anterior ? () => setOpen(anterior) : i === 0 && chainStart ? () => {
        setOpen(null);
        chainStart.onBack();
      } : undefined,
    };
  }

  return { open, setOpen, chain };
}

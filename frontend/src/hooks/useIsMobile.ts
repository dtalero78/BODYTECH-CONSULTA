import { useEffect, useState } from 'react';

/**
 * true cuando el viewport es de teléfono (< 768px). Reactivo a resize/rotación.
 * Usado para elegir la variante móvil de la sala de atención.
 */
export function useIsMobile(breakpointPx = 768): boolean {
  const query = `(max-width: ${breakpointPx - 1}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}

export default useIsMobile;

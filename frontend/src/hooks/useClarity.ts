import { useEffect } from 'react';

/**
 * Microsoft Clarity (grabación de sesión + heatmaps).
 *
 * Se carga SÓLO en las páginas que montan este hook (hoy: panel administrativo
 * `/coordinador` y panel de calidad `/calidad`), no globalmente en index.html.
 * De ese modo Clarity no corre en la sala de video del paciente/médico ni en
 * las páginas públicas.
 *
 * El ID del proyecto se toma de `VITE_CLARITY_PROJECT_ID` y cae al ID de la
 * cuenta actual si la variable no está definida.
 */
const CLARITY_PROJECT_ID =
  (import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined) || 'xjaud6lhxs';

// Flag a nivel de módulo: garantiza que el snippet se inyecte una sola vez
// aunque el usuario navegue entre /coordinador y /calidad (o remonte el hook).
let injected = false;

function loadClarity(): void {
  if (injected || typeof window === 'undefined') return;
  // Si el tag ya existe (p. ej. hot-reload en dev) no lo dupliques.
  if ((window as unknown as { clarity?: unknown }).clarity) {
    injected = true;
    return;
  }
  injected = true;

  // Snippet oficial de Clarity (https://clarity.microsoft.com), tipado.
  (function (c: any, l: Document, a: string, r: string, i: string) {
    c[a] =
      c[a] ||
      function (...args: unknown[]) {
        (c[a].q = c[a].q || []).push(args);
      };
    const t = l.createElement(r) as HTMLScriptElement;
    t.async = true;
    t.src = 'https://www.clarity.ms/tag/' + i;
    const y = l.getElementsByTagName(r)[0];
    y.parentNode?.insertBefore(t, y);
  })(window, document, 'clarity', 'script', CLARITY_PROJECT_ID);
}

/** Carga Microsoft Clarity al montar (idempotente). */
export function useClarity(): void {
  useEffect(() => {
    loadClarity();
  }, []);
}

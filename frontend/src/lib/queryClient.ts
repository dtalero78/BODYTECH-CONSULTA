import { QueryClient } from '@tanstack/react-query';

/**
 * Singleton QueryClient para la app.
 *
 * Defaults:
 * - staleTime: 30s — coincide con el ritmo de polling de transcripción y evita
 *   refetches innecesarios cuando varios componentes consumen la misma query.
 * - retry: 1 — un solo reintento, alineado con el retry manual que tenía
 *   `useAutoSave`.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

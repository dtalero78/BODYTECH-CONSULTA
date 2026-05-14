// Setup global de Vitest.
//
// `@testing-library/jest-dom/vitest` registra los matchers DOM (toBeInTheDocument,
// toHaveTextContent, etc.) sobre la instancia de `expect` de Vitest. En la
// versión 6.x del paquete el sub-export `/vitest` es el camino correcto
// (el `/` raíz registra contra `jest.expect`, no `vi.expect`).
//
// Los tests de este run NO usan matchers de DOM (sólo lógica pura), pero
// dejamos el setup listo para que futuros tests de componentes lo aprovechen
// sin tocar configuración.
import '@testing-library/jest-dom/vitest';

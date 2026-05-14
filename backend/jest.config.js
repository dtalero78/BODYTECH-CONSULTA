/**
 * Jest config — Run 3/4 (Testing Infrastructure).
 *
 * Tests viven co-locados en `src/**\/__tests__/` para que `ts-jest` los
 * resuelva sin tocar el `tsconfig.json` raíz (que excluye `tests/`).
 *
 * - `testEnvironment: 'node'` porque toda la suite del backend es Node puro
 *   (Express + servicios). No hay módulos DOM.
 * - `clearMocks: true` resetea el estado de `jest.mock()` entre tests para
 *   que las mocks de `postgres.service` no se filtren entre suites.
 * - `forceExit: true` evita el warning "Jest did not exit one second after
 *   the test run has completed". Algunos servicios singleton importados
 *   transitivamente (session-tracker, postgres pool) crean handles que no
 *   deberían existir bajo mock, pero por seguridad forzamos el exit limpio.
 * - `isolatedModules` en transform: acelera el typecheck por archivo y baja
 *   el overhead de ts-jest. La advertencia de deprecación de la configuración
 *   antigua se evita pasándola por `transform` (no por `globals`).
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/?(*.)+(test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
  forceExit: true,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        isolatedModules: true,
      },
    ],
  },
};

// ============================================================================
// sedeMiddleware — extrae el identificador de sede del request y lo deja en
// `(req as any).sedeId` para que los controllers lo lean y se lo pasen a los
// services / repositorios.
//
// Orden de resolución:
//   1) Header `X-Sede-Id`
//   2) Query string `?sede=...`
//   3) Default `'bsl'` (backward compat — la columna `sede_id` tiene
//      `DEFAULT 'bsl'`, así que todas las filas existentes hacen match).
// ============================================================================

import { Request, Response, NextFunction } from 'express';

export function sedeMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const sedeId =
    (req.headers['x-sede-id'] as string | undefined) ||
    (req.query['sede'] as string | undefined) ||
    'bsl';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (req as any).sedeId = sedeId;
  next();
}

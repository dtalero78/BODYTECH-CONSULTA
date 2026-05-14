import { Request, Response, NextFunction } from 'express';

/**
 * Error handler global. Atrapa los `next(error)` despachados desde los
 * controllers cuando ocurre un error inesperado (no de dominio).
 *
 * Reglas:
 *  - Si la respuesta ya se envió (webhooks Twilio responden 200 inmediato),
 *    delegar a Express con `next(err)` para que cierre la conexión sin
 *    intentar re-escribir el body.
 *  - Loguear server-side con detalle (stack + método + url) para diagnóstico.
 *  - Responder 500 con un shape uniforme: `{ success: false, error: 'Error interno' }`.
 *    NO exponemos `err.message` al cliente — puede filtrar detalles de DB / SDK.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    // Algún handler ya respondió (típico de webhooks Twilio que hacen
    // `res.sendStatus(200)` y luego procesan en background). Express necesita
    // que se siga la cadena para cerrar la conexión correctamente.
    return next(err);
  }

  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  console.error(
    `[ErrorHandler] ${req.method} ${req.originalUrl} — ${message}`,
    stack ?? ''
  );

  res.status(500).json({
    success: false,
    error: 'Error interno',
  });
}

export default errorHandler;

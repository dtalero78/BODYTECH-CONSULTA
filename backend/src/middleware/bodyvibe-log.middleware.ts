// ============================================================================
// bodyvibe-log.middleware — Registro de peticiones de BodyVibeTech.
//
// Existe por una lección concreta: la primera falla en producción tardó una
// hora en diagnosticarse porque no había forma de saber si la petición había
// llegado siquiera al servidor. `morgan` solo se activa en desarrollo
// (`index.ts`), así que en producción no queda rastro de ninguna petición.
//
// Cambiar eso para toda la plataforma sería mucho ruido en los logs; acá se
// limita a las rutas de BodyVibeTech, que son pocas, poco frecuentes y las que
// más falta hace poder mirar.
//
// Qué se registra: quién, qué, cuánto tardó, y el motivo cuando la respuesta no
// fue exitosa. Eso convierte una sesión de arqueología en diez segundos de
// lectura.
//
// Qué NO se registra, a propósito:
//   · El SQL de las consultas. Puede llevar filtros con datos de pacientes, y
//     para eso ya está `bodyvibe_query_log`, que vive en la base y no en un log
//     que se rota y se lee desde una terminal.
//   · El código generado, ni el pedido en lenguaje natural.
//   · Cualquier cuerpo de respuesta que no sea el mensaje de error.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { getSession } from './rbac.middleware';

export function bodyvibeLogMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inicio = Date.now();

  // El motivo del fallo viaja en el cuerpo (`mensaje`), no en el código HTTP.
  // Se intercepta `json` para poder registrarlo sin volver a leer la respuesta.
  let motivo: string | undefined;
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo: any) => {
    if (cuerpo && typeof cuerpo === 'object' && typeof cuerpo.mensaje === 'string') {
      motivo = cuerpo.mensaje;
    }
    return jsonOriginal(cuerpo);
  };

  res.on('finish', () => {
    const ms = Date.now() - inicio;
    const quien = getSession(req)?.email ?? 'sin-sesión';
    const base = `[bodyvibe] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms}ms ${quien}`;

    if (res.statusCode >= 400) {
      console.warn(`${base}${motivo ? ` — ${motivo}` : ''}`);
      return;
    }
    // Las consultas de los apps son las más frecuentes con diferencia; se
    // registran solo cuando tardan, para que el log siga siendo legible.
    if (req.originalUrl.includes('/query') && ms < 1000) return;
    console.log(base);
  });

  next();
}

export default bodyvibeLogMiddleware;

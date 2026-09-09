// ============================================================================
// /api/informe-corporativo/* — El informe mensual que se le entrega a la empresa.
//
// `GET /empresas`  → las empresas que tienen valoraciones, para el selector.
// `GET /datos`     → sólo las cifras (rápido; sirve para ver antes de generar).
// `GET /pdf`       → el informe completo, con gráficas y análisis redactados.
//
// El PDF tarda: la redacción de los análisis puede llevar medio minuto. Es una
// acción manual y ocasional —un informe por empresa al mes—, así que se resuelve
// en la misma petición en vez de montar una cola que nadie iría a consultar.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import * as informe from '../services/informe-corporativo.service';
import { redactar } from '../services/informe-corporativo-redaccion.service';
import { informeCorporativoHtml } from '../helpers/informe-corporativo-html';
import pdfService from '../services/pdf.service';

const router = Router();

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida empresa y rango. Devuelve `null` y responde si algo falta. */
function leerParametros(
  req: Request,
  res: Response,
): { empresa: string; desde: string; hasta: string } | null {
  const empresa = String(req.query.empresa ?? '').trim();
  const desde = String(req.query.desde ?? '').trim();
  const hasta = String(req.query.hasta ?? '').trim();
  if (!empresa || !FECHA.test(desde) || !FECHA.test(hasta)) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: 'Hacen falta la empresa y el rango de fechas (YYYY-MM-DD).',
    });
    return null;
  }
  return { empresa, desde, hasta };
}

router.get('/empresas', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await informe.empresasConValoraciones() });
  } catch (e) {
    next(e);
  }
});

router.get('/datos', async (req: Request, res: Response, next: NextFunction) => {
  const p = leerParametros(req, res);
  if (!p) return;
  try {
    res.json({ success: true, data: await informe.agregar(p.empresa, p.desde, p.hasta) });
  } catch (e) {
    next(e);
  }
});

router.get('/pdf', async (req: Request, res: Response, next: NextFunction) => {
  const p = leerParametros(req, res);
  if (!p) return;
  try {
    const datos = await informe.agregar(p.empresa, p.desde, p.hasta);
    if (datos.total === 0) {
      // Un informe de cero valoraciones no es un informe: es una hoja con
      // gráficas vacías que alguien mandaría por error.
      res.status(404).json({
        success: false,
        error: 'SIN_VALORACIONES',
        message: `No hay valoraciones de ${p.empresa} entre ${p.desde} y ${p.hasta}.`,
      });
      return;
    }
    const redaccion = await redactar(datos);
    const pdf = await pdfService.htmlToPdf(informeCorporativoHtml(datos, redaccion));
    const nombre = `Informe ${p.empresa} ${p.desde} a ${p.hasta}.pdf`.replace(/[^\w\s.áéíóúñÁÉÍÓÚÑ-]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(pdf);
  } catch (e) {
    next(e);
  }
});

export default router;

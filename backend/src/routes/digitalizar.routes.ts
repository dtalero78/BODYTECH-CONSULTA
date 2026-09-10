// ============================================================================
// Router /api/digitalizar/* — Pantallazo de "Citas asignadas" de MyBodytech →
// filas que abren la ficha del afiliado en MyBodytech con un clic.
//
// Montado con requireRole('admin', 'coordinador') en index.ts, y además solo
// para los correos de DIGITALIZAR_PERMITIDOS —la coordinación de la UMV—: ver
// digitalizar-acceso.ts. Devuelve nombres, cédulas y teléfonos de afiliados. Todo se acota a las sedes del
// usuario con effectiveSedes; al guardar, la fila toma la primera sede del
// usuario (el pantallazo trae el gimnasio de MyBodytech, que no es un sede_id).
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import digitalizarService from '../services/digitalizar.service';
import { leerFranjas } from '../services/digitalizar-ocr.service';
import { normalizarDocumento } from '../helpers/padron.helper';
import { effectiveSedes, getSession } from '../middleware/rbac.middleware';
import { puedeDigitalizar } from '../services/digitalizar-acceso';

const router = Router();

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe ser AAAA-MM-DD.');

const leerSchema = z.object({
  fecha: FECHA,
  // El navegador parte el pantallazo en franjas de 2000×700 px en JPEG: cada
  // una pesa unos cientos de KB. 12 franjas cubren una captura de página
  // entera; más que eso ya no es un pantallazo de una lista.
  franjas: z
    .array(
      z
        .string()
        .regex(/^data:image\/(png|jpeg|webp);base64,/, 'La imagen debe venir como data URL.')
        .max(3_000_000, 'La imagen es demasiado grande.'),
    )
    .min(1, 'Falta la imagen.')
    .max(12, 'El pantallazo es demasiado largo: pégalo en partes.'),
});

const editarSchema = z
  .object({
    numeroId: z
      .string()
      .transform((s) => normalizarDocumento(s))
      .refine((s) => s.length >= 5 && s.length <= 11, 'La cédula debe tener entre 5 y 11 dígitos.')
      .optional(),
    nombre: z.string().trim().min(2, 'Escribe el nombre.').max(200).optional(),
    telefono: z
      .string()
      .transform((s) => s.replace(/\D/g, ''))
      .transform((s) => s || null)
      .nullable()
      .optional(),
    /** "Lo comparé con el pantallazo y está bien", sin cambiar nada. */
    confirmar: z.literal(true).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'No hay nada que cambiar.');

function idDe(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'ID_INVALIDO' });
    return null;
  }
  return id;
}

function invalido(res: Response, message: string | undefined): void {
  res.status(400).json({ success: false, error: 'VALIDACION', message: message ?? 'Datos inválidos.' });
}

/**
 * ¿Esta persona puede usar Digitalizar? Lo pregunta el panel para decidir si
 * dibuja la pestaña. Va ANTES del candado a propósito: tiene que poder
 * contestarle "no" a un coordinador que no está en la lista.
 */
router.get('/acceso', (req: Request, res: Response) => {
  res.json({ success: true, data: { puede: puedeDigitalizar(getSession(req)?.email) } });
});

/**
 * Candado de todo lo demás: sesión Y correo en DIGITALIZAR_PERMITIDOS. Este es
 * el que manda; que el panel no dibuje la pestaña es solo para no mostrar un
 * botón que lleva a un 403.
 */
router.use((req: Request, res: Response, next: NextFunction) => {
  const session = getSession(req);
  if (!session) {
    res.status(401).json({ success: false, error: 'NO_SESSION' });
    return;
  }
  if (!puedeDigitalizar(session.email)) {
    res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Digitalizar es solo para la coordinación de la UMV.',
    });
    return;
  }
  next();
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  const fecha = FECHA.safeParse(req.query.fecha);
  if (!fecha.success) return invalido(res, fecha.error.issues[0]?.message);
  try {
    res.json({ success: true, data: await digitalizarService.listar(fecha.data, effectiveSedes(req)) });
  } catch (e) {
    next(e);
  }
});

/** Un pantallazo por request (en franjas): el navegador los manda de a uno y muestra el avance. */
router.post('/leer', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = leerSchema.safeParse(req.body);
  if (!parsed.success) return invalido(res, parsed.error.issues[0]?.message);

  let lectura: Awaited<ReturnType<typeof leerFranjas>>;
  try {
    lectura = await leerFranjas(parsed.data.franjas);
  } catch (e) {
    // 502 y un mensaje que se pueda mostrar: el que falló es el servicio de
    // lectura, no esta app, y reintentar suele bastar.
    console.error('[Digitalizar] No se pudo leer el pantallazo:', e instanceof Error ? e.message : e);
    res.status(502).json({
      success: false,
      error: 'LECTURA_FALLIDA',
      message: 'No se pudo leer el pantallazo. Intenta de nuevo en un momento.',
    });
    return;
  }

  try {
    const session = getSession(req);
    const r = await digitalizarService.guardar(lectura.filas, {
      fecha: parsed.data.fecha,
      sedeId: session?.sedes?.[0] ?? 'bsl',
      subidoPor: session?.email ?? null,
    });
    res.json({
      success: true,
      data: {
        leidas: lectura.filas.length,
        porVerificar: lectura.filas.filter((f) => f.dudas.includes('numeroId')).length,
        descartadas: lectura.descartadas,
        lecturasFallidas: lectura.lecturasFallidas,
        ...r,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = idDe(req, res);
  if (id === null) return;
  const parsed = editarSchema.safeParse(req.body);
  if (!parsed.success) return invalido(res, parsed.error.issues[0]?.message);
  try {
    // `confirmar` no viaja: editar() limpia las dudas siempre, cambie algo o no.
    const { numeroId, nombre, telefono } = parsed.data;
    const r = await digitalizarService.editar(
      id,
      { numeroId, nombre, telefono },
      getSession(req)?.email ?? null,
      effectiveSedes(req),
    );
    if (r === 'no_encontrada') {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    if (r === 'duplicada') {
      res.status(409).json({
        success: false,
        error: 'DUPLICADA',
        message: 'Esa cédula ya está en la lista de ese día.',
      });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/revisada', async (req: Request, res: Response, next: NextFunction) => {
  const id = idDe(req, res);
  if (id === null) return;
  try {
    const ok = await digitalizarService.marcarRevisada(id, getSession(req)?.email ?? null, effectiveSedes(req));
    if (!ok) {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = idDe(req, res);
  if (id === null) return;
  try {
    const ok = await digitalizarService.eliminar(id, effectiveSedes(req));
    if (!ok) {
      res.status(404).json({ success: false, error: 'NO_ENCONTRADA' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;

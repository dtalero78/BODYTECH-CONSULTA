// ============================================================================
// Router /api/dispositivo/* — el asistente de escritorio de la consulta
// presencial (UMV presencial y médico corporativo). Ver dispositivo.service.ts.
//
// Tres puertas, cada una con su candado:
//  - /emparejar*  — la placa sin vincular (pública, con límite por IP).
//  - /vincular, /mios — el médico desde su panel (sesión con rol médico).
//  - /yo, /consulta* — la placa ya vinculada (requireDispositivo).
//
// La placa solo abre citas agendadas HOY con el médico que la vinculó (decisión
// de Daniel, 1-oct-2026): no crea citas.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import dispositivoService from '../services/dispositivo.service';
import { crearTokenRealtime } from '../services/transcription.service';
import { getSession, requireRole } from '../middleware/rbac.middleware';
import { requireDispositivo, getDispositivoId, dispositivoVeTodo } from '../middleware/dispositivo-auth.middleware';
import auditService from '../services/audit.service';
import { normalizarCedula, normalizarCodigo } from '../helpers/dispositivo.helper';
import { programaDe } from '../helpers/guias-dispositivo';

const router = Router();

const limite = (max: number) =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' },
  });

const errorDb = (res: Response) =>
  res.status(503).json({ success: false, error: 'DB_ERROR', message: 'No se pudo consultar la base. Intenta de nuevo.' });

// ---------------------------------------------------------------------------
// La placa sin vincular
// ---------------------------------------------------------------------------

router.post('/emparejar', limite(20), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const r = await dispositivoService.iniciarEmparejamiento();
    if (!r) return void errorDb(res);
    res.json({ success: true, data: r });
  } catch (e) {
    next(e);
  }
});

const reclamoSchema = z.object({ codigo: z.string(), secreto: z.string().min(16) });

// La placa pregunta cada pocos segundos mientras el médico escribe el código.
router.post('/emparejar/reclamar', limite(300), async (req: Request, res: Response, next: NextFunction) => {
  const parsed = reclamoSchema.safeParse(req.body);
  const codigo = parsed.success ? normalizarCodigo(parsed.data.codigo) : null;
  if (!parsed.success || !codigo) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const r = await dispositivoService.reclamar(codigo, parsed.data.secreto);
    if (!r) return void errorDb(res);
    res.json({ success: true, data: r });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// El médico desde su panel
// ---------------------------------------------------------------------------

// Límite por IP: con sesión, igual no se puede probar códigos a ciegas.
router.post('/vincular', limite(20), requireRole('medico'), async (req: Request, res: Response, next: NextFunction) => {
  const codigo = normalizarCodigo(req.body?.codigo);
  if (!codigo) {
    res.status(400).json({ success: false, error: 'CODIGO_INVALIDO', message: 'El código tiene 8 letras y números.' });
    return;
  }
  try {
    const r = await dispositivoService.confirmarEmparejamiento(codigo, getSession(req)!.userId);
    const mensajes: Record<string, [number, string]> = {
      NO_EXISTE: [404, 'Ese código no existe. Revise la pantalla del dispositivo.'],
      VENCIDO: [410, 'El código venció. Reinicie el dispositivo para pedir otro.'],
      YA_USADO: [409, 'Ese código ya se usó.'],
      DB_ERROR: [503, 'No se pudo consultar la base. Intenta de nuevo.'],
    };
    if (r !== 'ok') {
      const [status, message] = mensajes[r];
      res.status(status).json({ success: false, error: r, message });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

router.get('/mios', requireRole('medico'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await dispositivoService.listar(getSession(req)!.userId);
    if (rows === null) return void errorDb(res);
    res.json({ success: true, data: rows });
  } catch (e) {
    next(e);
  }
});

router.delete('/mios/:id', requireRole('medico'), async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const ok = await dispositivoService.revocar(id, getSession(req)!.userId);
    if (ok === null) return void errorDb(res);
    if (!ok) {
      res.status(404).json({ success: false, error: 'NO_EXISTE' });
      return;
    }
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// La placa vinculada
// ---------------------------------------------------------------------------

router.get('/yo', requireDispositivo, (req: Request, res: Response) => {
  const s = getSession(req)!;
  res.json({ success: true, data: { nombre: s.nombre, codigo: s.codigo, programa: programaDe(s.especialidad) } });
});

router.post('/consulta', requireDispositivo, async (req: Request, res: Response, next: NextFunction) => {
  const cedula = normalizarCedula(req.body?.cedula);
  if (!cedula) {
    res.status(400).json({ success: false, error: 'CEDULA_INVALIDA', message: 'Revise el número de cédula.' });
    return;
  }
  try {
    const s = getSession(req)!;
    if (dispositivoVeTodo(req)) return void (await consultaDePrueba(req, res, cedula));
    const r = await dispositivoService.buscarCitaHoy(s.codigo!, cedula);
    if (!r) return void errorDb(res);
    if (r.estado === 'SIN_CITA') {
      res.status(404).json({ success: false, error: 'SIN_CITA', message: 'No tiene cita hoy con usted.' });
      return;
    }
    if (r.estado === 'YA_ATENDIDA') {
      res.status(409).json({ success: false, error: 'YA_ATENDIDA', message: 'La consulta de hoy ya se cerró.' });
      return;
    }
    const programa = programaDe(s.especialidad);
    const anteriores = await dispositivoService.visitasAnteriores(cedula, r.historia._id);
    res.json({ success: true, data: dispositivoService.armarConsulta(r.historia, programa, anteriores) });
  } catch (e) {
    next(e);
  }
});

/**
 * La placa de pruebas (`dispositivos.ve_todo`, decisión de Daniel del 8-oct-2026):
 * ve la historia de cualquier paciente, sea del profesional que sea. Solo para
 * mirar: grabar, transcribir y cerrar siguen exigiendo que la historia sea del
 * médico de la placa (cargarHistoria). Cada historia abierta así queda en la
 * auditoría con su id: es acceso a datos clínicos de un paciente ajeno.
 */
async function consultaDePrueba(req: Request, res: Response, cedula: string): Promise<void> {
  const r = await dispositivoService.buscarCualquiera(cedula);
  if (r === null) return void errorDb(res);
  if (r === 'SIN_HISTORIA') {
    res.status(404).json({ success: false, error: 'SIN_HISTORIA', message: 'No hay historias con esa cédula.' });
    return;
  }
  const prof = await dispositivoService.profesional(r.historia.medico);
  const programa = programaDe(prof?.especialidad);
  const anteriores = await dispositivoService.visitasAnteriores(cedula, r.historia._id);
  const s = getSession(req)!;
  auditService
    .record({
      actorUserId: s.userId,
      actorEmail: s.email,
      actorNombre: s.nombre,
      actorCodigo: s.codigo ?? null,
      actorRol: s.role,
      metodo: 'POST',
      ruta: req.originalUrl,
      accion: 'dispositivo_ver_historia',
      entidad: 'historia',
      entidadId: r.historia._id,
      statusCode: 200,
      ip: req.ip,
      detalle: { dispositivoId: getDispositivoId(req), medicoDeLaHistoria: r.historia.medico ?? null },
    })
    .catch(() => undefined);
  const encabezado = dispositivoService.encabezado(r.historia, r.deHoy, prof?.nombre ?? null);
  res.json({ success: true, data: dispositivoService.armarConsulta(r.historia, programa, anteriores, encabezado) });
}

/** Las rutas de una consulta: la historia tiene que ser del médico de la placa. */
async function cargarHistoria(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const historia = await dispositivoService.historiaDelMedico(req.params.id, getSession(req)!.codigo!);
    if (!historia) {
      res.status(404).json({ success: false, error: 'NO_EXISTE', message: 'Esa consulta no es suya.' });
      return;
    }
    if (historia.fechaConsulta) {
      res.status(409).json({ success: false, error: 'YA_ATENDIDA', message: 'La consulta ya se cerró.' });
      return;
    }
    res.locals.historia = historia;
    res.locals.programa = programaDe(getSession(req)!.especialidad);
    next();
  } catch (e) {
    next(e);
  }
}

router.post('/consulta/:id/realtime-token', requireDispositivo, cargarHistoria, async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: await crearTokenRealtime() });
  } catch (error: any) {
    console.error('[dispositivo] token realtime:', error?.response?.data || error?.message || error);
    res.status(502).json({ success: false, error: 'REALTIME', message: 'No se pudo iniciar la transcripción.' });
  }
});

const segmentosSchema = z.object({
  segmentos: z
    .array(
      z.object({
        seq: z.number().int().min(0),
        paso: z.string().max(40).nullable(),
        texto: z.string().max(4000),
      })
    )
    .min(1)
    .max(50),
});

router.post('/consulta/:id/segmentos', requireDispositivo, cargarHistoria, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = segmentosSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const n = await dispositivoService.guardarSegmentos(req.params.id, getDispositivoId(req)!, parsed.data.segmentos);
    if (n === null) return void errorDb(res);
    res.json({ success: true, data: { guardados: n } });
  } catch (e) {
    next(e);
  }
});

router.post('/consulta/:id/borrador', requireDispositivo, cargarHistoria, async (req: Request, res: Response) => {
  try {
    const segs = await dispositivoService.segmentos(req.params.id);
    if (segs === null) return void errorDb(res);
    const texto = dispositivoService.transcripcion(segs, res.locals.programa);
    const campos = await dispositivoService.borrador(res.locals.historia, res.locals.programa, texto);
    res.json({ success: true, data: { campos, frases: segs.length } });
  } catch (error: any) {
    console.error('[dispositivo] borrador:', error?.message || error);
    res.status(502).json({ success: false, error: 'IA', message: 'No se pudo procesar la transcripción.' });
  }
});

const finalizarSchema = z.object({
  campos: z.record(z.union([z.string().max(4000), z.number(), z.boolean()])),
});

router.post('/consulta/:id/finalizar', requireDispositivo, cargarHistoria, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = finalizarSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
    return;
  }
  try {
    const segs = await dispositivoService.segmentos(req.params.id);
    if (segs === null) return void errorDb(res);
    const texto = dispositivoService.transcripcion(segs, res.locals.programa);
    const r = await dispositivoService.finalizar(res.locals.historia, res.locals.programa, parsed.data.campos, texto);
    res.json({ success: true, data: r });
  } catch (e) {
    next(e);
  }
});

export default router;

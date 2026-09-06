// ============================================================================
// profesionales.controller — HTTP handlers para /api/profesionales/*.
//
// Sigue el envelope { success, data?, error? } del resto del backend (NO el
// envelope { ok, error } que usa Trepsi, porque este es para uso interno).
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import profesionalesService from '../services/profesionales.service';
import disponibilidadService from '../services/disponibilidad.service';
import disponibilidadFechaService from '../services/disponibilidad-fecha.service';
import { getSession, canActOnSede, effectiveSedes } from '../middleware/rbac.middleware';
import usuariosService from '../services/usuarios.service';
import { asegurarPersona } from '../services/directorio-escritura.service';
import { revisarAlta, Actor } from '../helpers/usuarios-permisos.helper';

/** El actor, en los términos que entiende el helper de permisos. */
function actorDe(req: Request): Actor {
  const s = getSession(req);
  return { role: s?.role ?? '', email: s?.email ?? '', sedes: s?.sedes ?? [] };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const rolEnum = z.enum(['medico', 'coach']);
const modalidadEnum = z.enum(['presencial', 'virtual']);

const profesionalCreateSchema = z.object({
  rol: rolEnum,
  codigo: z.string().min(1).max(80),
  // Cédula, para cruzar con el directorio compartido. Sólo dígitos: es lo que
  // usa el directorio como llave, y aceptar puntos o guiones haría que la misma
  // persona no cruzara según cómo la escribieron.
  // Obligatoria: es la llave del directorio compartido, y toda persona de la
  // plataforma existe primero allá. Sin cédula no hay a quién enganchar la
  // ficha ni la cuenta.
  documento: z.string().regex(/^[0-9]{5,15}$/, 'El documento debe ser solo dígitos.'),
  primerNombre: z.string().min(1).max(100),
  segundoNombre: z.string().max(100).nullable().optional(),
  primerApellido: z.string().min(1).max(100),
  segundoApellido: z.string().max(100).nullable().optional(),
  alias: z.string().max(200).nullable().optional(),
  especialidad: z.string().max(120).nullable().optional(),
  numeroLicencia: z.string().max(80).nullable().optional(),
  tipoLicencia: z.string().max(80).nullable().optional(),
  fechaVencimientoLicencia: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Debe ser YYYY-MM-DD.')
    .nullable()
    .optional(),
  tiempoConsulta: z.number().int().min(5).max(240).optional(),
  firma: z.string().nullable().optional(),
  foto: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  celular: z.string().nullable().optional(),
  // La cuenta, en el mismo paso. Opcional sólo para el caso de "todavía no
  // tengo su correo": sin ella la persona queda en la agenda y no puede entrar,
  // y la lista de profesionales lo muestra como tal.
  cuenta: z
    .object({
      email: z.string().email('Correo inválido.'),
      password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
      rol: z.enum(['medico', 'coach', 'auxiliar', 'coordinador', 'admin', 'torre']),
      sedes: z.array(z.string()).optional(),
      esGlobal: z.boolean().optional(),
    })
    .optional(),
});

const profesionalUpdateSchema = profesionalCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Debe enviar al menos un campo.'
);

const rangoSchema = z.object({
  horaInicio: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/, 'Formato HH:MM.'),
  horaFin: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/, 'Formato HH:MM.'),
});

const diaRangosSchema = z.object({
  diaSemana: z.number().int().min(0).max(6),
  rangos: z.array(rangoSchema),
});

const disponibilidadReplaceSchema = z.object({
  modalidad: modalidadEnum,
  dias: z.array(diaRangosSchema),
});

const disponibilidadFechaReplaceSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha debe ser YYYY-MM-DD.'),
  modalidad: modalidadEnum,
  bloqueado: z.boolean(),
  rangos: z.array(rangoSchema),
  // `sede` opcional: permite editar la disponibilidad de un profesional de otra
  // sede desde el modal del día (filtro por sede). Sin él, usa la del JWT.
  sede: z.string().min(1).optional(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrorToDetails(err: ZodError) {
  return err.errors.map((e) => ({
    field: e.path.join('.') || '(root)',
    issue: e.message,
  }));
}

// Sede para operaciones de UNA sede (getById/create/update/delete/disponibilidad).
// Con sesión RBAC: un `?sede` explícito que esté en el alcance manda; si no, la
// (primera) sede del usuario. Admin/global sin `?sede` cae a 'bsl' (el front lo
// pasa explícito). Sin sesión, conserva el comportamiento legacy.
function getSedeId(req: Request): string {
  const session = getSession(req);
  if (session) {
    const q = typeof req.query.sede === 'string' ? req.query.sede : '';
    if (q && canActOnSede(req, q)) return q;
    return session.sedes[0] ?? 'bsl';
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sedeId = (req as any).sedeId;
  return typeof sedeId === 'string' && sedeId.length > 0 ? sedeId : 'bsl';
}

function parseId(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Resuelve la sede del profesional (su sede fija) y valida que el actor pueda
 * gestionarla. La disponibilidad pertenece a la sede del profesional, no a la
 * de la sesión, así un admin/coordinador multi-sede la edita correctamente.
 * Si no existe o está fuera de alcance, ya respondió y devuelve null.
 */
async function resolveSedeOf(req: Request, res: Response, id: number): Promise<string | null> {
  const sede = await profesionalesService.getSede(id);
  if (!sede) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Profesional no encontrado.' } });
    return null;
  }
  if (!canActOnSede(req, sede)) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Este profesional está fuera de tu alcance.' } });
    return null;
  }
  return sede;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class ProfesionalesController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const rolRaw = req.query.rol;
      const activoRaw = req.query.activo;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      let rol: 'medico' | 'coach' | undefined;
      if (typeof rolRaw === 'string' && (rolRaw === 'medico' || rolRaw === 'coach')) {
        rol = rolRaw;
      }
      let activo: boolean | undefined;
      if (activoRaw === 'true') activo = true;
      else if (activoRaw === 'false') activo = false;

      // `sedes` (CSV) opcional. RBAC: la lista solicitada se CONSTRIÑE al alcance
      // del usuario (effectiveSedes). Un coordinador no puede listar sedes ajenas
      // aunque las pida. `undefined` → admin/global sin filtro (todas las sedes).
      const sedesRaw = req.query.sedes;
      let requested: string[] | undefined;
      if (typeof sedesRaw === 'string' && sedesRaw.trim().length > 0) {
        const list = sedesRaw.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        if (list.length > 0) requested = list;
      }
      const sedeIds = effectiveSedes(req, requested);

      const result = await profesionalesService.list({
        // sedeId=null → sin filtro single; si `sedeIds` viene, el servicio usa
        // ANY(sedeIds); si ambos vacíos (admin/global) → todas las sedes.
        sedeId: null,
        sedeIds,
        rol,
        activo,
        search,
      });
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  get = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const result = await profesionalesService.getById(id, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedeId = getSedeId(req);
      const parsed = profesionalCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }
      const d = parsed.data;

      // Si va a crear cuenta, los límites de privilegio son los MISMOS que en el
      // panel de usuarios: un coordinador no reparte roles ni sedes ajenas por
      // esta otra puerta.
      if (d.cuenta) {
        const fallo = revisarAlta(actorDe(req), {
          app: 'consulta',
          rol: d.cuenta.rol,
          esGlobal: d.cuenta.esGlobal,
          sedes: d.cuenta.sedes ?? [sedeId],
          // El vínculo con la ficha existe por construcción: se crea acá mismo.
          profesionalId: 0,
        });
        if (fallo) {
          res.status(fallo.code === 'FORBIDDEN' ? 403 : 400).json({
            success: false,
            error: { code: fallo.code, message: fallo.message },
          });
          return;
        }
      }

      // PASO 1 — el directorio. Toda persona existe primero allá; si esto falla,
      // no se crea nada, para no dejar una ficha huérfana de su persona.
      const enDirectorio = await asegurarPersona({
        documento: d.documento,
        nombre: [d.primerNombre, d.primerApellido].filter(Boolean).join(' '),
        rol: d.rol === 'coach' ? 'coach' : 'medico',
        cargo: d.especialidad ?? null,
        ambito: sedeId === 'corporativo' ? 'corporativo' : 'virtual',
      });
      if (!enDirectorio.ok) {
        res.status(503).json({
          success: false,
          error: {
            code: enDirectorio.error,
            message: 'No se pudo registrar a la persona en el directorio. No se creó nada.',
          },
        });
        return;
      }

      // PASO 2 — la ficha de agenda de Consulta.
      const result = await profesionalesService.create(d, sedeId);
      if (!result.ok || !result.data) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      const ficha = result.data;

      // PASO 3 — la cuenta, enganchada a la ficha recién creada. Si falla, la
      // ficha queda: se le crea la cuenta después desde el panel de usuarios, y
      // el mensaje lo dice en vez de fingir que todo salió bien.
      let cuenta: { creada: boolean; error?: string } = { creada: false };
      if (d.cuenta) {
        const r = await usuariosService.create({
          email: d.cuenta.email,
          passwordHash: await usuariosService.hashPassword(d.cuenta.password),
          nombre: [d.primerNombre, d.primerApellido].filter(Boolean).join(' '),
          rol: d.cuenta.rol as never,
          esGlobal: d.cuenta.esGlobal ?? false,
          sedes: d.cuenta.esGlobal ? [] : (d.cuenta.sedes ?? [sedeId]),
          profesionalId: ficha.id,
          celular: d.celular ?? null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);
        cuenta = r.ok
          ? { creada: true }
          : {
              creada: false,
              error:
                r.error === 'EMAIL_TAKEN'
                  ? 'Ya existe una cuenta con ese correo. La ficha sí quedó creada.'
                  : 'No se pudo crear la cuenta. La ficha sí quedó creada.',
            };
      }

      res.status(result.status).json({
        success: true,
        data: ficha,
        directorio: { yaEstaba: !enDirectorio.creada },
        cuenta,
      });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const parsed = profesionalUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }
      const result = await profesionalesService.update(id, sedeId, parsed.data);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const result = await profesionalesService.softDelete(id, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  reactivate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const result = await profesionalesService.reactivate(id, sedeId);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  // -------------------------------------------------------------------------
  // Disponibilidad
  // -------------------------------------------------------------------------

  getDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadService.getByProfesional(id, sedeId, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  replaceDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const parsed = disponibilidadReplaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }
      const result = await disponibilidadService.replace(
        id,
        sedeId,
        parsed.data.modalidad,
        parsed.data.dias
      );
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  deleteDiaDisponibilidad = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const dia = Number(req.params.dia);
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadService.deleteDia(id, sedeId, dia, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  // -------------------------------------------------------------------------
  // Disponibilidad por FECHA (override puntual del patrón semanal)
  // -------------------------------------------------------------------------

  getDisponibilidadFecha = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // RBAC: getSedeId valida que `?sede` esté en el alcance del usuario.
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'fecha es requerida (YYYY-MM-DD).' } });
        return;
      }
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadFechaService.getByFecha(id, sedeId, fecha, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  replaceDisponibilidadFecha = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const parsed = disponibilidadFechaReplaceSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Uno o más campos son inválidos.',
            details: zodErrorToDetails(parsed.error),
          },
        });
        return;
      }
      // La sede se deriva del profesional (su sede fija), con validación de alcance.
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const result = await disponibilidadFechaService.replaceByFecha(
        id,
        sedeId,
        parsed.data.fecha,
        parsed.data.modalidad,
        { bloqueado: parsed.data.bloqueado, rangos: parsed.data.rangos }
      );
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };

  deleteDisponibilidadFecha = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // RBAC: getSedeId valida que `?sede` esté en el alcance del usuario.
      const id = parseId(req.params.id);
      if (id === null) {
        res.status(400).json({ success: false, error: { code: 'INVALID_ID', message: 'ID inválido.' } });
        return;
      }
      const sedeId = await resolveSedeOf(req, res, id);
      if (sedeId === null) return;
      const fecha = typeof req.query.fecha === 'string' ? req.query.fecha : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_DATE', message: 'fecha es requerida (YYYY-MM-DD).' } });
        return;
      }
      const modalidadRaw = req.query.modalidad;
      const modalidad =
        modalidadRaw === 'presencial' || modalidadRaw === 'virtual' ? modalidadRaw : 'virtual';
      const result = await disponibilidadFechaService.clearByFecha(id, sedeId, fecha, modalidad);
      if (!result.ok) {
        res.status(result.status).json({ success: false, error: result.error });
        return;
      }
      res.status(200).json({ success: true, data: result.data });
    } catch (err) {
      next(err);
    }
  };
}

export default new ProfesionalesController();

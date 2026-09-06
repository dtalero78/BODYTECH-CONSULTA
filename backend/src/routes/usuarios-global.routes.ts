// ============================================================================
// Router /api/usuarios-global/* — Creación de Usuarios.
//
// El panel único desde el que se crean, editan e inhabilitan los usuarios de
// las tres aplicaciones. El rol que se asigna decide a qué plataforma llega la
// persona al iniciar sesión.
//
// ── Por qué Consulta se crea distinto ──────────────────────────────────────
// Un usuario de Consulta tiene que existir TAMBIÉN en la tabla local: de su id
// cuelgan las vistas guardadas del coordinador, la auditoría y el vínculo con
// su ficha de profesional. Por eso para 'consulta' se llama al servicio de
// siempre —que crea local y refleja en la global— y para ACC y prepagadas se
// escribe directo en la global, que es lo único que esas aplicaciones leen.
//
// Sólo admin: crea cuentas con el rol que se le indique.
// ============================================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import usuariosGlobalService from '../services/usuarios-global.service';
import usuariosService from '../services/usuarios.service';

const router = Router();

/**
 * Roles válidos POR aplicación. No hay un vocabulario único a propósito: un
 * fisioterapeuta no existe como rol en prepagadas, y forzar una lista común
 * sería inventar una realidad que no existe.
 */
const ROLES_POR_APP: Record<string, readonly string[]> = {
  consulta: ['admin', 'coordinador', 'medico', 'coach', 'auxiliar', 'torre'],
  acc: ['admin', 'fisioterapeuta'],
  prepagadas: ['admin', 'asesor', 'profesional'],
};

const crearSchema = z
  .object({
    email: z.string().email(),
    nombre: z.string().trim().min(2, 'El nombre es muy corto.').max(200),
    password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
    documento: z.string().trim().regex(/^[0-9]{5,15}$/).nullable().optional(),
    app: z.enum(['consulta', 'acc', 'prepagadas']),
    rol: z.string().min(1),
    sedes: z.array(z.string()).optional(),
    esGlobal: z.boolean().optional(),
  })
  .refine((v) => ROLES_POR_APP[v.app]?.includes(v.rol), {
    message: 'Ese rol no existe en esa aplicación.',
    path: ['rol'],
  });

router.get('/roles', (_req: Request, res: Response) => {
  res.json({ success: true, data: ROLES_POR_APP });
});

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: await usuariosGlobalService.listar() });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  const parsed = crearSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.error.issues[0]?.message ?? 'Datos inválidos.',
    });
    return;
  }
  const d = parsed.data;
  try {
    if (d.app === 'consulta') {
      // Camino local + reflejo: ver la cabecera.
      const r = await usuariosService.create({
        email: d.email,
        passwordHash: bcrypt.hashSync(d.password, 10),
        nombre: d.nombre,
        rol: d.rol as never,
        esGlobal: d.esGlobal ?? false,
        sedes: d.sedes ?? [],
        profesionalId: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      if (!r.ok) {
        res.status(r.error === 'EMAIL_TAKEN' ? 409 : 500).json({
          success: false,
          error: r.error,
          message: r.error === 'EMAIL_TAKEN' ? 'Ya existe un usuario con ese correo.' : 'No se pudo crear.',
        });
        return;
      }
      res.status(201).json({ success: true, id: r.id });
      return;
    }

    const r = await usuariosGlobalService.crear({
      email: d.email,
      password: d.password,
      nombre: d.nombre,
      documento: d.documento ?? null,
      app: d.app,
      rol: d.rol,
      alcance: d.sedes && d.sedes.length > 0 ? { sedes: d.sedes } : {},
    });
    if (!r.ok) {
      res.status(500).json({ success: false, error: r.error, message: 'No se pudo crear.' });
      return;
    }
    res.status(201).json({ success: true, id: r.id });
  } catch (e) {
    next(e);
  }
});

const editarSchema = z.object({
  nombre: z.string().trim().min(2).max(200).optional(),
  documento: z.string().trim().regex(/^[0-9]{5,15}$/).nullable().optional(),
  activo: z.boolean().optional(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.').optional(),
  app: z.enum(['consulta', 'acc', 'prepagadas']).optional(),
  rol: z.string().optional(),
  accesoActivo: z.boolean().optional(),
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  const id = Number(req.params.id);
  const parsed = editarSchema.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success) {
    res.status(400).json({
      success: false,
      error: 'VALIDACION',
      message: parsed.success ? 'Id inválido.' : parsed.error.issues[0]?.message,
    });
    return;
  }
  const d = parsed.data;
  if (d.app && d.rol && !ROLES_POR_APP[d.app]?.includes(d.rol)) {
    res.status(400).json({ success: false, error: 'VALIDACION', message: 'Ese rol no existe en esa aplicación.' });
    return;
  }
  try {
    await usuariosGlobalService.editar(id, d);
    res.json({ success: true });
  } catch (e) {
    next(e);
  }
});

export default router;

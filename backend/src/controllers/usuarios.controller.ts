// ============================================================================
// usuarios.controller — Gestión de usuarios (admin + coordinador).
//
// Envelope { success, data?, error? }. La ruta se monta con
// requireRole('admin','coordinador'); aquí se aplican los LÍMITES DE PRIVILEGIO
// (P7):
//   - El coordinador solo crea/edita roles medico|coach|auxiliar (NUNCA admin
//     ni coordinador) y solo asigna usuarios a SUS sedes. No puede tocar
//     usuarios globales ni de sedes ajenas.
//   - Solo el admin crea admins/coordinadores, asigna cualquier sede y marca
//     es_global.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';
import usuariosService, { Rol, UsuarioListItem } from '../services/usuarios.service';
import { getSession } from '../middleware/rbac.middleware';
import { SessionPayload } from '../services/auth.service';

const ALL_ROLES = ['admin', 'coordinador', 'medico', 'coach', 'auxiliar', 'torre'] as const;
const ROLES_GESTIONABLES_COORD: Rol[] = ['medico', 'coach', 'auxiliar'];

const createSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  nombre: z.string().min(1).max(200),
  rol: z.enum(ALL_ROLES),
  sedes: z.array(z.string().min(1)).optional().default([]),
  esGlobal: z.boolean().optional().default(false),
  profesionalId: z.number().int().positive().nullable().optional(),
});

const updateSchema = z
  .object({
    nombre: z.string().min(1).max(200).optional(),
    rol: z.enum(ALL_ROLES).optional(),
    activo: z.boolean().optional(),
    sedes: z.array(z.string().min(1)).optional(),
    esGlobal: z.boolean().optional(),
    profesionalId: z.number().int().positive().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Debe enviar al menos un campo.');

const resetPasswordSchema = z.object({
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

function validation(res: Response, err: ZodError): void {
  res.status(400).json({
    success: false,
    error: 'VALIDATION_ERROR',
    details: err.errors.map((e) => ({ field: e.path.join('.') || '(root)', issue: e.message })),
  });
}

function forbidden(res: Response, msg = 'No tienes permiso para esta acción.'): void {
  res.status(403).json({ success: false, error: 'FORBIDDEN', message: msg });
}

// --- Reglas de privilegio (P7) ---

function puedeAsignarRol(actor: SessionPayload, rol: Rol): boolean {
  if (actor.role === 'admin') return true;
  return ROLES_GESTIONABLES_COORD.includes(rol);
}

function puedeUsarSedes(actor: SessionPayload, sedes: string[]): boolean {
  if (actor.role === 'admin') return true;
  return sedes.every((s) => actor.sedes.includes(s));
}

/** ¿El actor puede ver/editar/resetear a este usuario destino? */
function puedeGestionar(actor: SessionPayload, target: UsuarioListItem): boolean {
  if (actor.role === 'admin') return true;
  if (target.esGlobal) return false;
  if (!ROLES_GESTIONABLES_COORD.includes(target.rol)) return false;
  // Todas las sedes del destino deben estar dentro del alcance del coordinador.
  return target.sedes.every((s) => actor.sedes.includes(s));
}

class UsuariosController {
  list = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = getSession(req)!; // requireRole garantiza sesión
      const opts =
        actor.role === 'admin'
          ? {}
          : { soloRoles: ROLES_GESTIONABLES_COORD, soloSedes: actor.sedes };
      const data = await usuariosService.list(opts);
      if (data === null) {
        res.status(500).json({ success: false, error: 'DB_ERROR' });
        return;
      }
      res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  };

  create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) return validation(res, parsed.error);
      const actor = getSession(req)!;
      const input = parsed.data;

      // es_global solo admin.
      if (input.esGlobal && actor.role !== 'admin') {
        return forbidden(res, 'Solo un administrador puede crear usuarios globales.');
      }
      // Rol asignable.
      if (!puedeAsignarRol(actor, input.rol)) {
        return forbidden(res, 'No puedes crear usuarios con ese rol.');
      }
      // Sedes (cuando no es global) dentro del alcance y al menos una.
      const sedes = input.esGlobal ? [] : input.sedes;
      if (!input.esGlobal) {
        if (sedes.length === 0) {
          res.status(400).json({ success: false, error: 'SEDES_REQUERIDAS', message: 'Asigna al menos una sede.' });
          return;
        }
        if (!puedeUsarSedes(actor, sedes)) {
          return forbidden(res, 'No puedes asignar sedes fuera de tu alcance.');
        }
      }

      const exists = await usuariosService.emailExists(input.email);
      if (exists === null) {
        res.status(500).json({ success: false, error: 'DB_ERROR' });
        return;
      }
      if (exists) {
        res.status(409).json({ success: false, error: 'EMAIL_TAKEN', message: 'Ese email ya está registrado.' });
        return;
      }

      const passwordHash = await usuariosService.hashPassword(input.password);
      const result = await usuariosService.create({
        email: input.email,
        passwordHash,
        nombre: input.nombre,
        rol: input.rol,
        esGlobal: input.esGlobal,
        profesionalId: input.profesionalId ?? null,
        sedes,
      });
      if (!result.ok) {
        if (result.error === 'EMAIL_TAKEN') {
          res.status(409).json({ success: false, error: 'EMAIL_TAKEN' });
          return;
        }
        res.status(500).json({ success: false, error: result.error ?? 'DB_ERROR' });
        return;
      }
      res.status(201).json({ success: true, data: { id: result.id } });
    } catch (err) {
      next(err);
    }
  };

  update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, error: 'INVALID_ID' });
        return;
      }
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) return validation(res, parsed.error);
      const actor = getSession(req)!;
      const fields = parsed.data;

      // El destino debe existir y ser gestionable por el actor.
      const target = await usuariosService.getById(id);
      if (!target) {
        res.status(404).json({ success: false, error: 'NOT_FOUND' });
        return;
      }
      if (!puedeGestionar(actor, target)) {
        return forbidden(res, 'No puedes gestionar a este usuario.');
      }
      // Auto-bloqueo: nadie se desactiva a sí mismo.
      if (fields.activo === false && actor.userId === id) {
        return forbidden(res, 'No puedes desactivar tu propia cuenta.');
      }
      // Cambios de rol → debe ser asignable por el actor.
      if (fields.rol !== undefined && !puedeAsignarRol(actor, fields.rol)) {
        return forbidden(res, 'No puedes asignar ese rol.');
      }
      // es_global solo admin.
      if (fields.esGlobal === true && actor.role !== 'admin') {
        return forbidden(res, 'Solo un administrador puede marcar un usuario global.');
      }
      // Cambios de sedes → dentro del alcance del actor.
      if (fields.sedes !== undefined && !fields.esGlobal && !puedeUsarSedes(actor, fields.sedes)) {
        return forbidden(res, 'No puedes asignar sedes fuera de tu alcance.');
      }

      const result = await usuariosService.update(
        id,
        {
          nombre: fields.nombre,
          rol: fields.rol,
          activo: fields.activo,
          esGlobal: fields.esGlobal,
          profesionalId: fields.profesionalId,
        },
        fields.sedes
      );
      if (!result.ok) {
        const code = result.error === 'NOT_FOUND' ? 404 : 500;
        res.status(code).json({ success: false, error: result.error ?? 'DB_ERROR' });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        res.status(400).json({ success: false, error: 'INVALID_ID' });
        return;
      }
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) return validation(res, parsed.error);
      const actor = getSession(req)!;

      const target = await usuariosService.getById(id);
      if (!target) {
        res.status(404).json({ success: false, error: 'NOT_FOUND' });
        return;
      }
      if (!puedeGestionar(actor, target)) {
        return forbidden(res, 'No puedes resetear la contraseña de este usuario.');
      }

      const hash = await usuariosService.hashPassword(parsed.data.password);
      const ok = await usuariosService.setPassword(id, hash);
      if (!ok) {
        res.status(500).json({ success: false, error: 'DB_ERROR' });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };
}

export default new UsuariosController();

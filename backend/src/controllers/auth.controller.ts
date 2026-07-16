// ============================================================================
// authController — Run 5 (multi-sede login).
//
// Endpoints:
//   POST /api/auth/login   → emite JWT { medicoCode, sedeId }
//   GET  /api/auth/sedes   → lista de sedes activas (público, sin auth)
//
// Sigue el shape uniforme `{ success, data?, error? }` del resto de los
// controllers. Errores no esperados se delegan al `errorHandler` global vía
// `next(err)`.
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import authService from '../services/auth.service';
import usuariosService from '../services/usuarios.service';
import emailService from '../services/email.service';

const loginSchema = z.object({
  medicoCode: z.string().min(1),
  sedeId: z.string().min(1),
});

const passwordLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

class AuthController {
  login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          details: parsed.error.errors,
        });
        return;
      }

      const { medicoCode, sedeId } = parsed.data;

      const result = await authService.login(medicoCode, sedeId);
      if (!result.ok) {
        const status = result.error === 'DB_ERROR' ? 500 : 401;
        res.status(status).json({
          success: false,
          error: result.error ?? 'UNKNOWN',
        });
        return;
      }

      res.status(200).json({
        success: true,
        token: result.token,
        medicoCode,
        sedeId,
        rol: result.rol,
        especialidad: result.especialidad ?? null,
      });
    } catch (err) {
      next(err);
    }
  };

  // RBAC — Login por email + contraseña (nueva auth).
  passwordLogin = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = passwordLoginSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          details: parsed.error.errors,
        });
        return;
      }

      const { email, password, remember } = parsed.data;
      const result = await authService.loginWithPassword(email, password, remember ?? false);
      if (result.ok) {
        res.status(200).json({
          success: true,
          token: result.token,
          user: result.user,
        });
        return;
      }

      // Puerta única: si no es un usuario de consulta (credenciales inválidas
      // aquí), probar contra la app hermana "prepagadas". Si autentica, el
      // frontend redirige a prepagadas con el token en el fragmento (#…).
      if (result.error === 'INVALID_CREDENTIALS') {
        const prepa = await authService.loginPrepagadas(email, password);
        if (prepa.ok) {
          res.status(200).json({
            success: true,
            program: 'prepagadas',
            token: prepa.token,
            redirectUrl: prepa.redirectUrl,
          });
          return;
        }
      }

      const status = result.error === 'DB_ERROR' ? 500 : 401;
      res.status(status).json({ success: false, error: result.error ?? 'UNKNOWN' });
    } catch (err) {
      next(err);
    }
  };

  // RBAC — "Olvidé mi contraseña". Responde SIEMPRE 200 (no revela si el email
  // existe). Si existe un usuario activo, le envía el enlace por Resend.
  forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, error: 'VALIDATION_ERROR' });
        return;
      }
      const { email } = parsed.data;
      const row = await usuariosService.findActiveByEmail(email);
      if (row) {
        const token = authService.createPasswordResetToken(row.id, row.password_hash);
        const base = process.env.BASE_URL || 'https://bodytech.app';
        const link = `${base.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(token)}`;
        // No bloqueamos la respuesta por el envío; logueamos si falla.
        emailService.sendPasswordReset(row.email, row.nombre, link).then((ok) => {
          if (!ok) console.error(`⚠️ [forgot-password] No se pudo enviar a ${row.email}`);
        });
      }
      // Respuesta uniforme — no filtra existencia del email.
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  // RBAC — Fija una nueva contraseña a partir del token del email.
  resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          details: parsed.error.errors,
        });
        return;
      }
      const { token, password } = parsed.data;
      const userId = await authService.verifyPasswordResetToken(token);
      if (userId === null) {
        res.status(400).json({ success: false, error: 'INVALID_TOKEN' });
        return;
      }
      const hash = await usuariosService.hashPassword(password);
      const ok = await usuariosService.setPassword(userId, hash);
      if (!ok) {
        res.status(500).json({ success: false, error: 'DB_ERROR' });
        return;
      }
      res.status(200).json({ success: true });
    } catch (err) {
      next(err);
    }
  };

  getSedes = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const sedes = await authService.getSedes();
      res.status(200).json({
        success: true,
        data: sedes,
      });
    } catch (err) {
      next(err);
    }
  };
}

export default new AuthController();

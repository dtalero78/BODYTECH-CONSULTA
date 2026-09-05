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

const registroBuscarSchema = z.object({
  documento: z.string().min(1),
});

// La validación de fondo (¿existe la cédula? ¿es fisioterapeuta? ¿el correo
// está libre?) la hace ACC, que es quien tiene el directorio y la tabla. Acá
// solo se comprueba la forma, para no reenviar basura ni pagar el viaje.
const registroSchema = z.object({
  documento: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
  foto: z.string().startsWith('data:image/', 'La foto no llegó en el formato esperado.'),
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
      // aquí), probar contra las apps hermanas (prepagadas, acc). Si alguna
      // autentica, el frontend redirige allá con el token en el fragmento (#…).
      if (result.error === 'INVALID_CREDENTIALS') {
        const hermana = await authService.loginHermanas(email, password);
        if (hermana.ok) {
          res.status(200).json({
            success: true,
            program: hermana.programa,
            token: hermana.token,
            redirectUrl: hermana.redirectUrl,
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

  // ==========================================================================
  // Registro de profesionales (público). La pantalla es de acá; la cuenta se
  // crea en ACC. Ver `authService.proxyRegistro` para por qué es un proxy.
  // ==========================================================================

  /**
   * POST /api/auth/registro/buscar — cruza la cédula contra el directorio
   * compartido y devuelve la ficha para que la persona la confirme.
   */
  registroBuscar = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = registroBuscarSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({ ok: false, codigo: 'validacion_fallida', mensaje: 'Falta la cédula.' });
        return;
      }
      const { status, body } = await authService.proxyRegistro('buscar', parsed.data);
      res.status(status).json(body);
    } catch (err) {
      next(err);
    }
  };

  /**
   * POST /api/auth/registro — crea la cuenta en ACC y devuelve el handoff.
   *
   * La respuesta lleva `redirectUrl` + `token` con la misma forma que un login
   * hacia una app hermana, así que el frontend termina el registro por el mismo
   * camino que ya conoce: `${redirectUrl}#t=${token}`.
   */
  registro = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = registroSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          ok: false,
          codigo: 'validacion_fallida',
          mensaje: parsed.error.errors[0]?.message ?? 'Datos del registro inválidos.',
        });
        return;
      }

      const { status, body } = await authService.proxyRegistro('crear', parsed.data);
      const datos = body as { ok?: boolean; token?: string };
      if (status === 201 && datos?.token) {
        res.status(201).json({
          ok: true,
          program: 'acc',
          token: datos.token,
          redirectUrl: authService.ssoUrlAcc(),
        });
        return;
      }
      res.status(status).json(body);
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

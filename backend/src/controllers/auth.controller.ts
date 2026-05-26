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

const loginSchema = z.object({
  medicoCode: z.string().min(1),
  sedeId: z.string().min(1),
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
      });
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

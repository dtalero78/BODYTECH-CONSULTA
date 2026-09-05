// ============================================================================
// auth.routes — Run 5 (multi-sede login).
//
// Rutas públicas (sin `requireAuthMiddleware`):
//   POST /api/auth/login   → emite JWT
//   GET  /api/auth/sedes   → lista sedes activas para popular el <select>
// ============================================================================

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import authController from '../controllers/auth.controller';

const router = Router();

// Rate-limit anti fuerza-bruta / abuso (requiere app.set('trust proxy') para
// que la clave sea la IP real detrás del proxy de DigitalOcean).
// Login: protege contra fuerza bruta de contraseñas (y DoS por bcrypt).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20, // 20 intentos por IP por ventana
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'RATE_LIMIT', message: 'Demasiados intentos. Espera unos minutos.' },
});
// Forgot-password: evita inundar correos y abusar la cuota de Resend.
const forgotLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5, // 5 solicitudes por IP por hora
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'RATE_LIMIT', message: 'Demasiadas solicitudes. Intenta más tarde.' },
});

/**
 * Registro de profesionales. Es el único punto del sistema donde alguien sin
 * cuenta puede consultar el directorio de Bodytech con una cédula, así que el
 * límite es lo que evita que se barra el rango entero de cédulas para ver
 * quién trabaja ahí.
 *
 * 10 por IP por hora: el uso legítimo es una persona registrándose una vez en
 * su vida (con un par de intentos si escribe mal el número). Va acá y no en
 * ACC porque acá se ve la IP del navegador — allá todos los intentos llegan
 * desde la nuestra.
 */
const registroLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    codigo: 'demasiados_intentos',
    mensaje: 'Demasiados intentos de registro. Esperá una hora o pedile la cuenta a tu coordinador.',
  },
});

router.post('/login', loginLimiter, authController.login);
// RBAC — nueva auth por email+contraseña.
router.post('/password-login', loginLimiter, authController.passwordLogin);
// Reset de contraseña por email (Resend). Públicos pero con rate-limit.
router.post('/forgot-password', forgotLimiter, authController.forgotPassword);
router.post('/reset-password', loginLimiter, authController.resetPassword);
// Registro de profesionales: público (todavía no tienen cuenta). La cuenta se
// crea en ACC; acá solo vive la pantalla y el rate-limit por IP real.
router.post('/registro/buscar', registroLimiter, authController.registroBuscar);
router.post('/registro', registroLimiter, authController.registro);
router.get('/sedes', authController.getSedes);

export default router;

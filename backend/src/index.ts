import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import appConfig from './config/app.config';
import authRoutes from './routes/auth.routes';
import videoRoutes from './routes/video.routes';
import telemedicineRoutes from './routes/telemedicine.routes';
import medicalPanelRoutes from './routes/medical-panel.routes';
import twilioVoiceRoutes from './routes/twilio-voice.routes';
import calidadRoutes from './routes/calidad.routes';
import trepsiRoutes from './routes/trepsi.routes';
import profesionalesRoutes from './routes/profesionales.routes';
import calendarioRoutes from './routes/calendario.routes';
import usuariosRoutes from './routes/usuarios.routes';
import botTrepsiRoutes from './routes/bot-trepsi.routes';
import trepsiWebhookAdminRoutes from './routes/trepsi-webhook-admin.routes';
import trepsiWebhookService from './services/trepsi-webhook.service';
import { requireApiKey } from './middleware/api-key.middleware';
import { telemedicineSocketService } from './services/telemedicine-socket.service';
import { sessionTracker } from './services/session-tracker.service';
import { errorHandler } from './middleware/error.middleware';
import { sedeMiddleware } from './middleware/sede.middleware';
import {
  optionalAuthMiddleware,
  requireAuthMiddleware,
} from './middleware/auth.middleware';
import { sessionContextMiddleware, requireRole } from './middleware/rbac.middleware';

const app: Application = express();
const httpServer = createServer(app);

// Initialize Socket.io with CORS configuration
const io = new Server(httpServer, {
  cors: {
    origin: appConfig.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// Initialize telemedicine socket service
telemedicineSocketService.initialize(io);
console.log('[Socket.io] Telemedicine service initialized');

// Initialize session tracker with Socket.io
sessionTracker.initialize(io);
console.log('[Socket.io] Session tracker initialized');

// Socket.io: Handle join-room event for doctors
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);

  socket.on('join-room', (roomName: string) => {
    socket.join(roomName);
    console.log(`[Socket.io] Socket ${socket.id} joined room: ${roomName}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// Middleware de seguridad - Configurado para servir archivos estaticos
app.use(
  helmet({
    contentSecurityPolicy: false, // Permitir carga de recursos del frontend
    crossOriginEmbedderPolicy: false, // Necesario para Twilio Video
  })
);

// CORS - Solo necesario si se accede desde otro dominio
app.use(
  cors({
    origin: appConfig.allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Logging
if (appConfig.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// Run 5 — Multi-sede login: si el request lleva `Authorization: Bearer <jwt>`,
// enriquece `req.medicoCode` y `req.sedeId`. NUNCA corta el request — sólo
// agrega contexto. Va ANTES de `sedeMiddleware` para que el JWT (cuando
// exista) gane sobre cualquier header `X-Sede-Id` que el cliente mande.
app.use(optionalAuthMiddleware);

// RBAC (nueva auth email+contraseña): si hay token de sesión válido, adjunta
// `req.session` + `req.sedeScope`. NO bloquea — el gating lo hace requireRole
// por grupo de rutas. Va después de optionalAuthMiddleware (tokens legacy) para
// que ambos esquemas coexistan durante la transición.
app.use(sessionContextMiddleware);

// Run 4 — Multi-tenancy: extrae `sedeId` del header `X-Sede-Id` (o ?sede=)
// y lo deja en `(req as any).sedeId` con default `'bsl'`. Debe ir DESPUÉS de
// CORS / body parser y ANTES de cualquier `app.use('/api/...', ...)`.
app.use(sedeMiddleware);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: appConfig.nodeEnv,
  });
});

// API Routes
// `/api/auth` es público (login + listado de sedes para el form).
app.use('/api/auth', authRoutes);
// `/api/video` y `/api/telemedicine` son públicos — pacientes acceden por link
// de WhatsApp sin cuenta y NO tienen JWT.
app.use('/api/video', videoRoutes);
app.use('/api/telemedicine', telemedicineRoutes);
// `/api/medical-panel` — RBAC por ruta (pacientes: clínico; órdenes: operativo).
// El gating vive en medical-panel.routes.ts (roles distintos por sub-ruta).
app.use('/api/medical-panel', medicalPanelRoutes);
// Panel Coordinador — RBAC: solo coordinador/admin gestionan profesionales y
// disponibilidad; el calendario lo ve además el auxiliar (agendar citas).
app.use('/api/profesionales', requireRole('coordinador', 'admin'), profesionalesRoutes);
app.use('/api/calendario', requireRole('coordinador', 'admin', 'auxiliar'), calendarioRoutes);
// Gestión de usuarios — admin + coordinador (límites P7 en el controller).
app.use('/api/usuarios', requireRole('admin', 'coordinador'), usuariosRoutes);
// Bot de asistencia técnica para el equipo Trepsi durante la integración.
// Público (sin JWT, sin API Key) — el system prompt + rate limit lo protegen.
app.use('/api/bot-trepsi', botTrepsiRoutes);
app.use('/api/twilio', twilioVoiceRoutes);
// Calidad — antes público; ahora solo coordinador/admin (auditoría).
app.use('/api/calidad', requireRole('coordinador', 'admin'), calidadRoutes);
// Admin del outbox del webhook BSL → Trepsi (JWT requerido).
app.use('/api/admin/trepsi-webhook', requireAuthMiddleware, trepsiWebhookAdminRoutes);
// Integración Trepsi (B2B, API Key). Mismo origen sirve staging y prod —
// la API Key se rota por ambiente (TREPSI_API_KEY).
app.use(
  '/api/v1/integrations/trepsi',
  requireApiKey('TREPSI_API_KEY', 'trepsi'),
  trepsiRoutes
);

// Servir archivos estaticos del frontend (despues de las rutas API)
const frontendPath = path.join(__dirname, '..', 'frontend-dist');
app.use(express.static(frontendPath));

// SPA fallback - Todas las rutas no API devuelven index.html
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handler global — DEBE registrarse al final, después de todas las
// rutas (Express identifica los handlers de error por su aridad de 4 args).
app.use(errorHandler);

// Run database migrations, luego sembrar el admin inicial (idempotente).
import postgresService from './services/postgres.service';
import usuariosService from './services/usuarios.service';
postgresService
  .runMigrations()
  .then(() => usuariosService.seedBootstrapAdmin())
  .catch((e) => console.error('❌ [bootstrap] Error en migraciones/siembra:', e?.message ?? e));

// Worker del outbox del webhook Trepsi: cada 30 s recorre la cola y reenvía
// las filas pending listas (con backoff exponencial). Si TREPSI_WEBHOOK_URL
// no está configurada, el dispatch retorna sin hacer nada (no rompe nada).
const TREPSI_WEBHOOK_INTERVAL_MS = 30_000;
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    trepsiWebhookService.dispatchPending().catch((e) => {
      console.error('[trepsi-webhook] worker error:', e?.message ?? e);
    });
  }, TREPSI_WEBHOOK_INTERVAL_MS);
  console.log(`📨 [Trepsi-Webhook] Worker iniciado (cada ${TREPSI_WEBHOOK_INTERVAL_MS / 1000}s)`);
}

// Start server
const PORT = appConfig.port;

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🎥  BSL CONSULTA VIDEO - Backend API                    ║
║                                                           ║
║   Server running on: http://localhost:${PORT}              ║
║   Environment: ${appConfig.nodeEnv.toUpperCase().padEnd(43)}║
║                                                           ║
║   API Endpoints:                                          ║
║   - Health Check:  GET  /health                           ║
║   - Video Token:   POST /api/video/token                  ║
║   - Create Room:   POST /api/video/rooms                  ║
║   - Get Room:      GET  /api/video/rooms/:roomName        ║
║   - Get Sessions:  GET  /api/telemedicine/sessions        ║
║   - Validate Sess: GET  /api/telemedicine/sessions/:room  ║
║   - Medical Panel: GET  /api/medical-panel/stats/:code    ║
║                                                           ║
║   WebSocket Services:                                     ║
║   - Telemedicine:  /telemedicine (Socket.io)              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;

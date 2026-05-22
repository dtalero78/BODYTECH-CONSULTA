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
import { requireApiKey } from './middleware/api-key.middleware';
import { telemedicineSocketService } from './services/telemedicine-socket.service';
import { sessionTracker } from './services/session-tracker.service';
import { errorHandler } from './middleware/error.middleware';
import { sedeMiddleware } from './middleware/sede.middleware';
import {
  optionalAuthMiddleware,
  requireAuthMiddleware,
} from './middleware/auth.middleware';

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
// `/api/medical-panel` exige JWT válido (médicos logueados).
app.use('/api/medical-panel', requireAuthMiddleware, medicalPanelRoutes);
app.use('/api/twilio', twilioVoiceRoutes);
app.use('/api/calidad', calidadRoutes);
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

// Run database migrations
import postgresService from './services/postgres.service';
postgresService.runMigrations();

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

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
import torniqueteRoutes from './routes/torniquete.routes';
import torniqueteService from './services/torniquete.service';
import usuariosRoutes from './routes/usuarios.routes';
import botTrepsiRoutes from './routes/bot-trepsi.routes';
import trepsiWebhookAdminRoutes from './routes/trepsi-webhook-admin.routes';
import trepsiWebhookService from './services/trepsi-webhook.service';
import whatsappLeadsRoutes from './routes/whatsapp-leads.routes';
import whatsappLeadsService from './services/whatsapp-leads.service';
import monitorIntegracionRoutes from './routes/monitor-integracion.routes';
import whatsappChatRoutes from './routes/whatsapp-chat.routes';
import gestionReportAdminRoutes from './routes/gestion-report-admin.routes';
import gestionReportImageRoutes from './routes/gestion-report-image.routes';
import auditRoutes from './routes/audit.routes';
import gestionReportService from './services/gestion-report.service';
import { trepsiMonitorMiddleware } from './middleware/trepsi-monitor.middleware';
import { requireApiKey } from './middleware/api-key.middleware';
import { telemedicineSocketService } from './services/telemedicine-socket.service';
import { sessionTracker } from './services/session-tracker.service';
import { mapaStatsService } from './services/mapa-stats.service';
import { errorHandler } from './middleware/error.middleware';
import { sedeMiddleware } from './middleware/sede.middleware';
import { optionalAuthMiddleware } from './middleware/auth.middleware';
import { sessionContextMiddleware, requireRole } from './middleware/rbac.middleware';
import { torniquetePresenceMiddleware } from './middleware/torniquete-presence.middleware';
import { auditMiddleware } from './middleware/audit.middleware';

const app: Application = express();
// Detrás del proxy de DigitalOcean App Platform: confiar en X-Forwarded-For
// para que req.ip sea la IP real del cliente (necesario para los rate-limiters
// y el limitador por-IP del bot Trepsi).
app.set('trust proxy', 1);
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

// Feed en vivo del Mapa de Rutas (namespace aislado /mapa-rutas, privado).
// Requiere 1 sola instancia (usa sessionTracker en memoria + Socket.io sin Redis).
mapaStatsService.initialize(io);
console.log('[Socket.io] Mapa de Rutas stats initialized');

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

// Torniquete de jornada: cualquier acción autenticada de un médico/coach cuenta
// como presencia (además del heartbeat del frontend). No bloquea, fire-and-forget
// con throttle. Va después de optionalAuth/session/sede para tener la identidad.
app.use(torniquetePresenceMiddleware);

// Audit log global: registra en `audit_log` cada mutación /api relevante con el
// actor del token/sesión. Fire-and-forget (res.on('finish')); nunca bloquea ni
// rompe el request. Va después de optionalAuth/session/sede para tener identidad.
app.use(auditMiddleware);

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
// Panel Coordinador — RBAC por-ruta DENTRO de cada router: la gestión de
// profesionales/disponibilidad y las vistas del calendario siguen siendo
// coordinador/admin(/auxiliar), pero el LISTADO de profesionales y los HORARIOS
// disponibles los consultan además médico/coach al autoagendar su propia cita
// desde /panel-medico (ver profesionales.routes.ts y calendario.routes.ts).
app.use('/api/profesionales', profesionalesRoutes);
app.use('/api/calendario', calendarioRoutes);
// Torniquete de jornada: heartbeat/logout (identidad derivada del token en el
// controller) + tablero del día (RBAC operativo dentro del router).
app.use('/api/torniquete', torniqueteRoutes);
// Gestión de usuarios — admin + coordinador (límites P7 en el controller).
app.use('/api/usuarios', requireRole('admin', 'coordinador'), usuariosRoutes);
// Bot de asistencia técnica para el equipo Trepsi durante la integración.
// Público (sin JWT, sin API Key) — el system prompt + rate limit lo protegen.
app.use('/api/bot-trepsi', botTrepsiRoutes);
app.use('/api/twilio', twilioVoiceRoutes);
// WhatsApp Leads — webhook público de WHAPI para capturar la "entidad" del
// lead. Sin JWT (lo llama WHAPI); se protege con WHAPI_WEBHOOK_SECRET opcional.
app.use('/api/whatsapp-leads', whatsappLeadsRoutes);

// Chat de WhatsApp del panel médico. La protección RBAC vive por-ruta dentro
// del router (el /webhook de Twilio debe quedar público).
app.use('/api/whatsapp-chat', whatsappChatRoutes);
// Calidad — antes público; ahora solo coordinador/admin (auditoría).
app.use('/api/calidad', requireRole('coordinador', 'admin'), calidadRoutes);
// Admin del outbox del webhook BSL → Trepsi (contiene PHI). RBAC: solo
// admin/coordinador (antes usaba el token legacy code+sede → cualquier médico).
app.use('/api/admin/trepsi-webhook', requireRole('admin', 'coordinador'), trepsiWebhookAdminRoutes);
// Bitácora de auditoría global (audit_log) — solo admin/coordinador.
app.use('/api/admin/audit', requireRole('admin', 'coordinador'), auditRoutes);
app.use('/api/admin/gestion-report', requireRole('admin'), gestionReportAdminRoutes);
// Público (sin auth): Twilio toma el PNG del tablero de aquí como media.
app.use('/api/public/gestion-report-image', gestionReportImageRoutes);
// Integración Trepsi (B2B, API Key). Mismo origen sirve staging y prod —
// la API Key se rota por ambiente (TREPSI_API_KEY).
// El middleware `trepsiMonitorMiddleware` registra CADA request en
// trepsi_integration_log para que aparezcan en /monitor-integracion.
app.use(
  '/api/v1/integrations/trepsi',
  requireApiKey('TREPSI_API_KEY', 'trepsi'),
  trepsiMonitorMiddleware,
  trepsiRoutes
);

// Monitor de integración (sin JWT, token simple). Pensado para uso del owner
// durante pruebas — el dashboard en /monitor-integracion consume estos endpoints.
app.use('/api/monitor-integracion', monitorIntegracionRoutes);

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
import { chimeRecordingService } from './services/video/chime-recording.service';
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

// Worker de WhatsApp Leads: cada 30 s vuelca a Google Sheets las entidades
// capturadas (tras la ventana de silencio) y purga preguntas sin responder.
// Si GSHEET_WEBAPP_URL no está configurada, el flush no-op (no rompe nada).
const WHATSAPP_LEADS_INTERVAL_MS = 30_000;
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    whatsappLeadsService.flushReadyLeads().catch((e) => {
      console.error('[whatsapp-leads] worker error:', e?.message ?? e);
    });
  }, WHATSAPP_LEADS_INTERVAL_MS);
  console.log(`🟢 [WhatsApp-Leads] Worker iniciado (cada ${WHATSAPP_LEADS_INTERVAL_MS / 1000}s)`);
}

// Worker del Informe de Gestión: cada 5 min chequea si ya pasó la hora objetivo
// (Colombia) y, de ser así, envía UNA vez al día el resumen a los admins con
// celular. La idempotencia (at-most-once por día, aun con reinicios) la garantiza
// `gestion_report_log` con INSERT ON CONFLICT DO NOTHING. Si la plantilla
// (TWILIO_WHATSAPP_GESTION_TEMPLATE_SID) no está configurada, el worker no-op.
const GESTION_REPORT_INTERVAL_MS = 5 * 60_000;
const GESTION_REPORT_HORA = process.env.GESTION_REPORT_HORA || '19:30'; // HH:MM Colombia
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    gestionReportService.maybeSendDaily(GESTION_REPORT_HORA).catch((e) => {
      console.error('[gestion-report] worker error:', e?.message ?? e);
    });
  }, GESTION_REPORT_INTERVAL_MS);
  console.log(`📊 [Gestión] Worker iniciado (envío diario ~${GESTION_REPORT_HORA} COT)`);
}

// Worker del Torniquete: cada 60s cierra las jornadas cuyo último latido superó
// la ventana de inactividad (cierre de pestaña / equipo suspendido / caída de
// internet). La "salida efectiva" queda en el último latido conocido. Persistido
// en Postgres → sobrevive a reinicios del contenedor.
const TORNIQUETE_SWEEP_INTERVAL_MS = 60_000;
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    torniqueteService.cerrarInactivas().catch((e) => {
      console.error('[torniquete] sweeper error:', e?.message ?? e);
    });
  }, TORNIQUETE_SWEEP_INTERVAL_MS);
  console.log(`⏱️  [Torniquete] Worker iniciado (cierre de jornadas inactivas cada ${TORNIQUETE_SWEEP_INTERVAL_MS / 1000}s)`);
}

// Retención del diagnóstico de video: se conservan 30 días. Es telemetría
// operativa, no historia clínica — pasado ese punto solo ocuparía espacio.
const DIAG_RETENCION_INTERVAL_MS = 6 * 60 * 60_000; // cada 6 h
if (process.env.NODE_ENV !== 'test') {
  setInterval(() => {
    postgresService
      .query(`DELETE FROM client_diag WHERE created_at < NOW() - INTERVAL '30 days'`)
      .catch((e) => console.error('[client-diag] limpieza falló:', e?.message ?? e));
  }, DIAG_RETENCION_INTERVAL_MS);
}

// Worker de grabaciones Chime: cada 30 min cierra las capturas que quedaron en
// 'capturing' (p. ej. el contenedor se reinició a mitad de una consulta y endRoom
// nunca corrió). Sin esto, el Media Capture Pipeline sigue corriendo y FACTURANDO.
// Solo se arma si la grabación está activa (RECORDINGS_ENABLED + bucket): mientras
// esté apagada (fase 1/2), no hay worker.
const CHIME_SWEEP_INTERVAL_MS = 30 * 60_000;
if (process.env.NODE_ENV !== 'test' && chimeRecordingService.enabled) {
  setInterval(() => {
    chimeRecordingService.sweepOrphanCaptures().catch((e) => {
      console.error('[chime-recording] sweep error:', e?.message ?? e);
    });
  }, CHIME_SWEEP_INTERVAL_MS);
  console.log(`🎥 [ChimeRecording] Barrido de capturas huérfanas iniciado (cada ${CHIME_SWEEP_INTERVAL_MS / 60000}min)`);
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

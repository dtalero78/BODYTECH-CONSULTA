# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSL Consulta Video is a medical telemedicine platform built around Twilio Video. PostgreSQL is the sole source of truth — there is no Wix integration. The platform includes:

- Twilio Video calls (doctor + patient) with participant recording and post-call compositions
- A medical panel (`/panel-medico`) with multi-sede login, patient list, citas management, and daily stats
- Real-time postural analysis (Socket.io + MediaPipe on the patient, canvas rendering on the doctor)
- Historia clínica (medical record) full editor (`MedicalConsultationPanel`) with 7 tabs, auto-save, and OpenAI-assisted suggestions
- Post-call transcription pipeline: Twilio recording → Whisper → GPT-4o-mini → auto-fill of 11 clinical fields
- Twilio WhatsApp messaging for session reports and patient links (Twilio SDK, template-based)
- Twilio Voice (outbound calls with custom TwiML audio)
- Ordenes panel: CRUD for medical orders
- Calidad module: evaluation of consultation quality using Anthropic Managed Agents + Whisper
- PDF export of historia clínica via Puppeteer (server-side)
- Coordinador panel (`/coordinador`): professionals CRUD, multi-sede calendar, availability management (recurring + per-date override), orders, and a "Team" day panel with drag-and-drop slot reassignment
- Nutritional panel (`/nutricion/:roomName`): a separate variant of the call panel (somatocarta, ISAK anthropometry, Heath-Carter somatotype, AI nutrition plan)
- Trepsi integration (bidirectional B2B): inbound API to create/reschedule/cancel appointments + historias from Trepsi, and an outbound webhook (BSL → Trepsi) that pushes consultation results once the historia is saved
- Bot Trepsi (`/bot-trepsi`): a public, scope-restricted GPT-4o-mini assistant that helps the Trepsi team with the integration

Two halves of the app share one Express server in production: API + WebSocket on `/api/*` and `/socket.io/*`, static React build on everything else.

## Development Commands

### Backend (`backend/`)
```bash
npm install
npm run dev             # nodemon + ts-node, port 3000
npm run build           # tsc → dist/
npm start               # node dist/index.js
npm test                # jest
npm run lint
npm run lint:fix
```

### Frontend (`frontend/`)
```bash
npm install
npm run dev             # vite, port 5173
npm run build           # tsc + vite build → dist/
npm run preview
npm run lint
npm run lint:fix
```

### Full stack locally
Start backend (`:3000`) and frontend (`:5173`) in separate terminals. Frontend hits `VITE_API_BASE_URL` (set to `http://localhost:3000` in dev) for both REST and Socket.io.

### Docker / production build
`Dockerfile` is a 3-stage build that compiles backend, builds the frontend, and copies `frontend/dist/` into `backend/frontend-dist/` so a single Express process serves both.

## High-Level Architecture

### Single-component deployment

**One Express server serves everything.** This is a hard constraint driven by the Digital Ocean App Platform cost target ($5/mo, single Basic XXS).

Routing in [backend/src/index.ts](backend/src/index.ts):
1. `/health` → health check
2. `/api/auth` → authentication (login, sede resolution)
3. `/api/video/*` → Twilio video, tracking events, medical history, AI suggestions, WhatsApp, transcription webhooks
4. `/api/telemedicine/*` → postural analysis session metadata
5. `/api/medical-panel/*` → doctor panel (stats, patient list, search) — requires `requireAuthMiddleware`
6. `/api/profesionales/*` → professionals CRUD + availability (recurring + per-date) — requires `requireAuthMiddleware`
7. `/api/calendario/*` → coordinador calendar (month/day, available slots, bulk reassign) — requires `requireAuthMiddleware`
8. `/api/bot-trepsi/*` → public Trepsi integration assistant chat (no auth; per-IP rate limit in controller)
9. `/api/twilio/*` → outbound voice calls
10. `/api/calidad/*` → calidad evaluation with Anthropic Managed Agents
11. `/api/admin/trepsi-webhook/*` → outbox admin for the BSL → Trepsi webhook — requires `requireAuthMiddleware`
12. `/api/v1/integrations/trepsi/*` → inbound Trepsi B2B API — protected by `requireApiKey('TREPSI_API_KEY', 'trepsi')`
13. `/socket.io/*` → Socket.io (telemedicine + session-tracker broadcasts)
14. Everything else → static frontend (`backend/frontend-dist/`) with SPA fallback to `index.html`

Implication: in dev you have CORS (set `ALLOWED_ORIGINS=http://localhost:5173`); in prod you don't, because frontend and API share an origin. `VITE_API_BASE_URL=""` in production makes the frontend use relative URLs.

Two middlewares run globally before any route:
- `optionalAuthMiddleware` — decodes JWT if present, attaches `req.user`
- `sedeMiddleware` — resolves the current `sede` from the token or request context

### Data layer: PostgreSQL is the sole source of truth

Digital Ocean PostgreSQL accessed via [backend/src/services/postgres.service.ts](backend/src/services/postgres.service.ts) (a single `pg.Pool`, SSL with `rejectUnauthorized: false`, migrations run on boot from `index.ts`).

Main tables:
- `HistoriaClinica` — visit/consultation row keyed by `_id`, with `numeroId` (patient document), `medico` (doctor code), `fechaAtencion` (scheduled), `fechaConsulta` (attended), ~150 snake_case clinical fields, and `transcription_status` / `transcription_text`.
- `formularios` — patient intake form keyed by `numero_id`, with 27 personal antecedent flags and 8 family antecedent flags. Joined via `LEFT JOIN` in [backend/src/services/medical-history.service.ts](backend/src/services/medical-history.service.ts).
- `room_historia_map` — maps Twilio `room_name` (PK) to `historia_id` so the recording webhook can find the right record.
- `ordenes` — medical orders with CRUD, linked to `historia_id`.
- `citas` — appointments (schedule, list, status).
- `sedes` — multi-tenancy root: each sede has its own doctor/patient scope and JWT.
- `profesionales` — coordinador-managed professionals (doctors/coaches) with sede, especialidad, license, photo.
- `profesionales_disponibilidad` — recurring weekly availability (`dia_semana` 0–6, per modalidad).
- `profesionales_disponibilidad_fecha` — per-date availability overrides (hours, full block, or none).
- `trepsi_appointments` — Trepsi appointment lifecycle keyed by `cita_id` (PK): `estado`, `fecha_atencion`, doctor, raw `payload`, and link to `historia_id`. `cita_id` is the idempotency key.
- `trepsi_webhook_outbox` — persistent queue for the BSL → Trepsi webhook (`cita_id`, `historia_id`, `payload` jsonb, `estado`, `intentos`, `proximo_intento_at`, `last_error`, `last_status_code`, `response_body`).

**Timezone gotcha — Colombia is UTC-5.** "Today" queries must convert via `Date.UTC(y, m, d, 5, 0, 0)` for start-of-day and `Date.UTC(y, m, d+1, 4, 59, 59, 999)` for end-of-day. See `getDailyStats` and `getPendingPatients` in `medical-panel.service.ts`. Don't use `new Date()` directly — local server TZ in production is UTC.

**Boolean coercion gotcha.** Antecedent columns store positives as `true`, `'true'`, `'Sí'`, or `'SI'` (different ingestion paths). Always check all four when reading. See [backend/src/services/medical-history.service.ts](backend/src/services/medical-history.service.ts) lines ~208-245.

### Multi-sede login and auth

Doctors log in via `POST /api/auth/login` with a doctor code. The backend resolves the sede from `tenant_id` embedded in the JWT. `sedeMiddleware` injects the resolved sede into every request so services can scope queries by tenant.

Frontend: `MedicalPanelPage.tsx` handles login state; after auth, the JWT is stored and injected into all API requests via the axios client in `api.service.ts`. `OrdenesPage.tsx` explicitly injects the JWT to avoid 401s on protected routes.

### Real-time layer: Socket.io for telemedicine and session reports

A single `socket.io` server is attached to the same `http.Server` as Express (see [backend/src/index.ts](backend/src/index.ts)). It is consumed by two services:

1. **`telemedicineSocketService`** ([backend/src/services/telemedicine-socket.service.ts](backend/src/services/telemedicine-socket.service.ts)) — postural analysis. Doctor and patient join a room keyed by `roomName`. Patient runs MediaPipe locally, emits `pose-data-update` with 33 landmarks @ ~15 FPS, server relays to the doctor. The doctor never receives video frames over Socket.io — only landmark data.
2. **`sessionTracker`** ([backend/src/services/session-tracker.service.ts](backend/src/services/session-tracker.service.ts)) — in-memory map of who is in which Twilio room. Frontend reports connect/disconnect via REST (`/api/video/events/participant-*`); when both doctor and patient have left, a formatted report is sent via Twilio WhatsApp. Wrapped in try/catch so tracking never breaks calls.

The frontend uses `socket.io-client` from [frontend/src/hooks/usePosturalAnalysis.ts](frontend/src/hooks/usePosturalAnalysis.ts). The video logic in [frontend/src/hooks/useVideoRoom.ts](frontend/src/hooks/useVideoRoom.ts) does NOT touch Socket.io — keep these concerns separate.

### Postural analysis (MediaPipe)

Patient side ([frontend/src/components/PosturalAnalysisPatient.tsx](frontend/src/components/PosturalAnalysisPatient.tsx)) uses MediaPipe Pose Landmarker, loaded lazily through [frontend/src/utils/mediapipe-loader.ts](frontend/src/utils/mediapipe-loader.ts). It emits `{ landmarks, metrics, timestamp }` over Socket.io.

Doctor side ([frontend/src/components/PosturalAnalysisCanvas.tsx](frontend/src/components/PosturalAnalysisCanvas.tsx)) receives the data and draws the skeleton on a canvas. The first frame triggers `hasReceivedFirstFrame` which transitions the modal out of the "Cargando Análisis..." state — see [DIAGNOSTICO_ANALISIS_POSTURAL.md](DIAGNOSTICO_ANALISIS_POSTURAL.md) for the diagnostic logging convention (`[Doctor] 📊`, `[Canvas] 🎨`, `[Patient] ...`).

The doctor can capture multiple snapshots ([frontend/src/components/PosturalAnalysisModal.tsx](frontend/src/components/PosturalAnalysisModal.tsx)). Each captures `canvas.toDataURL('image/png')` plus the current metrics, lets the doctor name the exercise, and assembles a multi-page PDF via `jspdf`. All client-side — no server storage.

### Twilio Video integration

Token-based, 1-hour TTL JWTs generated by [backend/src/services/twilio.service.ts](backend/src/services/twilio.service.ts) using the API Key (not the Auth Token). Rooms are created as **`group`** type (not `group-small` — deprecated, error 53126) with `recordParticipantsOnConnect: true` to enable the post-call transcription pipeline. Twilio auto-creates the room on first connect, so `POST /api/video/rooms` is rarely needed.

After a call ends, the doctor explicitly closes the room (via `room.disconnect()` + a close API call) to trigger Twilio's recording webhook immediately. A post-call composition is also created via the compositions API — see commit `a02cde5`.

**Track attachment is the trickiest part of the frontend.** Twilio tracks must be attached to a DOM element after both the track and the element exist. [frontend/src/components/Participant.tsx](frontend/src/components/Participant.tsx) uses a two-`useEffect` pattern (one to subscribe to the participant, one to attach existing tracks plus listen for `trackSubscribed`) — replicate this pattern for any new track-rendering component.

### Post-call transcription pipeline

Triggered automatically after every call ends:

1. When the doctor connects (`role === 'doctor'`), `useVideoRoom.ts` POSTs `{ roomName, historiaId }` to `POST /api/video/events/session-start`, which calls `linkRoomToHistoria()` in [backend/src/services/transcription.service.ts](backend/src/services/transcription.service.ts). This writes a row to `room_historia_map` and sets `transcription_status = 'pending'` on the `HistoriaClinica`.
2. When the recording is ready, Twilio calls `POST /api/video/webhooks/recording-ready`. The webhook validates the Twilio signature (`TWILIO_AUTH_TOKEN`), responds 200 immediately, then runs `processRecording()` in the background.
3. `processRecording()` pipeline: looks up `historia_id` from `room_historia_map` → sets status `processing` → downloads audio from Twilio with Basic auth → sends to OpenAI Whisper (`whisper-1`, `language: es`) → sends transcript to GPT-4o-mini with a prompt that extracts only explicitly-mentioned fields → PATCHes each extracted field individually via `updateMedicalHistoryField()` from `medical-history.service.ts` → sets status `done` (or `error`).
4. Extracted fields: `motivo_consulta_texto`, `ant_patologico_obs`, `ant_farmacologico_obs`, `ant_alergicos_obs`, `hallazgos_descripcion`, `hallazgos_dolor`, `cc_peso_nuevo`, `cc_estatura_nuevo`, `tas`, `tad`, `fcr`.
5. `MedicalConsultationPanel` polls the medical history GET every 30s while `transcriptionStatus === 'processing'`; on `done` it refetches and shows a badge in `PanelHeader` ("Transcripción lista · Revisar").

**Critical:** use `EDITABLE_FIELDS` and `updateMedicalHistoryField` from `medical-history.service.ts` — do not create duplicate PATCH logic.

### Calidad module (Anthropic Managed Agents)

Route: `/calidad` → `CalidadPage.tsx`. Backend: `calidad.routes.ts` → `calidad.service.ts` → `managed-agents-calidad.service.ts`.

The module evaluates consultation quality by:
1. Fetching the Twilio composition audio for a session
2. Extracting audio with `ffmpeg` (to stay under OpenAI's 25 MB limit)
3. Transcribing via Whisper
4. Passing the transcript + historia data to an Anthropic Managed Agent that scores the consultation on multiple dimensions
5. Persisting the evaluation and displaying it in `CalidadPage.tsx`

**ffmpeg dependency**: `extraerAudio` writes to a temp file (not a pipe/stdin) to avoid cross-platform stream issues.

### Ordenes panel

Route: `/ordenes` → `OrdenesPage.tsx`. Full CRUD for medical orders linked to a `historia_id`. JWT must be injected in every request — `OrdenesPage.tsx` explicitly sets the auth header to avoid 401s. No dedicated ordenes service/routes file; uses the video API layer.

### PDF export (Puppeteer)

`pdf.service.ts` generates PDFs server-side using Puppeteer from the historia clínica HTML template in [backend/src/helpers/historia-clinica-html.ts](backend/src/helpers/historia-clinica-html.ts). The template includes sections for Intervención and Conducta tabs. Triggered from the panel header.

### Twilio WhatsApp (Twilio SDK, template-based)

`whatsapp.service.ts` sends messages via the Twilio SDK (not WHAPI). Sender: `whatsapp:+5716284820`. All outbound messages use an approved template (SID: `HXb3cafc049dcc310e2cfbfffb6e943c4e`). Free-form messages are not supported — always use the template.

Phone formatting: [backend/src/helpers/phone.helper.ts](backend/src/helpers/phone.helper.ts) accepts `(+52) 244...`, `+13053...`, bare `13053...`, and Colombian local `300...`. Recognized country codes: 1, 33, 34, 44, 49, 52, 54, 55, 57.

### Twilio Voice

Outbound calls via `twilio-voice.service.ts` + `twilio-voice.routes.ts`. A TwiML webhook serves custom Bodytech audio. The webhook URL uses `Method=GET`. Unified outbound number: `+576016284820`.

### Medical panel (`MedicalConsultationPanel`) — 7-tab editor

The old `MedicalHistoryPanel.tsx` is orphaned on disk (kept for reference). The active panel is [frontend/src/components/panel/MedicalConsultationPanel.tsx](frontend/src/components/panel/MedicalConsultationPanel.tsx), rendered in `DoctorRoomPage` inside a 75/25 split with `VideoRoom`. Toggle Maximize (`M`) / Normal (`N`) via keyboard shortcuts.

**Tab structure (t1–t7):**

| Tab | File | Status |
|---|---|---|
| t1 Datos Básicos | `tabs/DatosBasicosTab.tsx` | Complete |
| t2 Anamnesis | `tabs/AnamnesisTab.tsx` | Complete |
| t3 Riesgo | `tabs/RiesgoTab.tsx` | Complete — Downton + ACSM + Riesgo final |
| t4 Examen Físico | `tabs/ExamenFisicoTab.tsx` | Complete — Composición, postural, vitals |
| t5 Intervención | `tabs/IntervencionTab.tsx` | Complete — included in PDF |
| t6 Conducta | `tabs/ConductaTab.tsx` | Complete — included in PDF |
| t7 Observaciones | `tabs/ObservacionesTab.tsx` | Placeholder |

**Panel internals:**
- `panel/types.ts` — `TabId`, `CardId`, `MedicalHistoryFull` (200+ field interface covering legacy camelCase + new snake_case fields + transcription status)
- `panel/hooks/useMedicalHistory.ts` — fetches and caches the historia; exposes `patchLocal()` for optimistic updates
- `panel/hooks/useAutoSave.ts` / `useFieldAutoSave.ts` — debounced (800ms) auto-save → `PATCH /api/video/medical-history/:id/field`
- `panel/SaveContext.tsx` — aggregates save status across all fields
- Shared UI: `Card.tsx`, `Modal.tsx`, `Dropdown.tsx`, `PillToggle.tsx`, `Calculated.tsx`, `fields.tsx`, `FAB.tsx`, `Tabs.tsx`, `PatientStrip.tsx`, `EyeOnPatientPill.tsx`

**React Query:** The frontend uses React Query for data fetching and caching. Use `invalidateQueries` with `refetchType: 'none'` to invalidate without triggering immediate refetch on every keystroke.

**AI suggestions:** `POST /api/video/ai-suggestions` calls [backend/src/services/openai.service.ts](backend/src/services/openai.service.ts) with patient context to draft fields like `mdConceptoFinal`, `mdRecomendacionesMedicasAdicionales`, etc. PDF preview is generated server-side in [backend/src/helpers/historia-clinica-html.ts](backend/src/helpers/historia-clinica-html.ts) and rendered by Puppeteer.

### Coordinador panel

Route: `/coordinador` (login at `/coordinador-login`) → `CoordinadorPage.tsx`. Three views toggled by a `View` state (`'profesionales' | 'calendario' | 'ordenes'`):

- **Profesionales** (`components/coordinador/ProfesionalesView.tsx`) — CRUD over `profesionales` (sede as a colored chip, photo, especialidad). Form in `ProfesionalFormModal.tsx`. Also hosts the "Afiliados" / "Crear consulta" flow.
- **Calendario** (`components/coordinador/CalendarioView.tsx`) — month/day calendar filterable by sede (multiple sedes grouped) and professional. Shows BSL citas plus **Trepsi citas** (placed by the doctor's sede). Reprogrammed citas render orange. A "Team" day panel (`a2e0365`) shows the day's roster with photo avatars and supports **drag-and-drop slot reassignment** (`ReasignarModal.tsx`, `POST /api/calendario/reasignar-bulk`).
- **Ordenes** (`components/coordinador/OrdenesView.tsx`) — orders view.

**Availability (disponibilidad)** is managed at two levels and is the single source of truth for scheduling:
- **Recurring by weekday** (`DisponibilidadModal` → `profesionales_disponibilidad`, `dia_semana` 0–6, per modalidad) — the base pattern ("Fijar disponibilidad").
- **Per-date override** (`DisponibilidadDiaModal` → `profesionales_disponibilidad_fecha`) — the calendar's "Disponibilidad" toggle lets the coordinador adjust one or more professionals' slots for a single date (or block the day) without touching the weekly pattern. The override exists ⟺ there is ≥1 row for `(profesional, sede, fecha, modalidad)`.

`disponibilidad-fecha.service.getRangosEfectivos()` resolves override > weekly and is the single source used by `calendario.service.getHorariosDisponibles()` and `validarSlotDisponible()`, so scheduling and rescheduling both respect the override. A day blocked by override prevents scheduling (`SLOT_BLOCKED`); absence of a weekly pattern keeps the legacy degradation (does not block).

Endpoints: `GET/PUT/DELETE /api/profesionales/:id/disponibilidad-fecha`, `GET /api/calendario/disponibilidad-dia`, `GET /api/calendario/disponibilidad-mes`.

### Nutritional panel

Route: `/nutricion/:roomName?doctor=CODE&documento=HISTORIA_ID&paciente=NOMBRE` → `NutricionRoomPage.tsx` (a mirror of `DoctorRoomPage` that passes `panelVariant="nutricional"` to `VideoRoom`). The default `panelVariant="consulta"` preserves the standard 7-tab `MedicalConsultationPanel`; the nutritional variant renders the **restored** `MedicalHistoryPanel.tsx` (somatocarta cartesiana, ISAK anthropometry, Heath-Carter somatotype, AI nutrition plan, voximetría). Nutritional data persists in the `datosNutricionales` (JSONB) column of `HistoriaClinica`. Routing to this panel is driven by the coach's especialidad. **Note:** `MedicalHistoryPanel.tsx` is no longer orphaned — it is the active nutritional panel.

### Trepsi integration (bidirectional B2B)

Spec: `Especificacion_Integracion_Trepsi_Bodytech.pdf` (v2.1). Two directions:

**Inbound (Trepsi → BSL)** — `trepsi.service.ts` + `trepsi.routes.ts`, mounted at `/api/v1/integrations/trepsi` behind `requireApiKey('TREPSI_API_KEY', 'trepsi')`:
- `POST /appointments` — create cita + historia clínica (writes `trepsi_appointments` + a `HistoriaClinica` row)
- `POST /appointments/:citaId/schedule` — reschedule
- `PATCH /appointments/:citaId/historia` — update historia
- `DELETE /appointments/:citaId` — cancel
- `GET /appointments/:citaId` — query status
- `GET /medicos`, `GET /horarios-disponibles`, `GET /health`

Idempotency is keyed on `cita_id` — resends never duplicate. Trepsi citas appear in the coordinador calendar grouped by the doctor's sede.

**Outbound (BSL → Trepsi)** — `trepsi-webhook.service.ts` with a persistent outbox (`trepsi_webhook_outbox`):
- `historia-mutation.updateMedicalHistory()` calls `trepsiWebhookService.enqueue(historiaId)` fire-and-forget after saving an HC. `enqueue()` checks whether the HC corresponds to a Trepsi cita (via `trepsi_appointments`), builds the spec v2.1 §6 payload, and stores it as `pending` (updating the existing pending/failed row so the latest version is sent). It marks `trepsi_appointments.estado='attended'` (idempotent) and triggers an immediate dispatch.
- `dispatchPending()` POSTs up to 25 ready rows with `Bearer TREPSI_WEBHOOK_API_KEY` (10s timeout). On failure it applies exponential backoff (1s/5s/30s/5min/30min/2h); after 6 attempts the row goes `dead`. `index.ts` runs `dispatchPending()` every 30s via `setInterval` for retries.
- Admin endpoints at `/api/admin/trepsi-webhook` (JWT): `GET /queue?limit=50`, `POST /queue/:id/retry`, `POST /dispatch`.

### Bot Trepsi

Route: `/bot-trepsi` → `BotTrepsiPage.tsx`. Backend: `bot-trepsi.routes.ts` → `bot-trepsi.service.ts` (`POST /api/bot-trepsi/chat`, public, per-IP rate limit in the controller). A GPT-4o-mini assistant with a very restrictive system prompt that answers **only** about the Trepsi ↔ Bodytech integration — no credentials, internal data, or off-scope topics. Stateless: the frontend passes the conversation history each call. OpenAI is used (not Anthropic) because the prod Anthropic key has a spend cap.

### Virtual backgrounds / blur

Uses `@twilio/video-processors`. The TFLite models and WASM (~5.1 MB) live in [frontend/public/twilio-processors/](frontend/public/twilio-processors/) — **do not delete** and **do not point at the Twilio CDN**, which returns 403 in production. `assetsPath` must be `/twilio-processors`. UI in [frontend/src/components/BackgroundControls.tsx](frontend/src/components/BackgroundControls.tsx), logic in [frontend/src/hooks/useBackgroundEffects.ts](frontend/src/hooks/useBackgroundEffects.ts). Only shown to `role === 'doctor'`.

## Frontend Routes

Defined in [frontend/src/App.tsx](frontend/src/App.tsx). Note: `/` redirects to `/panel-medico`.

| Path | Purpose |
|---|---|
| `/panel-medico` | Doctor login + patient list (default) |
| `/historias` | Historia clínica browser |
| `/historia/:historiaId` | Historia clínica detail page |
| `/ordenes` / `/ordenes-login` | Medical orders CRUD panel + its login |
| `/calidad` | Calidad evaluation module |
| `/coordinador` / `/coordinador-login` | Coordinador panel (profesionales, calendario, ordenes) + its login |
| `/bot-trepsi` | Public Trepsi integration assistant chat |
| `/reprogramar/:id` | Reschedule-an-appointment page |
| `/doctor` | Manual room creation page |
| `/doctor/:roomName?doctor=CODE` | Doctor joins specific room — renders `VideoRoom` + `MedicalConsultationPanel` |
| `/nutricion/:roomName?doctor=CODE&documento=...&paciente=...` | Doctor joins with the nutritional panel variant (`MedicalHistoryPanel`) |
| `/patient/:roomName?nombre=...&apellido=...&doctor=...` | Patient joins from WhatsApp link |
| `/panel-medico/patient/:roomName` | Same as `/patient` but routed under panel |

## Key Files

### Backend (`backend/src/`)
- `index.ts` — Express + Socket.io bootstrap, route mounting, global middlewares, static fallback, `postgresService.runMigrations()` on boot
- `config/app.config.ts` / `config/twilio.config.ts` — environment config and Twilio SDK init
- `services/twilio.service.ts` — token + room API; rooms are **`group`** type with `recordParticipantsOnConnect: true`
- `services/twilio-voice.service.ts` — outbound voice calls with TwiML webhook
- `services/whatsapp.service.ts` — Twilio WhatsApp send via SDK, sender `whatsapp:+5716284820`, approved template
- `services/postgres.service.ts` — `pg.Pool`, `query()`, migrations
- `services/auth.service.ts` — multi-sede login, JWT generation
- `services/medical-panel.service.ts` — daily stats, paginated pending list, search, "no contesta"
- `services/medical-history.service.ts` — historia clínica read/write; exports `EDITABLE_FIELDS` whitelist + `updateMedicalHistoryField()`; handles 27+8 antecedent boolean coercion
- `services/historia-clinica-postgres.service.ts` — historia clínica DB layer
- `services/historia-field-coercion.service.ts` — boolean/enum coercion logic
- `services/historia-query.service.ts` / `historia-mutation.service.ts` — CQRS split for historia queries vs mutations
- `services/transcription.service.ts` — post-call pipeline: `linkRoomToHistoria()` + `processRecording()` (Whisper → GPT-4o-mini → PATCH fields)
- `services/session-tracker.service.ts` — in-memory tracker, sends WhatsApp report on full disconnect
- `services/telemedicine-socket.service.ts` — Socket.io rooms for postural analysis
- `services/openai.service.ts` — AI suggestion prompts for clinical fields
- `services/pdf.service.ts` — Puppeteer-based PDF generation
- `services/calidad.service.ts` / `managed-agents-calidad.service.ts` / `openai-calidad.service.ts` — Anthropic Managed Agents evaluation pipeline
- `services/profesionales.service.ts` — professionals CRUD + recurring availability
- `services/disponibilidad.service.ts` / `disponibilidad-fecha.service.ts` — recurring vs per-date availability; `getRangosEfectivos()` resolves override > weekly (single source for scheduling)
- `services/calendario.service.ts` — coordinador calendar: `getHorariosDisponibles()`, `validarSlotDisponible()`, month/day views, bulk reassign
- `services/trepsi.service.ts` — inbound Trepsi API (create/reschedule/cancel/patch appointments + historias, idempotent on `cita_id`)
- `services/trepsi-webhook.service.ts` — outbound BSL → Trepsi webhook: `enqueue()` + `dispatchPending()` with persistent outbox and exponential backoff
- `services/bot-trepsi.service.ts` — GPT-4o-mini integration assistant (restrictive system prompt, stateless)
- `services/twilio-media.service.ts` — Twilio media/recording download helpers
- `controllers/*.controller.ts` — thin HTTP wrappers around the services
- `middleware/api-key.middleware.ts` — `requireApiKey(envVar, label)` for B2B routes; `auth.middleware.ts` — optional/required JWT; `sede.middleware.ts` — sede resolution; `error.middleware.ts`
- `routes/auth.routes.ts` — `/api/auth`
- `routes/video.routes.ts` — `/api/video`
- `routes/medical-panel.routes.ts` — `/api/medical-panel` (protected)
- `routes/profesionales.routes.ts` — `/api/profesionales` (protected)
- `routes/calendario.routes.ts` — `/api/calendario` (protected)
- `routes/calidad.routes.ts` — `/api/calidad`
- `routes/twilio-voice.routes.ts` — `/api/twilio`
- `routes/bot-trepsi.routes.ts` — `/api/bot-trepsi` (public)
- `routes/trepsi.routes.ts` — `/api/v1/integrations/trepsi` (API Key)
- `routes/trepsi-webhook-admin.routes.ts` — `/api/admin/trepsi-webhook` (protected)
- `helpers/historia-clinica-html.ts` — server-rendered HTML template for historia clínica PDF
- `helpers/phone.helper.ts` — server-side `formatTelefono`

### Frontend (`frontend/src/`)
- `App.tsx` — react-router routes
- `pages/MedicalPanelPage.tsx` — doctor login + patient list (default landing)
- `pages/HistoriasClinicasPage.tsx` — historia browser
- `pages/HistoriaDetallePage.tsx` — historia clínica detail page (`/historia/:historiaId`)
- `pages/OrdenesPage.tsx` / `OrdenesLoginPage.tsx` — medical orders CRUD (injects JWT explicitly) + login
- `pages/CalidadPage.tsx` — calidad evaluation module
- `pages/CoordinadorPage.tsx` / `CoordinadorLoginPage.tsx` — coordinador panel (profesionales/calendario/ordenes views) + login
- `pages/BotTrepsiPage.tsx` — public Trepsi integration assistant chat
- `pages/ReprogramarPage.tsx` — reschedule-an-appointment page (`/reprogramar/:id`)
- `pages/DoctorPage.tsx` / `DoctorRoomPage.tsx` — manual + link-routed doctor entry; `DoctorRoomPage` renders `VideoRoom` + `MedicalConsultationPanel` side by side
- `pages/NutricionRoomPage.tsx` — mirror of `DoctorRoomPage` that passes `panelVariant="nutricional"` (renders `MedicalHistoryPanel`)
- `pages/PatientPage.tsx` — patient entry from WhatsApp link
- `components/coordinador/` — `CoordinadorPage` views and modals: `ProfesionalesView.tsx`, `CalendarioView.tsx`, `OrdenesView.tsx`, `CalendarioStats.tsx`, `DisponibilidadModal.tsx` (recurring), `DisponibilidadDiaModal.tsx` (per-date override), `ProfesionalFormModal.tsx`, `ReasignarModal.tsx` (drag-and-drop slot reassign), `CalidadDetalleModal.tsx`
- `components/VideoRoom.tsx` — main call layout (75/25 split with panel), hosts `PosturalAnalysisModal`; `panelVariant` prop (`'consulta'` default | `'nutricional'`)
- `components/Participant.tsx` — track attachment (two-useEffect pattern)
- `components/MedicalHistoryPanel.tsx` — **active nutritional panel** (somatocarta, ISAK, Heath-Carter, AI nutrition plan); rendered by `VideoRoom` when `panelVariant="nutricional"`
- `components/PosturalAnalysisCanvas.tsx` / `PosturalAnalysisModal.tsx` / `PosturalAnalysisPatient.tsx` — postural flow
- `components/panel/MedicalConsultationPanel.tsx` — **active** 7-tab historia clínica editor (orchestrator)
- `components/panel/PanelHeader.tsx` — header with patient info + transcription-ready badge
- `components/panel/tabs/` — 8 tab files (DatosBasicos, Anamnesis, Riesgo, ExamenFisico, Intervencion, Conducta, Observaciones, Placeholder)
- `components/panel/hooks/useMedicalHistory.ts` — fetch + cache + optimistic `patchLocal()`
- `components/panel/hooks/useAutoSave.ts` / `useFieldAutoSave.ts` — debounced auto-save hooks
- `components/panel/SaveContext.tsx` — save state aggregator
- `components/panel/types.ts` — `TabId`, `MedicalHistoryFull` (200+ fields), `CardId`
- `components/panel/` (shared UI) — `Card.tsx`, `Modal.tsx`, `Dropdown.tsx`, `PillToggle.tsx`, `Calculated.tsx`, `fields.tsx`, `FAB.tsx`, `Tabs.tsx`, `PatientStrip.tsx`, `EyeOnPatientPill.tsx`
- `hooks/useVideoRoom.ts` — Twilio Video lifecycle + tracking event calls + `session-start` POST
- `hooks/usePosturalAnalysis.ts` — Socket.io client, `pose-data-update` listener, `hasReceivedFirstFrame`
- `hooks/useBackgroundEffects.ts` — blur + virtual background processor
- `services/api.service.ts` — axios client (uses `VITE_API_BASE_URL`); JWT injected via interceptor
- `services/auth.service.ts` — login, token storage
- `services/medical-panel.service.ts` — panel-specific axios calls
- `utils/mediapipe-loader.ts` — lazy MediaPipe load
- `utils/posturalMetricsFormatter.ts` — formats metrics for the modal/PDF
- `utils/linkGenerator.ts` — room name generation utility
- `public/twilio-processors/` — TFLite + WASM, must stay co-located
- `public/game.html` — interactive architecture map (Pac-Man style, accessible at `/game.html`)
- `public/game-pacman.html` — alternate architecture visualization

## Environment Variables

### Backend (`.env`)
```bash
# Twilio Video + WhatsApp + Voice
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx          # also used to validate recording webhooks
TWILIO_API_KEY_SID=SKxxxx
TWILIO_API_KEY_SECRET=xxxx
TWILIO_WHATSAPP_FROM=whatsapp:+5716284820
TWILIO_WHATSAPP_TEMPLATE_SID=HXb3cafc049dcc310e2cfbfffb6e943c4e

# PostgreSQL (Digital Ocean managed)
POSTGRES_HOST=...db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=defaultdb

# OpenAI (AI suggestions + post-call transcription)
OPENAI_API_KEY=sk-...

# Anthropic (Calidad module — Managed Agents)
ANTHROPIC_API_KEY=sk-ant-...

# Trepsi integration
TREPSI_API_KEY=...                          # inbound: validates POST/GET on /api/v1/integrations/trepsi
TREPSI_WEBHOOK_URL=https://us-central1-trepsi-v5-dev.cloudfunctions.net/bslConsultationResultsWebhook
TREPSI_WEBHOOK_API_KEY=...                   # outbound: Bearer token for BSL → Trepsi webhook (SECRET)

# Server
PORT=3000
NODE_ENV=development|production
ALLOWED_ORIGINS=http://localhost:5173   # dev only; in prod everything is same-origin
JWT_SECRET=...
```

### Frontend (`.env`)
```bash
VITE_API_BASE_URL=http://localhost:3000   # dev only; empty/unset in prod
```

## Common Patterns

### Adding a new REST endpoint
1. Add a method to the relevant service in `backend/src/services/`
2. Wrap it in `backend/src/controllers/<area>.controller.ts`
3. Register in `backend/src/routes/<area>.routes.ts`
4. Mount in `index.ts` if it's a new route group
5. Expose to the frontend via `frontend/src/services/api.service.ts` or a domain-specific service

### Adding a new panel tab field (auto-save pattern)
1. Add the column to `EDITABLE_FIELDS` in `medical-history.service.ts` with its type
2. Add the field to `MedicalHistoryFull` in `panel/types.ts`
3. Add the migration `ADD COLUMN IF NOT EXISTS` in `postgres.service.ts → runMigrations()`
4. Render via `useFieldAutoSave` in the relevant tab — debounce fires `PATCH /api/video/medical-history/:id/field` automatically

### Adding a new Socket.io event
Extend `telemedicineSocketService` (or a new service) and `initialize(io)` it from `index.ts`. Keep tracker / video / postural concerns separated — don't fan out from a single mega-handler.

### Generating a room name
`consulta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`. Utility in [frontend/src/utils/linkGenerator.ts](frontend/src/utils/linkGenerator.ts).

### Querying "today" in PostgreSQL
Convert to Colombia (UTC-5) before extracting `y/m/d`, then build start/end of day in UTC. Don't trust the server's local TZ.

### Sending WhatsApp messages
Always use `whatsapp.service.ts` with the approved template. Do not construct `wa.me/` URLs or free-form messages — Twilio Business accounts require approved templates.

## Known Issues and Solutions

- **Doctor sees skeleton-loading forever** — patient hasn't emitted the first `pose-data-update`. Check patient browser console for MediaPipe / camera errors. The doctor's "Iniciar Análisis" button is disabled until `isPosturalAnalysisConnected` is true; if it isn't, Socket.io hasn't connected yet (give it 2-3s after entering the room).
- **Background blur returns 403** — assets are being fetched from the Twilio CDN. Confirm `assetsPath: '/twilio-processors'` and that the public folder still has the TFLite/WASM bundle.
- **"Condiciones Especiales" tags missing for a patient** — the `formularios` row uses `'SI'` / `'Sí'` / `'true'`. The boolean coercion in `medical-history.service.ts` must check all four; missing one will silently hide that condition.
- **`new Date()` shows the wrong day** — production runs in UTC. Always convert to UTC-5 before computing day boundaries.
- **Transcription stays in `processing` forever** — the Twilio webhook (`/api/video/webhooks/recording-ready`) may not be registered in the Twilio console, or the signature validation fails (check `TWILIO_AUTH_TOKEN`). Also check that the room type is `group` (not `go`) — `go` rooms don't support recording rules. `group-small` is deprecated (error 53126).
- **Calculated fields reset on first render** — `Calculated.tsx` guards against overwriting an existing value; if a field appears blank on load, check that the GET response returns the field in camelCase and that it's in `MedicalHistoryFull`.
- **Dropdown doesn't open inside a modal** — `Dropdown.tsx` uses a fixed portal to escape `overflow: hidden`. If a dropdown appears clipped, verify the portal is mounted at `document.body`.
- **OrdenesPage returns 401** — JWT must be injected explicitly in `OrdenesPage.tsx`; the axios interceptor may not have it at first render.
- **Calidad audio extraction fails** — `extraerAudio` writes to a temp file (not a pipe). Confirm `ffmpeg` is installed in the production Docker image.
- **Duplicate compositions** — `endRoom` already creates the composition; the `statusCallback` webhook must check whether a composition for that room already exists before creating another.

## Testing Notes

- Jest is configured in backend with a `__tests__/` directory.
- No frontend test runner.
- Manual testing flow: backend on `:3000`, frontend on `:5173`, two browser windows (one for `/doctor/<room>`, one for `/patient/<room>`), open DevTools on both. Watch for `[Postural Analysis]`, `[Doctor] 📊`, `[Canvas] 🎨` log markers when exercising the postural feature.

## Reference Documents in this Repo

These docs go deeper than this file — read them when working on a specific area:

- [arquitectura-video.md](arquitectura-video.md) — overall architecture write-up
- [PANEL-MEDICO.md](PANEL-MEDICO.md) — medical panel design
- [DIAGNOSTICO_ANALISIS_POSTURAL.md](DIAGNOSTICO_ANALISIS_POSTURAL.md) — postural analysis log conventions and failure modes
- [FUNCIONALIDAD_SNAPSHOTS_MULTIPLES.md](FUNCIONALIDAD_SNAPSHOTS_MULTIPLES.md) — snapshot/PDF export internals
- [CONDICIONES_ESPECIALES.md](CONDICIONES_ESPECIALES.md) — antecedent flag coercion details
- [README-TELEMEDICINA.md](README-TELEMEDICINA.md) — telemedicine flow user-facing
- [.do/app.yaml](.do/app.yaml) + Dockerfile — deployment configuration

## Panel de Consulta Médica — Estado por Fase

### Phase 1 — Refactor estructura (completo)
- Panel descompuesto en `frontend/src/components/panel/` (orchestrator + 15 componentes + `tabs/` + `hooks/` + `types.ts`).
- Layout 75/25 en `VideoRoom.tsx` con toggle Maximize2/Minimize2 (atajos `M` / `N`).
- Auto-save: `useAutoSave` / `useFieldAutoSave` con debounce 800ms → `PATCH /api/video/medical-history/:id/field`. Aggregator de estado vía `SaveContext`.
- Schema: ~150 columnas snake_case en `HistoriaClinica` (idempotente con `ADD COLUMN IF NOT EXISTS`, en `postgres.service.ts → runMigrations()`).
- `EDITABLE_FIELDS` whitelist en `medical-history.service.ts` con tipos por campo. Coerción de booleanos consistente (`true | 'true' | 'Sí' | 'SI'`).
- Tab t1 Datos Básicos completo (3 cards: Identidad, Residencia, Información Básica).

### Phase 2 — Anamnesis + Riesgo + Examen Físico (completo)
- Tab t2 Anamnesis: motivo de consulta, historia de la consulta, antecedentes.
- Tab t3 Clasificación de Riesgo: escala Downton (caídas), clasificación ACSM, riesgo final.
- Tab t4 Examen Físico: composición corporal, análisis postural (enlazado a `PosturalAnalysisModal`), signos vitales.

### Phase 3 — Transcripción post-llamada (completo)
- `transcription.service.ts`: `linkRoomToHistoria()` + `processRecording()` (Whisper + GPT-4o-mini → 11 campos).
- `twilio.service.ts`: `recordParticipantsOnConnect: true`, tipo **`group`**.
- `video.routes.ts` + `video.controller.ts`: `POST /api/video/events/session-start` y `POST /api/video/webhooks/recording-ready` (validado con firma Twilio, responde 200 inmediato, procesa en background).
- `postgres.service.ts`: migración `room_historia_map` + columnas `transcription_status` / `transcription_text`.
- `useVideoRoom.ts`: POST session-start cuando el médico conecta.
- `MedicalConsultationPanel.tsx`: polling cada 30s mientras `transcriptionStatus === 'processing'`; refetch completo al pasar a `done`.
- `PanelHeader.tsx`: badge verde animado "Transcripción lista · Revisar".

### Fases completadas posteriores
- **Composiciones Twilio**: doctor cierra el room al salir → webhook dispara inmediatamente → composición creada para cada llamada.
- **Ordenes CRUD**: `/ordenes` con panel completo, JWT inyectado en `OrdenesPage`.
- **Calidad con Anthropic Managed Agents**: `/calidad` — pipeline Whisper + ffmpeg + Managed Agent.
- **Multi-sede login**: auth via JWT con `tenant_id`, `sedeMiddleware` en todas las rutas protegidas.
- **Citas**: lista y gestión de citas desde el panel médico.
- **Disponibilidad de profesionales (panel coordinador)**: `CoordinadorPage` → `CalendarioView` maneja disponibilidad en dos niveles:
  - **Recurrente por día de la semana** (`DisponibilidadModal` → tabla `profesionales_disponibilidad`, `dia_semana` 0-6, por modalidad). Patrón base ("Fijar disponibilidad").
  - **Override por fecha específica** (`DisponibilidadDiaModal` → tabla `profesionales_disponibilidad_fecha`). El toggle "Disponibilidad" del calendario permite elegir un día y ajustar las franjas de uno o más profesionales SOLO para esa fecha (o bloquear el día), sin tocar el patrón semanal. El override existe ⟺ hay ≥1 fila para `(profesional, sede, fecha, modalidad)`: con horas (`bloqueado=false`), bloqueo total (1 fila centinela `bloqueado=true` + horas NULL), o sin override (cae al patrón semanal).
  - El helper `disponibilidad-fecha.service.getRangosEfectivos()` resuelve override > semanal y es la fuente única que usan `calendario.service.getHorariosDisponibles()` y `validarSlotDisponible()`, de modo que agendamiento y reprogramación respetan el override. Un día bloqueado por override impide agendar (`SLOT_BLOCKED`); la ausencia de patrón semanal mantiene la degradación legacy (no bloquea).
  - Endpoints: `GET/PUT/DELETE /api/profesionales/:id/disponibilidad-fecha`, `GET /api/calendario/disponibilidad-dia`, `GET /api/calendario/disponibilidad-mes`.
- **Panel coordinador completo**: `/coordinador` con vistas Profesionales (CRUD), Calendario (filtrable por sede/profesional) y Ordenes. Calendario muestra citas BSL + Trepsi por sede del médico, citas reprogramadas en naranja, panel "Team" del día con avatares y drag-and-drop de horas para reasignar (`ReasignarModal` → `POST /api/calendario/reasignar-bulk`).
- **Panel nutricional**: `/nutricion/:roomName` con `panelVariant="nutricional"` → `MedicalHistoryPanel` (somatocarta, ISAK, Heath-Carter, plan nutricional con IA). Persiste en `datosNutricionales` (JSONB). `MedicalHistoryPanel.tsx` dejó de estar huérfano.
- **Integración Trepsi (bidireccional)**: inbound `/api/v1/integrations/trepsi` (API Key, idempotente por `cita_id`, tablas `trepsi_appointments`); outbound webhook BSL → Trepsi (`trepsi-webhook.service.ts`, cola persistente `trepsi_webhook_outbox`, backoff exponencial, `dispatchPending()` cada 30s); admin `/api/admin/trepsi-webhook`.
- **Bot Trepsi**: `/bot-trepsi` — asistente GPT-4o-mini con system prompt restringido a la integración (`bot-trepsi.service.ts`, público con rate limit por IP).
- **PDF Puppeteer**: historia clínica exportable como PDF server-side.
- **WhatsApp Twilio SDK**: migrado de WHAPI a Twilio SDK, sender `+5716284820`, template aprobado.
- **Twilio Voice**: TwiML webhook con audio Bodytech, número unificado `+576016284820`.
- **React Query**: frontend usa React Query para caché; `invalidateQueries` con `refetchType: 'none'`.
- **Backend refactor**: CQRS en historia clínica (`historia-query.service.ts` / `historia-mutation.service.ts`), `historia-field-coercion.service.ts`, testing infrastructure.

### Pendiente
- Tab t7 Observaciones (actualmente placeholder).

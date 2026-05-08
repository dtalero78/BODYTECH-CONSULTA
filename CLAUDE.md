# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

BSL Consulta Video is a medical telemedicine platform built around Twilio Video. It started as a video-call shim for a Wix front office and has grown into a full app with:

- Twilio Video calls (doctor + patient)
- A medical panel (`/panel-medico`) that replaced the Wix patient list and queries PostgreSQL directly
- Real-time postural analysis (Socket.io + MediaPipe on the patient, canvas rendering on the doctor)
- Historia clínica (medical record) viewer/editor with OpenAI-assisted suggestions
- Twilio WhatsApp messaging for session reports and patient links
- Twilio Voice (outbound calls)

Two halves of the app share one Express server in production: API + WebSocket on `/api/*` and `/socket.io/*`, static React build on everything else.

## Development Commands

### Backend (`backend/`)
```bash
npm install
npm run dev             # nodemon + ts-node, port 3000
npm run build           # tsc → dist/
npm start               # node dist/index.js
npm test                # jest (no tests written yet)
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
2. `/api/video/*` → Twilio video, tracking events, medical history, AI suggestions, WhatsApp
3. `/api/telemedicine/*` → postural analysis session metadata
4. `/api/medical-panel/*` → doctor panel (stats, patient list, search)
5. `/api/twilio/*` → outbound voice calls
6. `/socket.io/*` → Socket.io (telemedicine + session-tracker broadcasts)
7. Everything else → static frontend (`backend/frontend-dist/`) with SPA fallback to `index.html`

Implication: in dev you have CORS (set `ALLOWED_ORIGINS=http://localhost:5173`); in prod you don't, because frontend and API share an origin. `VITE_API_BASE_URL=""` in production makes the frontend use relative URLs.

### Data layer: PostgreSQL is the source of truth (Wix is legacy)

The medical panel originally proxied through Wix Velo functions. It now queries Digital Ocean PostgreSQL directly via [backend/src/services/postgres.service.ts](backend/src/services/postgres.service.ts) (a single `pg.Pool`, SSL with `rejectUnauthorized: false`, migrations run on boot from `index.ts`).

Two main tables:
- `HistoriaClinica` — visit/consultation row keyed by `_id`, with `numeroId` (patient document), `medico` (doctor code), `fechaAtencion` (scheduled), `fechaConsulta` (attended), and dozens of clinical fields.
- `formularios` — patient intake form keyed by `numero_id`, with 27 personal antecedent flags and 8 family antecedent flags. Joined via `LEFT JOIN` in [backend/src/services/medical-history.service.ts](backend/src/services/medical-history.service.ts).

**Timezone gotcha — Colombia is UTC-5.** "Today" queries must convert via `Date.UTC(y, m, d, 5, 0, 0)` for start-of-day and `Date.UTC(y, m, d+1, 4, 59, 59, 999)` for end-of-day. See `getDailyStats` and `getPendingPatients` in `medical-panel.service.ts`. Don't use `new Date()` directly — local server TZ in production is UTC.

**Boolean coercion gotcha.** Antecedent columns store positives as `true`, `'true'`, `'Sí'`, or `'SI'` (different ingestion paths). Always check all four when reading. See [backend/src/services/medical-history.service.ts](backend/src/services/medical-history.service.ts) lines ~208-245.

### Real-time layer: Socket.io for telemedicine and session reports

A single `socket.io` server is attached to the same `http.Server` as Express (see [backend/src/index.ts](backend/src/index.ts)). It is consumed by two services:

1. **`telemedicineSocketService`** ([backend/src/services/telemedicine-socket.service.ts](backend/src/services/telemedicine-socket.service.ts)) — postural analysis. Doctor and patient join a room keyed by `roomName`. Patient runs MediaPipe locally, emits `pose-data-update` with 33 landmarks @ ~15 FPS, server relays to the doctor. The doctor never receives video frames over Socket.io — only landmark data.
2. **`sessionTracker`** ([backend/src/services/session-tracker.service.ts](backend/src/services/session-tracker.service.ts)) — in-memory map of who is in which Twilio room. Frontend reports connect/disconnect via REST (`/api/video/events/participant-*`); when both doctor and patient have left, a formatted report is sent via WHAPI to `573008021701`. Wrapped in try/catch so tracking never breaks calls.

The frontend uses `socket.io-client` from [frontend/src/hooks/usePosturalAnalysis.ts](frontend/src/hooks/usePosturalAnalysis.ts). The video logic in [frontend/src/hooks/useVideoRoom.ts](frontend/src/hooks/useVideoRoom.ts) does NOT touch Socket.io — keep these concerns separate.

### Postural analysis (MediaPipe)

Patient side ([frontend/src/components/PosturalAnalysisPatient.tsx](frontend/src/components/PosturalAnalysisPatient.tsx)) uses MediaPipe Pose Landmarker, loaded lazily through [frontend/src/utils/mediapipe-loader.ts](frontend/src/utils/mediapipe-loader.ts). It emits `{ landmarks, metrics, timestamp }` over Socket.io.

Doctor side ([frontend/src/components/PosturalAnalysisCanvas.tsx](frontend/src/components/PosturalAnalysisCanvas.tsx)) receives the data and draws the skeleton on a canvas. The first frame triggers `hasReceivedFirstFrame` which transitions the modal out of the "Cargando Análisis..." state — see [DIAGNOSTICO_ANALISIS_POSTURAL.md](DIAGNOSTICO_ANALISIS_POSTURAL.md) for the diagnostic logging convention (`[Doctor] 📊`, `[Canvas] 🎨`, `[Patient] ...`).

The doctor can capture multiple snapshots ([frontend/src/components/PosturalAnalysisModal.tsx](frontend/src/components/PosturalAnalysisModal.tsx)). Each captures `canvas.toDataURL('image/png')` plus the current metrics, lets the doctor name the exercise, and assembles a multi-page PDF via `jspdf`. All client-side — no server storage.

### Twilio Video integration

Token-based, 1-hour TTL JWTs generated by [backend/src/services/twilio.service.ts](backend/src/services/twilio.service.ts) using the API Key (not the Auth Token). Twilio auto-creates the room on first connect, so `POST /api/video/rooms` is rarely needed.

**Track attachment is the trickiest part of the frontend.** Twilio tracks must be attached to a DOM element after both the track and the element exist. [frontend/src/components/Participant.tsx](frontend/src/components/Participant.tsx) uses a two-`useEffect` pattern (one to subscribe to the participant, one to attach existing tracks plus listen for `trackSubscribed`) — replicate this pattern for any new track-rendering component.

### Virtual backgrounds / blur

Uses `@twilio/video-processors`. The TFLite models and WASM (~5.1 MB) live in [frontend/public/twilio-processors/](frontend/public/twilio-processors/) — **do not delete** and **do not point at the Twilio CDN**, which returns 403 in production. `assetsPath` must be `/twilio-processors`. UI in [frontend/src/components/BackgroundControls.tsx](frontend/src/components/BackgroundControls.tsx), logic in [frontend/src/hooks/useBackgroundEffects.ts](frontend/src/hooks/useBackgroundEffects.ts). Only shown to `role === 'doctor'`.

### Medical history + OpenAI

`MedicalHistoryPanel` ([frontend/src/components/MedicalHistoryPanel.tsx](frontend/src/components/MedicalHistoryPanel.tsx)) opens during a doctor's call and edits the `HistoriaClinica` row. The "AI suggestions" button hits `POST /api/video/ai-suggestions` which calls OpenAI ([backend/src/services/openai.service.ts](backend/src/services/openai.service.ts)) with the patient context to draft fields like `mdConceptoFinal`, `mdRecomendacionesMedicasAdicionales`, etc. PDF preview is generated server-side as HTML in [backend/src/helpers/historia-clinica-html.ts](backend/src/helpers/historia-clinica-html.ts).

### Wix integration (legacy but still live)

The Wix front office still hosts the booking funnel. Two Wix files are kept in `backend/` as the source of truth that gets pasted into Velo:
- `backend/wix.json` — patient repeater + day stats
- `backend/panel-consultamedica-wix.json` — consultation lightbox with the WhatsApp + videollamada buttons

**Critical Wix constraint.** You cannot mutate a button's `.link` from inside its own `onClick` — the browser navigates before the handler resolves. Pattern that works: in `whpTwilio.onClick`, generate the room name once, set `iniciarConsultaTwilio.link` *atomically* in the same handler before sending the patient link via the backend's `sendTextMessage()` (NOT a `wa.me/` URL). See [WIX_INTEGRATION.md](WIX_INTEGRATION.md) for the full pattern.

**Phone formatting.** `formatTelefono()` in `backend/panel-consultamedica-wix.json` (and [backend/src/helpers/phone.helper.ts](backend/src/helpers/phone.helper.ts) on the server) accepts `(+52) 244...`, `+13053...`, bare `13053...`, and Colombian local `300...`. Recognized country codes: 1, 33, 34, 44, 49, 52, 54, 55, 57. Twilio WhatsApp accepts both with and without `+` — the service normalizes.

## Frontend Routes

Defined in [frontend/src/App.tsx](frontend/src/App.tsx). Note: `/` redirects to `/panel-medico`, not a landing page.

| Path | Purpose |
|---|---|
| `/panel-medico` | Doctor login + patient list (default) |
| `/historias` | Historia clínica browser |
| `/doctor` | Manual room creation page |
| `/doctor/:roomName?doctor=CODE` | Doctor joins specific room (entry from Wix) |
| `/patient/:roomName?nombre=...&apellido=...&doctor=...` | Patient joins from WhatsApp link |
| `/panel-medico/patient/:roomName` | Same as `/patient` but routed under panel (also from WhatsApp) |

## Key Files

### Backend (`backend/src/`)
- `index.ts` — Express + Socket.io bootstrap, route mounting, static fallback, `postgresService.runMigrations()` on boot
- `services/twilio.service.ts` — token + room API
- `services/twilio-voice.service.ts` — outbound voice calls
- `services/whatsapp.service.ts` — Twilio WhatsApp send (used by session reports + medical panel)
- `services/postgres.service.ts` — `pg.Pool`, `query()`, migrations
- `services/medical-panel.service.ts` — daily stats, paginated pending list, search, "no contesta"
- `services/medical-history.service.ts` — historia clínica read/write with the 27+8 antecedent boolean coercion
- `services/historia-clinica-postgres.service.ts` — historia clínica DB layer (separate concern from `medical-history.service`)
- `services/session-tracker.service.ts` — in-memory tracker, sends WhatsApp report on full disconnect
- `services/telemedicine-socket.service.ts` — Socket.io rooms for postural analysis
- `services/openai.service.ts` — AI suggestion prompts for clinical fields
- `controllers/*.controller.ts` — thin HTTP wrappers around the services
- `helpers/historia-clinica-html.ts` — server-rendered preview HTML for the historia clínica
- `helpers/phone.helper.ts` — server-side `formatTelefono`

### Frontend (`frontend/src/`)
- `App.tsx` — react-router routes
- `pages/MedicalPanelPage.tsx` — doctor login + patient list (default landing)
- `pages/HistoriasClinicasPage.tsx` — historia browser
- `pages/DoctorPage.tsx` / `DoctorRoomPage.tsx` — manual + Wix-routed doctor entry
- `pages/PatientPage.tsx` — patient entry from WhatsApp link
- `components/VideoRoom.tsx` — main call layout, hosts `MedicalHistoryPanel` + `PosturalAnalysisModal`
- `components/Participant.tsx` — track attachment (two-useEffect pattern)
- `components/MedicalHistoryPanel.tsx` — historia clínica editor; renders "Condiciones Especiales" tags
- `components/PosturalAnalysisCanvas.tsx` / `PosturalAnalysisModal.tsx` / `PosturalAnalysisPatient.tsx` — postural flow
- `hooks/useVideoRoom.ts` — Twilio Video lifecycle + tracking event calls
- `hooks/usePosturalAnalysis.ts` — Socket.io client, `pose-data-update` listener, `hasReceivedFirstFrame`
- `hooks/useBackgroundEffects.ts` — blur + virtual background processor
- `services/api.service.ts` — axios client (uses `VITE_API_BASE_URL`)
- `services/medical-panel.service.ts` — panel-specific axios calls
- `utils/mediapipe-loader.ts` — lazy MediaPipe load
- `utils/posturalMetricsFormatter.ts` — formats metrics for the modal/PDF
- `public/twilio-processors/` — TFLite + WASM, must stay co-located

## Environment Variables

### Backend (`.env`)
```bash
# Twilio Video + WhatsApp + Voice
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_API_KEY_SID=SKxxxx
TWILIO_API_KEY_SECRET=xxxx
TWILIO_WHATSAPP_FROM=whatsapp:+3153369631
TWILIO_WHATSAPP_TEMPLATE_SID=HXc8473cfd60cd378314355e17e736d24d

# PostgreSQL (Digital Ocean managed)
POSTGRES_HOST=...db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=...
POSTGRES_DATABASE=defaultdb

# OpenAI (AI suggestions in historia clínica)
OPENAI_API_KEY=sk-...

# Server
PORT=3000
NODE_ENV=development|production
ALLOWED_ORIGINS=http://localhost:5173   # dev only; in prod everything is same-origin
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

### Adding a new Socket.io event
Extend `telemedicineSocketService` (or a new service) and `initialize(io)` it from `index.ts`. Keep tracker / video / postural concerns separated — don't fan out from a single mega-handler.

### Generating a room name
`consulta-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`. Keep this consistent across Wix Velo and React (utility in [frontend/src/utils/linkGenerator.ts](frontend/src/utils/linkGenerator.ts)).

### Querying "today" in PostgreSQL
Convert to Colombia (UTC-5) before extracting `y/m/d`, then build start/end of day in UTC. Don't trust the server's local TZ.

### Showing async status in Wix
```javascript
$w('#estadoWhp').text = "📤 ENVIANDO LINK...";
$w('#estadoWhp').show();
// ... await sendTextMessage(...)
$w('#estadoWhp').text = "✅ MENSAJE ENVIADO"; // or "❌ ERROR AL ENVIAR"
```

## Known Issues and Solutions

- **Doctor sees skeleton-loading forever** — patient hasn't emitted the first `pose-data-update`. Check patient browser console for MediaPipe / camera errors. The doctor's "Iniciar Análisis" button is disabled until `isPosturalAnalysisConnected` is true; if it isn't, Socket.io hasn't connected yet (give it 2-3s after entering the room).
- **Doctor and patient end up in different rooms** — room name was generated in `$w.onReady` (Wix) instead of inside `whpTwilio.onClick`, OR `iniciarConsultaTwilio.link` was set after sending the patient link. Generate once, set the doctor link atomically before any await.
- **Background blur returns 403** — assets are being fetched from the Twilio CDN. Confirm `assetsPath: '/twilio-processors'` and that the public folder still has the TFLite/WASM bundle.
- **"Condiciones Especiales" tags missing for a patient** — the `formularios` row uses `'SI'` / `'Sí'` / `'true'`. The boolean coercion in `medical-history.service.ts` must check all four; missing one will silently hide that condition.
- **`new Date()` shows the wrong day** — production runs in UTC. Always convert to UTC-5 before computing day boundaries.

## Testing Notes

- Jest is configured in backend; no tests written yet.
- No frontend test runner.
- Manual testing flow: backend on `:3000`, frontend on `:5173`, two browser windows (one for `/doctor/<room>`, one for `/patient/<room>`), open DevTools on both. Watch for `[Postural Analysis]`, `[Doctor] 📊`, `[Canvas] 🎨` log markers when exercising the postural feature.

## Reference Documents in this Repo

These docs go deeper than this file — read them when working on a specific area:

- [arquitectura-video.md](arquitectura-video.md) — overall architecture write-up
- [WIX_INTEGRATION.md](WIX_INTEGRATION.md) — full Wix integration patterns
- [PANEL-MEDICO.md](PANEL-MEDICO.md) — medical panel design
- [MIGRACION-WIX-POSTGRES.md](MIGRACION-WIX-POSTGRES.md) — schema, queries, TZ handling
- [DIAGNOSTICO_ANALISIS_POSTURAL.md](DIAGNOSTICO_ANALISIS_POSTURAL.md) — postural analysis log conventions and failure modes
- [FUNCIONALIDAD_SNAPSHOTS_MULTIPLES.md](FUNCIONALIDAD_SNAPSHOTS_MULTIPLES.md) — snapshot/PDF export internals
- [CONDICIONES_ESPECIALES.md](CONDICIONES_ESPECIALES.md) — antecedent flag coercion details
- [README-TELEMEDICINA.md](README-TELEMEDICINA.md) — telemedicine flow user-facing
- [.do/app.yaml](.do/app.yaml) + Dockerfile — deployment configuration

## Phase 1 — refactor structure (panel de consulta médica)

- Panel descompuesto en `frontend/src/components/panel/` (orchestrator + 12 componentes + tabs/ + hooks/ + types.ts).
- Layout 75/25 en `VideoRoom.tsx` con toggle Maximize2/Minimize2 (atajos `M` / `N`).
- Auto-save: hook `useAutoSave` con debounce 800ms → `PATCH /api/video/medical-history/:id/field`. Aggregator de estado vía `SaveContext`.
- Schema: ~150 columnas snake_case nuevas en `HistoriaClinica` (idempotente con `ADD COLUMN IF NOT EXISTS`, en `postgres.service.ts → runMigrations()`).
- Whitelist de campos editables en `medical-history.service.ts` (constante exportada `EDITABLE_FIELDS` + tipos por campo). Coerción de booleanos consistente con el resto del proyecto (`true | 'true' | 'Sí' | 'SI'`).
- POC tab Datos Básicos completo (3 cards: Identidad, Residencia, Información Básica). El resto de tabs son placeholders.
- `MedicalHistoryPanel.tsx` viejo queda huérfano en disco para referencia Phase 2; ya no se importa desde `VideoRoom.tsx`.
- Phase 2 (anamnesis, examen físico, riesgo) y Phase 3 (intervención, conducta, observaciones, polish) son runs separados.

import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { TemaBodyVibe } from './components/bodyvibe/TemaBodyVibe';
import { RequireRole } from './components/RequireRole';
import { useTorniquete } from './hooks/useTorniquete';
import { queryClient } from './lib/queryClient';

// ---------------------------------------------------------------------------
// Páginas en carga diferida (code splitting por ruta).
//
// Antes todo esto vivía en un único bundle de 2,8 MB (713 KB comprimidos) que
// bajaba TODO el mundo: el paciente que abría su videollamada desde WhatsApp
// descargaba, sin usarlos, el panel de coordinador, el panel corporativo, xlsx
// (138 KB) y el catálogo CIE-10 (56 KB); y el coordinador descargaba el SDK de
// video (455 KB) que nunca iba a abrir. Ahora cada página es su propio chunk,
// que el navegador pide sólo al entrar a esa ruta.
//
// Medido sobre el build, comprimido:
//   · primer pintado (login): 713 KB → 86 KB, un solo archivo.
//   · paciente en videollamada: 713 KB → 595 KB. Baja poco porque `VideoRoom`
//     (Twilio Video + MediaPipe, 455 KB) sí lo necesita; el resto se fue.
//
// `LoginPage` queda fuera a propósito: es la primera pantalla de casi todos, y
// diferirla sólo agregaría un viaje al servidor antes del primer pintado.
//
// Todas son exportaciones con nombre salvo BodyVibeTech y AppsPublicados, que
// son `export default` — de ahí las dos formas del import.
// ---------------------------------------------------------------------------
const DoctorPage = lazy(() => import('./pages/DoctorPage').then((m) => ({ default: m.DoctorPage })));
const DoctorRoomPage = lazy(() =>
  import('./pages/DoctorRoomPage').then((m) => ({ default: m.DoctorRoomPage }))
);
const NutricionRoomPage = lazy(() =>
  import('./pages/NutricionRoomPage').then((m) => ({ default: m.NutricionRoomPage }))
);
const PatientPage = lazy(() =>
  import('./pages/PatientPage').then((m) => ({ default: m.PatientPage }))
);
const MedicalPanelPage = lazy(() =>
  import('./pages/MedicalPanelPage').then((m) => ({ default: m.MedicalPanelPage }))
);
const HistoriasClinicasPage = lazy(() =>
  import('./pages/HistoriasClinicasPage').then((m) => ({ default: m.HistoriasClinicasPage }))
);
const HistoriaDetallePage = lazy(() =>
  import('./pages/HistoriaDetallePage').then((m) => ({ default: m.HistoriaDetallePage }))
);
const CorporativoConsultaPage = lazy(() =>
  import('./pages/CorporativoConsultaPage').then((m) => ({ default: m.CorporativoConsultaPage }))
);
const OrdenesPage = lazy(() =>
  import('./pages/OrdenesPage').then((m) => ({ default: m.OrdenesPage }))
);
const CalidadPage = lazy(() =>
  import('./pages/CalidadPage').then((m) => ({ default: m.CalidadPage }))
);
const CoordinadorPage = lazy(() =>
  import('./pages/CoordinadorPage').then((m) => ({ default: m.CoordinadorPage }))
);
const BotTrepsiPage = lazy(() =>
  import('./pages/BotTrepsiPage').then((m) => ({ default: m.BotTrepsiPage }))
);
const MonitorIntegracionPage = lazy(() =>
  import('./pages/MonitorIntegracionPage').then((m) => ({ default: m.MonitorIntegracionPage }))
);
const MonitorMybodytechPage = lazy(() =>
  import('./pages/MonitorMybodytechPage').then((m) => ({ default: m.MonitorMybodytechPage }))
);
const ReprogramarPage = lazy(() =>
  import('./pages/ReprogramarPage').then((m) => ({ default: m.ReprogramarPage }))
);
const TerminosPage = lazy(() =>
  import('./pages/TerminosPage').then((m) => ({ default: m.TerminosPage }))
);
const RegistroPage = lazy(() =>
  import('./pages/RegistroPage').then((m) => ({ default: m.RegistroPage }))
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/PasswordPages').then((m) => ({ default: m.ForgotPasswordPage }))
);
const ResetPasswordPage = lazy(() =>
  import('./pages/PasswordPages').then((m) => ({ default: m.ResetPasswordPage }))
);
const BodyVibeTechPage = lazy(() => import('./pages/BodyVibeTechPage'));
const AppsPublicadosPage = lazy(() => import('./pages/AppsPublicadosPage'));

// Devtools sólo en dev. En build de producción `import.meta.env.DEV === false`
// y el lazy import nunca se evalúa, por lo que el chunk queda fuera del
// bundle principal (sólo aparece como chunk async sin emitirse).
const ReactQueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import('@tanstack/react-query-devtools').then((m) => ({
        default: m.ReactQueryDevtools,
      }))
    )
  : null;

// Ruta demo (solo dev) para grabar el clip de antropometría ISAK. Igual que los
// devtools: en producción `import.meta.env.DEV === false`, el lazy nunca se
// evalúa y el chunk queda fuera del bundle.
const IsakDemo = import.meta.env.DEV
  ? lazy(() => import('./pages/IsakDemo').then((m) => ({ default: m.IsakDemo })))
  : null;

/** Placeholder para el rol `torre` (aún sin alcances asignados). */
function SinAcceso() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 text-center p-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-800">Sin acceso asignado</h1>
        <p className="text-sm text-zinc-500 mt-2">
          Tu usuario aún no tiene módulos habilitados. Contacta al administrador.
        </p>
        <a href="/login" className="text-sm text-blue-700 mt-4 inline-block">
          Volver a iniciar sesión
        </a>
      </div>
    </div>
  );
}

/**
 * Heartbeat del torniquete de jornada. Montado una sola vez dentro del Router
 * para que persista entre navegaciones. No renderiza nada.
 */
function TorniqueteHeartbeat() {
  useTorniquete();
  return null;
}

/**
 * Lo que se ve mientras baja el chunk de una página. Deliberadamente sobrio y
 * sin texto: en una conexión buena dura milisegundos, y un cartel de "Cargando"
 * parpadeando en cada navegación se lee peor que un vacío tranquilo.
 */
function CargandoPagina() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-zinc-50"
      role="status"
      aria-label="Cargando"
    >
      <div className="w-6 h-6 border-2 border-zinc-300 border-t-zinc-600 rounded-full animate-spin" />
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TorniqueteHeartbeat />
        {/* Aplica la apariencia configurada en BodyVibeTech. No pinta nada; se
            retira sola mientras hay una videollamada activa. */}
        <TemaBodyVibe />
        {/* Un solo límite para todas las rutas diferidas: cada `element` es un
            chunk que se pide al entrar, y éste es el estado mientras llega. */}
        <Suspense fallback={<CargandoPagina />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            {/* Login unificado (RBAC). Las páginas de login viejas redirigen aquí. */}
            <Route path="/login" element={<LoginPage />} />
            {/* Registro de profesionales: la pantalla es de acá, la cuenta se
                crea en ACC (ver RegistroPage). */}
            <Route path="/registro" element={<RegistroPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/coordinador-login" element={<Navigate to="/login" replace />} />
            <Route path="/ordenes-login" element={<Navigate to="/login" replace />} />
            <Route path="/sin-acceso" element={<SinAcceso />} />
            {/* Públicas: paciente / video / reprogramar / bot. */}
            <Route path="/doctor" element={<DoctorPage />} />
            <Route path="/doctor/:roomName" element={<DoctorRoomPage />} />
            <Route path="/nutricion/:roomName" element={<NutricionRoomPage />} />
            {IsakDemo && (
              <Route
                path="/demo-isak"
                element={
                  <Suspense fallback={null}>
                    <IsakDemo />
                  </Suspense>
                }
              />
            )}
            <Route path="/patient/:roomName" element={<PatientPage />} />
            <Route path="/panel-medico/patient/:roomName" element={<PatientPage />} />
            <Route path="/bot-trepsi" element={<BotTrepsiPage />} />
            <Route path="/monitor-integracion" element={<MonitorIntegracionPage />} />
            <Route path="/monitor-mybodytech" element={<MonitorMybodytechPage />} />
            <Route path="/reprogramar/:id" element={<ReprogramarPage />} />
            <Route path="/terminos" element={<TerminosPage />} />
            <Route path="/terminos-y-condiciones" element={<Navigate to="/terminos" replace />} />
            {/* Panel clínico — sesión RBAC (médico/coach/coordinador/admin). */}
            <Route
              path="/panel-medico"
              element={
                <RequireRole roles={['medico', 'coach', 'coordinador', 'admin']}>
                  <MedicalPanelPage />
                </RequireRole>
              }
            />
            <Route
              path="/historias"
              element={
                <RequireRole roles={['medico', 'coach', 'coordinador', 'admin']}>
                  <HistoriasClinicasPage />
                </RequireRole>
              }
            />
            <Route
              path="/historia/:historiaId"
              element={
                <RequireRole roles={['medico', 'coach', 'coordinador', 'admin']}>
                  <HistoriaDetallePage />
                </RequireRole>
              }
            />
            <Route
              path="/corporativo/:historiaId"
              element={
                <RequireRole roles={['medico', 'coordinador', 'admin']}>
                  <CorporativoConsultaPage />
                </RequireRole>
              }
            />
            {/* Protegidas por rol (RBAC). */}
            <Route
              path="/ordenes"
              element={
                <RequireRole roles={['admin', 'coordinador', 'auxiliar']}>
                  <OrdenesPage />
                </RequireRole>
              }
            />
            <Route
              path="/calidad"
              element={
                <RequireRole roles={['admin', 'coordinador']}>
                  <CalidadPage />
                </RequireRole>
              }
            />
            <Route
              path="/coordinador"
              element={
                <RequireRole roles={['admin', 'coordinador']}>
                  <CoordinadorPage />
                </RequireRole>
              }
            />

            {/* BodyVibeTech — construcción de apps internos. Solo admin: en esta
                fase quienes construyen son administradores, y la audiencia se
                amplía recién con la publicación. */}
            <Route
              path="/bodyvibetech"
              element={
                <RequireRole roles={['admin']}>
                  <BodyVibeTechPage />
                </RequireRole>
              }
            />

            {/* Donde la audiencia USA los apps publicados. Abierta a todos los
                roles: quién ve cada app lo decide su audiencia, y eso lo resuelve
                el backend — la pantalla no decide permisos. */}
            <Route
              path="/apps"
              element={
                <RequireRole roles={['admin', 'coordinador', 'medico', 'coach', 'auxiliar', 'torre']}>
                  <AppsPublicadosPage />
                </RequireRole>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
      {ReactQueryDevtools && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}

export default App;

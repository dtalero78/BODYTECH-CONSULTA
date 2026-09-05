import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { DoctorPage } from './pages/DoctorPage';
import { DoctorRoomPage } from './pages/DoctorRoomPage';
import { NutricionRoomPage } from './pages/NutricionRoomPage';
import { PatientPage } from './pages/PatientPage';
import { MedicalPanelPage } from './pages/MedicalPanelPage';
import { HistoriasClinicasPage } from './pages/HistoriasClinicasPage';
import { HistoriaDetallePage } from './pages/HistoriaDetallePage';
import { CorporativoConsultaPage } from './pages/CorporativoConsultaPage';
import { OrdenesPage } from './pages/OrdenesPage';
import { CalidadPage } from './pages/CalidadPage';
import { CoordinadorPage } from './pages/CoordinadorPage';
import { BotTrepsiPage } from './pages/BotTrepsiPage';
import { MonitorIntegracionPage } from './pages/MonitorIntegracionPage';
import { MonitorMybodytechPage } from './pages/MonitorMybodytechPage';
import { ReprogramarPage } from './pages/ReprogramarPage';
import { TerminosPage } from './pages/TerminosPage';
import { LoginPage } from './pages/LoginPage';
import { RegistroPage } from './pages/RegistroPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
import BodyVibeTechPage from './pages/BodyVibeTechPage';
import AppsPublicadosPage from './pages/AppsPublicadosPage';
import { TemaBodyVibe } from './components/bodyvibe/TemaBodyVibe';
import { RequireRole } from './components/RequireRole';
import { useTorniquete } from './hooks/useTorniquete';
import { queryClient } from './lib/queryClient';

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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TorniqueteHeartbeat />
        {/* Aplica la apariencia configurada en BodyVibeTech. No pinta nada; se
            retira sola mientras hay una videollamada activa. */}
        <TemaBodyVibe />
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

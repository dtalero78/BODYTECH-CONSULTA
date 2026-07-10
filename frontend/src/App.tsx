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
import { OrdenesPage } from './pages/OrdenesPage';
import { CalidadPage } from './pages/CalidadPage';
import { CoordinadorPage } from './pages/CoordinadorPage';
import { BotTrepsiPage } from './pages/BotTrepsiPage';
import { MonitorIntegracionPage } from './pages/MonitorIntegracionPage';
import { ReprogramarPage } from './pages/ReprogramarPage';
import { TerminosPage } from './pages/TerminosPage';
import { LoginPage } from './pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordPages';
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
        <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />
          {/* Login unificado (RBAC). Las páginas de login viejas redirigen aquí. */}
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/coordinador-login" element={<Navigate to="/login" replace />} />
          <Route path="/ordenes-login" element={<Navigate to="/login" replace />} />
          <Route path="/sin-acceso" element={<SinAcceso />} />
          {/* Públicas: paciente / video / reprogramar / bot. */}
          <Route path="/doctor" element={<DoctorPage />} />
          <Route path="/doctor/:roomName" element={<DoctorRoomPage />} />
          <Route path="/nutricion/:roomName" element={<NutricionRoomPage />} />
          <Route path="/patient/:roomName" element={<PatientPage />} />
          <Route path="/panel-medico/patient/:roomName" element={<PatientPage />} />
          <Route path="/bot-trepsi" element={<BotTrepsiPage />} />
          <Route path="/monitor-integracion" element={<MonitorIntegracionPage />} />
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

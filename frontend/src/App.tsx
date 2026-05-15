import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { DoctorPage } from './pages/DoctorPage';
import { DoctorRoomPage } from './pages/DoctorRoomPage';
import { PatientPage } from './pages/PatientPage';
import { MedicalPanelPage } from './pages/MedicalPanelPage';
import { HistoriasClinicasPage } from './pages/HistoriasClinicasPage';
import { OrdenesPage } from './pages/OrdenesPage';
import { OrdenesLoginPage } from './pages/OrdenesLoginPage';
import { CalidadPage } from './pages/CalidadPage';
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

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/panel-medico" replace />} />
          <Route path="/doctor" element={<DoctorPage />} />
          <Route path="/doctor/:roomName" element={<DoctorRoomPage />} />
          <Route path="/patient/:roomName" element={<PatientPage />} />
          <Route path="/panel-medico/patient/:roomName" element={<PatientPage />} />
          <Route path="/panel-medico" element={<MedicalPanelPage />} />
          <Route path="/historias" element={<HistoriasClinicasPage />} />
          <Route path="/ordenes-login" element={<OrdenesLoginPage />} />
          <Route path="/ordenes" element={<OrdenesPage />} />
          <Route path="/calidad" element={<CalidadPage />} />
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

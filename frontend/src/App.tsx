import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { DoctorPage } from './pages/DoctorPage';
import { DoctorRoomPage } from './pages/DoctorRoomPage';
import { PatientPage } from './pages/PatientPage';
import { MedicalPanelPage } from './pages/MedicalPanelPage';
import { HistoriasClinicasPage } from './pages/HistoriasClinicasPage';
import { OrdenesPage } from './pages/OrdenesPage';
import { CalidadPage } from './pages/CalidadPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/panel-medico" replace />} />
        <Route path="/doctor" element={<DoctorPage />} />
        <Route path="/doctor/:roomName" element={<DoctorRoomPage />} />
        <Route path="/patient/:roomName" element={<PatientPage />} />
        <Route path="/panel-medico/patient/:roomName" element={<PatientPage />} />
        <Route path="/panel-medico" element={<MedicalPanelPage />} />
        <Route path="/historias" element={<HistoriasClinicasPage />} />
        <Route path="/ordenes" element={<OrdenesPage />} />
        <Route path="/calidad" element={<CalidadPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

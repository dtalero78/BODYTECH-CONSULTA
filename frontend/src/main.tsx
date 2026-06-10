import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import './index.css';
// Registra el interceptor global de axios que inyecta el JWT en cada request.
// Debe importarse antes de renderizar para que los hooks del panel (axios
// directo) envíen el token a las rutas protegidas de historia clínica.
import './services/axios-auth';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

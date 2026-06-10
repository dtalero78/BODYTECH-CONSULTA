// ============================================================================
// Interceptor GLOBAL de axios — inyecta el JWT (`bsl_auth_token`) en TODA
// petición hecha con la instancia por defecto de axios (`axios.get/post/patch`).
//
// Por qué existe: varios hooks del panel médico (useMedicalHistory, useAutoSave,
// usePersistField) usan `axios` directo en vez del cliente de `api.service.ts`
// (que ya tiene su propio interceptor). Tras proteger las rutas de historia
// clínica con JWT en el backend, esos llamados deben enviar el token o
// recibirían 401. Este interceptor lo garantiza de forma centralizada.
//
// Si no hay sesión (paciente / pre-login), no se agrega header y el request
// sigue siendo anónimo — los endpoints públicos (token de video, eventos,
// reprogramar) no se ven afectados.
//
// Se importa una sola vez desde `main.tsx`, antes de renderizar la app.
// ============================================================================

import axios from 'axios';

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('bsl_auth_token');
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export {};

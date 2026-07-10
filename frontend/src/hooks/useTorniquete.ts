// ============================================================================
// useTorniquete — Heartbeat de jornada laboral del profesional.
//
// Se monta UNA vez a nivel de App (persiste entre cambios de ruta de React
// Router). Mientras haya un profesional (médico/coach) logueado, late cada
// ~90s para marcar "activo en la plataforma". El backend abre/extiende la
// jornada; el sweeper cierra las inactivas.
//
// Gating: solo late si el usuario logueado es médico/coach (tiene código de
// profesional). Pacientes (sin token) y coordinador/admin no fichan torniquete.
//
// Al volver la pestaña a primer plano manda un latido inmediato para reflejar
// rápido el "en línea" en el tablero del coordinador.
// ============================================================================

import { useEffect } from 'react';
import authService from '../services/auth.service';
import torniqueteService from '../services/torniquete.service';

// Debe ser cómodamente menor que la ventana de inactividad del backend (5 min)
// para tolerar el throttling de setInterval en pestañas en segundo plano.
const HEARTBEAT_INTERVAL_MS = 90_000;

/** ¿El usuario logueado es un profesional (médico/coach) que ficha jornada? */
function esProfesionalLogueado(): boolean {
  if (!authService.isLoggedIn()) return false;
  // Login legacy (code+sede) deja `bsl_rol`; RBAC deja el rol en `bsl_user`.
  if (authService.getRol() !== null) return true;
  const role = authService.getUser()?.role;
  return role === 'medico' || role === 'coach';
}

export function useTorniquete(): void {
  useEffect(() => {
    if (!esProfesionalLogueado()) return;

    // Latido inmediato al entrar (marca la entrada apenas abre la plataforma).
    torniqueteService.heartbeat();

    const interval = window.setInterval(() => {
      // Revalidar en cada tick: si cerró sesión, dejar de latir.
      if (esProfesionalLogueado()) {
        torniqueteService.heartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible' && esProfesionalLogueado()) {
        torniqueteService.heartbeat();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
}

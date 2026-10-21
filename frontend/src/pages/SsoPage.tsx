import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import authService, { homePathForRole } from '../services/auth.service';

/**
 * Entrada por pase desde otra app (el CRM de Bodytech). Llega `/sso#t=<jwt>&u=<usuario en base64url>`: el
 * token va en el FRAGMENTO, que no viaja al servidor, así que no queda en logs de acceso ni en el Referer, y se
 * borra del historial apenas se lee. Es el mismo mecanismo que `/sso` de ACC, pero acá el token lo emitió
 * Consulta y la sesión guarda también el usuario.
 */
function leerUsuario(b64: string | null): unknown {
  if (!b64) return null;
  try {
    const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return null;
  }
}

export default function SsoPage() {
  const navigate = useNavigate();
  // Se lee al renderizar y no en el efecto: el efecto borra el fragmento y StrictMode lo corre dos veces en dev.
  const [{ token, usuario }] = useState(() => {
    const f = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    return { token: f.get('t'), usuario: leerUsuario(f.get('u')) };
  });
  const [fallo, setFallo] = useState(false);

  useEffect(() => {
    window.history.replaceState(null, '', window.location.pathname);
    const sesion = token ? authService.entrarConPase(token, usuario) : null;
    if (!sesion) {
      setFallo(true);
      return;
    }
    navigate(homePathForRole(sesion.role), { replace: true });
  }, [token, usuario, navigate]);

  if (fallo) return <Navigate to="/login" replace />;
  return <p style={{ padding: 24, fontFamily: 'sans-serif' }}>Entrando…</p>;
}

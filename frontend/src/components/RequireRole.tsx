import { Navigate } from 'react-router-dom';
import authService, { Role, homePathForRole } from '../services/auth.service';

/**
 * Guard de ruta por rol (RBAC). Sin sesión → /login. Con sesión pero rol no
 * permitido → su pantalla de inicio (homePathForRole). El backend igual valida
 * por rol; esto evita mostrar vistas a las que el usuario no tiene acceso.
 */
export function RequireRole({
  roles,
  children,
}: {
  roles: Role[];
  children: React.ReactElement;
}): React.ReactElement {
  const user = authService.getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) {
    return <Navigate to={homePathForRole(user.role)} replace />;
  }
  return children;
}

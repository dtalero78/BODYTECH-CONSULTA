// ============================================================================
// paneles-acceso — Quién usa la página de paneles (/paneles).
//
// /paneles es la puerta del creador de la plataforma a las pantallas de las
// tres apps hermanas: Consulta, ACC y Prepagadas. La cascada del login decide
// sola a qué app entra cada correo —quien tiene cuenta en Consulta nunca llega
// a las otras—, así que para mirar las tres hacían falta tres cuentas.
//
// No se abre por rol: `admin` la abriría a todos los administradores, y desde
// ahí se entra a ACC y a Prepagadas sin volver a escribir la contraseña. Va por
// correo, igual que Digitalizar. La lista vive en `SUPERUSUARIOS` (correos
// separados por coma): sumar o sacar a alguien es cambiar una variable de
// entorno, no desplegar.
//
// Esto NO reparte permisos en ninguna app. Cada una sigue decidiendo con su
// propio acceso en `persona_apps`: estar en la lista sin tener cuenta de admin
// en ACC es no poder entrar a ACC. Lo único que decide es si Consulta pide los
// tokens de las hermanas al iniciar sesión y si dibuja la página.
// ============================================================================

/** Si nadie configuró la variable, solo el autor. Nunca "todos". */
const POR_DEFECTO = ['danieltalero78@gmail.com'];

function lista(): string[] {
  const crudo = process.env.SUPERUSUARIOS;
  if (!crudo) return POR_DEFECTO;
  const correos = crudo
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  // Una variable presente pero vacía no debe abrir la puerta a todos: es un
  // error de configuración, no una decisión.
  return correos.length > 0 ? correos : POR_DEFECTO;
}

export function esSuperusuario(email: string | null | undefined): boolean {
  if (!email) return false;
  return lista().includes(email.trim().toLowerCase());
}

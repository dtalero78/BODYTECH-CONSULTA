// ============================================================================
// sesion-vencida — cuando el token se venció, volver al login solo.
//
// Antes no pasaba nada: el token vencía, cada llamada respondía 401, y la
// pantalla se quedaba puesta mostrando "no se pudo traer …" en cada recuadro.
// Nada decía la única cosa que había que hacer, que era volver a entrar. Pasaba
// en todos los paneles, no solo en BodyVibeTech: ninguno de los cuatro clientes
// HTTP miraba las respuestas de error.
//
// La parte delicada de esto no es redirigir — son los casos en los que NO hay
// que redirigir, porque sacar a alguien de donde está es más caro que dejarlo
// ver un error:
//
//   · Sin sesión guardada. Un 401 ahí es lo normal, no una sesión vencida: el
//     paciente que entra por el enlace de WhatsApp y el bot de Trepsi no tienen
//     token y nunca lo tuvieron. Mandarlos a un login sería inventarles una
//     puerta que no les corresponde.
//   · Con una videollamada en curso. Si a un médico se le vence el token
//     mientras atiende, redirigir le tumba la consulta —vídeo, grabación y lo
//     que llevara escrito—. Se prefiere que vea el error y siga atendiendo; al
//     salir de la sala, el siguiente 401 sí lo lleva al login.
//   · Ya estando en el login. El propio intento fallido responde 401, y
//     redirigir ahí es un bucle.
//
// Solo mira 401. Un 403 es "entró bien, pero esto no es para usted": ahí la
// respuesta correcta es explicarlo, no pedir credenciales otra vez.
// ============================================================================

import { AxiosInstance } from 'axios';
import { hayLlamadaActiva } from '../state/llamadaActiva';

const TOKEN_KEY = 'bsl_auth_token';

/**
 * Una sola redirección aunque fallen diez llamadas juntas. Al abrir un panel
 * salen varias peticiones a la vez; sin esto, la primera navega y las demás
 * vuelven a navegar sobre la navegación en curso.
 */
let yendoAlLogin = false;

function limpiarSesion(): void {
  for (const k of [
    'bsl_auth_token',
    'bsl_user',
    'bsl_rol',
    'bsl_sede_id',
    'bsl_sede_name',
    'bsl_medico_code',
    'bsl_especialidad',
  ]) {
    localStorage.removeItem(k);
  }
}

/**
 * Se le instala a cada cliente axios. Deja pasar el error igual: quien llamó
 * puede seguir manejándolo, esto solo agrega la salida al login.
 */
export function instalarCierreDeSesion(cliente: AxiosInstance): void {
  cliente.interceptors.response.use(
    (r) => r,
    (error) => {
      if (error?.response?.status !== 401) return Promise.reject(error);
      if (!localStorage.getItem(TOKEN_KEY)) return Promise.reject(error);
      if (window.location.pathname === '/login') return Promise.reject(error);

      if (hayLlamadaActiva()) {
        console.warn(
          '[sesión] El token venció durante una videollamada. No se redirige para no cortar la consulta; ' +
            'al salir de la sala habrá que volver a entrar.'
        );
        return Promise.reject(error);
      }

      if (yendoAlLogin) return Promise.reject(error);
      yendoAlLogin = true;

      limpiarSesion();
      // Se recuerda dónde estaba para devolverlo ahí después de entrar. Se usa
      // `replace` para que el botón «atrás» no lo traiga de vuelta a una
      // pantalla que ya no puede cargar.
      const volver = window.location.pathname + window.location.search;
      window.location.replace(`/login?volver=${encodeURIComponent(volver)}`);

      return Promise.reject(error);
    }
  );
}

export default instalarCierreDeSesion;

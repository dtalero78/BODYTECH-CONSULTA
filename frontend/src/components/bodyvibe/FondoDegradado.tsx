// ============================================================================
// FondoDegradado — el fondo de la portada de BodyVibeTech.
//
// Blanco arriba, que se va llenando de color hacia abajo.
//
// ⚠️ SIN `filter: blur()`, y no es un detalle de estilo. La primera versión
// desenfocaba una capa del tamaño de la pantalla más 320px por lado. Eso obliga
// al navegador a reservar una superficie enorme en la GPU y volver a
// desenfocarla en cada cuadro; cuando no le alcanza, descarta la capa y el
// fondo desaparece. Se veía como un parpadeo: aparecía y se iba.
//
// No hacía falta: un degradado radial YA es suave por definición. Lo que el
// desenfoque aportaba —fundir una mancha con la siguiente— se consigue igual
// con caídas largas a transparente, y sin costo de composición. Por eso también
// se evita `backdrop-filter` en lo que va encima.
//
// Sobre los colores. Azul y naranja son opuestos, y donde se cruzan de frente
// dan gris sucio — no es cuestión de gusto, es lo que pasa al mezclar luz
// complementaria. Por eso entre el azul y el naranja hay un coral (#FF6B4A) y
// un violeta (#7C6BF5): la transición pasa por ahí en vez de chocar, que es lo
// mismo que hace un atardecer real. Quitar esos dos pasos deja el barro.
//
// En oscuro no se usan otros colores sino menos: el mismo campo al 45%, porque
// sobre negro estos tonos a plena intensidad brillan tanto que el texto de
// encima deja de leerse.
// ============================================================================

/**
 * Las manchas, de arriba hacia abajo. La primera de la lista queda encima.
 *
 * Las caídas son largas (hasta 70-80%) justamente porque no hay desenfoque que
 * las suavice después: la suavidad tiene que estar en la parada del degradado.
 */
const CAMPO = [
  // Naranja: la base, ocupa todo el borde inferior.
  'radial-gradient(90% 70% at 50% 112%, #FF8A1F 0%, rgba(255,138,31,0.55) 38%, rgba(255,138,31,0) 78%)',
  // Coral a los costados — el paso del azul al naranja sin pasar por el gris.
  'radial-gradient(70% 60% at 12% 92%, #FF6B4A 0%, rgba(255,107,74,0.45) 40%, rgba(255,107,74,0) 78%)',
  'radial-gradient(70% 60% at 88% 96%, #FF7A2E 0%, rgba(255,122,46,0.45) 40%, rgba(255,122,46,0) 78%)',
  // Violeta: el otro extremo del mismo puente, del lado del azul.
  'radial-gradient(60% 55% at 18% 68%, #7C6BF5 0%, rgba(124,107,245,0.40) 42%, rgba(124,107,245,0) 80%)',
  // Azul, la mancha grande del medio.
  'radial-gradient(95% 65% at 55% 62%, #4F72F5 0%, rgba(79,114,245,0.50) 40%, rgba(79,114,245,0) 80%)',
  'radial-gradient(60% 50% at 84% 60%, #6E8BFF 0%, rgba(110,139,255,0.40) 42%, rgba(110,139,255,0) 80%)',
].join(', ');

export function FondoDegradado() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 opacity-90 dark:opacity-45" style={{ background: CAMPO }} />
      {/* El color arranca a media altura; arriba el fondo queda limpio para que
          el título y la barra de sesión se lean sin competencia. */}
      <div className="absolute inset-x-0 top-0 h-[46%] bg-gradient-to-b from-white via-white/85 to-transparent dark:from-zinc-950 dark:via-zinc-950/85" />
    </div>
  );
}

export default FondoDegradado;

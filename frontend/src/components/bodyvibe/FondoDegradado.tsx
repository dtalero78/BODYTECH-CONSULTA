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
  'radial-gradient(105% 62% at 50% 118%, #FF7A00 0%, rgba(255,122,0,0.72) 34%, rgba(255,122,0,0) 76%)',
  // Coral a los costados — el paso del azul al naranja sin pasar por el gris.
  'radial-gradient(62% 46% at 8% 98%, #FF5C36 0%, rgba(255,92,54,0.55) 38%, rgba(255,92,54,0) 76%)',
  'radial-gradient(62% 46% at 92% 100%, #FF8A2B 0%, rgba(255,138,43,0.55) 38%, rgba(255,138,43,0) 76%)',
  // Violeta: el otro extremo del mismo puente, del lado del azul.
  'radial-gradient(58% 40% at 16% 82%, #8B5CF6 0%, rgba(139,92,246,0.50) 40%, rgba(139,92,246,0) 78%)',
  'radial-gradient(52% 34% at 86% 78%, #A855F7 0%, rgba(168,85,247,0.42) 42%, rgba(168,85,247,0) 78%)',
  // Azul, la mancha grande. Va bien abajo: si sube, le pisa el título y el
  // texto queda leyéndose sobre color en vez de sobre blanco.
  'radial-gradient(88% 46% at 50% 76%, #3B6BF5 0%, rgba(59,107,245,0.68) 38%, rgba(59,107,245,0) 78%)',
].join(', ');

export function FondoDegradado() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 dark:opacity-50" style={{ background: CAMPO }} />
      {/* El color arranca a media altura; arriba el fondo queda limpio para que
          el título y la barra de sesión se lean sin competencia. */}
      <div className="absolute inset-x-0 top-0 h-[58%] bg-gradient-to-b from-white via-white/90 to-transparent dark:from-zinc-950 dark:via-zinc-950/90" />
    </div>
  );
}

export default FondoDegradado;

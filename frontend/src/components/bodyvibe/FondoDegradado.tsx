// ============================================================================
// FondoDegradado — el fondo de la portada de BodyVibeTech.
//
// Blanco arriba, que se va llenando de color hacia abajo. Son manchas radiales
// muy desenfocadas: el desenfoque es lo que hace el trabajo: sin él se ven los
// bordes de cada mancha y parece una calcomanía.
//
// Sobre los colores. Azul y naranja son opuestos, y donde se cruzan de frente
// dan gris sucio — no es una cuestión de gusto, es lo que pasa al mezclar luz
// complementaria. Por eso entre el azul y el naranja hay un coral (#FF6B4A) y
// un violeta (#7C6BF5): la transición pasa por ahí en vez de chocar, que es lo
// mismo que hace un atardecer real. Quitar esos dos pasos deja el barro.
//
// En oscuro no se usan otros colores sino menos: el mismo campo al 45%, porque
// sobre negro estos tonos a plena intensidad brillan tanto que el texto de
// encima deja de leerse.
// ============================================================================

/** Las manchas, de arriba hacia abajo. La primera de la lista queda encima. */
const CAMPO = [
  // Naranja: la base, ocupa todo el borde inferior.
  'radial-gradient(75% 55% at 50% 108%, #FF8A1F 0%, rgba(255,138,31,0) 66%)',
  // Coral a los costados — el paso del azul al naranja sin pasar por el gris.
  'radial-gradient(55% 45% at 16% 88%, #FF6B4A 0%, rgba(255,107,74,0) 62%)',
  'radial-gradient(55% 45% at 84% 92%, #FF7A2E 0%, rgba(255,122,46,0) 62%)',
  // Violeta: el otro extremo del mismo puente, del lado del azul.
  'radial-gradient(50% 40% at 22% 66%, #7C6BF5 0%, rgba(124,107,245,0) 62%)',
  // Azul, la mancha grande del medio.
  'radial-gradient(80% 52% at 52% 60%, #4F72F5 0%, rgba(79,114,245,0) 64%)',
  'radial-gradient(45% 35% at 80% 58%, #6E8BFF 0%, rgba(110,139,255,0) 62%)',
].join(', ');

export function FondoDegradado() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/*
        El bloque va más grande que su contenedor (`-inset-40`) a propósito: el
        desenfoque come los bordes, y si midiera lo mismo se vería una franja
        pálida en los cuatro lados.
      */}
      <div
        className="absolute -inset-40 opacity-95 blur-[90px] dark:opacity-45"
        style={{ background: CAMPO }}
      />
      {/* El color arranca a media altura; arriba el fondo queda limpio para que
          el título y la barra de sesión se lean sin competencia. */}
      <div className="absolute inset-x-0 top-0 h-[46%] bg-gradient-to-b from-white via-white/85 to-transparent dark:from-zinc-950 dark:via-zinc-950/85" />
    </div>
  );
}

export default FondoDegradado;

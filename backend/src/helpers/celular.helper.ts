/**
 * La regla única de "¿este celular se puede marcar?".
 *
 * Vivía dentro de `link-paciente.service`, que al importarse arrastra el
 * cliente de Twilio: cualquier otro módulo que quisiera la regla se llevaba
 * media infraestructura encima (y rompía sus tests). Acá no depende de nada.
 */

/**
 * Indicativos de país que reconocemos cuando el número viene sin `+`. Los de 3
 * dígitos van PRIMERO para que el regex no los corte con un prefijo de 2.
 * `\d{8,}` tolera longitudes nacionales variables (Chile 9, Colombia 10).
 */
export const INDICATIVOS =
  /^(502|503|504|505|506|507|591|593|595|598|1|33|34|44|49|51|52|53|54|55|56|57|58)\d{8,}/;

/**
 * Celular en E.164 (`+57...`), o `null` si no lo reconocemos.
 *
 * Devolver `null` es deliberado: un worker no supervisado que le mande a Twilio
 * algo no reconocido produce errores 21211 en masa, así que preferimos omitir
 * la cita y dejarla en la bitácora. Y es también lo que le dice al panel que
 * una historia trae número pero no hay a quién llamar.
 */
export function formatCelularE164(celular: string): string | null {
  const cleaned = (celular || '').replace(/[\s()-]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('+')) {
    return /^\+\d{10,15}$/.test(cleaned) ? cleaned : null;
  }
  // Ya trae indicativo de país: solo le falta el '+'.
  if (INDICATIVOS.test(cleaned)) return `+${cleaned}`;
  // Celular local colombiano (10 dígitos que empiezan con 3).
  if (/^3\d{9}$/.test(cleaned)) return `+57${cleaned}`;

  return null;
}

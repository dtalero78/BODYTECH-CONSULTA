// ============================================================================
// reprogramar-firma — el link de "Reprogramar" lleva su propia firma.
//
// `/reprogramar/:id` es público a la fuerza: el afiliado la abre desde el botón
// de WhatsApp y no tiene cuenta. Pero el `:id` es el id de su historia, y con
// uno ajeno se veía su nombre y su hora, y se le podía mover la cita. Nada
// impedía probar ids hasta acertar.
//
// La firma ata el link a una cita concreta: `trepsi_123~9f2a1c7b55`. Es un HMAC
// del id con `JWT_SECRET` recortado a 10 caracteres — suficiente para que no se
// adivine (2^40 intentos), corto para que el link siga cabiendo en un botón de
// WhatsApp. No lleva vencimiento a propósito: la cita ya trae el suyo (una
// atendida o con el tope de reprogramaciones no se mueve).
//
// **Los links ya enviados siguen sirviendo** mientras `REPROGRAMAR_EXIGIR_FIRMA`
// esté apagada, que es como nace: el afiliado que recibió su mensaje ayer no se
// queda sin poder reprogramar hoy. Cuando todos los mensajes en circulación
// lleven firma (los del día, más el recordatorio de la mañana), se prende la
// variable y el id pelado deja de valer.
//
// Funciones PURAS: el secreto entra por parámetro para poder probarlas.
// ============================================================================

import { createHmac, timingSafeEqual } from 'crypto';

/** Separador entre el id y su firma. No aparece en ningún id real. */
const SEP = '~';
const LARGO = 10;

/** La firma de un id, en hexadecimal recortado. */
export function firmaDe(id: string, secreto: string): string {
  return createHmac('sha256', secreto).update(String(id)).digest('hex').slice(0, LARGO);
}

/** El id tal como viaja en el link: `id~firma`. */
export function firmarId(id: string, secreto: string | undefined): string {
  if (!secreto) return id; // sin secreto no hay firma que valga: el link sale pelado
  return `${id}${SEP}${firmaDe(id, secreto)}`;
}

export interface IdDeLink {
  /** El id de la historia, ya sin la firma. */
  id: string;
  /** `true` sólo si venía firma y coincide. */
  firmado: boolean;
}

/**
 * Separa el id de su firma y dice si es válida. Nunca lanza: un link roto
 * devuelve `firmado: false` y que decida quien llama.
 */
export function leerIdDeLink(raw: string, secreto: string | undefined): IdDeLink {
  const texto = String(raw ?? '');
  const corte = texto.lastIndexOf(SEP);
  if (corte <= 0) return { id: texto, firmado: false };

  const id = texto.slice(0, corte);
  const firma = texto.slice(corte + 1);
  if (!secreto || firma.length !== LARGO) return { id, firmado: false };

  const esperada = Buffer.from(firmaDe(id, secreto));
  const recibida = Buffer.from(firma);
  const firmado = esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
  return { id, firmado };
}

/** ¿Hay que rechazar un link sin firma? Lo decide el entorno, apagado por defecto. */
export function exigeFirma(entorno: Record<string, string | undefined>): boolean {
  return String(entorno.REPROGRAMAR_EXIGIR_FIRMA ?? '').toLowerCase() === 'true';
}

// ============================================================================
// marca.helper — ¿el paciente es de Bodytech o de Athletic, y por dónde se le
// escribe?
//
// Athletic es una marca de Bodytech: mismos coaches, mismo panel, mismas citas.
// Lo único que cambia para el paciente es QUIÉN le escribe por WhatsApp: a un
// paciente de Athletic le tiene que llegar el mensaje desde el número de
// Athletic (+1 505 587-1860), no desde el de Bodytech (+57 1 628 4820).
//
// La marca sale de `HistoriaClinica.codEmpresa`, que llena Trepsi con
// 'BODYTECH-COLOMBIA' o 'ATHLETIC' (trepsi.controller.ts, campo `empresa`). Solo
// Trepsi lo llena, y está bien así: los pacientes de Athletic llegan SOLO por
// Trepsi. Todo lo demás —MyBodytech, nativas, corporativo, UMV, y las citas de
// Trepsi anteriores a que mandaran el campo— es Bodytech.
//
// Las plantillas NO cambian con la marca: las tres que recibe el paciente (link,
// recordatorio, reprogramada) tienen texto neutro y están aprobadas en la WABA
// que comparten los dos números. Cambia el número de salida y el tenant de
// bsl-plataforma (donde queda el hilo del chat).
//
// Funciones PURAS: el entorno entra por parámetro para que los tests no toquen
// process.env.
// ============================================================================

export type Marca = 'bodytech' | 'athletic';

/** Número de WhatsApp de Athletic, si ATHLETIC_WHATSAPP_FROM no dice otro. */
export const ATHLETIC_WHATSAPP_FROM_DEFAULT = 'whatsapp:+15055871860';

type Entorno = Record<string, string | undefined>;

/** codEmpresa → marca. Solo 'ATHLETIC' es Athletic; vacío o cualquier otro valor es Bodytech. */
export function marcaDeCodEmpresa(codEmpresa: string | null | undefined): Marca {
  return (codEmpresa || '').trim().toUpperCase() === 'ATHLETIC' ? 'athletic' : 'bodytech';
}

/**
 * ¿Está encendido el canal de Athletic?
 *
 * Apagado por defecto, como los demás envíos automáticos a pacientes
 * (LINK_AUTO_ENABLED, RECORDATORIO_ENABLED). Mientras esté apagado, a los
 * pacientes de Athletic se les escribe desde Bodytech — exactamente como antes
 * de que existiera esto —, así que desplegar el código no cambia nada.
 *
 * Exige además el usuario del tenant ATHLETIC en bsl-plataforma, y no es un
 * detalle: el worker de link-auto deja de usar la plataforma en toda la corrida
 * apenas UN envío cae a Twilio (link-auto.service, `plataformaViva`). Con Athletic
 * encendido y sin usuario, cada paciente de Athletic caería a Twilio y dejaría a
 * los de Bodytech sin su mensaje en el chat. Además, sin ese usuario no hay chat
 * de Athletic que leer: número y chat van juntos o no va ninguno.
 */
export function athleticActivo(env: Entorno = process.env): boolean {
  return (
    env.ATHLETIC_WHATSAPP_ENABLED === 'true' &&
    !!env.ATHLETIC_PLATAFORMA_USER &&
    !!env.ATHLETIC_PLATAFORMA_PASS
  );
}

/** La marca por la que se le escribe al paciente: la suya, si su canal está encendido. */
export function marcaDeEnvio(codEmpresa: string | null | undefined, env: Entorno = process.env): Marca {
  const marca = marcaDeCodEmpresa(codEmpresa);
  return marca === 'athletic' && athleticActivo(env) ? 'athletic' : 'bodytech';
}

/**
 * Número de salida para el envío directo por Twilio.
 *
 * `undefined` para Bodytech a propósito: significa "el de siempre" y deja que
 * whatsapp.service use su TWILIO_WHATSAPP_FROM, así el camino de Bodytech queda
 * idéntico al de antes.
 */
export function whatsappFromDeMarca(marca: Marca, env: Entorno = process.env): string | undefined {
  if (marca !== 'athletic') return undefined;
  return env.ATHLETIC_WHATSAPP_FROM || ATHLETIC_WHATSAPP_FROM_DEFAULT;
}

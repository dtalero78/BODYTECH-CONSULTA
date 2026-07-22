/**
 * Factory del proveedor de video. Selecciona la implementación según
 * VIDEO_PROVIDER (default "twilio"). Solo instancia el proveedor elegido.
 *
 * FASE 1 (esto): interruptor GLOBAL. Con VIDEO_PROVIDER sin definir → twilio →
 * comportamiento idéntico al de hoy.
 *
 * FASE 3 (pendiente): canary por médico (CHIME_ALLOWLIST). Requiere resolver el
 * proveedor POR SALA en los endpoints que no son el token (endRoom, participantes),
 * porque la sala tuvo que crearse con el mismo proveedor con el que se cierra. Se
 * resolverá consultando `chime_meetings` (si la sala está ahí → chime; si no →
 * twilio), sin columna nueva. No mezclar hasta entonces: un canary a medias deja
 * al médico en un proveedor y al paciente en otro, sin error visible.
 */
import { IVideoProvider, VideoProviderName } from './types';
import { TwilioVideoProvider } from './twilio-video.provider';
import { ChimeVideoProvider } from './chime-video.provider';

function resolveProviderName(): VideoProviderName {
  const raw = (process.env.VIDEO_PROVIDER || 'twilio').toLowerCase();
  return raw === 'chime' ? 'chime' : 'twilio';
}

let instance: IVideoProvider | null = null;

export function getVideoProvider(): IVideoProvider {
  if (instance) return instance;
  const name = resolveProviderName();
  instance = name === 'chime' ? new ChimeVideoProvider() : new TwilioVideoProvider();
  console.log(`[VideoProvider] Proveedor de video activo: "${instance.name}"`);
  return instance;
}

export const videoProvider = getVideoProvider();
export * from './types';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room, LocalAudioTrack, RemoteAudioTrack, RemoteTrack } from 'twilio-video';
import apiService from '../services/api.service';

interface UseConsultationRecorderOptions {
  /** Id de la HistoriaClinica activa (destino de la transcripción). */
  historiaId?: string;
  /**
   * Cuando true, el grabador arranca automáticamente en cuanto hay una sala
   * conectada. Computado por el caller como `role==='doctor' && !!historiaId &&
   * isConnected`. Solo el médico graba.
   */
  active: boolean;
}

interface UseConsultationRecorderReturn {
  isRecording: boolean;
  isUploading: boolean;
  error: string | null;
  /**
   * Detiene la grabación, arma el blob y lo sube al backend. El caller debe
   * await esto ANTES de desconectar la sala (al desconectar, Twilio detiene los
   * tracks que alimentan el grabador). El backend procesa async (202), así que
   * el await dura básicamente la transferencia del audio.
   */
  stopAndUpload: () => Promise<void>;
}

/**
 * Graba el audio de la consulta en el navegador del médico: mezcla el
 * micrófono local + el audio remoto del paciente (Web Audio API) en un único
 * stream y lo captura con MediaRecorder. Es la entrada PRINCIPAL de
 * transcripción — el transcript queda listo a los segundos de finalizar la
 * llamada, sin esperar el render de la composición de Twilio (que se conserva
 * como fallback automático).
 *
 * Autostart: arranca apenas la sala está conectada (captura el mic local desde
 * el inicio) y va agregando el audio remoto a la mezcla a medida que los
 * participantes publican sus tracks (`trackSubscribed`).
 */
export function useConsultationRecorder(
  room: Room | null,
  { historiaId, active }: UseConsultationRecorderOptions
): UseConsultationRecorderReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const connectedTrackIds = useRef<Set<string>>(new Set());
  const trackSubscribedRef = useRef<((track: RemoteTrack) => void) | null>(null);
  const resumeHandlerRef = useRef<(() => void) | null>(null);
  const mimeRef = useRef<string>('audio/webm');
  const startedRef = useRef(false);

  /** Conecta un MediaStreamTrack de audio a la mezcla (idempotente por id). */
  const addAudioTrack = useCallback((mst: MediaStreamTrack | null | undefined) => {
    const ctx = audioCtxRef.current;
    const dest = destRef.current;
    if (!ctx || !dest || !mst || mst.kind !== 'audio') return;
    if (connectedTrackIds.current.has(mst.id)) return;
    try {
      const source = ctx.createMediaStreamSource(new MediaStream([mst]));
      source.connect(dest);
      connectedTrackIds.current.add(mst.id);
    } catch (e) {
      console.warn('[ConsultaRecorder] No se pudo conectar un track a la mezcla:', e);
    }
  }, []);

  const start = useCallback(async () => {
    if (startedRef.current || !room) return;
    startedRef.current = true;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      // El doctor ya interactuó (botón "Unirse"), así que resume() debería pasar.
      await ctx.resume().catch(() => undefined);
      // Red de seguridad: si el navegador dejó el contexto suspendido (política
      // de autoplay sin gesto directo), lo reanudamos en la próxima interacción
      // del médico (que ocurre a los segundos en el panel). Sin esto, el
      // destino produciría silencio y el blob saldría vacío.
      if (ctx.state === 'suspended') {
        const resumeOnGesture = () => {
          ctx.resume().catch(() => undefined);
          if (ctx.state === 'running') {
            window.removeEventListener('pointerdown', resumeOnGesture);
            window.removeEventListener('keydown', resumeOnGesture);
            resumeHandlerRef.current = null;
          }
        };
        resumeHandlerRef.current = resumeOnGesture;
        window.addEventListener('pointerdown', resumeOnGesture);
        window.addEventListener('keydown', resumeOnGesture);
      }
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      destRef.current = dest;
      connectedTrackIds.current = new Set();

      // Mic local (desde el inicio).
      room.localParticipant.audioTracks.forEach((pub) => {
        addAudioTrack((pub.track as LocalAudioTrack | null)?.mediaStreamTrack);
      });
      // Audio remoto ya presente.
      room.participants.forEach((p) => {
        p.audioTracks.forEach((pub) => {
          addAudioTrack((pub.track as RemoteAudioTrack | null)?.mediaStreamTrack);
        });
      });

      // Audio remoto que llegue después (paciente que se conecta o reconecta).
      const onTrackSubscribed = (track: RemoteTrack) => {
        if (track.kind === 'audio') {
          addAudioTrack((track as RemoteAudioTrack).mediaStreamTrack);
        }
      };
      trackSubscribedRef.current = onTrackSubscribed;
      room.on('trackSubscribed', onTrackSubscribed);

      const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const supported = candidates.find(
        (c) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)
      );
      mimeRef.current = supported || 'audio/webm';

      const recorder = new MediaRecorder(
        dest.stream,
        supported ? { mimeType: supported } : undefined
      );
      chunksRef.current = [];
      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.start(2000); // junta datos cada 2s (robusto ante grabaciones largas)
      recorderRef.current = recorder;
      setIsRecording(true);
      console.log('[ConsultaRecorder] Grabación iniciada');
    } catch (e) {
      console.error('[ConsultaRecorder] Error iniciando grabación:', e);
      startedRef.current = false;
    }
  }, [room, addAudioTrack]);

  /** Libera AudioContext y listeners (no toca el recorder ni los chunks). */
  const teardownAudio = useCallback(() => {
    if (resumeHandlerRef.current) {
      window.removeEventListener('pointerdown', resumeHandlerRef.current);
      window.removeEventListener('keydown', resumeHandlerRef.current);
      resumeHandlerRef.current = null;
    }
    if (room && trackSubscribedRef.current) {
      // Los typings de Room heredan un EventEmitter sin removeListener/off,
      // pero existe en runtime (Twilio usa un EventEmitter real).
      (
        room as unknown as {
          removeListener(event: string, listener: (...args: unknown[]) => void): void;
        }
      ).removeListener('trackSubscribed', trackSubscribedRef.current as (...args: unknown[]) => void);
    }
    trackSubscribedRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    destRef.current = null;
    connectedTrackIds.current.clear();
  }, [room]);

  const stopAndUpload = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) {
      teardownAudio();
      return;
    }

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeRef.current }));
      try {
        recorder.stop();
      } catch {
        resolve(new Blob(chunksRef.current, { type: mimeRef.current }));
      }
    });

    setIsRecording(false);
    teardownAudio();

    if (!historiaId || blob.size === 0) {
      // Sin audio útil → el fallback por composición de Twilio cubre el caso.
      return;
    }

    try {
      setIsUploading(true);
      setError(null);
      await apiService.transcribeConsulta(historiaId, blob);
      console.log(`[ConsultaRecorder] Audio subido (${(blob.size / 1024 / 1024).toFixed(2)} MB)`);
    } catch (e) {
      console.error('[ConsultaRecorder] Error subiendo la grabación:', e);
      setError('No se pudo subir la grabación de la consulta.');
    } finally {
      setIsUploading(false);
    }
  }, [historiaId, teardownAudio]);

  // Autostart cuando hay sala conectada y el caller lo habilita.
  useEffect(() => {
    if (active && room && !startedRef.current) {
      void start();
    }
  }, [active, room, start]);

  // Cleanup al desmontar: detener el recorder (best-effort). La subida fiable
  // ocurre vía stopAndUpload() en el flujo de "finalizar"; aquí solo evitamos
  // dejar el grabador y el AudioContext colgando.
  useEffect(() => {
    return () => {
      const rec = recorderRef.current;
      if (rec && rec.state !== 'inactive') {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      teardownAudio();
    };
  }, [teardownAudio]);

  return { isRecording, isUploading, error, stopAndUpload };
}

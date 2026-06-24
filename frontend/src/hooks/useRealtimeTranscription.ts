import { useCallback, useEffect, useRef, useState } from 'react';
import type { Room, RemoteAudioTrack, RemoteTrack } from 'twilio-video';
import apiService from '../services/api.service';

/**
 * Transcripción EN VIVO del audio del PACIENTE (pista remota de Twilio) vía
 * OpenAI Realtime. El navegador del médico:
 *   1. pide un token efímero al backend (no se expone la API key),
 *   2. abre un WebSocket directo a OpenAI (intent=transcription),
 *   3. transmite la pista de audio remota como PCM16 24 kHz,
 *   4. recibe deltas (preview) y transcripciones finales por turno (server_vad).
 *
 * Expone la misma forma que useLiveDictation para integrarse igual en la guía:
 * { supported, listening, interim, start, stop, setOnFinal }.
 *
 * Captura SOLO al paciente (audio remoto). La voz del coach (mic local) no entra
 * — eso es justamente lo que se necesitaba.
 */
function floatToPCM16Base64(float32: Float32Array): string {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s, true);
  }
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

export function useRealtimeTranscription(room: Room | null, opts?: { lang?: string }) {
  const supported =
    typeof window !== 'undefined' &&
    'WebSocket' in window &&
    ('AudioContext' in window || 'webkitAudioContext' in window);
  void opts; // el idioma/modelo se configuran en el token efímero (backend)

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');

  const onFinalRef = useRef<((text: string) => void) | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const connectedTrackId = useRef<string | null>(null);
  const trackSubRef = useRef<((t: RemoteTrack) => void) | null>(null);
  const shouldRunRef = useRef(false);

  const setOnFinal = useCallback((fn: ((text: string) => void) | null) => {
    onFinalRef.current = fn;
  }, []);

  /** Conecta la pista de audio remota al grafo que la empuja al WebSocket. */
  const attachTrack = useCallback((mst?: MediaStreamTrack | null) => {
    const ctx = ctxRef.current;
    if (!ctx || !mst || mst.kind !== 'audio') return;
    if (connectedTrackId.current === mst.id) return;
    try {
      srcRef.current?.disconnect();
      procRef.current?.disconnect();
    } catch {
      /* noop */
    }
    const src = ctx.createMediaStreamSource(new MediaStream([mst]));
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0; // no reproducir (evita eco); Twilio ya reproduce el audio
    proc.onaudioprocess = (e: AudioProcessingEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToPCM16Base64(input) }));
    };
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    srcRef.current = src;
    procRef.current = proc;
    muteRef.current = mute;
    connectedTrackId.current = mst.id;
  }, []);

  const wireRemoteAudio = useCallback(() => {
    if (!room) return;
    room.participants.forEach((p) =>
      p.audioTracks.forEach((pub) =>
        attachTrack((pub.track as RemoteAudioTrack | null)?.mediaStreamTrack)
      )
    );
    const onSub = (track: RemoteTrack) => {
      if (track.kind === 'audio') attachTrack((track as RemoteAudioTrack).mediaStreamTrack);
    };
    trackSubRef.current = onSub;
    room.on('trackSubscribed', onSub);
  }, [room, attachTrack]);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    if (room && trackSubRef.current) {
      (
        room as unknown as {
          removeListener(event: string, listener: (...args: unknown[]) => void): void;
        }
      ).removeListener('trackSubscribed', trackSubRef.current as (...args: unknown[]) => void);
    }
    trackSubRef.current = null;
    connectedTrackId.current = null;
    try {
      procRef.current?.disconnect();
      srcRef.current?.disconnect();
      muteRef.current?.disconnect();
    } catch {
      /* noop */
    }
    procRef.current = null;
    srcRef.current = null;
    muteRef.current = null;
    try {
      ctxRef.current?.close();
    } catch {
      /* noop */
    }
    ctxRef.current = null;
    try {
      wsRef.current?.close();
    } catch {
      /* noop */
    }
    wsRef.current = null;
    setInterim('');
    setListening(false);
  }, [room]);

  const start = useCallback(async () => {
    if (!supported || shouldRunRef.current) return;
    shouldRunRef.current = true;
    try {
      const { token } = await apiService.getRealtimeToken();
      if (!token || !shouldRunRef.current) {
        shouldRunRef.current = false;
        return;
      }
      // API GA: token efímero por subprotocolo, SIN 'openai-beta.realtime-v1'
      // (la API beta fue retirada). La sesión ya viene configurada por el token.
      const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
        'realtime',
        `openai-insecure-api-key.${token}`,
      ]);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!shouldRunRef.current) {
          try {
            ws.close();
          } catch {
            /* noop */
          }
          return;
        }
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx({ sampleRate: 24000 });
        ctxRef.current = ctx;
        ctx.resume().catch(() => undefined);
        wireRemoteAudio();
        setListening(true);
        console.log('[Realtime] sesión de transcripción en vivo iniciada');
      };

      ws.onmessage = (ev: MessageEvent) => {
        let m: any;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        const t: string = m?.type || '';
        if (t.endsWith('input_audio_transcription.delta')) {
          if (typeof m.delta === 'string') setInterim((prev) => (prev + m.delta).slice(-400));
        } else if (t.endsWith('input_audio_transcription.completed')) {
          const txt = (m.transcript || '').trim();
          setInterim('');
          if (txt && onFinalRef.current) onFinalRef.current(txt);
        } else if (t === 'error') {
          console.warn('[Realtime] error de sesión:', m?.error || m);
        }
      };

      ws.onerror = (e) => {
        console.warn('[Realtime] WebSocket error', e);
      };
      ws.onclose = () => {
        setListening(false);
      };
    } catch (e) {
      console.error('[Realtime] no se pudo iniciar:', e);
      shouldRunRef.current = false;
      setListening(false);
    }
  }, [supported, wireRemoteAudio]);

  // Cleanup al desmontar.
  useEffect(() => () => stop(), [stop]);

  return { supported, listening, interim, start, stop, setOnFinal };
}

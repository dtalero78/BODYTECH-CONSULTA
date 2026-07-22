import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoEngine } from '../video/video-engine';
import apiService from '../services/api.service';

/**
 * Transcripción EN VIVO de TODA la consulta (coach + paciente) vía OpenAI
 * Realtime GA. Mezcla el micrófono local + el audio remoto y los transmite como
 * PCM16 24 kHz por WebSocket directo a OpenAI (token efímero del backend, sin
 * exponer la API key). Acumula el transcript completo; NO lo escribe en campos
 * — al finalizar, la IA procesa todo el texto y diligencia la historia.
 *
 * Eventos GA: conversation.item.input_audio_transcription.delta (.delta) y
 * .completed (.transcript). Sólo Chrome/Edge de escritorio.
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

export function useRealtimeTranscription(room: VideoEngine | null) {
  const supported =
    typeof window !== 'undefined' &&
    'WebSocket' in window &&
    ('AudioContext' in window || 'webkitAudioContext' in window);

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [transcript, setTranscript] = useState('');

  const transcriptRef = useRef('');
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const muteRef = useRef<GainNode | null>(null);
  const sourcesRef = useRef<MediaStreamAudioSourceNode[]>([]);
  const connectedTrackIds = useRef<Set<string>>(new Set());
  // El motor es provider-agnostic: en vez de escuchar 'trackSubscribed' (Twilio),
  // poleamos los tracks de audio y los agregamos idempotentemente (ver recorder).
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldRunRef = useRef(false);

  const getTranscript = useCallback(() => transcriptRef.current.trim(), []);
  const reset = useCallback(() => {
    transcriptRef.current = '';
    setTranscript('');
    setInterim('');
  }, []);

  /** Conecta un track de audio (mic local o remoto) al mismo ScriptProcessor (se suman). */
  const attachTrack = useCallback((mst?: MediaStreamTrack | null) => {
    const ctx = ctxRef.current;
    const proc = procRef.current;
    if (!ctx || !proc || !mst || mst.kind !== 'audio') return;
    if (connectedTrackIds.current.has(mst.id)) return;
    try {
      const src = ctx.createMediaStreamSource(new MediaStream([mst]));
      src.connect(proc);
      sourcesRef.current.push(src);
      connectedTrackIds.current.add(mst.id);
    } catch (e) {
      console.warn('[Realtime] no se pudo conectar un track:', e);
    }
  }, []);

  const wireAudio = useCallback(() => {
    if (!room) return;
    // Agrega el audio disponible ahora (mic local + remotos) y deja un poll que
    // capta lo que llegue después. attachTrack es idempotente por id.
    const attachCurrent = () => {
      room.getLocalAudioTracks().forEach((t) => attachTrack(t));
      room.getRemoteAudioTracks().forEach((t) => attachTrack(t));
    };
    attachCurrent();
    pollRef.current = setInterval(attachCurrent, 2000);
  }, [room, attachTrack]);

  const stop = useCallback(() => {
    shouldRunRef.current = false;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    connectedTrackIds.current.clear();
    try {
      sourcesRef.current.forEach((s) => s.disconnect());
      procRef.current?.disconnect();
      muteRef.current?.disconnect();
    } catch {
      /* noop */
    }
    sourcesRef.current = [];
    procRef.current = null;
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
      // API GA: token efímero por subprotocolo, SIN 'openai-beta.realtime-v1'.
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
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        const mute = ctx.createGain();
        mute.gain.value = 0; // no reproducir (Twilio ya reproduce el audio)
        proc.onaudioprocess = (e: AudioProcessingEvent) => {
          const w = wsRef.current;
          if (!w || w.readyState !== WebSocket.OPEN) return;
          const input = e.inputBuffer.getChannelData(0);
          w.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: floatToPCM16Base64(input) }));
        };
        proc.connect(mute);
        mute.connect(ctx.destination);
        procRef.current = proc;
        muteRef.current = mute;
        wireAudio();
        setListening(true);
        console.log('[Realtime] transcripción en vivo iniciada (coach + paciente)');
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
          if (typeof m.delta === 'string') setInterim((prev) => (prev + m.delta).slice(-300));
        } else if (t.endsWith('input_audio_transcription.completed')) {
          const txt = (m.transcript || '').trim();
          setInterim('');
          if (txt) {
            transcriptRef.current = (transcriptRef.current + ' ' + txt).trim();
            setTranscript(transcriptRef.current);
          }
        } else if (t === 'error') {
          console.warn('[Realtime] error de sesión:', m?.error || m);
        }
      };

      ws.onerror = (e) => console.warn('[Realtime] WebSocket error', e);
      ws.onclose = () => setListening(false);
    } catch (e) {
      console.error('[Realtime] no se pudo iniciar:', e);
      shouldRunRef.current = false;
      setListening(false);
    }
  }, [supported, wireAudio]);

  useEffect(() => () => stop(), [stop]);

  return { supported, listening, interim, transcript, getTranscript, reset, start, stop };
}

/**
 * BOT_VOZ — usePatientBot
 *
 * Hook para el bot de voz del paciente (testing).
 * Captura el audio remoto del médico desde Twilio, lo pasa a OpenAI Realtime,
 * genera una respuesta de paciente y la publica de vuelta al room de Twilio.
 * Al terminar cada turno emite bot-turn-done via Socket.io para que el bot
 * médico sepa que puede hablar.
 *
 * Para rollback:
 *   - Eliminar este archivo
 *   - Eliminar el botón Bot Paciente en PatientPage.tsx (marcado con BOT_VOZ)
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { LocalAudioTrack, LocalParticipant, RemoteAudioTrack, RemoteParticipant } from 'twilio-video';
import { io, Socket } from 'socket.io-client';
import apiService from '../services/api.service';
import type { BotTranscriptEntry } from './useDoctorBot';

interface UsePatientBotOptions {
  roomName: string;
  localParticipant: LocalParticipant | null;
  remoteParticipants: Map<string, RemoteParticipant>;
}

interface UsePatientBotReturn {
  isActive: boolean;
  isConnecting: boolean;
  transcript: BotTranscriptEntry[];
  error: string | null;
  activateBot: () => Promise<void>;
  deactivateBot: () => void;
}

const PATIENT_SYSTEM_PROMPT = `Eres Carlos Mejía, afiliado nuevo de Bodytech, 38 años, viviendo en Bogotá.

Tu perfil:
- Quieres bajar de peso (tienes unos kilos de más, te da un poco de pena mencionarlo)
- Tienes dolor lumbar crónico leve, llevas 2 años con eso, empeora cuando estás mucho tiempo sentado en la oficina
- Tomas ibuprofeno ocasionalmente para el dolor de espalda, nada más
- Eres alérgico al polvo (rinitis alérgica), no a ningún medicamento
- Tuviste una cirugía de menisco en la rodilla derecha hace 4 años, te recuperaste bien
- Tu mamá tiene hipertensión, tu papá tuvo diabetes tipo 2
- Actualmente eres sedentario, caminas poco, trabajas en una oficina 9 horas al día
- Pesas aproximadamente 85 kg y mides 1.75 m
- No recuerdas tu presión arterial, hace mucho no te la toman

Instrucciones de conducta:
- Habla como una persona normal colombiana en una consulta médica, tono informal
- Eres PARLANCHIN: das más información de la que te preguntan, cuentas anécdotas, divagás
- Tienes un poco de nervios porque no vas al médico seguido
- Haces preguntas ocasionales al médico ("¿eso es importante?", "¿tengo que preocuparme por eso?")
- Cuando mencionas el peso, eres un poco evasivo al principio
- Habla en español colombiano informal
- Responde SOLO a lo que te pregunta el médico en este turno, pero sé generoso con los detalles`;

export function usePatientBot({
  roomName,
  localParticipant,
  remoteParticipants,
}: UsePatientBotOptions): UsePatientBotReturn {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState<BotTranscriptEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const botTrackRef = useRef<LocalAudioTrack | null>(null);
  const realMicTrackRef = useRef<LocalAudioTrack | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const scheduledTimeRef = useRef<number>(0);
  const currentTranscriptRef = useRef<string>('');
  const deactivateRef = useRef<() => void>(() => {});

  const decodeAndScheduleAudio = useCallback((base64: string) => {
    const ctx = audioCtxRef.current;
    const dest = destNodeRef.current;
    if (!ctx || !dest) return;

    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const pcm16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(pcm16.length);
    for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(dest);

    const now = ctx.currentTime;
    const startAt = Math.max(now, scheduledTimeRef.current);
    source.start(startAt);
    scheduledTimeRef.current = startAt + buffer.duration;
  }, []);

  const deactivateBot = useCallback(() => {
    processorRef.current?.disconnect();
    processorRef.current = null;

    wsRef.current?.close();
    wsRef.current = null;

    if (botTrackRef.current && localParticipant) {
      try {
        localParticipant.unpublishTrack(botTrackRef.current);
        botTrackRef.current.stop();
      } catch (_) {}
      botTrackRef.current = null;
    }

    realMicTrackRef.current?.enable();
    realMicTrackRef.current = null;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    destNodeRef.current = null;
    scheduledTimeRef.current = 0;

    socketRef.current?.disconnect();
    socketRef.current = null;

    setIsActive(false);
  }, [localParticipant]);

  useEffect(() => {
    deactivateRef.current = deactivateBot;
  }, [deactivateBot]);

  const findDoctorAudioTrack = useCallback((): RemoteAudioTrack | null => {
    for (const participant of remoteParticipants.values()) {
      for (const pub of participant.audioTracks.values()) {
        if (pub.track) return pub.track as RemoteAudioTrack;
      }
    }
    return null;
  }, [remoteParticipants]);

  const activateBot = useCallback(async () => {
    if (!localParticipant || isActive || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    setTranscript([]);
    currentTranscriptRef.current = '';

    try {
      // 1. Ephemeral key
      const sessionData = await apiService.createBotSession('nova');
      const ephemeralKey: string = sessionData.client_secret.value;

      // 2. AudioContext único a 24kHz para entrada y salida
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      destNodeRef.current = dest;
      scheduledTimeRef.current = ctx.currentTime;

      // 3. Publicar track sintético (salida del bot) en Twilio
      const { LocalAudioTrack: TwilioLocalAudioTrack } = await import('twilio-video');
      const syntheticMST = dest.stream.getAudioTracks()[0];
      const botTrack = new TwilioLocalAudioTrack(syntheticMST, { name: 'bot-patient-audio' });
      botTrackRef.current = botTrack;
      await localParticipant.publishTrack(botTrack);

      // 4. Silenciar micrófono real
      localParticipant.audioTracks.forEach((pub) => {
        const t = pub.track as LocalAudioTrack | null;
        if (t && t !== botTrack && t.isEnabled) {
          realMicTrackRef.current = t;
          t.disable();
        }
      });

      // 5. Socket.io
      const apiBase = (import.meta as any).env.VITE_API_BASE_URL || '';
      const socket = io(`${apiBase}/telemedicine`, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.emit('join-bot-room', { roomName });

      // 6. WebSocket a OpenAI Realtime con VAD habilitado para detectar silencios del médico
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`,
        ['realtime', `openai-insecure-api-key.${ephemeralKey}`, 'openai-beta.realtime-v1']
      );
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['audio', 'text'],
            instructions: PATIENT_SYSTEM_PROMPT,
            voice: 'nova',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 700,
            },
          },
        }));
        setIsActive(true);
        setIsConnecting(false);
        console.log('[BotPaciente] Sesión OpenAI Realtime iniciada');

        // 7. Capturar audio remoto del médico y enviarlo a OpenAI
        const startCapture = () => {
          const doctorTrack = findDoctorAudioTrack();
          if (!doctorTrack) {
            console.warn('[BotPaciente] No hay track de audio del médico todavía, reintentando…');
            setTimeout(startCapture, 1000);
            return;
          }

          const stream = new MediaStream([doctorTrack.mediaStreamTrack]);
          const source = ctx.createMediaStreamSource(stream);

          // ScriptProcessorNode: deprecated pero soportado en Safari iOS
          const bufferSize = 4096;
          const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
          processorRef.current = processor;

          processor.onaudioprocess = (e) => {
            const currentWs = wsRef.current;
            if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return;

            const float32 = e.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(float32.length);
            for (let i = 0; i < float32.length; i++) {
              pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
            }

            const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)));
            currentWs.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: base64,
            }));
          };

          source.connect(processor);
          // Conectar a destination para evitar que el browser silencie el nodo
          processor.connect(ctx.destination);
          console.log('[BotPaciente] Captura de audio del médico iniciada');
        };

        startCapture();
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'response.audio.delta' && msg.delta) {
          decodeAndScheduleAudio(msg.delta);
        }

        if (msg.type === 'response.audio_transcript.delta') {
          currentTranscriptRef.current += msg.delta ?? '';
        }

        if (msg.type === 'response.audio_transcript.done') {
          const text = msg.transcript ?? currentTranscriptRef.current;
          currentTranscriptRef.current = '';
          setTranscript((prev) => [...prev, { role: 'patient', text }]);
          console.log('[BotPaciente] Paciente dijo:', text);
        }

        if (msg.type === 'response.done') {
          // Notificar al bot médico que el turno del paciente terminó
          const socket = socketRef.current;
          if (socket?.connected) {
            const finalText = currentTranscriptRef.current || '';
            socket.emit('bot-turn-done', { roomName, transcript: finalText });
            currentTranscriptRef.current = '';
          }
        }

        if (msg.type === 'error') {
          console.error('[BotPaciente] OpenAI error:', msg.error);
          setError(msg.error?.message || 'Error en OpenAI Realtime');
        }
      };

      ws.onerror = () => {
        setError('Error de conexión con OpenAI Realtime');
        setIsConnecting(false);
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error activando bot paciente';
      console.error('[BotPaciente] activateBot error:', err);
      setError(msg);
      setIsConnecting(false);
      deactivateRef.current();
    }
  }, [localParticipant, roomName, isActive, isConnecting, findDoctorAudioTrack, decodeAndScheduleAudio]);

  useEffect(() => {
    return () => { deactivateRef.current(); };
  }, []);

  return { isActive, isConnecting, transcript, error, activateBot, deactivateBot };
}

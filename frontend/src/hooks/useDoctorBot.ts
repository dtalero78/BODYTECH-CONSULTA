/**
 * BOT_VOZ — useDoctorBot
 *
 * Hook para el bot de voz del médico (testing).
 * Conecta con OpenAI Realtime API vía WebSocket (ephemeral key del backend),
 * publica audio sintético al room de Twilio, y orquesta los turnos via Socket.io.
 *
 * Para rollback:
 *   - Eliminar este archivo
 *   - Eliminar el botón Bot Médico en VideoRoom.tsx (marcado con BOT_VOZ)
 *   - Eliminar ruta POST /api/video/bot/session-token en video.routes.ts
 *   - Eliminar método createBotSession en video.controller.ts
 *   - Eliminar eventos join-bot-room y bot-turn-done en telemedicine-socket.service.ts
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { LocalAudioTrack, LocalParticipant } from 'twilio-video';
import { io, Socket } from 'socket.io-client';
import apiService from '../services/api.service';

export interface BotTranscriptEntry {
  role: 'doctor' | 'patient';
  text: string;
}

interface UseDoctorBotOptions {
  roomName: string;
  localParticipant: LocalParticipant | null;
  historiaData?: Record<string, unknown>;
}

export function useDoctorBot({ roomName, localParticipant, historiaData }: UseDoctorBotOptions) {
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
  const scheduledTimeRef = useRef<number>(0);
  const deactivateRef = useRef<() => void>(() => {});

  const buildSystemPrompt = useCallback(() => {
    const historiaCtx = historiaData
      ? `\n\nContexto de la historia clínica actual:\n${JSON.stringify(historiaData, null, 2)}`
      : '';

    return `Eres un profesional de salud deportiva de Bodytech, la cadena de gimnasios más grande de Colombia. Estás realizando una valoración médica inicial a un afiliado nuevo.

Tu objetivo es cubrir los siguientes temas de forma conversacional y natural:
- Motivo de consulta (objetivo en el gimnasio)
- Antecedentes patológicos (enfermedades previas o actuales)
- Antecedentes quirúrgicos y traumas
- Antecedentes osteomuscular / lesiones deportivas
- Antecedentes farmacológicos (medicamentos actuales)
- Alergias
- Antecedentes familiares relevantes
- Actividad física actual (frecuencia, duración, tipo de ejercicio)
- Peso y talla aproximados

Instrucciones de conducta:
- Habla en español colombiano, tono profesional pero cálido y cercano
- Conduce una conversación NATURAL, no una lista de preguntas
- Haz preguntas de seguimiento según lo que el paciente responda
- Muestra empatía y curiosidad genuina
- Cuando hayas cubierto todos los temas, concluye con una frase natural como "Perfecto, con eso tengo todo lo que necesito para tu valoración inicial. ¡Bienvenido a Bodytech!"
- Empieza saludando brevemente y preguntando el motivo de consulta${historiaCtx}`;
  }, [historiaData]);

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

  // Mantener referencia estable de deactivateBot para closures de WS
  useEffect(() => {
    deactivateRef.current = deactivateBot;
  }, [deactivateBot]);

  const activateBot = useCallback(async () => {
    if (!localParticipant || isActive || isConnecting) return;
    setIsConnecting(true);
    setError(null);
    setTranscript([]);

    try {
      // 1. Ephemeral key desde el backend
      const sessionData = await apiService.createBotSession('shimmer');
      const ephemeralKey: string = sessionData.client_secret.value;

      // 2. AudioContext a 24kHz (formato nativo de OpenAI Realtime)
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await ctx.resume();
      const dest = ctx.createMediaStreamDestination();
      audioCtxRef.current = ctx;
      destNodeRef.current = dest;
      scheduledTimeRef.current = ctx.currentTime;

      // 3. Crear LocalAudioTrack sintético y publicarlo en Twilio
      const { LocalAudioTrack: TwilioLocalAudioTrack } = await import('twilio-video');
      const syntheticMST = dest.stream.getAudioTracks()[0];
      const botTrack = new TwilioLocalAudioTrack(syntheticMST, { name: 'bot-doctor-audio' });
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

      // 5. Socket.io — unirse a la sala del bot
      const apiBase = (import.meta as any).env.VITE_API_BASE_URL || '';
      const socket = io(`${apiBase}/telemedicine`, { transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.emit('join-bot-room', { roomName });

      // 6. WebSocket a OpenAI Realtime
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
            instructions: buildSystemPrompt(),
            voice: 'shimmer',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            turn_detection: null,
          },
        }));
        // Arrancar primer turno del médico
        ws.send(JSON.stringify({ type: 'response.create' }));
        setIsActive(true);
        setIsConnecting(false);
        console.log('[BotMédico] Sesión OpenAI Realtime iniciada');
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);

        if (msg.type === 'response.audio.delta' && msg.delta) {
          decodeAndScheduleAudio(msg.delta);
        }

        if (msg.type === 'response.audio_transcript.done') {
          const text: string = msg.transcript ?? '';
          setTranscript((prev) => [...prev, { role: 'doctor', text }]);
          console.log('[BotMédico] Médico dijo:', text);

          // Detectar frase de cierre → desactivar el bot
          const lower = text.toLowerCase();
          if (lower.includes('bienvenido a bodytech') || lower.includes('eso es todo')) {
            setTimeout(() => deactivateRef.current(), 1500);
          }
        }

        if (msg.type === 'error') {
          console.error('[BotMédico] OpenAI error:', msg.error);
          setError(msg.error?.message || 'Error en OpenAI Realtime');
        }
      };

      ws.onerror = () => {
        setError('Error de conexión con OpenAI Realtime');
        setIsConnecting(false);
      };

      // 7. Escuchar bot-turn-done del paciente
      socket.on('bot-turn-done', (data: { transcript?: string }) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        if (data?.transcript) {
          ws.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{ type: 'input_text', text: data.transcript }],
            },
          }));
          setTranscript((prev) => [...prev, { role: 'patient', text: data.transcript! }]);
          console.log('[BotMédico] Paciente dijo:', data.transcript);
        }

        // Generar siguiente respuesta del médico
        ws.send(JSON.stringify({ type: 'response.create' }));
      });

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error activando bot médico';
      console.error('[BotMédico] activateBot error:', err);
      setError(msg);
      setIsConnecting(false);
      deactivateRef.current();
    }
  }, [localParticipant, roomName, isActive, isConnecting, buildSystemPrompt, decodeAndScheduleAudio]);

  // Cleanup al desmontar
  useEffect(() => {
    return () => { deactivateRef.current(); };
  }, []);

  return { isActive, isConnecting, transcript, error, activateBot, deactivateBot };
}

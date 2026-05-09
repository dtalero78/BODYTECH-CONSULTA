import { useState, useEffect, useCallback } from 'react';
import Video, {
  Room,
  LocalParticipant,
  RemoteParticipant,
  LocalVideoTrack,
  LocalAudioTrack,
} from 'twilio-video';
import apiService from '../services/api.service';

interface UseVideoRoomOptions {
  identity: string;
  roomName: string;
  role?: 'doctor' | 'patient';
  documento?: string;
  medicoCode?: string;
  /**
   * Phase 3 — id de la HistoriaClinica activa.
   * Cuando role==='doctor' y se pasa historiaId, useVideoRoom dispara un
   * fire-and-forget POST a /api/video/events/session-start para vincular el
   * roomName con la historia. Necesario para que el webhook de Twilio sepa
   * a qué historia llenar con la transcripción.
   */
  historiaId?: string;
}

interface UseVideoRoomReturn {
  room: Room | null;
  localParticipant: LocalParticipant | null;
  remoteParticipants: Map<string, RemoteParticipant>;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
  connectToRoom: () => Promise<void>;
  disconnectFromRoom: () => void;
  toggleAudio: () => void;
  toggleVideo: () => void;
  isAudioEnabled: boolean;
  isVideoEnabled: boolean;
  localVideoTrack: LocalVideoTrack | null;
}

// Helper function para reproducir sonido de notificación
const playNotificationSound = () => {
  try {
    // Crear un contexto de audio
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Configurar el sonido: tono de notificación agradable
    oscillator.frequency.value = 800; // Frecuencia en Hz
    oscillator.type = 'sine'; // Tipo de onda

    // Configurar volumen con fade
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

    // Reproducir
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.5);

    console.log('🔔 Notification sound played');
  } catch (error) {
    console.error('Error playing notification sound:', error);
  }
};

// Helper function para text-to-speech
const speakText = (text: string) => {
  try {
    if ('speechSynthesis' in window) {
      // Cancelar cualquier speech en progreso
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'es-ES'; // Español
      utterance.rate = 1.0; // Velocidad normal
      utterance.pitch = 1.0; // Tono normal
      utterance.volume = 1.0; // Volumen máximo

      // Primero reproducir el sonido de notificación
      playNotificationSound();

      // Luego hablar el texto
      setTimeout(() => {
        window.speechSynthesis.speak(utterance);
        console.log('🔊 Speaking:', text);
      }, 600); // Esperar a que termine el sonido
    } else {
      console.warn('speechSynthesis no está disponible en este navegador');
      // Si no hay speech synthesis, al menos reproducir el sonido
      playNotificationSound();
    }
  } catch (error) {
    console.error('Error in speakText:', error);
  }
};

export const useVideoRoom = ({
  identity,
  roomName,
  role,
  documento,
  medicoCode,
  historiaId,
}: UseVideoRoomOptions): UseVideoRoomReturn => {
  const [room, setRoom] = useState<Room | null>(null);
  const [localParticipant, setLocalParticipant] = useState<LocalParticipant | null>(null);
  const [remoteParticipants, setRemoteParticipants] = useState<Map<string, RemoteParticipant>>(
    new Map()
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [localVideoTrack, setLocalVideoTrack] = useState<LocalVideoTrack | null>(null);

  const connectToRoom = useCallback(async () => {
    try {
      setIsConnecting(true);
      setError(null);

      // Obtener token del backend
      const token = await apiService.getVideoToken(identity, roomName);

      // Conectar a la sala
      const connectedRoom = await Video.connect(token, {
        name: roomName,
        audio: true,
        video: { width: 640, height: 480 },
        networkQuality: {
          local: 1,
          remote: 1,
        },
      });

      setRoom(connectedRoom);
      setLocalParticipant(connectedRoom.localParticipant);
      setIsConnected(true);

      // Guardar referencia al video track local para efectos de fondo
      const videoTrack = Array.from(connectedRoom.localParticipant.videoTracks.values())[0]?.track as LocalVideoTrack;
      if (videoTrack) {
        setLocalVideoTrack(videoTrack);
      }

      // Registrar conexión para reportes (si se proporcionó rol)
      if (role) {
        try {
          await apiService.trackParticipantConnected(roomName, identity, role, documento, medicoCode);
        } catch (err) {
          console.error('Error tracking participant connection:', err);
        }

        // Phase 3 — vincular el room con la historia clínica activa cuando
        // el doctor entra. El webhook de Twilio usará este mapping al
        // terminar el recording. Fire-and-forget: si falla no rompemos la
        // llamada.
        if (role === 'doctor' && historiaId) {
          apiService
            .sessionStart(roomName, historiaId)
            .then(() => {
              console.log('[SessionStart] room linked to historia', { roomName, historiaId });
            })
            .catch((err) => {
              console.warn('[SessionStart] error vinculando room↔historia:', err);
            });
        }
      }

      // Agregar participantes remotos existentes
      connectedRoom.participants.forEach((participant) => {
        setRemoteParticipants((prev) => new Map(prev).set(participant.sid, participant));
      });

      // Escuchar eventos de participantes
      connectedRoom.on('participantConnected', (participant: RemoteParticipant) => {
        console.log(`Participant connected: ${participant.identity}`);
        setRemoteParticipants((prev) => new Map(prev).set(participant.sid, participant));

        // Anunciar con voz cuando un paciente se conecta (solo para doctores)
        if (role === 'doctor') {
          const participantName = participant.identity;
          speakText(`Paciente ${participantName} conectado`);
        }
      });

      connectedRoom.on('participantDisconnected', (participant: RemoteParticipant) => {
        console.log(`Participant disconnected: ${participant.identity}`);
        setRemoteParticipants((prev) => {
          const newMap = new Map(prev);
          newMap.delete(participant.sid);
          return newMap;
        });
      });

      // Escuchar desconexión
      connectedRoom.on('disconnected', () => {
        console.log('Disconnected from room');
        setIsConnected(false);
        setRoom(null);
        setLocalParticipant(null);
        setRemoteParticipants(new Map());
      });

      console.log(`Successfully connected to room: ${roomName}`);
    } catch (err) {
      console.error('Error connecting to room:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect to room');
    } finally {
      setIsConnecting(false);
    }
  }, [identity, roomName, role, documento, medicoCode, historiaId]);

  const disconnectFromRoom = useCallback(() => {
    if (room) {
      // Registrar desconexión para reportes (si se proporcionó rol)
      if (role) {
        try {
          apiService.trackParticipantDisconnected(roomName, identity);
        } catch (err) {
          console.error('Error tracking participant disconnection:', err);
        }
      }

      room.disconnect();
      setRoom(null);
      setLocalParticipant(null);
      setRemoteParticipants(new Map());
      setIsConnected(false);
    }
  }, [room, role, roomName, identity]);

  const toggleAudio = useCallback(() => {
    if (localParticipant) {
      localParticipant.audioTracks.forEach((publication) => {
        const track = publication.track as LocalAudioTrack;
        if (track.isEnabled) {
          track.disable();
          setIsAudioEnabled(false);
        } else {
          track.enable();
          setIsAudioEnabled(true);
        }
      });
    }
  }, [localParticipant]);

  const toggleVideo = useCallback(() => {
    if (localParticipant) {
      localParticipant.videoTracks.forEach((publication) => {
        const track = publication.track as LocalVideoTrack;
        if (track.isEnabled) {
          track.disable();
          setIsVideoEnabled(false);
        } else {
          track.enable();
          setIsVideoEnabled(true);
        }
      });
    }
  }, [localParticipant]);

  // Cleanup on unmount or window close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (room && role) {
        // Usar sendBeacon para asegurar que la solicitud se envíe incluso si la ventana se cierra
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '';
        const url = `${apiBaseUrl}/api/video/events/participant-disconnected`;
        const data = JSON.stringify({ roomName, identity });

        // sendBeacon es síncrono y garantiza que se envíe
        navigator.sendBeacon(url, new Blob([data], { type: 'application/json' }));

        room.disconnect();
      }
    };

    // Agregar listener para cierre de ventana
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (room) {
        // Registrar desconexión para reportes (si se proporcionó rol)
        if (role) {
          try {
            apiService.trackParticipantDisconnected(roomName, identity);
          } catch (err) {
            console.error('Error tracking participant disconnection:', err);
          }
        }
        room.disconnect();
      }
    };
  }, [room, role, roomName, identity]);

  return {
    room,
    localParticipant,
    remoteParticipants,
    isConnecting,
    isConnected,
    error,
    connectToRoom,
    disconnectFromRoom,
    toggleAudio,
    toggleVideo,
    isAudioEnabled,
    isVideoEnabled,
    localVideoTrack,
  };
};

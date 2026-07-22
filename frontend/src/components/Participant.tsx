import { useEffect, useRef, useState } from 'react';
import type { NormalizedParticipant, NormalizedVideoRef } from '../video/video-engine';

interface ParticipantProps {
  participant: NormalizedParticipant;
  isLocal?: boolean;
}

/**
 * Renderiza el video/audio de un participante, sin conocer el proveedor. El
 * motor (Twilio o Chime) expone `videoTrackRef`/`audioTrackRef` normalizados con
 * attach()/detach(); este componente solo los enlaza al DOM con el patrón de dos
 * efectos (uno para suscribir cambios, otro para enlazar cuando el elemento y el
 * ref existen).
 */
export const Participant = ({ participant, isLocal = false }: ParticipantProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [videoTrackRef, setVideoTrackRef] = useState<NormalizedVideoRef | null>(
    participant.videoTrackRef
  );
  const [audioTrackRef, setAudioTrackRef] = useState<NormalizedVideoRef | null>(
    participant.audioTrackRef
  );

  // Sincronizar los refs del participante y suscribirse a sus cambios. El motor
  // actualiza videoTrackRef/audioTrackRef en su sitio y emite onTracksChanged.
  useEffect(() => {
    const sync = () => {
      setVideoTrackRef(participant.videoTrackRef);
      setAudioTrackRef(participant.audioTrackRef);
    };
    sync();
    return participant.onTracksChanged(sync);
  }, [participant]);

  // Enlazar el video cuando existan a la vez el ref y el elemento.
  useEffect(() => {
    if (videoTrackRef && videoRef.current) {
      const el = videoRef.current;
      try {
        videoTrackRef.attach(el);
        // Autoplay en móvil: el <video> va muted, pero algunos navegadores igual
        // requieren un play() explícito tras enlazar.
        el.play?.().catch(() => undefined);
        console.log('Video track attached successfully for', participant.identity);
      } catch (error) {
        console.error('Error attaching video track:', error);
      }

      return () => {
        videoTrackRef.detach();
      };
    }
  }, [videoTrackRef, participant.identity]);

  // Enlazar el audio (solo remoto).
  useEffect(() => {
    if (audioTrackRef && audioRef.current && !isLocal) {
      const el = audioRef.current;
      try {
        audioTrackRef.attach(el);
        console.log('Audio track attached successfully for', participant.identity);
      } catch (error) {
        console.error('Error attaching audio track:', error);
      }

      return () => {
        audioTrackRef.detach();
      };
    }
  }, [audioTrackRef, isLocal, participant.identity]);

  return (
    <div className={`relative bg-gray-900 overflow-hidden ${isLocal ? 'h-full rounded-lg' : 'h-full w-full'}`}>
      {videoTrackRef ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-purple-600">
          <div className={`text-white font-bold ${isLocal ? 'text-4xl' : 'text-6xl sm:text-7xl md:text-8xl'}`}>
            {participant.identity.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {!isLocal && <audio ref={audioRef} autoPlay />}

      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-3 pb-2">
        <div className="flex items-center justify-between">
          <span className="text-white font-semibold text-sm sm:text-base drop-shadow-lg">
            {isLocal ? 'Tú' : participant.identity}
          </span>
          <div className="flex gap-2">
            {!audioTrackRef && (
              <span className="text-red-400 text-xs sm:text-sm drop-shadow-lg">
                🔇 Silenciado
              </span>
            )}
            {!videoTrackRef && (
              <span className="text-red-400 text-xs sm:text-sm drop-shadow-lg">
                📹 Sin video
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

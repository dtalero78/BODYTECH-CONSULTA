import { useState } from 'react';
import { useVideoRoom } from '../hooks/useVideoRoom';
import { useBackgroundEffects } from '../hooks/useBackgroundEffects';
import { useConsultationRecorder } from '../hooks/useConsultationRecorder';
import { usePosturalAnalysis } from '../hooks/usePosturalAnalysis';
import { Participant } from './Participant';
import { VideoControls } from './VideoControls';
import { PosturalAnalysisModal } from './PosturalAnalysisModal';
import { PosturalAnalysisPatient } from './PosturalAnalysisPatient';
import { MedicalConsultationPanel } from './panel/MedicalConsultationPanel';
import { MedicalHistoryPanel } from './MedicalHistoryPanel';
import apiService from '../services/api.service';

interface VideoRoomProps {
  identity: string;
  roomName: string;
  role?: 'doctor' | 'patient';
  historiaId?: string; // ID de la historia clínica
  documento?: string; // Documento del paciente (para notificaciones en tiempo real)
  medicoCode?: string; // Código del médico (para Socket.io Rooms)
  // Panel que se renderiza junto al video para el médico.
  // 'consulta' (default) → MedicalConsultationPanel de 7 tabs (comportamiento actual).
  // 'nutricional' → MedicalHistoryPanel nutricional (somatocarta, ISAK, Heath-Carter).
  panelVariant?: 'consulta' | 'nutricional';
  onLeave?: () => void;
}

export const VideoRoom = ({ identity, roomName, role, historiaId, documento, medicoCode, panelVariant = 'consulta', onLeave }: VideoRoomProps) => {
  const [isPosturalAnalysisOpen, setIsPosturalAnalysisOpen] = useState(false);
  const [isPanelMaxed, setIsPanelMaxed] = useState(false);

  const [cameraWarnDismissed, setCameraWarnDismissed] = useState(false);

  const [isFinishing, setIsFinishing] = useState(false);

  const {
    room,
    localParticipant,
    remoteParticipants,
    isConnecting,
    isConnected,
    error,
    cameraWarning,
    connectToRoom,
    disconnectFromRoom,
    toggleAudio,
    toggleVideo,
    isAudioEnabled,
    isVideoEnabled,
    localVideoTrack,
  } = useVideoRoom({ identity, roomName, role, documento, medicoCode, historiaId });

  // Grabación de audio de la consulta (entrada principal de transcripción).
  // Solo el médico con historia activa graba; arranca apenas la sala conecta.
  const { isRecording, stopAndUpload } = useConsultationRecorder(room, {
    historiaId,
    active: role === 'doctor' && !!historiaId && isConnected,
  });

  const {
    currentEffect,
    isProcessing,
    applyBlur,
    applyVirtualBackground,
    removeEffect,
  } = useBackgroundEffects();

  // Initialize postural analysis
  // El hook siempre está enabled para que Socket.io esté listo
  // Pero el componente del paciente solo se muestra cuando sessionActive es true Y el doctor ha iniciado
  const posturalAnalysis = usePosturalAnalysis({
    roomName,
    doctorIdentity: identity,
    role: role || 'patient',
    enabled: true, // Siempre enabled para mantener conexión Socket.io
  });

  const {
    isConnected: isPosturalAnalysisConnected,
    sessionActive,
    patientConnected,
    latestPoseData,
    hasReceivedFirstFrame,
    startSession,
    endSession,
    sendPoseData,
  } = posturalAnalysis;

  const handleLeave = async () => {
    // El médico graba el audio de la consulta en el navegador. Subimos ANTES de
    // desconectar (al desconectar Twilio detiene los tracks que alimentan el
    // grabador). El backend procesa async, así que esto dura básicamente la
    // transferencia. Si falla o el médico cierra la pestaña de golpe, el
    // fallback por composición de Twilio transcribe igual.
    if (role === 'doctor') {
      setIsFinishing(true);
      try {
        await stopAndUpload();
      } catch (err) {
        console.warn('[VideoRoom] stopAndUpload falló (fallback por composición cubrirá):', err);
      }
      setIsFinishing(false);
    }

    disconnectFromRoom();
    // El médico cierra el room explícitamente para disparar el webhook
    // inmediatamente (statusCallback → composición). El paciente solo se
    // desconecta; el room lo cierra el médico.
    if (role === 'doctor') {
      apiService.endRoom(roomName).catch(() => {});
      if (historiaId && documento) {
        apiService.downloadRips(historiaId, documento).catch(() => {});
      }
    }
    onLeave?.();
  };

  const handleApplyBlur = () => {
    if (localVideoTrack) {
      applyBlur(localVideoTrack);
    }
  };

  const handleApplyVirtualBackground = (imageUrl: string) => {
    if (localVideoTrack) {
      applyVirtualBackground(localVideoTrack, imageUrl);
    }
  };

  const handleRemoveEffect = () => {
    if (localVideoTrack) {
      removeEffect(localVideoTrack);
    }
  };

  const handleOpenPosturalAnalysis = () => {
    // Validar que Socket.io esté conectado antes de abrir el modal
    if (!isPosturalAnalysisConnected) {
      alert('⚠️ El sistema de análisis postural aún no está conectado. Por favor espere un momento e intente de nuevo.');
      console.warn('[VideoRoom] Cannot open postural analysis: Socket.io not connected');
      return;
    }
    setIsPosturalAnalysisOpen(true);
  };

  const handleClosePosturalAnalysis = () => {
    if (sessionActive) {
      endSession();
    }
    setIsPosturalAnalysisOpen(false);
  };

  if (error) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex items-center justify-center p-4">
        <div className="bg-[#1f2c34] rounded-3xl shadow-2xl p-8 sm:p-10 max-w-md w-full">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-2xl font-semibold text-white mb-3">Error de Conexión</h2>
            <p className="text-gray-400 mb-8">{error}</p>
            <button
              onClick={connectToRoom}
              className="w-full bg-[#00a884] text-white px-6 py-3 rounded-xl hover:bg-[#008f6f] transition font-semibold"
            >
              Reintentar
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex items-center justify-center p-4">
        <div className="bg-[#1f2c34] rounded-3xl shadow-2xl p-8 sm:p-10 max-w-md w-full">
          <div className="text-center">
            {/* Logo BSL */}
            <div className="flex justify-center mb-6">
              <img
                src="/bodyLogo.jpg"
                alt="BSL Logo"
                className="h-20 w-auto"
              />
            </div>

            <h2 className="text-2xl sm:text-3xl font-semibold text-white mb-6">Consulta Video</h2>

            {/* Info de la sala y usuario */}
            <div className="space-y-3 mb-8">
              <div className="bg-[#2a3942] rounded-xl px-4 py-3 text-left">
                <p className="text-xs text-gray-400 mb-1">Sala</p>
                <p className="text-white font-medium">{roomName}</p>
              </div>
              <div className="bg-[#2a3942] rounded-xl px-4 py-3 text-left">
                <p className="text-xs text-gray-400 mb-1">Usuario</p>
                <p className="text-white font-medium">{identity}</p>
              </div>
            </div>

            {/* Botón de unirse */}
            <button
              onClick={connectToRoom}
              disabled={isConnecting}
              className="w-full bg-[#00a884] text-white px-6 py-3.5 rounded-xl hover:bg-[#008f6f] transition disabled:bg-gray-600 disabled:cursor-not-allowed font-semibold shadow-lg"
            >
              {isConnecting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Conectando...
                </span>
              ) : (
                'Unirse a la Llamada'
              )}
            </button>

            {/* Footer con icono de seguridad */}
            <div className="mt-6 pt-6 border-t border-gray-700">
              <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Conexión segura end-to-end</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const remoteParticipantArray = Array.from(remoteParticipants.values());

  // Doctor con historiaId → layout 25/75 con panel de consulta médica.
  const showPanel = role === 'doctor' && !!historiaId;

  // Bloque de columna de video (reusable entre estados normal y maxed).
  const videoColumn = (
    <div className="relative w-full h-full bg-[#0b141a] flex flex-col overflow-hidden">
      {/* Banner de advertencia de cámara — no bloqueante */}
      {cameraWarning && !cameraWarnDismissed && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-30 w-[90%] max-w-md bg-amber-500/90 backdrop-blur text-white text-xs rounded-xl px-4 py-2 flex items-start gap-2 shadow-lg">
          <span className="text-base leading-none mt-0.5">⚠️</span>
          <span className="flex-1">{cameraWarning}</span>
          <button onClick={() => setCameraWarnDismissed(true)} className="ml-1 text-white/70 hover:text-white leading-none text-base">✕</button>
        </div>
      )}
      {/* Indicador de grabación de la consulta (solo médico) */}
      {role === 'doctor' && isRecording && !isFinishing && (
        <div className="absolute top-2 right-3 z-30 flex items-center gap-1.5 bg-black/55 backdrop-blur text-white text-[11px] font-medium rounded-full px-2.5 py-1 shadow-lg">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          Grabando consulta
        </div>
      )}

      {/* Overlay mientras se sube el audio al finalizar */}
      {isFinishing && (
        <div className="fixed inset-0 z-[100] bg-[#0b141a]/80 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-white">
            <svg className="animate-spin h-8 w-8" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <p className="text-sm font-medium">Guardando consulta…</p>
            <p className="text-xs text-gray-400">Procesando la transcripción</p>
          </div>
        </div>
      )}

      {/* Header tipo WhatsApp — solo para vista paciente o cuando no hay panel */}
      {!showPanel && (
        <div className="bg-[#1f2c34] px-4 py-3 flex items-center justify-between shadow-lg">
          <button
            onClick={handleLeave}
            className="text-white p-2 hover:bg-white/10 rounded-full transition"
            aria-label="Volver"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 flex items-center justify-center gap-2">
            <img src="/bodyLogo.jpg" alt="BSL" className="h-8 w-auto" />
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>End-to-end Encrypted</span>
            </div>
          </div>
          <button className="text-white p-2 hover:bg-white/10 rounded-full transition" aria-label="Información">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 relative overflow-hidden bg-[#0b141a]">
        {remoteParticipantArray.length > 0 ? (
          <div
            className={
              isPosturalAnalysisOpen
                ? 'fixed bottom-20 right-6 w-80 h-60 z-[55] rounded-xl overflow-hidden shadow-2xl border-2 border-green-500'
                : 'absolute inset-0 w-full h-full'
            }
          >
            <Participant participant={remoteParticipantArray[0]} />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0b141a]">
            <div className="text-center">
              <img src="/bodyLogo.jpg" alt="BSL" className="h-16 w-auto mx-auto mb-4 opacity-50" />
              <p className="text-gray-500">Esperando afiliado...</p>
            </div>
          </div>
        )}
        {localParticipant && (
          <div
            className={`absolute top-3 ${role === 'doctor' ? 'left-3' : 'right-3'} w-28 h-36 sm:w-32 sm:h-44 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/30 z-10`}
          >
            <Participant participant={localParticipant} isLocal={true} />
          </div>
        )}
        {remoteParticipantArray.length > 1 && (
          <div className="absolute bottom-24 left-0 right-0 px-4 z-10">
            <div className="flex gap-2 justify-center overflow-x-auto pb-2">
              {remoteParticipantArray.slice(1).map((participant) => (
                <div
                  key={participant.sid}
                  className="w-24 h-32 rounded-lg overflow-hidden flex-shrink-0 border-2 border-gray-700"
                >
                  <Participant participant={participant} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <VideoControls
        isAudioEnabled={isAudioEnabled}
        isVideoEnabled={isVideoEnabled}
        onToggleAudio={toggleAudio}
        onToggleVideo={toggleVideo}
        onLeave={handleLeave}
        showBackgroundControls={role === 'doctor' && !!localVideoTrack}
        onApplyBlur={handleApplyBlur}
        onApplyVirtualBackground={handleApplyVirtualBackground}
        onRemoveEffect={handleRemoveEffect}
        isProcessingBackground={isProcessing}
        currentBackgroundEffect={currentEffect}
        showPosturalAnalysis={role === 'doctor'}
        onOpenPosturalAnalysis={handleOpenPosturalAnalysis}
      />
    </div>
  );

  // Vista paciente o doctor sin historiaId → layout legacy (no panel)
  if (!showPanel) {
    return (
      <div className="min-h-screen bg-[#0b141a] flex">
        <div className="flex-1 flex flex-col">{videoColumn}</div>
        {role === 'doctor' && (
          <PosturalAnalysisModal
            isOpen={isPosturalAnalysisOpen}
            onClose={handleClosePosturalAnalysis}
            roomName={roomName}
            sessionActive={sessionActive}
            patientConnected={patientConnected}
            latestPoseData={latestPoseData}
            hasReceivedFirstFrame={hasReceivedFirstFrame}
            onStartSession={startSession}
            onEndSession={endSession}
            onAppendToObservaciones={null}
          />
        )}
        {role === 'patient' && sessionActive && (
          <PosturalAnalysisPatient onPoseData={sendPoseData} isActive={sessionActive} />
        )}
      </div>
    );
  }

  // Doctor con panel — layout 25/75 con toggle Maximize2
  return (
    <div className={`h-screen w-screen bg-[#0b141a] flex overflow-hidden ${isPanelMaxed ? 'panel-maxed' : ''}`}>
      {/* Columna de video (25% por default, 0 cuando maxed) */}
      <aside
        className="relative bg-[#070f12] border-r border-[#324049] transition-[flex-basis,width,opacity] duration-300 ease-out"
        style={{
          flex: isPanelMaxed ? '0 0 0' : '0 0 max(320px, 25vw)',
          width: isPanelMaxed ? '0' : undefined,
          visibility: isPanelMaxed ? 'hidden' : 'visible',
          pointerEvents: isPanelMaxed ? 'none' : 'auto',
        }}
      >
        {videoColumn}
      </aside>

      {/* Panel principal */}
      <main className="flex-1 min-w-0 relative">
        {panelVariant === 'nutricional' ? (
          <div className="h-full overflow-y-auto">
            <MedicalHistoryPanel historiaId={historiaId!} />
          </div>
        ) : (
          <MedicalConsultationPanel
            historiaId={historiaId!}
            isMaxed={isPanelMaxed}
            onToggleMaxed={() => setIsPanelMaxed((p) => !p)}
            autoGuide
          />
        )}
      </main>

      {/* Float thumbnail del video remoto cuando el panel está maximizado */}
      {isPanelMaxed && (
        <div
          className="fixed bottom-6 right-6 w-72 h-44 z-[55] rounded-2xl overflow-hidden border-2 border-[#00a884] shadow-2xl bg-[#070f12]"
        >
          {remoteParticipantArray.length > 0 ? (
            <Participant participant={remoteParticipantArray[0]} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
              Esperando afiliado...
            </div>
          )}
        </div>
      )}

      {/* Postural Analysis Modal */}
      <PosturalAnalysisModal
        isOpen={isPosturalAnalysisOpen}
        onClose={handleClosePosturalAnalysis}
        roomName={roomName}
        sessionActive={sessionActive}
        patientConnected={patientConnected}
        latestPoseData={latestPoseData}
        hasReceivedFirstFrame={hasReceivedFirstFrame}
        onStartSession={startSession}
        onEndSession={endSession}
        onAppendToObservaciones={null}
      />
    </div>
  );
};

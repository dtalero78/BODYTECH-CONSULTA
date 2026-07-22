import { Server as SocketIOServer } from 'socket.io';
import { videoProvider } from './video';

interface SessionParticipant {
  identity: string;
  role: 'doctor' | 'patient';
  connectedAt: Date;
  disconnectedAt?: Date;
}

interface VideoSession {
  roomName: string;
  participants: Map<string, SessionParticipant>;
  createdAt: Date;
  completedAt?: Date;
  patientDocumento?: string; // ID del documento del paciente
  medicoCode?: string; // Código del médico asignado
}

class SessionTrackerService {
  private sessions: Map<string, VideoSession> = new Map();
  private io: SocketIOServer | null = null;
  private changeListeners: Array<() => void> = [];

  /**
   * Inicializa el servicio con la instancia de Socket.io
   */
  initialize(io: SocketIOServer): void {
    this.io = io;
    console.log('[SessionTracker] Socket.io initialized');
  }

  /**
   * Registra un listener que se invoca cuando cambia el estado de sesiones
   * (alguien se conecta/desconecta). Lo usa el mapa de rutas para empujar
   * el conteo "ahora" solo cuando de verdad pasa algo (sin polling).
   */
  onChange(listener: () => void): void {
    this.changeListeners.push(listener);
  }

  private notifyChange(): void {
    for (const cb of this.changeListeners) {
      try {
        cb();
      } catch {
        /* aislado: un listener no debe romper el tracking ni la llamada */
      }
    }
  }

  /**
   * Sesiones con al menos un participante conectado en este momento.
   * Solo lectura, en memoria — no toca Twilio ni el socket de la llamada.
   */
  getActiveSessions(): Array<{
    roomName: string;
    medicoCode?: string;
    patientDocumento?: string;
    patientConnected: boolean;
    doctorConnected: boolean;
    patientName?: string; // identity del paciente conectado (= su nombre)
    doctorName?: string; // identity del médico/coach conectado
    startedAt?: string; // inicio de la consulta (ISO)
  }> {
    const out: Array<{
      roomName: string;
      medicoCode?: string;
      patientDocumento?: string;
      patientConnected: boolean;
      doctorConnected: boolean;
      patientName?: string;
      doctorName?: string;
      startedAt?: string;
    }> = [];
    for (const session of this.sessions.values()) {
      let patientConnected = false;
      let doctorConnected = false;
      let patientName: string | undefined;
      let doctorName: string | undefined;
      for (const p of session.participants.values()) {
        if (p.disconnectedAt) continue;
        if (p.role === 'patient') {
          patientConnected = true;
          patientName = p.identity;
        }
        if (p.role === 'doctor') {
          doctorConnected = true;
          doctorName = p.identity;
        }
      }
      if (patientConnected || doctorConnected) {
        out.push({
          roomName: session.roomName,
          medicoCode: session.medicoCode,
          patientDocumento: session.patientDocumento,
          patientConnected,
          doctorConnected,
          patientName,
          doctorName,
          startedAt: session.createdAt ? session.createdAt.toISOString() : undefined,
        });
      }
    }
    return out;
  }

  /**
   * Registra que un participante se conectó a la sala
   */
  trackParticipantConnected(roomName: string, identity: string, role: 'doctor' | 'patient', documento?: string, medicoCode?: string): void {
    console.log(`[SessionTracker] Participant connected: ${identity} (${role}) to room ${roomName}, medicoCode: ${medicoCode}`);

    if (!this.sessions.has(roomName)) {
      this.sessions.set(roomName, {
        roomName,
        participants: new Map(),
        createdAt: new Date(),
        patientDocumento: documento,
        medicoCode: medicoCode,
      });
    }

    const session = this.sessions.get(roomName)!;

    // Si es un paciente y tenemos el documento, guardarlo en la sesión
    if (role === 'patient' && documento) {
      session.patientDocumento = documento;
    }

    // Si tenemos medicoCode, guardarlo en la sesión
    if (medicoCode) {
      session.medicoCode = medicoCode;
    }

    session.participants.set(identity, {
      identity,
      role,
      connectedAt: new Date(),
    });

    console.log(`[SessionTracker] Current participants in ${roomName}: ${session.participants.size}`);

    // Grabación: arrancar la captura SOLO cuando ambos ya están conectados. Si el
    // Media Capture Pipeline se une mientras los clientes establecen su video,
    // satura la señalización y el video no renderiza. Fire-and-forget e
    // idempotente. No-op con Twilio (graba al conectar); trabajo real con Chime.
    if (session.participants.size >= 2) {
      videoProvider
        .startRecording(roomName)
        .catch((err: any) => console.error(`[SessionTracker] Error arrancando grabación: ${err.message}`));
    }

    // Emitir evento Socket.io cuando un paciente se conecta - SOLO a la Room del médico específico
    if (role === 'patient' && this.io && documento && session.medicoCode) {
      const roomToEmit = `doctor-${session.medicoCode}`;
      console.log(`[SessionTracker] Emitting patient-connected event to room: ${roomToEmit} for documento: ${documento}`);
      this.io.to(roomToEmit).emit('patient-connected', {
        documento,
        roomName,
        identity,
        connectedAt: new Date().toISOString(),
      });
    }
    this.notifyChange();
  }

  /**
   * Registra que un participante se desconectó de la sala
   */
  trackParticipantDisconnected(roomName: string, identity: string): void {
    console.log(`[SessionTracker] Participant disconnected: ${identity} from room ${roomName}`);

    const session = this.sessions.get(roomName);
    if (!session) {
      console.warn(`[SessionTracker] Session not found for room: ${roomName}`);
      return;
    }

    const participant = session.participants.get(identity);

    // Idempotencia: colgar + beforeunload + cleanup del componente disparan esto
    // 2-3 veces para el mismo participante. Sin el guard se re-emite el evento de
    // socket y (con Chime) se cerraría la sala dos veces.
    if (participant?.disconnectedAt) {
      console.log(`[SessionTracker] Desconexión duplicada de ${identity} en ${roomName}, ignorada`);
      return;
    }

    if (participant) {
      participant.disconnectedAt = new Date();

      // Emitir evento Socket.io cuando un paciente se desconecta - SOLO a la Room del médico específico
      if (participant.role === 'patient' && this.io && session.patientDocumento && session.medicoCode) {
        const roomToEmit = `doctor-${session.medicoCode}`;
        console.log(`[SessionTracker] Emitting patient-disconnected event to room: ${roomToEmit} for documento: ${session.patientDocumento}`);
        this.io.to(roomToEmit).emit('patient-disconnected', {
          documento: session.patientDocumento,
          roomName,
          identity,
          disconnectedAt: new Date().toISOString(),
        });
      }

      // Ciclo de vida de la sala: si el MÉDICO se desconecta y NO queda nadie más
      // conectado, cerrar la sala SIN finalizarla (`completed: false`) → deja el
      // link reutilizable y, con Chime, detiene la grabación. Si el paciente sigue
      // dentro, NO se toca (borrarla lo expulsaría). No-op con Twilio.
      if (participant.role === 'doctor') {
        const quedaAlguien = Array.from(session.participants.values()).some(
          (p) => p.identity !== identity && !p.disconnectedAt
        );
        if (!quedaAlguien) {
          videoProvider
            .endRoom(roomName, { completed: false })
            .catch((err: any) => console.error(`[SessionTracker] Error cerrando sala ${roomName}: ${err.message}`));
        }
      }
    }

    // Verificar si todos los participantes se desconectaron
    const allDisconnected = Array.from(session.participants.values()).every(
      (p) => p.disconnectedAt !== undefined
    );

    if (allDisconnected && session.participants.size >= 2) {
      console.log(`[SessionTracker] All participants disconnected from ${roomName}. Finalizing session.`);
      session.completedAt = new Date();
      this.finalizeSession(session);
    }
    this.notifyChange();
  }

  /**
   * Finaliza la sesión completada.
   *
   * NOTA: el envío del reporte de WhatsApp al cerrar la consulta fue eliminado
   * a pedido del negocio. Aquí solo se libera la sesión en memoria; el tracking
   * de presencia (eventos Socket.io) no se ve afectado.
   */
  private finalizeSession(session: VideoSession): void {
    console.log(`[SessionTracker] Sesión ${session.roomName} finalizada (reporte de WhatsApp deshabilitado)`);
    this.sessions.delete(session.roomName);
  }

  /**
   * Obtiene el estado actual de todos los pacientes conectados
   * Retorna un array de objetos con documento, roomName, identity, connectedAt
   * @param medicoCode - Opcional: filtrar solo pacientes de este médico
   */
  getConnectedPatients(medicoCode?: string): Array<{ documento: string; roomName: string; identity: string; connectedAt: string }> {
    const connectedPatients: Array<{ documento: string; roomName: string; identity: string; connectedAt: string }> = [];

    for (const [roomName, session] of this.sessions.entries()) {
      // Si se proporciona medicoCode, filtrar solo las sesiones de ese médico
      if (medicoCode && session.medicoCode !== medicoCode) {
        continue;
      }

      for (const participant of session.participants.values()) {
        // Solo incluir pacientes que NO se han desconectado
        if (participant.role === 'patient' && !participant.disconnectedAt && session.patientDocumento) {
          connectedPatients.push({
            documento: session.patientDocumento,
            roomName,
            identity: participant.identity,
            connectedAt: participant.connectedAt.toISOString(),
          });
        }
      }
    }

    console.log(`[SessionTracker] getConnectedPatients (medicoCode: ${medicoCode}): Found ${connectedPatients.length} connected patients`);
    return connectedPatients;
  }

  /**
   * Limpia sesiones antiguas (mayores a 24 horas)
   */
  cleanOldSessions(): void {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    for (const [roomName, session] of this.sessions.entries()) {
      if (session.createdAt.getTime() < oneDayAgo) {
        console.log(`[SessionTracker] Cleaning old session: ${roomName}`);
        this.sessions.delete(roomName);
      }
    }
  }
}

export const sessionTracker = new SessionTrackerService();

// Limpiar sesiones antiguas cada hora
setInterval(() => {
  sessionTracker.cleanOldSessions();
}, 60 * 60 * 1000);

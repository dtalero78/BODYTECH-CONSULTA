import twilio from 'twilio';
import { Server as SocketIOServer } from 'socket.io';
import whatsappService from './whatsapp.service';

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
  private readonly ADMIN_PHONE = '+573008021701';
  private readonly twilioClient: twilio.Twilio;
  private readonly twilioWhatsAppFrom: string;
  private io: SocketIOServer | null = null;
  private changeListeners: Array<() => void> = [];

  constructor() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID || '';
    const authToken = process.env.TWILIO_AUTH_TOKEN || '';
    this.twilioWhatsAppFrom = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+3153369631';

    if (!accountSid || !authToken) {
      console.warn('⚠️  Credenciales de Twilio no configuradas - reportes de sesión no disponibles');
      this.twilioClient = {} as twilio.Twilio;
    } else {
      this.twilioClient = twilio(accountSid, authToken);
      console.log('✅ SessionTrackerService inicializado con Twilio WhatsApp');
    }
  }

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
    }

    // Verificar si todos los participantes se desconectaron
    const allDisconnected = Array.from(session.participants.values()).every(
      (p) => p.disconnectedAt !== undefined
    );

    if (allDisconnected && session.participants.size >= 2) {
      console.log(`[SessionTracker] All participants disconnected from ${roomName}. Sending report...`);
      session.completedAt = new Date();
      this.sendSessionReport(session);
    }
    this.notifyChange();
  }

  /**
   * Envía el reporte de la sesión completada
   */
  private async sendSessionReport(session: VideoSession): Promise<void> {
    try {
      const doctor = Array.from(session.participants.values()).find((p) => p.role === 'doctor');
      const patient = Array.from(session.participants.values()).find((p) => p.role === 'patient');

      if (!doctor || !patient) {
        console.warn('[SessionTracker] Session incomplete: missing doctor or patient');
        return;
      }

      const duration = this.calculateDuration(session);
      const report = this.formatSessionReport(session, doctor, patient, duration);
      const variables = this.buildReportVariables(session, doctor, patient, duration);

      await this.sendWhatsAppMessage(variables, report);

      console.log(`[SessionTracker] Report sent successfully for room ${session.roomName}`);

      // Limpiar la sesión después de enviar el reporte
      this.sessions.delete(session.roomName);
    } catch (error) {
      console.error('[SessionTracker] Error sending session report:', error);
    }
  }

  /**
   * Calcula la duración de la sesión
   */
  private calculateDuration(session: VideoSession): string {
    const participants = Array.from(session.participants.values());
    const earliestConnection = Math.min(...participants.map((p) => p.connectedAt.getTime()));
    const latestDisconnection = Math.max(
      ...participants.map((p) => p.disconnectedAt?.getTime() || 0)
    );

    const durationMs = latestDisconnection - earliestConnection;
    const minutes = Math.floor(durationMs / 60000);
    const seconds = Math.floor((durationMs % 60000) / 1000);

    return `${minutes}m ${seconds}s`;
  }

  /**
   * Formatea el reporte de la sesión
   */
  private formatSessionReport(
    session: VideoSession,
    doctor: SessionParticipant,
    patient: SessionParticipant,
    duration: string
  ): string {
    const timestamp = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let report = `📹 *VIDEOLLAMADA COMPLETADA*\n`;
    report += `📅 ${timestamp}\n\n`;

    report += `🏥 *SALA*\n`;
    report += `• ID: ${session.roomName}\n`;
    report += `• Duración: ${duration}\n\n`;

    report += `⚕️ *DOCTOR*\n`;
    report += `• Código: ${doctor.identity.replace('Dr. ', '')}\n`;
    report += `• Conectado: ${doctor.connectedAt.toLocaleTimeString('es-CO')}\n`;
    report += `• Desconectado: ${doctor.disconnectedAt?.toLocaleTimeString('es-CO') || 'N/A'}\n\n`;

    report += `👤 *PACIENTE*\n`;
    report += `• Nombre: ${patient.identity}\n`;
    report += `• Conectado: ${patient.connectedAt.toLocaleTimeString('es-CO')}\n`;
    report += `• Desconectado: ${patient.disconnectedAt?.toLocaleTimeString('es-CO') || 'N/A'}\n\n`;

    report += `✅ Sesión finalizada correctamente`;

    return report;
  }

  /**
   * Construye las variables posicionales de la plantilla `bsl_reporte_videollamada`.
   *   {{1}} fecha/hora · {{2}} sala · {{3}} duración · {{4}} doctor · {{5}} paciente
   */
  private buildReportVariables(
    session: VideoSession,
    doctor: SessionParticipant,
    patient: SessionParticipant,
    duration: string
  ): Record<string, string> {
    const timestamp = new Date().toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

    return {
      '1': timestamp,
      '2': session.roomName,
      '3': duration,
      '4': doctor.identity.replace('Dr. ', ''),
      '5': patient.identity,
    };
  }

  /**
   * Envía el reporte por WhatsApp.
   *
   * WhatsApp Business no entrega texto libre fuera de la ventana de 24h, por eso se
   * usa la plantilla aprobada (`whatsappService.sendReportMessage`). Si la plantilla
   * no está configurada (dev/sandbox), cae a texto libre con el cliente propio.
   */
  private async sendWhatsAppMessage(
    variables: Record<string, string>,
    fallbackBody: string
  ): Promise<void> {
    // Ruta preferida: plantilla aprobada (requerida en producción)
    if (process.env.TWILIO_WHATSAPP_REPORT_TEMPLATE_SID) {
      const result = await whatsappService.sendReportMessage(this.ADMIN_PHONE, variables);
      if (result.success) {
        console.log(`[SessionTracker] Reporte enviado por plantilla — SID: ${result.messageSid}`);
      } else {
        console.error(`[SessionTracker] Error enviando reporte por plantilla: ${result.error}`);
      }
      return;
    }

    // Fallback (dev / sandbox): texto libre con el cliente propio
    if (!this.twilioClient.messages) {
      console.error('[SessionTracker] Twilio client not configured');
      return;
    }

    try {
      const twilioMessage = await this.twilioClient.messages.create({
        from: this.twilioWhatsAppFrom,
        to: `whatsapp:${this.ADMIN_PHONE}`,
        body: fallbackBody,
      });

      console.warn('[SessionTracker] ⚠️ Reporte enviado como texto libre (sin plantilla) — solo válido dentro de la ventana de 24h');
      console.log(`   Message SID: ${twilioMessage.sid}`);
      console.log(`   Estado: ${twilioMessage.status}`);
    } catch (error) {
      console.error('[SessionTracker] Error sending WhatsApp message:', error);
      throw error;
    }
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

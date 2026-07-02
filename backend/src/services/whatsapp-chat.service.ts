// ============================================================================
// whatsapp-chat.service — pegamento Socket.io para el chat del panel médico.
//
// Guarda una referencia al `io` (seteada desde index.ts) y expone un emit
// global de `nuevo-mensaje-whatsapp`. El frontend (chat por paciente en la
// Agenda) filtra por el celular de la conversación abierta.
// ============================================================================

import { Server } from 'socket.io';

export interface ChatMensajePayload {
  celular: string;
  id: number;
  direccion: 'entrante' | 'saliente';
  contenido: string;
  tipoMensaje?: string;
  mediaUrl?: string | null;
  createdAt: string;
}

class WhatsappChatService {
  private io: Server | null = null;

  initialize(io: Server): void {
    this.io = io;
    console.log('[Socket.io] WhatsApp chat service initialized');
  }

  emitNuevoMensaje(payload: ChatMensajePayload): void {
    if (!this.io) return;
    this.io.emit('nuevo-mensaje-whatsapp', payload);
  }
}

export const whatsappChatService = new WhatsappChatService();
export default whatsappChatService;

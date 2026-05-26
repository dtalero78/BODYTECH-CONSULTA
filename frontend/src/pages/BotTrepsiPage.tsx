import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Send, Bot, User, AlertCircle, Loader2 } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const INITIAL_GREETING: ChatTurn = {
  role: 'assistant',
  content:
    '¡Hola! Soy el asistente técnico de la integración Trepsi ↔ Bodytech. Puedo ayudarte con:\n\n' +
    '• Endpoints disponibles (médicos, horarios, citas, webhook)\n' +
    '• Formatos esperados (E.164, ISO 8601, códigos de respuesta)\n' +
    '• Flujo de datos y validaciones\n' +
    '• Casos de prueba y manejo de errores\n\n' +
    '¿En qué puedo ayudarte hoy?',
};

const SUGGESTED_QUESTIONS = [
  '¿Cuáles son los endpoints disponibles?',
  '¿Cómo creo una cita?',
  '¿Qué formato debe tener la fecha de atención?',
  '¿Cómo obtengo los horarios libres de un médico?',
  '¿Qué pasa si la API Key es inválida?',
];

export function BotTrepsiPage() {
  const [messages, setMessages] = useState<ChatTurn[]>([INITIAL_GREETING]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll cuando llega un nuevo mensaje
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sending) return;
      setError(null);

      const userTurn: ChatTurn = { role: 'user', content: trimmed };
      // Para la request al backend, mandamos el historial SIN el saludo inicial
      // (es solo UI) + el nuevo mensaje del usuario.
      const conversationForApi = [
        ...messages.filter((m) => m !== INITIAL_GREETING),
        userTurn,
      ];

      setMessages((prev) => [...prev, userTurn]);
      setInput('');
      setSending(true);

      try {
        const res = await axios.post(`${API_BASE_URL}/api/bot-trepsi/chat`, {
          messages: conversationForApi,
        });
        const reply = res.data?.reply;
        if (typeof reply !== 'string' || reply.length === 0) {
          throw new Error('Respuesta vacía del bot.');
        }
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      } catch (err: unknown) {
        const msg =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.response?.data?.error?.message ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.message ||
          'No se pudo enviar el mensaje. Intenta de nuevo.';
        setError(msg);
        // Quitar el mensaje del usuario si falló, para que pueda reintentar
        setMessages((prev) => prev.slice(0, -1));
        setInput(trimmed);
      } finally {
        setSending(false);
        // Devolver foco al textarea
        inputRef.current?.focus();
      }
    },
    [messages, sending]
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    send(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-800">
              Asistente Integración · Trepsi ↔ Bodytech
            </h1>
            <p className="text-xs text-gray-500">
              Resuelvo dudas técnicas sobre los endpoints, formatos y flujo de la integración.
            </p>
          </div>
        </div>
      </header>

      {/* Chat */}
      <main className="flex-1 overflow-hidden">
        <div className="max-w-3xl mx-auto h-full flex flex-col">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-4 py-6 space-y-4"
          >
            {messages.map((m, i) => (
              <Message key={i} turn={m} />
            ))}
            {sending && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-2xl">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                  <span className="text-sm text-gray-500">Pensando...</span>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </div>

          {/* Sugerencias rápidas (solo al inicio) */}
          {messages.length === 1 && !sending && (
            <div className="px-4 pb-3">
              <p className="text-xs text-gray-400 mb-2">Sugerencias:</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    onClick={() => send(q)}
                    className="px-3 py-1.5 text-xs text-blue-700 bg-white border border-blue-200 rounded-full hover:bg-blue-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form
            onSubmit={handleSubmit}
            className="border-t border-gray-200 bg-white px-4 py-3"
          >
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu pregunta sobre la integración..."
                rows={1}
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-32"
                style={{ minHeight: '40px' }}
                disabled={sending}
                autoFocus
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5 text-sm"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">
              Enter para enviar · Shift+Enter para nueva línea · Las respuestas son generadas por IA y
              pueden contener errores. Para casos críticos, contacta a d.talero@bsl.com.co
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Message({ turn }: { turn: ChatTurn }) {
  const isUser = turn.role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser ? 'bg-gray-200 text-gray-600' : 'bg-blue-50 text-blue-600'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>
      <div
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap break-words ${
          isUser
            ? 'bg-blue-600 text-white rounded-br-sm'
            : 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm'
        }`}
      >
        {turn.content}
      </div>
    </div>
  );
}

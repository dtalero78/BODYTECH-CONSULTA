import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
  Clock,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

interface IntegrationEvent {
  id: number;
  direccion: 'inbound' | 'outbound';
  tipo: string;
  metodo: string | null;
  path: string | null;
  cita_id: string | null;
  status_code: number | null;
  ok: boolean;
  latency_ms: number | null;
  request_body: unknown;
  response_body: unknown;
  error_code: string | null;
  error_message: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

interface EventsResponse {
  ok: boolean;
  serverTime: string;
  count: number;
  events: IntegrationEvent[];
}

const POLL_MS = 2000;
const MAX_EVENTS = 500;

// -----------------------------------------------------------------------
// Diccionario de explicaciones por tipo de evento + sugerencias por error
// -----------------------------------------------------------------------

const TIPO_LABEL: Record<string, { label: string; descripcion: string }> = {
  health: {
    label: 'Health check',
    descripcion: 'Trepsi verificó que el endpoint responde y su token es válido.',
  },
  listMedicos: {
    label: 'Listar médicos',
    descripcion:
      'Trepsi pidió la lista de profesionales activos (médicos y/o coaches) para mostrarla al paciente en el agendamiento.',
  },
  listHorariosDisponibles: {
    label: 'Horarios disponibles',
    descripcion:
      'Trepsi pidió los slots libres de un profesional en una fecha. Bodytech cruza la disponibilidad teórica vs las citas ya agendadas.',
  },
  createAppointment: {
    label: 'Crear cita',
    descripcion:
      'Trepsi creó una nueva cita con la historia clínica diligenciada por el paciente. Se insertó en HistoriaClinica + trepsi_appointments.',
  },
  rescheduleAppointment: {
    label: 'Reprogramar cita',
    descripcion: 'Trepsi cambió la fecha/hora/médico de una cita existente.',
  },
  patchHistoria: {
    label: 'Actualizar historia clínica',
    descripcion:
      'Trepsi actualizó campos de la historia clínica entre la creación y el momento de la atención.',
  },
  cancelAppointment: {
    label: 'Cancelar cita',
    descripcion: 'Trepsi canceló una cita. La historia clínica se conserva por trazabilidad.',
  },
  getAppointment: {
    label: 'Consultar cita',
    descripcion: 'Trepsi consultó el estado actual de una cita.',
  },
  'webhook.consultationResults': {
    label: 'Webhook → Trepsi (resultados)',
    descripcion:
      'Bodytech envió a Trepsi los resultados de una consulta (médico hizo clic en "Guardar HC"). Si falla, se reintenta con backoff exponencial.',
  },
};

// Sugerencias por error_code (cubre lo más común). Si no hay match exacto, se
// usa un fallback genérico.
const SUGGESTIONS: Record<string, { titulo: string; pasos: string[] }> = {
  MISSING_API_KEY: {
    titulo: 'Falta el header Authorization',
    pasos: [
      'Trepsi debe enviar `Authorization: Bearer <TREPSI_API_KEY>` en cada request.',
      'Confirma con su equipo que estén leyendo bien el token desde su config.',
    ],
  },
  INVALID_API_KEY: {
    titulo: 'API Key inválida',
    pasos: [
      'Verifica que el token que Trepsi está usando coincide exactamente con el TREPSI_API_KEY de Bodytech (sin espacios extra).',
      'Si rotaste la key, asegúrate de haberles compartido el nuevo valor por canal seguro.',
    ],
  },
  VALIDATION_ERROR: {
    titulo: 'Payload con campos inválidos',
    pasos: [
      'Revisa el `details` del response — indica qué campo falló y por qué.',
      'Los más comunes: celular fuera de formato E.164 (debe iniciar con +), fechaAtencion sin offset ISO 8601, fechaNacimiento no en YYYY-MM-DD.',
    ],
  },
  CONSENT_REQUIRED: {
    titulo: 'consentimientoInformado falso o ausente',
    pasos: [
      'La cita requiere que `historiaClinica.consentimientoInformado === true`. Esto debe venir de un checkbox explícito en la UI de Trepsi (Ley 1581 Colombia).',
      'Trepsi no puede agendar sin que el paciente acepte explícitamente.',
    ],
  },
  FECHA_IN_PAST: {
    titulo: 'fechaAtencion en el pasado',
    pasos: [
      'La fecha enviada está antes de NOW(). Verifica que Trepsi maneje correctamente la zona horaria de Colombia (-05:00).',
    ],
  },
  NOT_FOUND: {
    titulo: 'citaId no existe',
    pasos: [
      'Trepsi intentó operar (schedule/cancel/patch) sobre una cita que no existe en Bodytech.',
      'Verifica que estén usando el mismo citaId que enviaron en el POST /appointments original.',
    ],
  },
  ALREADY_CANCELLED: {
    titulo: 'La cita ya estaba cancelada',
    pasos: [
      'No se puede reprogramar ni modificar la historia de una cita cancelada.',
      'Si necesitan reactivar, deben crear una nueva cita con un nuevo citaId.',
    ],
  },
  ALREADY_ATTENDED: {
    titulo: 'La cita ya fue atendida',
    pasos: [
      'El médico ya consignó la HC. Desde ese momento, Trepsi no puede modificarla.',
      'Si necesitan cambios clínicos, deben hacerlos desde su lado o crear una nueva consulta.',
    ],
  },
  MEDICO_NOT_FOUND: {
    titulo: 'Código de médico no registrado',
    pasos: [
      'Trepsi envió un `medico.codigo` que no existe o está inactivo en Bodytech.',
      'Hay que dar de alta ese profesional desde el panel coordinador o pasarle a Trepsi un código válido.',
    ],
  },
  NETWORK_ERROR: {
    titulo: 'Error de red al llamar al webhook',
    pasos: [
      'Bodytech no pudo conectarse al webhook de Trepsi (timeout, DNS, etc.).',
      'El reintento es automático con backoff (1s, 5s, 30s, 5min, 30min, 2h).',
      'Si persiste, verifica que la URL TREPSI_WEBHOOK_URL sea correcta y que su Cloud Function esté arriba.',
    ],
  },
  HTTP_401: {
    titulo: 'Trepsi rechazó nuestro token',
    pasos: [
      'El header `Authorization: Bearer <TREPSI_WEBHOOK_API_KEY>` no fue aceptado.',
      'Confirma con Trepsi que el token que tenemos en TREPSI_WEBHOOK_API_KEY es el correcto.',
    ],
  },
  HTTP_400: {
    titulo: 'Trepsi rechazó nuestro payload',
    pasos: [
      'Su webhook esperaba un shape distinto al que enviamos. Mira el response_body para ver qué les molestó.',
      'Si es un campo faltante, podemos extender el payload builder en `trepsi-webhook.service.ts`.',
    ],
  },
  HTTP_500: {
    titulo: 'Error interno en Trepsi',
    pasos: [
      'Su Cloud Function tuvo un error. El reintento automático probablemente lo resuelva.',
      'Si persiste, avísale al equipo de Trepsi con el citaId afectado.',
    ],
  },
};

function suggestionFor(ev: IntegrationEvent): { titulo: string; pasos: string[] } | null {
  if (ev.ok) return null;
  if (ev.error_code && SUGGESTIONS[ev.error_code]) return SUGGESTIONS[ev.error_code];
  if (ev.status_code) {
    const key = `HTTP_${ev.status_code}`;
    if (SUGGESTIONS[key]) return SUGGESTIONS[key];
  }
  return {
    titulo: 'Error genérico',
    pasos: [
      'Revisa el response_body para ver detalles del error.',
      'Si es 5xx, los reintentos automáticos podrían resolverlo.',
      'Si es 4xx, revisa que el payload cumpla la spec v2.1.',
    ],
  };
}

// -----------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------

export function MonitorIntegracionPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'todos' | 'errores' | 'inbound' | 'outbound'>('todos');
  const [lastError, setLastError] = useState<string | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const lastSinceRef = useRef<string | null>(null);

  const fetchEvents = useCallback(async () => {
    if (paused) return;
    if (!token) {
      setLastError('Falta token. Abre la página con `?token=...`.');
      return;
    }
    try {
      const since = lastSinceRef.current;
      const params = new URLSearchParams({ token });
      if (since) params.set('since', since);
      const res = await fetch(`${API_BASE}/api/monitor-integracion/events?${params.toString()}`);
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error?.message ?? `HTTP ${res.status}`);
      }
      const data: EventsResponse = await res.json();
      setServerTime(data.serverTime);
      setLastError(null);
      if (data.events.length === 0) return;
      const lastEv = data.events[data.events.length - 1];
      lastSinceRef.current = lastEv.created_at;
      setEvents((prev) => {
        const merged = [...prev, ...data.events];
        if (merged.length > MAX_EVENTS) return merged.slice(-MAX_EVENTS);
        return merged;
      });
    } catch (err) {
      setLastError(err instanceof Error ? err.message : String(err));
    }
  }, [token, paused]);

  useEffect(() => {
    fetchEvents();
    const id = setInterval(fetchEvents, POLL_MS);
    return () => clearInterval(id);
  }, [fetchEvents]);

  const filtered = useMemo(() => {
    if (filter === 'todos') return events;
    if (filter === 'errores') return events.filter((e) => !e.ok);
    return events.filter((e) => e.direccion === filter);
  }, [events, filter]);

  const stats = useMemo(() => {
    return {
      total: events.length,
      inbound: events.filter((e) => e.direccion === 'inbound').length,
      outbound: events.filter((e) => e.direccion === 'outbound').length,
      errores: events.filter((e) => !e.ok).length,
    };
  }, [events]);

  const selected = useMemo(
    () => (selectedId !== null ? events.find((e) => e.id === selectedId) ?? null : null),
    [events, selectedId]
  );

  // Auto-select el último evento si no hay nada seleccionado
  useEffect(() => {
    if (selectedId === null && filtered.length > 0) {
      setSelectedId(filtered[filtered.length - 1].id);
    }
  }, [filtered, selectedId]);

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-900">Monitor Integración Trepsi</h1>
              <p className="text-[11px] text-zinc-500">
                {lastError ? (
                  <span className="text-red-600">⚠ {lastError}</span>
                ) : paused ? (
                  <span>Pausado · {events.length} eventos</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                    En vivo · {events.length} eventos
                    {serverTime && ` · ${new Date(serverTime).toLocaleTimeString('es-CO')}`}
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Filtros */}
            <div className="flex items-center gap-1 bg-zinc-100 p-0.5 rounded-md">
              {(['todos', 'errores', 'inbound', 'outbound'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                    filter === f
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  }`}
                >
                  {f === 'errores' && '⚠ '}
                  {f}
                </button>
              ))}
            </div>

            <button
              onClick={() => setPaused((p) => !p)}
              className="p-1.5 text-zinc-600 hover:bg-zinc-100 rounded-md"
              title={paused ? 'Reanudar' : 'Pausar'}
            >
              {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                lastSinceRef.current = null;
                setEvents([]);
                setSelectedId(null);
                fetchEvents();
              }}
              className="p-1.5 text-zinc-600 hover:bg-zinc-100 rounded-md"
              title="Limpiar y recargar"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="max-w-7xl mx-auto px-6 pb-3 grid grid-cols-4 gap-3">
          <StatChip label="Total" value={stats.total} color="text-zinc-700" />
          <StatChip
            label="Inbound"
            value={stats.inbound}
            color="text-blue-700"
            icon={<ArrowDownLeft className="w-3 h-3" />}
          />
          <StatChip
            label="Outbound"
            value={stats.outbound}
            color="text-purple-700"
            icon={<ArrowUpRight className="w-3 h-3" />}
          />
          <StatChip
            label="Errores"
            value={stats.errores}
            color={stats.errores > 0 ? 'text-red-700' : 'text-zinc-700'}
            icon={<AlertTriangle className="w-3 h-3" />}
          />
        </div>
      </header>

      {/* Body: tabla + panel diagnóstico */}
      <div className="flex-1 max-w-7xl mx-auto w-full px-6 py-4 grid grid-cols-12 gap-4 min-h-0">
        {/* Tabla */}
        <div className="col-span-7 bg-white border border-zinc-200 rounded-lg overflow-hidden flex flex-col min-h-0">
          {/* Header tabla */}
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            <div className="col-span-2">Hora</div>
            <div className="col-span-1"></div>
            <div className="col-span-3">Tipo</div>
            <div className="col-span-3">Cita / Detalle</div>
            <div className="col-span-2 text-right">Latencia</div>
            <div className="col-span-1 text-right">Estado</div>
          </div>

          {/* Filas */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-zinc-400">
                {paused
                  ? 'Pausado'
                  : token
                    ? 'Esperando eventos…'
                    : 'Sin token. Abre la página con `?token=...`.'}
              </div>
            ) : (
              filtered
                .slice()
                .reverse()
                .map((ev) => (
                  <EventRow
                    key={ev.id}
                    event={ev}
                    selected={selectedId === ev.id}
                    onClick={() => setSelectedId(ev.id)}
                  />
                ))
            )}
          </div>
        </div>

        {/* Panel diagnóstico */}
        <div className="col-span-5 bg-white border border-zinc-200 rounded-lg overflow-hidden flex flex-col min-h-0">
          {selected ? (
            <Diagnosis event={selected} />
          ) : (
            <div className="p-12 text-center text-sm text-zinc-400">
              Selecciona un evento para ver el detalle
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------

function StatChip({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-zinc-50 border border-zinc-200 rounded-md px-3 py-1.5 flex items-center justify-between">
      <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-500 uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <div className={`text-base font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function EventRow({
  event,
  selected,
  onClick,
}: {
  event: IntegrationEvent;
  selected: boolean;
  onClick: () => void;
}) {
  const time = new Date(event.created_at).toLocaleTimeString('es-CO', {
    hour12: false,
  });
  const dirIcon =
    event.direccion === 'inbound' ? (
      <ArrowDownLeft className="w-3 h-3 text-blue-600" />
    ) : (
      <ArrowUpRight className="w-3 h-3 text-purple-600" />
    );
  const statusClasses = event.ok
    ? 'bg-green-100 text-green-700'
    : 'bg-red-100 text-red-700';
  const tipoLabel = TIPO_LABEL[event.tipo]?.label ?? event.tipo;

  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-12 gap-2 px-3 py-2 border-b border-zinc-100 text-left text-[12px] transition-colors ${
        selected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-zinc-50'
      }`}
    >
      <div className="col-span-2 font-mono text-zinc-500 tabular-nums">{time}</div>
      <div className="col-span-1 flex items-center">{dirIcon}</div>
      <div className="col-span-3 text-zinc-900 font-medium truncate">{tipoLabel}</div>
      <div className="col-span-3 text-zinc-500 truncate font-mono text-[11px]">
        {event.cita_id ?? event.error_code ?? '—'}
      </div>
      <div className="col-span-2 text-right text-zinc-500 tabular-nums">
        {event.latency_ms !== null ? `${event.latency_ms}ms` : '—'}
      </div>
      <div className="col-span-1 text-right">
        <span
          className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold rounded ${statusClasses}`}
        >
          {event.status_code ?? '—'}
        </span>
      </div>
    </button>
  );
}

function Diagnosis({ event }: { event: IntegrationEvent }) {
  const info = TIPO_LABEL[event.tipo];
  const suggestion = suggestionFor(event);
  const created = new Date(event.created_at).toLocaleString('es-CO');

  return (
    <div className="flex-1 overflow-y-auto p-5 text-[13px]">
      {/* Cabecera */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          {event.ok ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600" />
          )}
          <h2 className="text-sm font-bold text-zinc-900">
            {info?.label ?? event.tipo}
          </h2>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              event.direccion === 'inbound'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-purple-100 text-purple-700'
            }`}
          >
            {event.direccion === 'inbound' ? 'Trepsi → Bodytech' : 'Bodytech → Trepsi'}
          </span>
        </div>
        {info && <p className="text-zinc-600 leading-snug">{info.descripcion}</p>}
      </div>

      {/* Sugerencia (solo si hay error) */}
      {suggestion && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-md">
          <div className="flex items-center gap-1.5 mb-1.5 text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="text-[12px] font-bold">{suggestion.titulo}</span>
          </div>
          <ul className="text-[12px] text-amber-900 space-y-1 list-disc list-inside">
            {suggestion.pasos.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-2 mb-4 text-[11.5px]">
        <MetaItem icon={<Clock className="w-3 h-3" />} label="Hora" value={created} />
        {event.latency_ms !== null && (
          <MetaItem label="Latencia" value={`${event.latency_ms} ms`} />
        )}
        {event.cita_id && <MetaItem label="citaId" value={event.cita_id} mono />}
        {event.status_code !== null && (
          <MetaItem label="HTTP" value={String(event.status_code)} mono />
        )}
        {event.path && <MetaItem label="Path" value={event.path} mono full />}
        {event.metodo && <MetaItem label="Método" value={event.metodo} mono />}
        {event.ip && <MetaItem label="IP origen" value={event.ip} mono />}
      </div>

      {/* Bodies */}
      <div className="space-y-3">
        <BodyBlock title="Request body" data={event.request_body} />
        <BodyBlock title="Response body" data={event.response_body} />
        {event.error_message && (
          <BodyBlock title="Error message" data={event.error_message} />
        )}
      </div>
    </div>
  );
}

function MetaItem({
  label,
  value,
  mono,
  full,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={`bg-zinc-50 border border-zinc-200 rounded px-2 py-1 ${full ? 'col-span-2' : ''}`}
    >
      <div className="text-[9.5px] uppercase tracking-wide text-zinc-400 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={`text-zinc-800 ${mono ? 'font-mono text-[11px]' : ''} truncate`}>
        {value}
      </div>
    </div>
  );
}

function BodyBlock({ title, data }: { title: string; data: unknown }) {
  if (data === null || data === undefined) return null;
  const display = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-zinc-400 mb-1">{title}</div>
      <pre className="text-[11px] bg-zinc-50 border border-zinc-200 rounded p-2 overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-zinc-700">
        {display || '(vacío)'}
      </pre>
    </div>
  );
}

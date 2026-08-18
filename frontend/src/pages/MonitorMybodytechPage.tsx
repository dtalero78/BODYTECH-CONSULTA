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
const POLL_MS = 2000;
const MAX_EVENTS = 500;

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

// -----------------------------------------------------------------------
// Diccionario de explicaciones por tipo de evento (lenguaje de negocio)
// -----------------------------------------------------------------------

const TIPO_LABEL: Record<string, { label: string; descripcion: string }> = {
  'oauth.token': {
    label: 'Pedir token (OAuth2)',
    descripcion:
      'mybodytech solicitó un access_token enviando su client_id + client_secret. Si es correcto, recibe una "manilla" (JWT) válida por 10 horas.',
  },
  health: {
    label: 'Health check',
    descripcion:
      'mybodytech verificó, en un solo llamado, que la URL responde y que su token es válido.',
  },
  listSedes: {
    label: 'Listar sedes',
    descripcion: 'mybodytech pidió el catálogo de códigos de sede válidos para agendar.',
  },
  listHorarios: {
    label: 'Horarios disponibles',
    descripcion:
      'mybodytech pidió los cupos libres de nutrición para que el afiliado elija día y hora.',
  },
  createAfiliado: {
    label: 'Crear afiliado + cita',
    descripcion:
      'mybodytech creó un afiliado nuevo y agendó su valoración de nutrición. Se creó el paciente + la cita.',
  },
  getAfiliado: {
    label: 'Consultar afiliado',
    descripcion: 'mybodytech consultó el estado de la cita de un afiliado.',
  },
  cancelAfiliado: {
    label: 'Cancelar afiliado',
    descripcion: 'mybodytech canceló la cita de un afiliado.',
  },
};

// -----------------------------------------------------------------------
// Diagnóstico por error: título + pasos concretos para resolverlo.
// -----------------------------------------------------------------------

const SUGGESTIONS: Record<string, { titulo: string; pasos: string[] }> = {
  INVALID_CLIENT: {
    titulo: 'Credenciales inválidas',
    pasos: [
      'El client_id o client_secret no coinciden con los del servidor.',
      'Verifica que mybodytech esté usando exactamente los valores que le entregaste (sin espacios ni saltos de línea).',
      'Si rotaste el client_secret, confirma que les pasaste el nuevo por canal seguro.',
    ],
  },
  MISSING_TOKEN: {
    titulo: 'Falta el token de acceso',
    pasos: [
      'La petición a un endpoint protegido no trae `Authorization: Bearer <access_token>`.',
      'mybodytech debe primero pedir el token en POST /oauth/token y luego enviarlo en cada request.',
    ],
  },
  INVALID_TOKEN: {
    titulo: 'Token inválido',
    pasos: [
      'La firma o estructura del token no es válida — puede ser un token viejo, manipulado, o de otro ambiente.',
      'Que mybodytech pida uno nuevo en /oauth/token.',
      'Si es tráfico que no reconoces, revisa la IP en la metadata — podría ser un sondeo.',
    ],
  },
  TOKEN_EXPIRED: {
    titulo: 'Token vencido',
    pasos: [
      'El access_token dura 10 horas (expires_in 36000) y ya venció.',
      'mybodytech debe solicitar uno nuevo en /oauth/token.',
      'Recomiéndales renovarlo proactivamente antes de que expire, no esperar al 401.',
    ],
  },
  RATE_LIMIT: {
    titulo: 'Demasiados intentos',
    pasos: [
      'Se superó el límite de 30 intentos de token por IP en 15 minutos.',
      'Si es tráfico legítimo (muchos afiliados a la vez), avísame para subir el límite o para que ellos cacheen el token (dura 10h, no hace falta pedir uno por request).',
      'Si no reconoces la IP, podría ser fuerza bruta — revisa la IP en la metadata.',
    ],
  },
  UNSUPPORTED_GRANT_TYPE: {
    titulo: 'grant_type incorrecto',
    pasos: [
      'El campo grant_type debe ser exactamente "client_credentials".',
      'Revisa el Request body — probablemente enviaron otro valor o lo omitieron.',
    ],
  },
  INVALID_REQUEST: {
    titulo: 'Faltan credenciales en el body',
    pasos: [
      'El body de /oauth/token debe incluir client_id y client_secret.',
      'Confirma que están enviando JSON con esos dos campos.',
    ],
  },
  INTEGRATION_NOT_CONFIGURED: {
    titulo: 'Integración no configurada en el servidor',
    pasos: [
      'Faltan las variables MYBODYTECH_CLIENT_ID / CLIENT_SECRET / TOKEN_SECRET en el ambiente.',
      'Es un problema de configuración nuestro (Digital Ocean), NO de mybodytech.',
    ],
  },
  VALIDATION_ERROR: {
    titulo: 'Payload con campos inválidos',
    pasos: [
      'Falta un campo requerido o el formato no es válido. Revisa el Response body para ver cuál.',
      '(Aplicará cuando existan los endpoints de afiliados / RIPS.)',
    ],
  },
  SEDE_NOT_FOUND: {
    titulo: 'Código de sede no existe',
    pasos: [
      'El código de sede enviado no está en nuestro catálogo.',
      'Que mybodytech cargue los códigos desde GET /sedes en vez de fijarlos a mano.',
    ],
  },
  NO_AVAILABILITY: {
    titulo: 'Sin cupos disponibles',
    pasos: [
      'No hay horarios de nutrición libres en esa sede/fecha.',
      'Que reintenten con otra preferenciaFecha, o escalar a coordinación para abrir agenda.',
    ],
  },
  NOT_FOUND: {
    titulo: 'La referencia no existe',
    pasos: [
      'El eventoId consultado no existe en Bodytech.',
      'Verifica que usen el mismo eventoId que enviaron en el POST original.',
    ],
  },
  HTTP_401: {
    titulo: 'No autenticado',
    pasos: [
      'La petición no trae un token válido, o el client_id/secret son incorrectos.',
      'Revisa el error_code exacto y el flujo: primero /oauth/token, luego Bearer en el resto.',
    ],
  },
  HTTP_429: {
    titulo: 'Límite de peticiones excedido',
    pasos: [
      'Demasiadas peticiones desde esa IP en poco tiempo.',
      'Si es legítimo, coordinemos subir el límite o cachear el token del lado de mybodytech.',
    ],
  },
  HTTP_500: {
    titulo: 'Error interno del servidor',
    pasos: [
      'Ocurrió un error transitorio de nuestro lado. Revisa el Response body.',
      'mybodytech puede reintentar con el mismo eventoId (idempotente).',
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
      'Revisa el Response body para ver los detalles del error.',
      'Si es 5xx, probablemente sea transitorio y se resuelva reintentando.',
      'Si es 4xx, revisa que la petición cumpla el contrato de la integración.',
    ],
  };
}

// -----------------------------------------------------------------------
// Página
// -----------------------------------------------------------------------

export function MonitorMybodytechPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'todos' | 'errores' | 'inbound' | 'outbound'>('todos');
  const [lastError, setLastError] = useState<string | null>(null);
  const [serverTime, setServerTime] = useState<string | null>(null);
  const lastIdRef = useRef<number | null>(null);

  const fetchEvents = useCallback(async () => {
    if (paused) return;
    if (!token) {
      setLastError('Falta token. Abre la página con `?token=...`.');
      return;
    }
    try {
      const params = new URLSearchParams({ token, integracion: 'mybodytech' });
      if (lastIdRef.current !== null) {
        params.set('sinceId', String(lastIdRef.current));
      }
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
      lastIdRef.current = lastEv.id;
      setEvents((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        const nuevos = data.events.filter((e) => !seen.has(e.id));
        if (nuevos.length === 0) return prev;
        const merged = [...prev, ...nuevos];
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
            <div className="p-2 rounded-lg bg-teal-50 text-teal-600">
              <Activity className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-zinc-900">Monitor Integración mybodytech</h1>
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
                lastIdRef.current = null;
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
            color="text-teal-700"
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
          <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-zinc-50 border-b border-zinc-200 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
            <div className="col-span-2">Hora</div>
            <div className="col-span-1"></div>
            <div className="col-span-3">Tipo</div>
            <div className="col-span-3">Detalle</div>
            <div className="col-span-2 text-right">Latencia</div>
            <div className="col-span-1 text-right">Estado</div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-zinc-400">
                {paused
                  ? 'Pausado'
                  : token
                    ? 'Esperando eventos de mybodytech…'
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
  const time = new Date(event.created_at).toLocaleTimeString('es-CO', { hour12: false });
  const dirIcon =
    event.direccion === 'inbound' ? (
      <ArrowDownLeft className="w-3 h-3 text-teal-600" />
    ) : (
      <ArrowUpRight className="w-3 h-3 text-purple-600" />
    );
  const statusClasses = event.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700';
  const tipoLabel = TIPO_LABEL[event.tipo]?.label ?? event.tipo;

  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-12 gap-2 px-3 py-2 border-b border-zinc-100 text-left text-[12px] transition-colors ${
        selected ? 'bg-teal-50 hover:bg-teal-100' : 'hover:bg-zinc-50'
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
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          {event.ok ? (
            <CheckCircle2 className="w-4 h-4 text-green-600" />
          ) : (
            <XCircle className="w-4 h-4 text-red-600" />
          )}
          <h2 className="text-sm font-bold text-zinc-900">{info?.label ?? event.tipo}</h2>
          <span
            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
              event.direccion === 'inbound'
                ? 'bg-teal-100 text-teal-700'
                : 'bg-purple-100 text-purple-700'
            }`}
          >
            {event.direccion === 'inbound' ? 'mybodytech → Bodytech' : 'Bodytech → mybodytech'}
          </span>
        </div>
        {info && <p className="text-zinc-600 leading-snug">{info.descripcion}</p>}
      </div>

      {/* Diagnóstico (solo si hay error) */}
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

      <div className="grid grid-cols-2 gap-2 mb-4 text-[11.5px]">
        <MetaItem icon={<Clock className="w-3 h-3" />} label="Hora" value={created} />
        {event.latency_ms !== null && <MetaItem label="Latencia" value={`${event.latency_ms} ms`} />}
        {event.cita_id && <MetaItem label="ref (eventoId)" value={event.cita_id} mono />}
        {event.status_code !== null && (
          <MetaItem label="HTTP" value={String(event.status_code)} mono />
        )}
        {event.path && <MetaItem label="Path" value={event.path} mono full />}
        {event.metodo && <MetaItem label="Método" value={event.metodo} mono />}
        {event.ip && <MetaItem label="IP origen" value={event.ip} mono />}
      </div>

      <div className="space-y-3">
        <BodyBlock title="Request body" data={event.request_body} />
        <BodyBlock title="Response body" data={event.response_body} />
        {event.error_message && <BodyBlock title="Error message" data={event.error_message} />}
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
    <div className={`bg-zinc-50 border border-zinc-200 rounded px-2 py-1 ${full ? 'col-span-2' : ''}`}>
      <div className="text-[9.5px] uppercase tracking-wide text-zinc-400 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className={`text-zinc-800 ${mono ? 'font-mono text-[11px]' : ''} truncate`}>{value}</div>
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

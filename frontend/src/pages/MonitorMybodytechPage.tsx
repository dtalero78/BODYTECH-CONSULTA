import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';
const POLL_MS = 2000;
const MAX_EVENTS = 400;

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

interface SummaryDir {
  direccion: string;
  total: number;
  ok: number;
  errores: number;
  latencia_promedio_ms: number | null;
}

// Qué significa cada tipo de evento (lenguaje de negocio).
const TIPO_LABEL: Record<string, { label: string; desc: string }> = {
  'oauth.token': {
    label: 'Pedir token (OAuth2)',
    desc: 'mybodytech solicitó un access_token con su client_id + client_secret.',
  },
  health: {
    label: 'Health check',
    desc: 'mybodytech verificó que el endpoint responde y que su token es válido.',
  },
  listSedes: { label: 'Listar sedes', desc: 'mybodytech pidió el catálogo de sedes válidas.' },
  listHorarios: {
    label: 'Horarios disponibles',
    desc: 'mybodytech pidió los cupos libres para que el afiliado elija.',
  },
  createAfiliado: {
    label: 'Crear afiliado + cita',
    desc: 'mybodytech creó un afiliado nuevo y agendó su consulta.',
  },
  getAfiliado: { label: 'Consultar afiliado', desc: 'mybodytech consultó el estado de una cita.' },
  cancelAfiliado: { label: 'Cancelar afiliado', desc: 'mybodytech canceló una cita.' },
};

// Sugerencias por código de error.
const SUGGESTIONS: Record<string, string> = {
  INVALID_CLIENT:
    'El client_id o client_secret no coinciden con los configurados en el servidor. Verifica que mybodytech esté usando exactamente los valores que le entregaste.',
  MISSING_TOKEN: 'No enviaron el header Authorization: Bearer <access_token>. Deben pedir el token primero en /oauth/token.',
  INVALID_TOKEN: 'El access_token es inválido (firma o estructura). Puede ser un token viejo o manipulado — que pidan uno nuevo.',
  TOKEN_EXPIRED: 'El token venció (dura 10h). mybodytech debe volver a pedir uno en /oauth/token.',
  RATE_LIMIT: 'Demasiados intentos de token desde esa IP (límite 30/15min). Si es tráfico legítimo, avísame para ajustar el límite.',
  UNSUPPORTED_GRANT_TYPE: 'El grant_type debe ser exactamente "client_credentials".',
  INVALID_REQUEST: 'Falta client_id o client_secret en el body de la petición del token.',
  INTEGRATION_NOT_CONFIGURED:
    'Faltan variables de entorno en el servidor (CLIENT_ID / CLIENT_SECRET / TOKEN_SECRET). Es un problema de configuración, no de mybodytech.',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  return `hace ${h}h`;
}

// ---- estilos (dashboard oscuro, autocontenido) ----
const C = {
  bg: '#0d1117',
  card: '#161b22',
  card2: '#1c2230',
  line: '#2b3440',
  ink: '#e6edf3',
  soft: '#9aa7b4',
  faint: '#6b7684',
  teal: '#3fb6a8',
  green: '#3fb950',
  red: '#f85149',
  amber: '#d29922',
};

export function MonitorMybodytechPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [summary, setSummary] = useState<SummaryDir[]>([]);
  const [paused, setPaused] = useState(false);
  const [connError, setConnError] = useState<string | null>(null);
  const [lastPoll, setLastPoll] = useState<number>(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const lastIdRef = useRef<number | null>(null);

  const poll = useCallback(async () => {
    if (!token) return;
    try {
      const since = lastIdRef.current;
      const url =
        `${API_BASE}/api/monitor-integracion/events?integracion=mybodytech&token=${encodeURIComponent(token)}` +
        (since !== null ? `&sinceId=${since}` : '');
      const r = await fetch(url);
      if (r.status === 401) {
        setConnError('Token inválido. Revisa el ?token= en la URL.');
        return;
      }
      if (!r.ok) {
        setConnError(`Error ${r.status} al consultar eventos.`);
        return;
      }
      const data = await r.json();
      const incoming: IntegrationEvent[] = data.events || [];
      if (incoming.length > 0) {
        lastIdRef.current = Math.max(...incoming.map((e) => e.id));
        setEvents((prev) => {
          // más nuevos arriba
          const merged = [...incoming.reverse(), ...prev];
          return merged.slice(0, MAX_EVENTS);
        });
      }
      setConnError(null);
      setLastPoll(Date.now());
    } catch {
      setConnError('Sin conexión con el servidor.');
    }
  }, [token]);

  const fetchSummary = useCallback(async () => {
    if (!token) return;
    try {
      const r = await fetch(
        `${API_BASE}/api/monitor-integracion/summary?integracion=mybodytech&token=${encodeURIComponent(token)}`
      );
      if (r.ok) {
        const data = await r.json();
        setSummary(data.porDireccion || []);
      }
    } catch {
      /* noop */
    }
  }, [token]);

  useEffect(() => {
    if (!token || paused) return;
    poll();
    fetchSummary();
    const t = setInterval(() => {
      poll();
      fetchSummary();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [token, paused, poll, fetchSummary]);

  const inbound = summary.find((s) => s.direccion === 'inbound');
  const total = inbound?.total ?? 0;
  const oks = inbound?.ok ?? 0;
  const errs = inbound?.errores ?? 0;
  const lat = inbound?.latencia_promedio_ms ?? null;

  if (!token) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, display: 'grid', placeItems: 'center', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
          <div style={{ fontSize: 40 }}>🔐</div>
          <h1 style={{ fontSize: 20 }}>Monitor mybodytech</h1>
          <p style={{ color: C.soft }}>
            Falta el token de acceso. Abre esta página con <code style={{ color: C.teal }}>?token=…</code> en la URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, fontFamily: 'system-ui, sans-serif', padding: '20px 18px 60px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div style={{ fontSize: 22 }}>🩺</div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Monitor · mybodytech</div>
            <div style={{ fontSize: 12, color: C.faint }}>Integración OAuth2 · flujo en vivo</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: connError ? C.red : C.green }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: connError ? C.red : C.green, boxShadow: connError ? 'none' : `0 0 6px ${C.green}` }} />
              {connError ? 'Sin conexión' : paused ? 'Pausado' : 'En vivo'}
            </span>
            <button
              onClick={() => setPaused((p) => !p)}
              style={{ background: C.card2, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
            >
              {paused ? '▶ Reanudar' : '⏸ Pausar'}
            </button>
          </div>
        </div>

        {connError && (
          <div style={{ background: '#2a1416', border: `1px solid ${C.red}`, color: '#ffb4ae', borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 13 }}>
            {connError}
          </div>
        )}

        {/* counters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 20 }}>
          <Counter label="Requests (24h)" value={total} color={C.teal} />
          <Counter label="Exitosos" value={oks} color={C.green} />
          <Counter label="Errores" value={errs} color={errs > 0 ? C.red : C.soft} />
          <Counter label="Latencia prom." value={lat !== null ? `${lat} ms` : '—'} color={C.amber} />
        </div>

        {/* stream */}
        <div style={{ fontSize: 12, color: C.faint, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
          <span>FLUJO EN VIVO — más recientes arriba</span>
          {lastPoll > 0 && <span>actualizado {timeAgo(new Date(lastPoll).toISOString())}</span>}
        </div>

        {events.length === 0 ? (
          <div style={{ background: C.card, border: `1px dashed ${C.line}`, borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: C.soft }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>📡</div>
            Esperando el primer request de mybodytech…
            <div style={{ fontSize: 12, color: C.faint, marginTop: 8 }}>
              Prueba pidiendo un token: <code style={{ color: C.teal }}>POST /oauth/token</code>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {events.map((e) => {
              const meta = TIPO_LABEL[e.tipo] || { label: e.tipo, desc: '' };
              const isOpen = expanded === e.id;
              const barColor = e.ok ? C.green : C.red;
              return (
                <div key={e.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderLeft: `3px solid ${barColor}`, borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : e.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer', flexWrap: 'wrap' }}
                  >
                    <span title="inbound" style={{ color: C.teal, fontSize: 15 }}>⬇</span>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 650, fontSize: 14 }}>{meta.label}</div>
                      <div style={{ fontSize: 11.5, color: C.faint, fontFamily: 'ui-monospace, monospace' }}>
                        {e.metodo} {e.path}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: e.ok ? C.green : C.red, background: e.ok ? '#0f2417' : '#2a1416', borderRadius: 6, padding: '2px 8px' }}>
                      {e.status_code}
                    </span>
                    {e.latency_ms !== null && <span style={{ fontSize: 12, color: C.faint }}>{e.latency_ms}ms</span>}
                    <span style={{ fontSize: 11.5, color: C.faint, minWidth: 62, textAlign: 'right' }}>{timeAgo(e.created_at)}</span>
                  </div>

                  {isOpen && (
                    <div style={{ borderTop: `1px solid ${C.line}`, padding: '12px 14px', background: C.card2, fontSize: 12.5 }}>
                      {meta.desc && <p style={{ margin: '0 0 10px', color: C.soft }}>{meta.desc}</p>}
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', color: C.faint, fontSize: 11.5, marginBottom: 10 }}>
                        <span>IP: {e.ip || '—'}</span>
                        {e.cita_id && <span>ref: {e.cita_id}</span>}
                        <span>{new Date(e.created_at).toLocaleString('es-CO')}</span>
                      </div>
                      {!e.ok && e.error_code && (
                        <div style={{ background: '#221a0e', border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                          <div style={{ color: C.amber, fontWeight: 700, marginBottom: 3 }}>⚠ {e.error_code}</div>
                          {e.error_message && <div style={{ color: C.soft, marginBottom: 6 }}>{e.error_message}</div>}
                          {SUGGESTIONS[e.error_code] && <div style={{ color: C.ink }}>{SUGGESTIONS[e.error_code]}</div>}
                        </div>
                      )}
                      <BodyBlock title="Request" body={e.request_body} />
                      <BodyBlock title="Response" body={e.response_body} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ textAlign: 'center', color: C.faint, fontSize: 11, marginTop: 30 }}>
          Monitor de integración · mybodytech ↔ Bodytech Consulta
        </div>
      </div>
    </div>
  );
}

function Counter({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 24, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11.5, color: C.faint, marginTop: 2 }}>{label}</div>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body: unknown }) {
  if (body === null || body === undefined) return null;
  let text: string;
  try {
    text = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  } catch {
    text = String(body);
  }
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: C.faint, marginBottom: 3 }}>{title}</div>
      <pre style={{ margin: 0, background: '#0b0f14', border: `1px solid ${C.line}`, borderRadius: 8, padding: '9px 11px', color: '#c9d4e0', fontSize: 11.5, overflowX: 'auto', maxHeight: 220, fontFamily: 'ui-monospace, monospace' }}>
        {text}
      </pre>
    </div>
  );
}

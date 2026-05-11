import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || '';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionInfo {
  compositionSid: string | null;
  patientName: string;
  numeroId: string;
  doctorName: string;
  empresa: string;
  fechaConsulta: string | null;
  fechaAtencion: string | null;
}

interface Criterio {
  id: string;
  nombre: string;
  puntaje: number; // 1-5
  evidencia: string;
}

interface EvaluacionResult {
  criterios: Criterio[];
  fortalezas: string[];
  recomendaciones: string[];
  resumen?: string;
  puntaje_total: number;
}

type EstadoEval = 'procesando' | 'transcribiendo' | 'evaluando' | 'completado' | 'error';

interface EvaluacionRow {
  id: number;
  estado: EstadoEval;
  pasos: Array<{ ts: string; texto: string }>;
  puntaje_total: number | null;
  evaluacion: EvaluacionResult | null;
  error_msg: string | null;
  transcript: string | null;
  created_at: string;
}

interface HistorialItem {
  id: number;
  puntaje_total: number | null;
  estado: EstadoEval;
  created_at: string;
  error_msg: string | null;
}

// ─── Helper functions ─────────────────────────────────────────────────────────

function fmtFecha(fechaStr?: string | null): string {
  if (!fechaStr) return '—';
  try {
    const [y, m, d] = fechaStr.slice(0, 10).split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return fechaStr;
  }
}

function fmtTime(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return isoStr;
  }
}

function scoreColor(score: number): { ring: string; text: string; bg: string; bar: string } {
  if (score >= 75) return { ring: '#16a34a', text: 'text-green-700', bg: 'bg-green-50', bar: 'bg-green-500' };
  if (score >= 55) return { ring: '#d97706', text: 'text-yellow-700', bg: 'bg-yellow-50', bar: 'bg-yellow-500' };
  return { ring: '#dc2626', text: 'text-red-700', bg: 'bg-red-50', bar: 'bg-red-500' };
}

function criterioColor(puntaje: number): string {
  if (puntaje >= 4) return 'bg-green-500';
  if (puntaje === 3) return 'bg-yellow-400';
  return 'bg-red-400';
}

function criterioTextColor(puntaje: number): string {
  if (puntaje >= 4) return 'text-green-700';
  if (puntaje === 3) return 'text-yellow-700';
  return 'text-red-700';
}

function estadoBadgeClass(estado: EstadoEval): string {
  if (estado === 'completado') return 'bg-green-100 text-green-800';
  if (estado === 'error') return 'bg-red-100 text-red-800';
  return 'bg-yellow-100 text-yellow-800';
}

function estadoLabel(estado: EstadoEval): string {
  if (estado === 'procesando') return 'Procesando';
  if (estado === 'transcribiendo') return 'Transcribiendo';
  if (estado === 'evaluando') return 'Evaluando';
  if (estado === 'completado') return 'Completado';
  if (estado === 'error') return 'Error';
  return estado;
}

const IN_PROGRESS_STATES: EstadoEval[] = ['procesando', 'transcribiendo', 'evaluando'];

// ─── Sub-components ───────────────────────────────────────────────────────────

function ScoreGauge({ score }: { score: number }) {
  const colors = scoreColor(score);
  // SVG circular gauge: radius 44, circumference = 2π*44 ≈ 276.46
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  // Map score 20-100 to 0-100%
  const pct = Math.max(0, Math.min(100, ((score - 20) / 80) * 100));
  const strokeDash = (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-28 h-28">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          {/* Track */}
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="10"
          />
          {/* Progress */}
          <circle
            cx="50" cy="50" r={radius}
            fill="none"
            stroke={colors.ring}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${strokeDash} ${circumference}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-3xl font-bold ${colors.text}`}>{score}</span>
          <span className="text-xs text-gray-400 font-medium">/ 100</span>
        </div>
      </div>
      <span className={`text-sm font-semibold px-3 py-1 rounded-full ${colors.bg} ${colors.text}`}>
        {score >= 75 ? 'Excelente' : score >= 55 ? 'Regular' : 'Insuficiente'}
      </span>
    </div>
  );
}

function CriterioRow({ criterio }: { criterio: Criterio }) {
  const [expanded, setExpanded] = useState(false);
  const barColor = criterioColor(criterio.puntaje);
  const textColor = criterioTextColor(criterio.puntaje);
  const barPct = (criterio.puntaje / 5) * 100;

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
      >
        {/* Score badge */}
        <span className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold bg-gray-100 ${textColor}`}>
          {criterio.puntaje}
        </span>
        {/* Bar + label */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800 truncate">{criterio.nombre}</p>
          <div className="mt-1.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${barColor} transition-all duration-500`}
              style={{ width: `${barPct}%` }}
            />
          </div>
        </div>
        {/* Chevron */}
        <svg
          className={`shrink-0 w-4 h-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && criterio.evidencia && (
        <div className="px-4 pb-3 pt-1 bg-gray-50 border-t border-gray-100">
          <p className="text-xs text-gray-500 font-medium mb-1 uppercase tracking-wide">Evidencia</p>
          <p className="text-sm text-gray-700 leading-relaxed">{criterio.evidencia}</p>
        </div>
      )}
    </div>
  );
}

function ProgressLog({ pasos, estado }: { pasos: EvaluacionRow['pasos']; estado: EstadoEval }) {
  const isActive = IN_PROGRESS_STATES.includes(estado);

  return (
    <div className="bg-white rounded-xl border shadow-sm p-5">
      <div className="flex items-center gap-2 mb-4">
        {isActive && (
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600" />
        )}
        <h3 className="text-sm font-semibold text-gray-700">
          {isActive ? 'Procesando...' : 'Registro de pasos'}
        </h3>
        <span className={`ml-auto text-xs font-semibold px-2 py-0.5 rounded-full ${estadoBadgeClass(estado)}`}>
          {estadoLabel(estado)}
        </span>
      </div>

      {pasos.length === 0 ? (
        <p className="text-sm text-gray-400 italic">Iniciando proceso...</p>
      ) : (
        <ol className="space-y-2">
          {pasos.map((paso, idx) => {
            const isLast = idx === pasos.length - 1;
            return (
              <li key={idx} className="flex items-start gap-3">
                {/* Dot / spinner */}
                <div className="mt-0.5 shrink-0">
                  {isLast && isActive ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500" />
                  ) : (
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center ${isLast && !isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 0 1 0 1.414l-8 8a1 1 0 0 1-1.414 0l-4-4a1 1 0 1 1 1.414-1.414L8 12.586l7.293-7.293a1 1 0 0 1 1.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-700 leading-snug">{paso.texto}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtTime(paso.ts)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CalidadPage() {
  const historiaId = new URLSearchParams(window.location.search).get('historiaId') ?? '';

  // Session info
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Video
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);

  // Current evaluation
  const [currentEval, setCurrentEval] = useState<EvaluacionRow | null>(null);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  // History
  const [historial, setHistorial] = useState<HistorialItem[]>([]);
  const [historialLoading, setHistorialLoading] = useState(true);

  // Transcript expansion
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  // Polling interval ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch session info ──────────────────────────────────────────────────────
  const fetchSession = useCallback(async () => {
    if (!historiaId) {
      setSessionError('No se proporcionó historiaId en la URL.');
      setSessionLoading(false);
      return;
    }
    try {
      const res = await axios.get(`${API}/api/calidad/session/${historiaId}`);
      if (!res.data.found) {
        setSessionError('No se encontró la historia clínica.');
        return;
      }
      setSession({
        compositionSid: res.data.compositionSid ?? null,
        patientName: res.data.patientName ?? '—',
        numeroId: res.data.numeroId ?? '—',
        doctorName: res.data.doctorName ?? '—',
        empresa: res.data.empresa ?? '—',
        fechaConsulta: res.data.fechaConsulta ?? null,
        fechaAtencion: res.data.fechaAtencion ?? null,
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setSessionError(e.response?.data?.message || e.message || 'Error al cargar sesión.');
    } finally {
      setSessionLoading(false);
    }
  }, [historiaId]);

  // ── Fetch video URL once session with compositionSid is available ───────────
  const fetchVideoUrl = useCallback(async (compositionSid: string) => {
    setVideoLoading(true);
    try {
      const res = await axios.get(`${API}/api/calidad/video-url/${compositionSid}`);
      setVideoUrl(res.data.url ?? null);
    } catch {
      // Non-critical — video simply won't play
      setVideoUrl(null);
    } finally {
      setVideoLoading(false);
    }
  }, []);

  // ── Fetch historial ─────────────────────────────────────────────────────────
  const fetchHistorial = useCallback(async () => {
    if (!historiaId) return;
    try {
      const res = await axios.get(`${API}/api/calidad/historial/${historiaId}`);
      setHistorial(res.data.data ?? []);
    } catch {
      // Non-critical
    } finally {
      setHistorialLoading(false);
    }
  }, [historiaId]);

  // ── Fetch single evaluation ─────────────────────────────────────────────────
  const fetchEvaluacion = useCallback(async (evalId: number): Promise<EvaluacionRow | null> => {
    try {
      const res = await axios.get(`${API}/api/calidad/evaluacion/${evalId}`);
      return res.data.data ?? null;
    } catch {
      return null;
    }
  }, []);

  // ── Start polling ───────────────────────────────────────────────────────────
  const startPolling = useCallback((evalId: number) => {
    // Clear any existing poll
    if (pollRef.current) clearInterval(pollRef.current);

    pollRef.current = setInterval(async () => {
      const data = await fetchEvaluacion(evalId);
      if (!data) return;

      setCurrentEval(data);

      if (data.estado === 'completado' || data.estado === 'error') {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        // Refresh historial so the new entry shows correct score
        fetchHistorial();
      }
    }, 3000);
  }, [fetchEvaluacion, fetchHistorial]);

  // ── Trigger new evaluation ──────────────────────────────────────────────────
  const handleTrigger = useCallback(async () => {
    setTriggering(true);
    setTriggerError(null);
    setCurrentEval(null);
    setTranscriptOpen(false);

    try {
      const res = await axios.post(`${API}/api/calidad/evaluar/${historiaId}`);
      const evalId: number = res.data.evaluacionId;

      // Fetch initial state immediately
      const initial = await fetchEvaluacion(evalId);
      if (initial) setCurrentEval(initial);

      // Start polling
      startPolling(evalId);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setTriggerError(e.response?.data?.message || e.message || 'Error al iniciar evaluación.');
    } finally {
      setTriggering(false);
    }
  }, [historiaId, fetchEvaluacion, startPolling]);

  // ── Load a historical evaluation ───────────────────────────────────────────
  const handleLoadHistorial = useCallback(async (evalId: number) => {
    const data = await fetchEvaluacion(evalId);
    if (data) {
      setCurrentEval(data);
      setTranscriptOpen(false);
      // If somehow it's still in-progress, start polling
      if (IN_PROGRESS_STATES.includes(data.estado)) {
        startPolling(evalId);
      }
    }
  }, [fetchEvaluacion, startPolling]);

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSession();
    fetchHistorial();
  }, [fetchSession, fetchHistorial]);

  useEffect(() => {
    if (session?.compositionSid) {
      fetchVideoUrl(session.compositionSid);
    }
  }, [session, fetchVideoUrl]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Derived state ───────────────────────────────────────────────────────────
  const isInProgress = currentEval ? IN_PROGRESS_STATES.includes(currentEval.estado) : false;
  const isCompleted = currentEval?.estado === 'completado';
  const isError = currentEval?.estado === 'error';
  const showProgress = currentEval && (isInProgress || isCompleted || isError);

  // ─────────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────────

  if (!historiaId) {
    return (
      <div className="min-h-screen bg-gray-50 font-figtree flex items-center justify-center">
        <div className="bg-white rounded-xl border shadow-sm p-8 text-center max-w-sm">
          <svg className="mx-auto mb-4 w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 0 1 5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
          </svg>
          <p className="text-gray-600 font-medium">Falta el parámetro <code className="bg-gray-100 px-1 rounded">historiaId</code> en la URL.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 font-figtree">

      {/* ── Header ────────────────────────────────────────────────────────────── */}
      <div className="bg-white shadow-sm border-b sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {/* Icon */}
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 0 2 2" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Evaluación de Calidad</h1>
              {sessionLoading ? (
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse mt-1" />
              ) : session ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                  <span className="text-sm font-semibold text-gray-700">{session.patientName}</span>
                  <span className="text-xs text-gray-400">CC {session.numeroId}</span>
                  <span className="text-xs text-gray-400">·</span>
                  <span className="text-xs text-gray-500">Dr. {session.doctorName}</span>
                  {session.empresa && session.empresa !== '—' && (
                    <>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">{session.empresa}</span>
                    </>
                  )}
                  {(session.fechaConsulta || session.fechaAtencion) && (
                    <>
                      <span className="text-xs text-gray-400">·</span>
                      <span className="text-xs text-gray-500">
                        {fmtFecha(session.fechaConsulta || session.fechaAtencion)}
                      </span>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <a
            href="/ordenes"
            className="shrink-0 text-sm text-gray-500 hover:text-gray-700 hover:underline flex items-center gap-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Volver
          </a>
        </div>
      </div>

      {/* Session error */}
      {sessionError && (
        <div className="max-w-5xl mx-auto px-4 mt-6">
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {sessionError}
          </div>
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Video section ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.36a1 1 0 0 1-1.447.89L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Grabación de la consulta</span>
            {session?.compositionSid && (
              <span className="ml-auto text-xs text-gray-400 font-mono">{session.compositionSid}</span>
            )}
          </div>

          <div className="p-4">
            {sessionLoading ? (
              <div className="aspect-video bg-gray-100 rounded-lg animate-pulse" />
            ) : !session?.compositionSid ? (
              <div className="aspect-video bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-3 text-gray-400">
                <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0 1 21 8.82v6.36a1 1 0 0 1-1.447.89L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2zM3 3l18 18" />
                </svg>
                <p className="text-sm font-medium">Sin grabación disponible</p>
                <p className="text-xs">Esta consulta no tiene un video compuesto asociado.</p>
              </div>
            ) : videoLoading ? (
              <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
              </div>
            ) : videoUrl ? (
              <video
                src={videoUrl}
                controls
                className="w-full rounded-lg aspect-video bg-black"
                preload="metadata"
              />
            ) : (
              <div className="aspect-video bg-gray-100 rounded-lg flex flex-col items-center justify-center gap-2 text-gray-400">
                <svg className="w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                </svg>
                <p className="text-sm font-medium">No se pudo cargar el video</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Trigger section ────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm p-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-gray-800">Analizar consulta</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Transcribe el audio y evalúa la calidad de la atención médica con IA.
              </p>
            </div>
            <button
              onClick={handleTrigger}
              disabled={triggering || isInProgress || !session}
              className="shrink-0 flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold transition-colors shadow-sm"
            >
              {/* Brain/sparkles icon */}
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              {triggering ? 'Iniciando...' : isInProgress ? 'Procesando...' : 'Analizar Consulta'}
            </button>
          </div>

          {triggerError && (
            <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {triggerError}
            </div>
          )}
        </div>

        {/* ── Progress log ───────────────────────────────────────────────────── */}
        {showProgress && currentEval && (
          <ProgressLog pasos={currentEval.pasos} estado={currentEval.estado} />
        )}

        {/* ── Error state ────────────────────────────────────────────────────── */}
        {isError && currentEval?.error_msg && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex gap-3">
            <div className="shrink-0 w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-red-800 mb-1">Error en la evaluación</p>
              <p className="text-sm text-red-700">{currentEval.error_msg}</p>
            </div>
          </div>
        )}

        {/* ── Results section ────────────────────────────────────────────────── */}
        {isCompleted && currentEval?.evaluacion && (
          <div className="space-y-5">

            {/* Score card */}
            <div className={`bg-white rounded-xl border shadow-sm p-6`}>
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <ScoreGauge score={currentEval.evaluacion.puntaje_total} />
                <div className="flex-1 text-center sm:text-left">
                  <h2 className="text-lg font-bold text-gray-800 mb-1">Puntaje de Calidad</h2>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    Evaluación automática basada en transcripción de la consulta y criterios médicos de calidad.
                  </p>
                  {currentEval.evaluacion.resumen && (
                    <p className="mt-3 text-sm text-gray-700 italic border-l-2 border-blue-300 pl-3">
                      {currentEval.evaluacion.resumen}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Criteria list */}
            {currentEval.evaluacion.criterios.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-gray-50">
                  <h3 className="text-sm font-semibold text-gray-700">Criterios evaluados</h3>
                </div>
                <div className="p-4 space-y-2">
                  {currentEval.evaluacion.criterios.map((c) => (
                    <CriterioRow key={c.id} criterio={c} />
                  ))}
                </div>
              </div>
            )}

            {/* Fortalezas */}
            {currentEval.evaluacion.fortalezas.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-green-50">
                  <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Fortalezas
                  </h3>
                </div>
                <ul className="p-4 space-y-2">
                  {currentEval.evaluacion.fortalezas.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                      <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recomendaciones */}
            {currentEval.evaluacion.recomendaciones.length > 0 && (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <div className="px-5 py-3 border-b bg-blue-50">
                  <h3 className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
                    </svg>
                    Recomendaciones
                  </h3>
                </div>
                <ol className="p-4 space-y-2.5 list-none">
                  {currentEval.evaluacion.recomendaciones.map((r, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm text-gray-700">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                        {i + 1}
                      </span>
                      {r}
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Transcript toggle */}
            {currentEval.transcript && (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
                <button
                  onClick={() => setTranscriptOpen((v) => !v)}
                  className="w-full px-5 py-3 flex items-center gap-2 hover:bg-gray-50 transition-colors text-left"
                >
                  <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z" />
                  </svg>
                  <span className="text-sm font-semibold text-gray-700">Ver transcripción</span>
                  <svg
                    className={`ml-auto w-4 h-4 text-gray-400 transition-transform ${transcriptOpen ? 'rotate-180' : ''}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {transcriptOpen && (
                  <div className="border-t px-5 py-4 bg-gray-50">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto">
                      {currentEval.transcript}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── History table ──────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b bg-gray-50 flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
            </svg>
            <span className="text-sm font-semibold text-gray-700">Historial de evaluaciones</span>
            {historial.length > 0 && (
              <span className="ml-auto text-xs text-gray-400">{historial.length} {historial.length === 1 ? 'evaluación' : 'evaluaciones'}</span>
            )}
          </div>

          {historialLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </div>
          ) : historial.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <svg className="mx-auto mb-3 w-10 h-10 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
              </svg>
              <p className="text-sm">No hay evaluaciones previas para esta consulta.</p>
            </div>
          ) : (
            <div className="divide-y">
              {historial.map((item) => {
                const colors = item.puntaje_total !== null ? scoreColor(item.puntaje_total) : null;
                const isLoaded = currentEval?.id === item.id;

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-4 px-5 py-3 transition-colors ${isLoaded ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                  >
                    {/* Date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {new Date(item.created_at).toLocaleString('es-CO', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      {item.estado === 'error' && item.error_msg && (
                        <p className="text-xs text-red-500 truncate mt-0.5">{item.error_msg}</p>
                      )}
                    </div>

                    {/* Score or Estado badge */}
                    <div className="shrink-0">
                      {item.puntaje_total !== null && colors ? (
                        <span className={`text-sm font-bold px-3 py-1 rounded-full ${colors.bg} ${colors.text}`}>
                          {item.puntaje_total}
                        </span>
                      ) : (
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${estadoBadgeClass(item.estado)}`}>
                          {estadoLabel(item.estado)}
                        </span>
                      )}
                    </div>

                    {/* Load button */}
                    <button
                      onClick={() => handleLoadHistorial(item.id)}
                      disabled={isLoaded}
                      className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                        isLoaded
                          ? 'bg-blue-100 text-blue-600 cursor-default'
                          : 'bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-700'
                      }`}
                    >
                      {isLoaded ? 'Cargado' : 'Cargar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

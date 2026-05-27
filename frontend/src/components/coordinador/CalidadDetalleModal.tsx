// ============================================================================
// CalidadDetalleModal — Modal que muestra la evaluación de calidad de una
// historia clínica (criterios + recomendaciones + acción re-evaluar).
//
// Se abre desde la columna "Calidad" de OrdenesView. Si la historia ya tiene
// una eval (`initialEvalId` != null), la fetcha y la pinta. Si no, ofrece un
// botón para disparar la primera. El botón "Re-evaluar" siempre está
// disponible cuando la última eval está en estado completado/error.
//
// Polling automático mientras la eval esté en estado procesando/transcribiendo/
// evaluando, hasta 5 min máx. Usa `/api/calidad/evaluacion/:id` y
// `/api/calidad/evaluar/:historiaId`.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { X, RefreshCw, AlertCircle } from 'lucide-react';
import authService from '../../services/auth.service';
import { FONT_INTER, FONT_MONO } from './_tokens';

const API = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders() {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ── Types (mirror del jsonb que devuelve `consulta_evaluaciones.evaluacion`)──

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

// ── Helpers visuales ────────────────────────────────────────────────────────

function scoreColor(score: number): { ring: string; text: string; bg: string } {
  if (score >= 75) return { ring: '#16a34a', text: 'text-green-700', bg: 'bg-green-50' };
  if (score >= 55) return { ring: '#d97706', text: 'text-amber-700', bg: 'bg-amber-50' };
  return { ring: '#dc2626', text: 'text-red-700', bg: 'bg-red-50' };
}

function criterioColor(puntaje: number): string {
  if (puntaje >= 4) return 'bg-green-500';
  if (puntaje === 3) return 'bg-yellow-400';
  return 'bg-red-400';
}

function criterioTextColor(puntaje: number): string {
  if (puntaje >= 4) return 'text-green-700';
  if (puntaje === 3) return 'text-amber-700';
  return 'text-red-700';
}

function isRunning(estado: EstadoEval): boolean {
  return estado === 'procesando' || estado === 'transcribiendo' || estado === 'evaluando';
}

function estadoLabel(estado: EstadoEval): string {
  switch (estado) {
    case 'procesando':
      return 'Procesando…';
    case 'transcribiendo':
      return 'Transcribiendo…';
    case 'evaluando':
      return 'Evaluando…';
    case 'completado':
      return 'Completado';
    case 'error':
      return 'Error';
  }
}

// ── Props ───────────────────────────────────────────────────────────────────

interface Props {
  historiaId: string;
  numeroId: string;
  paciente: string;
  initialEvalId: number | null;
  onClose: () => void;
  onUpdated?: (puntaje: number | null, estado: EstadoEval | null) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CalidadDetalleModal({
  historiaId,
  numeroId,
  paciente,
  initialEvalId,
  onClose,
  onUpdated,
}: Props) {
  const [currentEvalId, setCurrentEvalId] = useState<number | null>(initialEvalId);
  const [evalRow, setEvalRow] = useState<EvaluacionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEval = useCallback(
    async (id: number) => {
      try {
        const res = await axios.get(`${API}/api/calidad/evaluacion/${id}`, {
          headers: authHeaders(),
        });
        const row: EvaluacionRow = res.data;
        setEvalRow(row);
        setError(null);
        return row;
      } catch (err) {
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.error || err.message
          : 'No se pudo cargar la evaluación.';
        setError(String(msg));
        return null;
      }
    },
    [],
  );

  // Carga inicial + polling mientras la eval está en estado activo.
  useEffect(() => {
    let cancelled = false;
    if (currentEvalId == null) {
      setEvalRow(null);
      return;
    }
    setLoading(true);
    fetchEval(currentEvalId).finally(() => {
      if (!cancelled) setLoading(false);
    });

    function schedulePoll() {
      pollRef.current = setTimeout(async () => {
        if (cancelled || currentEvalId == null) return;
        const row = await fetchEval(currentEvalId);
        if (row && isRunning(row.estado)) {
          schedulePoll();
        } else if (row) {
          // Eval terminó: avisar al padre para que refresque su pill.
          onUpdated?.(row.puntaje_total, row.estado);
        }
      }, 3500);
    }
    // Si la eval está activa, arrancamos polling.
    schedulePoll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // onUpdated es ref-estable desde el padre (useCallback); fetchEval también.
  }, [currentEvalId, fetchEval, onUpdated]);

  async function handleEvaluar() {
    setDispatching(true);
    setError(null);
    try {
      const res = await axios.post(
        `${API}/api/calidad/evaluar/${historiaId}`,
        {},
        { headers: authHeaders() },
      );
      const newId = res.data.evaluacionId ?? res.data.id;
      if (typeof newId === 'number') {
        setCurrentEvalId(newId);
      } else {
        setError('Evaluación disparada pero la respuesta no incluyó un ID.');
      }
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error || err.message
        : 'No se pudo disparar la evaluación.';
      setError(String(msg));
    } finally {
      setDispatching(false);
    }
  }

  const puntaje = evalRow?.puntaje_total ?? null;
  const estado: EstadoEval | null = evalRow?.estado ?? null;
  const running = estado != null && isRunning(estado);
  const sc = puntaje != null ? scoreColor(puntaje) : null;
  const ultimoPaso = evalRow?.pasos?.length ? evalRow.pasos[evalRow.pasos.length - 1] : null;

  return (
    <div
      className="fixed inset-0 z-[55] bg-zinc-900/40 flex items-center justify-center p-4"
      style={{ fontFamily: FONT_INTER }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-zinc-200">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
              Calidad de la consulta
            </div>
            <div className="text-[15px] font-semibold text-zinc-900 truncate mt-0.5">
              {paciente}
            </div>
            <div
              className="text-[11px] text-zinc-500 mt-0.5"
              style={{ fontFamily: FONT_MONO }}
            >
              CC {numeroId}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            aria-label="Cerrar"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 rounded-md text-[13px] text-red-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Estado vacío: no hay eval para esta historia */}
          {currentEvalId == null && !dispatching && (
            <div className="text-center py-10">
              <div className="text-[13px] text-zinc-600 mb-4">
                Esta consulta aún no tiene una evaluación de calidad.
              </div>
              <button
                onClick={handleEvaluar}
                className="px-4 py-2 rounded-md text-white text-[13px] font-medium"
                style={{ background: '#1f3a8a' }}
              >
                Evaluar ahora
              </button>
            </div>
          )}

          {loading && currentEvalId != null && !evalRow && (
            <div className="flex justify-center py-10">
              <div
                className="animate-spin rounded-full h-7 w-7 border-b-2"
                style={{ borderColor: '#1f3a8a' }}
              />
            </div>
          )}

          {evalRow && (
            <div className="space-y-5">
              {/* Resumen header: puntaje + estado */}
              <div className="flex items-center justify-between gap-4">
                <div>
                  {puntaje != null && sc ? (
                    <div className="flex items-baseline gap-2">
                      <div
                        className={`text-[40px] leading-none font-semibold ${sc.text} tabular-nums`}
                        style={{ fontFamily: FONT_INTER }}
                      >
                        {puntaje}
                      </div>
                      <div className="text-[14px] text-zinc-400 tabular-nums">/100</div>
                    </div>
                  ) : (
                    <div className="text-[13px] text-zinc-500">Sin puntaje todavía</div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {running && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-[12px]">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-amber-700" />
                      <span>{estadoLabel(estado!)}</span>
                    </div>
                  )}
                  {!running && (
                    <button
                      onClick={handleEvaluar}
                      disabled={dispatching}
                      className="px-3 py-1.5 rounded-md border border-zinc-200 text-[12px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Re-evaluar
                    </button>
                  )}
                </div>
              </div>

              {/* Mientras corre, mostramos el último paso reportado por el agente */}
              {running && ultimoPaso && (
                <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded-md text-[12px] text-zinc-600">
                  {ultimoPaso.texto}
                </div>
              )}

              {/* Error msg de una eval pasada */}
              {estado === 'error' && evalRow.error_msg && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-[13px] text-red-700">
                  {evalRow.error_msg}
                </div>
              )}

              {/* Criterios + recomendaciones (solo cuando hay evaluacion completa) */}
              {evalRow.evaluacion && (
                <>
                  <div>
                    <h3 className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-3">
                      Criterios
                    </h3>
                    <div className="space-y-2.5">
                      {evalRow.evaluacion.criterios.map((c) => {
                        const barPct = (c.puntaje / 5) * 100;
                        return (
                          <div key={c.id} className="border border-zinc-100 rounded-md p-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="text-[13px] font-medium text-zinc-800">
                                {c.nombre}
                              </div>
                              <div
                                className={`text-[13px] font-semibold tabular-nums ${criterioTextColor(c.puntaje)}`}
                              >
                                {c.puntaje}/5
                              </div>
                            </div>
                            <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-1.5">
                              <div
                                className={`h-full ${criterioColor(c.puntaje)} transition-all`}
                                style={{ width: `${barPct}%` }}
                              />
                            </div>
                            <div className="text-[12px] text-zinc-600">{c.evidencia}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {evalRow.evaluacion.fortalezas?.length > 0 && (
                    <div>
                      <h3 className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-3">
                        Fortalezas
                      </h3>
                      <ul className="space-y-1.5">
                        {evalRow.evaluacion.fortalezas.map((f, i) => (
                          <li key={i} className="text-[13px] text-zinc-700 flex gap-2">
                            <span className="text-green-600">✓</span>
                            <span>{f}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evalRow.evaluacion.recomendaciones?.length > 0 && (
                    <div>
                      <h3 className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold mb-3">
                        Recomendaciones
                      </h3>
                      <ul className="space-y-1.5">
                        {evalRow.evaluacion.recomendaciones.map((r, i) => (
                          <li key={i} className="text-[13px] text-zinc-700 flex gap-2">
                            <span className="text-zinc-400 tabular-nums">{i + 1}.</span>
                            <span>{r}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evalRow.transcript && (
                    <details className="text-[12px]">
                      <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700">
                        Ver transcript
                      </summary>
                      <div
                        className="mt-2 p-3 bg-zinc-50 border border-zinc-200 rounded-md text-zinc-700 whitespace-pre-wrap"
                        style={{ fontFamily: FONT_MONO, fontSize: 11.5 }}
                      >
                        {evalRow.transcript}
                      </div>
                    </details>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

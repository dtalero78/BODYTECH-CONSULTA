// ============================================================================
// LlamadasVozPanel — las llamadas grabadas de una historia, para quien audita.
//
// Se muestra en la historia clínica (HistoriaDetallePage) solo a coordinador y
// admin: los coaches no escuchan grabaciones, ni las propias. El servidor lo
// vuelve a verificar en /api/twilio/llamadas/:id/audio, así que esto es
// presentación, no la puerta.
//
// El audio se baja recién cuando alguien aprieta "Escuchar": las grabaciones
// son datos de pacientes y no tiene sentido traerlas todas por abrir la ficha.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { Phone, Play, Loader2 } from 'lucide-react';
import apiService, { type LlamadaVoz } from '../services/api.service';
import { Pill, PILLS, initialsOf, MonoAvatar } from './coordinador/_tokens';

const ESTADO_META: Record<string, { label: string; pill: keyof typeof PILLS }> = {
  completada: { label: 'Hablaron', pill: 'ok' },
  sin_respuesta: { label: 'No contestó', pill: 'warn' },
  coach_no_contesto: { label: 'Coach no atendió', pill: 'warn' },
  fallida: { label: 'Falló', pill: 'bad' },
  en_llamada: { label: 'En curso', pill: 'now' },
  llamando_paciente: { label: 'Llamando', pill: 'now' },
  llamando_coach: { label: 'Llamando', pill: 'now' },
  iniciando: { label: 'Iniciando', pill: 'mute' },
};

function fechaHora(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-CO', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'America/Bogota',
  });
}

function duracion(seg: number | null): string {
  if (seg == null) return '—';
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`;
}

export function LlamadasVozPanel({ historiaId }: { historiaId: string }) {
  const [llamadas, setLlamadas] = useState<LlamadaVoz[] | null>(null);
  const [audio, setAudio] = useState<{ id: number; url: string } | null>(null);
  const [cargandoAudio, setCargandoAudio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [textoAbierto, setTextoAbierto] = useState<number | null>(null);

  const cargar = useCallback(
    (vivo: () => boolean) =>
      apiService
        .listarLlamadas(historiaId)
        .then((l) => vivo() && setLlamadas(l))
        .catch(() => vivo() && setLlamadas([])),
    [historiaId]
  );

  useEffect(() => {
    let vivo = true;
    cargar(() => vivo);
    return () => {
      vivo = false;
    };
  }, [cargar]);

  // Mientras alguna esté transcribiendo, refrescar: el backend consulta el job
  // al listar, así que el texto aparece solo en cuanto Transcribe termina.
  const transcribiendo = (llamadas ?? []).some((l) => l.transcriptionStatus === 'processing');
  useEffect(() => {
    if (!transcribiendo) return;
    let vivo = true;
    const t = setInterval(() => cargar(() => vivo), 15000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [transcribiendo, cargar]);

  // Liberar el object URL al cambiar de audio o desmontar.
  useEffect(() => {
    return () => {
      if (audio) URL.revokeObjectURL(audio.url);
    };
  }, [audio]);

  const escuchar = async (l: LlamadaVoz) => {
    setError(null);
    setCargandoAudio(l.id);
    try {
      const blob = await apiService.descargarAudioLlamada(l.id);
      setAudio({ id: l.id, url: URL.createObjectURL(blob) });
    } catch {
      setError('No se pudo cargar la grabación.');
    } finally {
      setCargandoAudio(null);
    }
  };

  if (!llamadas || llamadas.length === 0) return null;

  return (
    <section className="shrink-0 bg-white border-b border-zinc-200 px-6 py-3">
      <div className="flex items-center gap-2 mb-2">
        <Phone className="w-3.5 h-3.5 text-zinc-400" />
        <span className="text-[10.5px] uppercase tracking-[0.1em] text-zinc-400 font-semibold">
          Llamadas del coach · {llamadas.length}
        </span>
      </div>
      <ul className="divide-y divide-zinc-100">
        {llamadas.map((l) => {
          const meta = ESTADO_META[l.estado] ?? { label: l.estado, pill: 'mute' as const };
          const puedeEscuchar = l.recordingEstado === 'lista' && !!l.recordingSid;
          return (
            <li key={l.id} className="py-2 flex items-center gap-3 flex-wrap">
              <MonoAvatar initials={initialsOf(l.coachNombre || l.coachCodigo || '·')} size={26} />
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] text-zinc-800">
                  {l.coachNombre || l.coachCodigo || 'Coach'}
                  <span className="text-zinc-400"> · {fechaHora(l.iniciadaAt)}</span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Pill variant={meta.pill}>{meta.label}</Pill>
                  <span className="text-[11px] text-zinc-500 tabular-nums">
                    {duracion(l.recordingDuracionSeg ?? l.duracionSeg)}
                  </span>
                  {l.estado === 'completada' && l.recordingEstado === 'pendiente' && (
                    <span className="text-[11px] text-zinc-400">grabación en camino…</span>
                  )}
                </div>
              </div>
              {puedeEscuchar && audio?.id !== l.id && (
                <button
                  onClick={() => escuchar(l)}
                  disabled={cargandoAudio === l.id}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {cargandoAudio === l.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Escuchar
                </button>
              )}
              {audio?.id === l.id && (
                <audio src={audio.url} controls autoPlay className="h-8 max-w-[320px]" />
              )}
              {l.transcriptionStatus === 'done' && l.transcriptionText && (
                <button
                  onClick={() => setTextoAbierto(textoAbierto === l.id ? null : l.id)}
                  className="text-[12px] font-medium text-zinc-600 hover:underline"
                >
                  {textoAbierto === l.id ? 'Ocultar transcripción' : 'Transcripción'}
                </button>
              )}
              {l.transcriptionStatus === 'processing' && (
                <span className="text-[11px] text-zinc-400">transcribiendo…</span>
              )}
              {textoAbierto === l.id && l.transcriptionText && (
                <p className="basis-full mt-1 text-[12.5px] leading-relaxed text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2 whitespace-pre-wrap">
                  {l.transcriptionText}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {error && <div className="mt-1 text-[11.5px] text-red-600">{error}</div>}
    </section>
  );
}

export default LlamadasVozPanel;

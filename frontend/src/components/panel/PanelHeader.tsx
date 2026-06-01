import { useState } from 'react';
import { Maximize2, Minimize2, CloudOff, Cloud, Sparkles, Download } from 'lucide-react';
import type { MedicalHistoryFull, SaveStatus } from './types';

// Run 6 — Misma resolución que `api.service.ts`. En prod queda '' (relative,
// same-origin); en dev (vite :5173 → express :3000) usa VITE_API_BASE_URL.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

interface PanelHeaderProps {
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onToggleMaxed: () => void;
  /** Estado agregado de auto-save de los hijos. */
  saveState: SaveStatus;
  /** Título de la sección actual (ej. "Datos Básicos"). */
  sectionTitle: string;
  onRetrySave?: () => void;
  /**
   * Phase 3 — true cuando la transcripción post-llamada terminó y los
   * campos auto-rellenados ya están en el panel. Renderiza un badge verde
   * animado que invita al médico a revisar.
   */
  transcriptionReady?: boolean;
  /** Phase 3 — handler para descartar el badge cuando el médico hace click. */
  onDismissTranscriptionBadge?: () => void;
}

function getInitials(d: MedicalHistoryFull | null): string {
  if (!d) return 'PA';
  const a = (d.primerNombre || '').trim()[0] || '';
  const b = (d.primerApellido || '').trim()[0] || '';
  return (a + b).toUpperCase() || 'PA';
}

function relativeTime(date: Date | null): string {
  if (!date) return '—';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'ahora';
  if (diff < 60) return `hace ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}

/**
 * Header del panel con toggle de maximize, paciente mini y indicador de save.
 */
export function PanelHeader({
  data,
  isMaxed,
  onToggleMaxed,
  saveState,
  sectionTitle,
  onRetrySave,
  transcriptionReady,
  onDismissTranscriptionBadge,
}: PanelHeaderProps) {
  const initials = getInitials(data);
  const fullName = [data?.primerNombre, data?.primerApellido].filter(Boolean).join(' ') || 'Afiliado';

  // Run 6 — Descarga del PDF. `historiaId` viene del response del backend
  // (`MedicalHistoryFull.historiaId` es alias de `_id`). El botón sólo se
  // renderiza cuando exista, así que aquí asumimos string.
  const historiaId = data?.historiaId || data?._id;
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function handleDownloadPdf() {
    if (!historiaId || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      const token = localStorage.getItem('bsl_auth_token');
      const res = await fetch(`${API_BASE_URL}/api/video/medical-history/${historiaId}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        throw new Error(`PDF download failed: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `historia-${historiaId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('PDF error:', e);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const subtitleParts = [
    data?.edad ? `${data.edad} a` : '',
    data?.genero ? data.genero[0]?.toUpperCase() : '',
    data?.numeroId ? `CC ${data.numeroId}` : '',
  ].filter(Boolean);

  const saveLabel = saveState.error
    ? 'Error al guardar — clic para reintentar'
    : saveState.saving
      ? 'Guardando…'
      : saveState.lastSavedAt
        ? `Guardado ${relativeTime(saveState.lastSavedAt)}`
        : 'Sin cambios';

  const pillCls = saveState.error
    ? 'bg-[rgba(239,68,68,0.12)] text-[#ef4444] border-[rgba(239,68,68,0.25)]'
    : saveState.saving
      ? 'bg-[rgba(0,168,132,0.18)] text-[#34d399] border-[rgba(0,168,132,0.4)] animate-pulse'
      : 'bg-[rgba(0,168,132,0.12)] text-[#34d399] border-[rgba(0,168,132,0.25)]';

  return (
    <div className="flex items-center gap-3 px-5 py-3 border-b border-[#324049] sticky top-0 z-20 bg-[#0b141a]">
      <button
        type="button"
        onClick={onToggleMaxed}
        title={isMaxed ? 'Restaurar panel (M)' : 'Maximizar panel (M)'}
        aria-label={isMaxed ? 'Restaurar' : 'Maximizar'}
        className="w-9 h-9 rounded-[10px] bg-[#00a884] text-[#001b14] grid place-items-center flex-shrink-0 hover:bg-[#008f6f] transition shadow-[0_4px_14px_rgba(0,168,132,0.35)]"
      >
        {isMaxed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
      </button>
      <div className="flex flex-col min-w-0">
        <span className="text-[10.5px] font-semibold text-[#6b7882] tracking-widest uppercase">
          Historia clínica · Sección
        </span>
        <span className="text-[15px] font-bold text-[#e9edef] truncate">{sectionTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-3 min-w-0">
        {historiaId && (
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloadingPdf || !historiaId}
            title="Descargar historia clínica en PDF"
            aria-label="Descargar PDF"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(59,130,246,0.45)] bg-[rgba(59,130,246,0.15)] text-[#60a5fa] text-[12px] font-semibold hover:bg-[rgba(59,130,246,0.25)] transition flex-shrink-0 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={13} />
            <span>{downloadingPdf ? 'Generando...' : 'PDF'}</span>
          </button>
        )}

        {transcriptionReady && (
          <button
            type="button"
            role="status"
            aria-live="polite"
            onClick={onDismissTranscriptionBadge}
            title="La transcripción post-llamada llenó campos. Click para revisar y descartar el aviso."
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-[rgba(0,168,132,0.15)] text-[#34d399] border-[rgba(0,168,132,0.45)] text-[12px] font-semibold animate-pulse hover:bg-[rgba(0,168,132,0.25)] transition flex-shrink-0"
          >
            <Sparkles size={13} />
            <span>Transcripción lista · Revisar</span>
          </button>
        )}

        <div className="flex items-center gap-2.5 px-2.5 py-1 rounded-full bg-[#2a3942] min-w-0">
          <span
            className="w-7 h-7 rounded-full grid place-items-center font-bold text-[12px] text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #7a4dff, #3a1d99)' }}
          >
            {initials}
          </span>
          <div className="hidden sm:flex flex-col min-w-0">
            <span className="text-[13px] font-bold text-[#e9edef] truncate" title={fullName}>{fullName}</span>
            <span className="text-[11px] text-[#a4b1b9]">{subtitleParts.join(' · ') || '—'}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => saveState.error && onRetrySave?.()}
          title={saveLabel}
          aria-label={saveLabel}
          className={`w-9 h-9 rounded-[10px] grid place-items-center flex-shrink-0 border transition ${pillCls}`}
        >
          {saveState.error ? <CloudOff size={16} /> : <Cloud size={16} />}
        </button>
      </div>
    </div>
  );
}

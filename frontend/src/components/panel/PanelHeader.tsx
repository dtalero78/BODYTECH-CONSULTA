import { Maximize2, Minimize2, CloudOff, Cloud } from 'lucide-react';
import type { MedicalHistoryFull, SaveStatus } from './types';

interface PanelHeaderProps {
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onToggleMaxed: () => void;
  /** Estado agregado de auto-save de los hijos. */
  saveState: SaveStatus;
  /** Título de la sección actual (ej. "Datos Básicos"). */
  sectionTitle: string;
  onRetrySave?: () => void;
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
}: PanelHeaderProps) {
  const initials = getInitials(data);
  const fullName = [data?.primerNombre, data?.primerApellido].filter(Boolean).join(' ') || 'Paciente';
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

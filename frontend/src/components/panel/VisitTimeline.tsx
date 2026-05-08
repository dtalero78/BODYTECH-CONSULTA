interface VisitDot {
  status: 'done' | 'now' | 'future';
  tip: string;
}

interface VisitTimelineProps {
  dots?: VisitDot[];
}

/**
 * Mini timeline horizontal de las últimas N visitas.
 * Phase 1: datos pueden ser mock; UI funcional.
 */
export function VisitTimeline({ dots }: VisitTimelineProps) {
  const items: VisitDot[] = dots ?? [
    { status: 'done', tip: 'Ingreso' },
    { status: 'done', tip: 'Control' },
    { status: 'done', tip: 'Trimestral' },
    { status: 'now', tip: 'Hoy' },
    { status: 'future', tip: 'Próximo control' },
  ];

  const doneCount = items.filter((d) => d.status === 'done' || d.status === 'now').length;
  const progress = items.length > 1 ? (doneCount - 1) / (items.length - 1) : 0;

  return (
    <div className="flex flex-col gap-1.5 px-3.5 border-l border-[#324049] min-w-[148px]">
      <span className="text-[9.5px] text-[#6b7882] tracking-widest uppercase font-semibold">
        Trayectoria · {items.length} visitas
      </span>
      <div className="flex items-center h-[18px] relative">
        {/* Track base */}
        <div className="absolute left-1.5 right-1.5 top-1/2 h-[2px] bg-[#324049] rounded-[2px] -translate-y-1/2" />
        {/* Track progreso */}
        <div
          className="absolute left-1.5 top-1/2 h-[2px] -translate-y-1/2 rounded-[2px] shadow-[0_0_8px_rgba(0,168,132,0.45)]"
          style={{
            width: `calc(${Math.max(0, Math.min(1, progress)) * 100}% - 12px)`,
            background: 'linear-gradient(90deg, #008f6f, #00a884)',
          }}
        />
        {/* Dots */}
        <div className="flex items-center justify-between w-full relative z-10">
          {items.map((d, idx) => {
            const cls =
              d.status === 'now'
                ? 'bg-[#00a884] border-[#00a884] shadow-[0_0_0_4px_rgba(0,168,132,0.18)] animate-pulse'
                : d.status === 'done'
                  ? 'bg-[#00a884] border-[#00a884]'
                  : 'bg-[#2a3942] border-[#324049] border-dashed';
            return (
              <button
                key={idx}
                type="button"
                title={d.tip}
                aria-label={d.tip}
                className={`relative w-[11px] h-[11px] rounded-full border-2 ${cls} hover:scale-[1.35] transition-transform`}
              >
                {/* hit area expandida */}
                <span className="absolute -inset-2 rounded-full" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

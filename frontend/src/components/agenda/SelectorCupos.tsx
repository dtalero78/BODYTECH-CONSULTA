import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

// Selector de día + hora que ve el afiliado desde el WhatsApp. Lo usan
// /reprogramar (Trepsi y demás) y /agendar (afiliado nuevo de la UMV).

const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const MESES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// Mediodía UTC para obtener el día de la semana correcto sin TZ.
function isoToDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12, 0, 0));
}

function chip(iso: string): { dow: string; dnum: string; mon: string } {
  const dt = isoToDate(iso);
  const d = iso.slice(8, 10);
  const mo = Number(iso.slice(5, 7));
  if (!dt) return { dow: iso, dnum: d, mon: '' };
  return { dow: DIAS_CORTO[dt.getUTCDay()], dnum: String(Number(d)), mon: MESES_CORTO[mo - 1] };
}

export function fechaLarga(iso: string): string {
  const dt = isoToDate(iso);
  if (!dt) return iso;
  const d = Number(iso.slice(8, 10));
  const mo = Number(iso.slice(5, 7));
  return `${DIAS_LARGO[dt.getUTCDay()]} ${d} de ${MESES_LARGO[mo - 1]}`;
}

export interface DiaCupos {
  fecha: string;
  horarios: string[];
}

export function SelectorCupos({
  dias,
  accent,
  submitting,
  onElegir,
}: {
  dias: DiaCupos[];
  accent: string;
  /** Hora que se está enviando; mientras haya una, los botones se bloquean. */
  submitting: string | null;
  onElegir: (fecha: string, hora: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(dias[0]?.fecha ?? null);

  // Si la lista cambia (se recargó tras un cupo tomado) y el día ya no está, se
  // vuelve al primero.
  useEffect(() => {
    if (!dias.some((d) => d.fecha === selectedDay)) setSelectedDay(dias[0]?.fecha ?? null);
  }, [dias, selectedDay]);

  const diaSel = dias.find((d) => d.fecha === selectedDay) ?? null;

  return (
    <>
      {/* Selector de día */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Día</p>
      <div className="flex gap-2 overflow-x-auto pb-2 mb-5 -mx-1 px-1">
        {dias.map((d) => {
          const c = chip(d.fecha);
          const active = d.fecha === selectedDay;
          return (
            <button
              key={d.fecha}
              onClick={() => setSelectedDay(d.fecha)}
              className="shrink-0 flex flex-col items-center justify-center w-16 h-16 rounded-md border text-sm transition-colors"
              style={
                active
                  ? { background: accent, borderColor: accent, color: '#fff' }
                  : { background: '#fff', borderColor: '#e4e4e7', color: '#3f3f46' }
              }
            >
              <span className="text-[11px] leading-none mb-0.5 opacity-80">{c.dow}</span>
              <span className="text-lg font-semibold leading-none">{c.dnum}</span>
              <span className="text-[10px] leading-none mt-0.5 opacity-80">{c.mon}</span>
            </button>
          );
        })}
      </div>

      {/* Selector de hora */}
      {diaSel && (
        <>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Hora · {fechaLarga(diaSel.fecha)}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {diaSel.horarios.map((h) => {
              const busy = submitting === h;
              return (
                <button
                  key={h}
                  onClick={() => onElegir(diaSel.fecha, h)}
                  disabled={submitting !== null}
                  className="inline-flex items-center justify-center gap-1.5 h-11 rounded-md text-[14px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin text-zinc-500" /> : h}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

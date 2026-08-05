import { useCorporativoAnterior } from '../hooks/useCorporativoAnterior';
import type { MedicalHistoryFull } from '../types';

/**
 * Fila "Comparación" del examen ocupacional: delta de la composición corporal
 * contra la visita corporativa anterior del mismo paciente.
 *
 * En la plantilla de Excel esto se resolvía contra la hoja Consolidado (fila
 * 34 vs fila 78). Los signos de la plantilla son inconsistentes entre métricas
 * (unas calculan `anterior − actual` y otras `actual − anterior`, y algunas
 * dividen entre 100), así que aquí se normaliza a `actual − anterior` y el
 * color indica si el cambio es favorable, igual que el panel de consulta.
 */

type Direction = 'down-good' | 'up-good' | 'neutral';

interface Metric {
  label: string;
  unit?: string;
  actual: number | null;
  anterior: number | null;
  direction: Direction;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return isNaN(n) ? null : n;
}

function DeltaPill({ actual, anterior, direction }: Omit<Metric, 'label' | 'unit'>) {
  if (actual === null || anterior === null) {
    return (
      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[12px] font-bold tracking-wider bg-[#1a2530] border border-[#324049] text-[#6b7882]">
        —
      </span>
    );
  }
  const delta = Math.round((actual - anterior) * 10) / 10;
  if (Math.abs(delta) < 0.05) {
    return (
      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[12px] font-bold tracking-wider bg-[#1a2530] border border-[#324049] text-[#a4b1b9]">
        0.0 IGUAL
      </span>
    );
  }
  const text = `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)}`;
  if (direction === 'neutral') {
    return (
      <span className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[12px] font-bold tracking-wider bg-[#1a2530] border border-[#324049] text-[#a4b1b9]">
        {text}
      </span>
    );
  }
  const isGood =
    (direction === 'down-good' && delta < 0) || (direction === 'up-good' && delta > 0);
  const cls = isGood
    ? 'bg-[rgba(52,211,153,0.12)] border-[rgba(52,211,153,0.35)] text-[#34d399]'
    : 'bg-[rgba(239,68,68,0.12)] border-[rgba(239,68,68,0.35)] text-[#ef4444]';
  return (
    <span
      className={`inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-[12px] font-bold tracking-wider border ${cls}`}
    >
      {text}
    </span>
  );
}

export function ComparacionAnterior({
  historiaId,
  data,
  imcActual,
}: {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  /** IMC calculado en vivo (aún puede no estar persistido). */
  imcActual: number | null;
}) {
  const { anterior, loading } = useCorporativoAnterior(historiaId);

  if (loading) {
    return (
      <div className="pt-4 border-t border-dashed border-[#324049] text-[12px] text-[#6b7882]">
        Buscando visita anterior…
      </div>
    );
  }

  if (!anterior) {
    return (
      <div className="pt-4 border-t border-dashed border-[#324049] text-[12px] text-[#6b7882] italic">
        Primera valoración corporativa del afiliado — no hay visita anterior con la cual comparar.
      </div>
    );
  }

  const metrics: Metric[] = [
    {
      label: 'Peso',
      unit: 'kg',
      actual: toNum(data?.mcPeso),
      anterior: anterior.mcPeso,
      direction: 'neutral',
    },
    {
      label: '% Grasa',
      actual: toNum(data?.mcPctGrasa),
      anterior: anterior.mcPctGrasa,
      direction: 'down-good',
    },
    {
      label: '% Músculo',
      actual: toNum(data?.mcPctMusculo),
      anterior: anterior.mcPctMusculo,
      direction: 'up-good',
    },
    {
      label: 'Grasa visceral',
      actual: toNum(data?.mcGrasaVisceral),
      anterior: anterior.mcGrasaVisceral,
      direction: 'down-good',
    },
    {
      label: 'IMC',
      actual: imcActual,
      anterior: anterior.mcImc,
      direction: 'neutral',
    },
  ];

  const fecha = anterior.fecha ? new Date(anterior.fecha) : null;
  const fechaTxt =
    fecha && !isNaN(fecha.getTime())
      ? fecha.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;

  return (
    <div className="pt-4 border-t border-dashed border-[#324049]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[11px] font-semibold text-[#6b7882] tracking-widest uppercase">
          Comparación con visita anterior
        </div>
        {fechaTxt && <div className="text-[11px] text-[#6b7882]">{fechaTxt}</div>}
      </div>

      <div className="grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-3 pb-2 border-b border-[#324049] mb-2">
        {['Medida', 'Anterior', 'Actual', 'Δ'].map((h) => (
          <div
            key={h}
            className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase"
          >
            {h}
          </div>
        ))}
      </div>

      {metrics.map((m) => (
        <div
          key={m.label}
          className="grid grid-cols-[1.3fr_1fr_1fr_1fr] gap-3 items-center py-2 border-b border-dashed border-[#324049] last:border-b-0"
        >
          <div className="text-[13px] text-[#e9edef] font-medium">
            {m.label}
            {m.unit && <span className="text-[#6b7882] text-[11px] ml-1">({m.unit})</span>}
          </div>
          <div className="text-[13px] text-[#a4b1b9]">{m.anterior ?? '—'}</div>
          <div className="text-[13px] text-[#e9edef]">{m.actual ?? '—'}</div>
          <DeltaPill actual={m.actual} anterior={m.anterior} direction={m.direction} />
        </div>
      ))}
    </div>
  );
}

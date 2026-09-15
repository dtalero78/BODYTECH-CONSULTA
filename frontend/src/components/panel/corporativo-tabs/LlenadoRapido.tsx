import { Check, Loader2 } from 'lucide-react';
import { useLlenarVarios } from './llenado';

/**
 * Botón de llenado rápido ("Niega todos", "Todo normal"). Ver `llenado.ts`.
 *
 * Desaparece cuando ya no queda nada vacío que llenar. Va dentro de un Card
 * (que abre su modal al hacer clic), así que corta la propagación: tocar el
 * botón no debe abrir la ventana.
 */
export function AccionRapida({
  label,
  titulo,
  valores,
  historiaId,
  onPatchLocal,
}: {
  label: string;
  /** Tooltip: qué hace exactamente el botón. */
  titulo: string;
  /** Solo los campos vacíos (ver `soloVacios`). */
  valores: Record<string, unknown>;
  historiaId: string | undefined;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  const { llenar, guardando, error } = useLlenarVarios(historiaId, onPatchLocal);
  if (Object.keys(valores).length === 0) return null;

  return (
    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        disabled={guardando}
        onClick={() => void llenar(valores)}
        title={titulo}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border border-[rgba(var(--p-accent-rgb),0.35)] text-[var(--p-accent)] bg-[rgba(var(--p-accent-rgb),0.08)] hover:bg-[rgba(var(--p-accent-rgb),0.16)] transition disabled:opacity-60"
      >
        {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        {label}
      </button>
      {error && <div className="mt-1.5 text-[11.5px] text-[var(--p-danger)]">{error}</div>}
    </div>
  );
}

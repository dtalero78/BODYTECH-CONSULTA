import { Eye } from 'lucide-react';

interface Props {
  isMaxed: boolean;
}

/**
 * Pill que confirma al doctor que el paciente sigue accesible.
 * Verde cuando el panel NO está maximizado (paciente visible al lado).
 * Amarillo cuando está maximizado (paciente en la miniatura flotante).
 */
export function EyeOnPatientPill({ isMaxed }: Props) {
  const cls = isMaxed
    ? 'bg-[rgba(var(--p-warn-rgb),0.10)] border-[rgba(var(--p-warn-rgb),0.32)] text-[var(--p-warn)]'
    : 'bg-[rgba(var(--p-accent-rgb),0.10)] border-[rgba(var(--p-accent-rgb),0.32)] text-[var(--p-ok)]';
  const dotCls = isMaxed ? 'bg-[var(--p-warn)]' : 'bg-[var(--p-ok)]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10.5px] font-bold uppercase tracking-wider border flex-shrink-0 ${cls}`}
      title={isMaxed ? 'Afiliado en miniatura' : 'Afiliado visible'}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls} animate-pulse`} />
      <Eye size={11} />
      <span>{isMaxed ? 'En miniatura' : 'Visible'}</span>
    </span>
  );
}

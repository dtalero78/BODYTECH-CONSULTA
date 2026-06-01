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
    ? 'bg-[rgba(251,191,36,0.10)] border-[rgba(251,191,36,0.32)] text-[#fbbf24]'
    : 'bg-[rgba(0,168,132,0.10)] border-[rgba(0,168,132,0.32)] text-[#34d399]';
  const dotCls = isMaxed ? 'bg-[#fbbf24]' : 'bg-[#34d399]';
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

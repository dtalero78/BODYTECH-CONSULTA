import type { MedicalHistoryFull } from './types';
import { VisitTimeline } from './VisitTimeline';
import { edadEfectiva } from './edad';

interface PatientStripProps {
  data: MedicalHistoryFull | null;
}

function getInitials(d: MedicalHistoryFull | null): string {
  if (!d) return 'PA';
  const a = (d.primerNombre || '').trim()[0] || '';
  const b = (d.primerApellido || '').trim()[0] || '';
  return (a + b).toUpperCase() || 'PA';
}

function formatAge(age?: number | null): string {
  if (!age && age !== 0) return '— años';
  return `${age} años`;
}

function formatGenero(g?: string): string {
  if (!g) return '—';
  const v = g.toUpperCase();
  if (v.startsWith('F')) return 'Femenino';
  if (v.startsWith('M')) return 'Masculino';
  return g;
}

/**
 * Strip sticky con datos del paciente: avatar, nombre, edad, género, IMC, EPS, etc.
 */
export function PatientStrip({ data }: PatientStripProps) {
  const initials = getInitials(data);
  const fullName = [data?.primerNombre, data?.primerApellido].filter(Boolean).join(' ') || 'Afiliado';
  const subtitleParts = [
    // `edadEfectiva` y no `data.edad`: si el médico corrige la fecha de
    // nacimiento, el strip tiene que moverse con ella. Antes mostraba la edad
    // congelada de la ficha del afiliado y quedaba contradiciendo al campo Edad
    // de Identificación, que sí se recalcula.
    formatAge(edadEfectiva(data)),
    formatGenero(data?.genero),
    data?.grupoSanguineo,
    data?.numeroId ? `CC ${data.numeroId}` : '',
    data?.ciudad,
  ].filter(Boolean);

  const peso = data?.peso ? Number(data.peso) : null;
  const tallaCm = data?.talla ? Number(data.talla) : null;
  const tallaM = tallaCm && tallaCm > 3 ? tallaCm / 100 : tallaCm;
  const imc = peso && tallaM ? peso / (tallaM * tallaM) : null;

  // Sin borde. La sombra `0,0,0,0.25` venía del tema oscuro y sobre superficie
  // clara se leía como un contorno duro; acá basta una elevación suave, que
  // igual hace falta porque el strip es sticky y el contenido le pasa por debajo.
  return (
    <div className="sticky top-0 z-[5] mx-5 mt-4 p-4 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.05),0_8px_24px_rgba(0,0,0,0.05)] grid grid-cols-[auto,1fr,auto] md:grid-cols-[auto,1fr,auto,auto,auto] gap-4 items-center"
      style={{ background: 'linear-gradient(135deg, var(--p-surface) 0%, var(--p-surface-6) 100%)' }}>
      <div className="w-[46px] h-[46px] rounded-[14px] grid place-items-center font-extrabold text-[15px] text-white"
        style={{ background: 'linear-gradient(135deg, var(--p-violet), var(--p-violet-2))' }}>
        {initials}
      </div>
      <div className="flex flex-col min-w-0">
        <div className="text-[16px] font-bold text-[var(--p-text)] truncate">{fullName}</div>
        <div className="text-[11.5px] text-[var(--p-text-2)] mt-0.5 truncate">
          {subtitleParts.join(' · ') || 'Sin información'}
        </div>
      </div>
      <VisitTimeline />
      <div className="hidden md:flex flex-col gap-0.5 px-3.5 border-l border-[var(--p-line)]">
        <span className="text-[9.5px] text-[var(--p-text-3)] tracking-widest uppercase font-semibold">EPS</span>
        <span className="text-[13px] font-semibold text-[var(--p-text)]">{data?.eps || '—'}</span>
      </div>
      <div className="hidden md:flex flex-col gap-0.5 px-3.5 border-l border-[var(--p-line)]">
        <span className="text-[9.5px] text-[var(--p-text-3)] tracking-widest uppercase font-semibold">IMC</span>
        <span className="text-[13px] font-semibold text-[var(--p-text)]">
          {imc ? imc.toFixed(1) : '—'}
        </span>
      </div>
    </div>
  );
}

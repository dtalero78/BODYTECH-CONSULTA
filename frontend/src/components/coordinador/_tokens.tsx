// ============================================================================
// Tokens visuales compartidos del Panel Coordinador (lenguaje editorial zinc/Inter).
//
// Se mantienen como constantes string para que Tailwind las recolecte vía content
// scan (el class scanner soporta valores estáticos en archivos .tsx).
// ============================================================================

import React from 'react';

export const TOKENS = {
  accent: '#1f3a8a',
  accentSoft: '#eef2ff',
  accentHover: '#1e3a8a',
  surface: '#fafaf9',
  panel: '#fcfcfb',
  line: '#e4e4e7',
  todayBg: '#f8fafc',
};

// Familia tipográfica del Panel Coordinador. Inter sobrescribe Figtree.
// Stack solo sans, sin fallback editorial (la app es clínica; constraint del autor).
export const FONT_INTER = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const FONT_MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

// Clases reutilizables
export const SECTION_LABEL =
  'text-[10.5px] uppercase tracking-[0.1em] text-zinc-400 font-semibold';

export const PILL_BASE =
  'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium border';

export const PILLS = {
  ok: 'bg-green-50 text-green-800 border-green-100',
  warn: 'bg-amber-50 text-amber-800 border-amber-100',
  bad: 'bg-red-50 text-red-800 border-red-100',
  mute: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  now: 'bg-blue-50 text-blue-800 border-blue-100',
  resched: 'bg-orange-50 text-orange-800 border-orange-100',
};

// Botón primario (CTA azul ink) y secundario outline
export const CTA_PRIMARY =
  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-white transition-colors';

export const CTA_OUTLINE =
  'inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors';

// Icon-button (acciones en tabla)
export const ICON_BUTTON =
  'p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors';

// ----------------------------------------------------------------------------
// MonoAvatar — círculo con iniciales (Inter, sin tipografía editorial)
// ----------------------------------------------------------------------------

export function MonoAvatar({
  initials,
  variant = 'default',
  size = 32,
}: {
  initials: string;
  variant?: 'default' | 'accent' | 'muted';
  size?: number;
}) {
  const bgClass =
    variant === 'accent'
      ? 'bg-[#eef2ff] text-[#1e3a8a]'
      : variant === 'muted'
        ? 'bg-zinc-100 text-zinc-400'
        : 'bg-zinc-100 text-zinc-700';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-medium tracking-tight shrink-0 ${bgClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        fontFamily: FONT_INTER,
        boxShadow: 'inset 0 0 0 1px rgba(24,24,27,0.06)',
      }}
    >
      {initials}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Pill (badge de estado)
// ----------------------------------------------------------------------------

export function Pill({
  variant,
  children,
  withDot = true,
}: {
  variant: keyof typeof PILLS;
  children: React.ReactNode;
  withDot?: boolean;
}) {
  const dotColor: Record<keyof typeof PILLS, string> = {
    ok: 'bg-green-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
    mute: 'bg-zinc-400',
    now: 'bg-blue-500',
    resched: 'bg-orange-500',
  };
  return (
    <span className={`${PILL_BASE} ${PILLS[variant]}`}>
      {withDot && <span className={`w-1.5 h-1.5 rounded-full ${dotColor[variant]}`} />}
      {children}
    </span>
  );
}

// ----------------------------------------------------------------------------
// FilterChip wrapper para <select> con ChevronDown overlay
// ----------------------------------------------------------------------------

export function FilterChip({
  label,
  active = false,
  children,
}: {
  label?: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  const baseCls =
    'relative h-[30px] inline-flex items-center bg-white border rounded-md text-[12.5px] font-medium';
  const stateCls = active
    ? 'border-[#1f3a8a] bg-[#eef2ff] text-[#1e3a8a]'
    : 'border-zinc-300 text-zinc-800';
  return (
    <div className={`${baseCls} ${stateCls}`} style={{ fontFamily: FONT_INTER }}>
      {label && (
        <span className="pl-[11px] text-zinc-500 font-normal pr-1">{label}:</span>
      )}
      <span className={label ? '' : 'pl-[11px]'}>{children}</span>
    </div>
  );
}

// Calcular iniciales a partir de un nombre. Devuelve 2 letras.
export function initialsOf(...parts: Array<string | null | undefined>): string {
  const cleaned = parts.filter(Boolean).map((p) => String(p).trim()).filter((s) => s.length > 0);
  if (cleaned.length === 0) return '··';
  if (cleaned.length === 1) {
    const s = cleaned[0];
    return (s.slice(0, 2).toUpperCase());
  }
  return (cleaned[0][0] + cleaned[1][0]).toUpperCase();
}

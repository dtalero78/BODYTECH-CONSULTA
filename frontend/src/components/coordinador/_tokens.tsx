// ============================================================================
// Tokens visuales compartidos del Panel Coordinador (lenguaje editorial zinc/Inter).
//
// Se mantienen como constantes string para que Tailwind las recolecte vía content
// scan (el class scanner soporta valores estáticos en archivos .tsx).
// ============================================================================

import React, { useState } from 'react';

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
  src,
}: {
  initials: string;
  variant?: 'default' | 'accent' | 'muted';
  size?: number;
  /** Si se provee y carga bien, muestra la foto; si falla, cae a iniciales. */
  src?: string | null;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const bgClass =
    variant === 'accent'
      ? 'bg-[#eef2ff] text-[#1e3a8a]'
      : variant === 'muted'
        ? 'bg-zinc-100 text-zinc-400'
        : 'bg-zinc-100 text-zinc-700';
  const showImg = !!src && !imgFailed;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-medium tracking-tight shrink-0 overflow-hidden ${showImg ? 'bg-zinc-100' : bgClass}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        fontFamily: FONT_INTER,
        boxShadow: 'inset 0 0 0 1px rgba(24,24,27,0.06)',
      }}
    >
      {showImg ? (
        <img
          src={src!}
          alt={initials}
          loading="lazy"
          onError={() => setImgFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        initials
      )}
    </span>
  );
}

// ----------------------------------------------------------------------------
// Pool de fotos placeholder (Spaces lgs-bucket, públicas). Provisional: hasta
// que `profesionales` tenga su propio campo de foto, se asigna una de estas de
// forma estable por código de profesional (mismo código → misma foto).
// ----------------------------------------------------------------------------

const AVATAR_FOTO_POOL = [
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/05e29a1f-2400-4299-82a2-85abafa81ffa/foto-1773764710640.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/0661b06f-466c-4bc3-98b5-f18eb18247a6/foto-1774478122754.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/07a9a7de-4075-48cb-977b-6b7aee7d495d/foto-1775155047586.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/0c235cfc-51a5-4fff-858f-dc5f26ede4f4/foto-1773676338287.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/10673e28-c96b-47f3-9154-38f8c4c7ea4f/foto-1774537784310.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/1fd95802-08f2-49c2-947c-77ba74b4f75f/foto-1773243715258.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/22d5660e-1141-405c-88fb-18238cec3971/foto-1773181317550.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/2332abec-22bb-404a-80ba-e48ef1281a5b/foto-1774463711751.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/2c0791c9-efb6-46cf-a57f-bcf43e0b04d3/foto-1773175081525.jpeg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/3816359e-802c-4ef9-82b1-228d1153c9c6/foto-1773345618709.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/3e60d7b9-4ce5-40ad-91e4-59e829a02e29/foto-1773254155749.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/42ab4118-18c0-4e44-9cba-8668823bb8d6/foto-1773513346283.jpg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/9f803ce7-80e1-49d2-92f8-36c529060930/foto-1773177048045.jpeg',
  'https://lgs-bucket.sfo3.digitaloceanspaces.com/fotos/0157417f-3c48-4f0e-b1a5-664f8c0d2f6b/foto-1773257629204.png',
];

/** Devuelve una foto del pool de forma estable a partir de una clave (código). */
export function avatarFotoFor(key: string | null | undefined): string | null {
  if (!key) return null;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return AVATAR_FOTO_POOL[Math.abs(h) % AVATAR_FOTO_POOL.length];
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

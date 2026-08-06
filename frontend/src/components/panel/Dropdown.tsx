import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  value: string | undefined;
  options: ReadonlyArray<DropdownOption>;
  onChange: (value: string) => void;
  /** Habilita búsqueda interna. Default true. */
  searchable?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * Searchable dropdown con keyboard navigation real (↑↓ Enter Esc).
 * Animación scaleY al abrir.
 */
export function Dropdown({
  value,
  options,
  onChange,
  searchable = true,
  placeholder = 'Seleccionar...',
  disabled = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  // Posicionar como fixed al abrir para escapar overflow:hidden del modal
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 6,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    });
  }, [open]);

  // Cerrar al click fuera — verifica tanto el trigger como el portal
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = wrapRef.current?.contains(target);
      const inList = listRef.current?.contains(target);
      if (!inTrigger && !inList) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      // pequeño delay para que el input ya esté en DOM
      setTimeout(() => searchRef.current?.focus(), 60);
    }
  }, [open, searchable]);

  useEffect(() => {
    setActiveIndex(filtered.length > 0 ? 0 : -1);
  }, [filtered.length, query]);

  const selected = options.find((o) => o.value === value);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const opt = filtered[activeIndex];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
        setQuery('');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={`w-full bg-[var(--p-input)] border border-[var(--p-line)] text-[var(--p-text)] px-3.5 py-2.5 rounded-xl text-[13.5px] flex items-center justify-between cursor-pointer outline-none transition disabled:opacity-50 disabled:cursor-not-allowed ${
          open ? 'border-[var(--p-accent)] bg-[var(--p-input-2)]' : ''
        }`}
      >
        <span className={selected ? '' : 'text-[var(--p-text-3)]'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && createPortal(
        <div
          ref={listRef}
          // `panel-theme` va acá porque el menú se portalea a `document.body`,
          // fuera del árbol del panel: sin la clase no heredaría las `--p-*` y
          // los colores quedarían sin resolver.
          className="panel-theme bg-[var(--p-surface-5)] border border-[var(--p-accent)] rounded-2xl shadow-2xl overflow-hidden"
          style={{
            ...dropdownStyle,
            transformOrigin: 'top center',
            animation: 'panelScaleY 180ms ease-out',
          }}
          onKeyDown={handleKey}
        >
          {searchable && (
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--p-line)] bg-[var(--p-surface-4)]">
              <Search size={14} className="text-[var(--p-text-3)]" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="flex-1 bg-transparent border-none outline-none text-[13px] text-[var(--p-text)] placeholder:text-[var(--p-text-3)]"
                placeholder="Buscar..."
              />
            </div>
          )}
          <ul className="max-h-[230px] overflow-y-auto p-1.5 list-none m-0">
            {filtered.length === 0 ? (
              <li className="px-4 py-4 text-center text-xs text-[var(--p-text-3)]">Sin resultados</li>
            ) : (
              filtered.map((opt, idx) => (
                <li
                  key={opt.value}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                    setQuery('');
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-[9px] text-[13px] cursor-pointer ${
                    activeIndex === idx ? 'bg-[var(--p-input)]' : ''
                  } ${value === opt.value ? 'text-[var(--p-accent)] bg-[rgba(var(--p-accent-rgb),0.12)] font-semibold' : 'text-[var(--p-text)]'}`}
                >
                  <span>{opt.label}</span>
                </li>
              ))
            )}
          </ul>
          <div className="px-3 py-2 border-t border-[var(--p-line)] bg-[var(--p-surface-4)] flex justify-between text-[10.5px] text-[var(--p-text-3)]">
            <span>↑↓ navegar</span>
            <span>Enter seleccionar · Esc cerrar</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Loader2 } from 'lucide-react';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';
import type { Cie10Entry } from './cie10-catalogo';

interface Cie10FieldProps {
  historiaId: string | undefined;
  field: string;
  /** Códigos separados por coma, tal como viven en la columna. */
  initialValue?: string | null;
  onSaved?: (field: string, value: unknown) => void;
  label?: string;
}

/** Máximo de resultados que se pintan por búsqueda: más de esto ya no se lee. */
const MAX_RESULTADOS = 30;

/**
 * Sin tildes ni diéresis, en mayúsculas, para comparar. El catálogo viene sin
 * acentos ("Ciatica", "Radiculopatia") pero el equipo médico escribe con ellos
 * ("ciática"): sin esto la búsqueda por nombre fallaba justo en las palabras más
 * comunes. Se aplica a las dos puntas, así también aguanta un catálogo que
 * algún día venga acentuado.
 */
function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function parse(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter((c, i, arr) => c !== '' && arr.indexOf(c) === i);
}

/**
 * Buscador CIE-10 con selección múltiple.
 *
 * Escribís y va filtrando por código (prefijo: "M54") o por nombre (subcadena:
 * "lumbal"); cada elección se suma como chip y el buscador se queda abierto para
 * seguir agregando. Guarda los códigos separados por coma en la columna, con el
 * mismo auto-guardado que cualquier otro campo del panel.
 *
 * No extiende `Dropdown`: ese es single-select, cierra al elegir y busca sólo por
 * etiqueta, y lo usan ~30 SelectFields de los dos paneles. Retorcerlo para este
 * caso era más riesgo que escribir uno propio. Sí copia su truco del portal a
 * `document.body` con `position: fixed`, que es lo que le permite salirse del
 * `overflow: hidden` del modal.
 *
 * El catálogo (~4.800 códigos, ~300 KB) se carga con `import()` dinámico la
 * primera vez que el campo se enfoca: el panel entero no debe pagar ese peso
 * por un modal que a veces ni se abre.
 */
export function Cie10Field({ historiaId, field, initialValue, onSaved, label = 'CIE-10' }: Cie10FieldProps) {
  const [codigos, setCodigos] = useState<string[]>(() => parse(initialValue));
  const [catalogo, setCatalogo] = useState<ReadonlyArray<Cie10Entry> | null>(null);
  const [cargando, setCargando] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [listStyle, setListStyle] = useState<React.CSSProperties>({});
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Re-sync si cambia desde fuera (refetch), igual que TextField.
  useEffect(() => {
    setCodigos(parse(initialValue));
  }, [initialValue]);

  useFieldAutoSave({
    historiaId,
    field,
    value: codigos.length === 0 ? null : codigos.join(','),
    onSaved,
  });

  // Carga diferida del catálogo, una sola vez.
  async function asegurarCatalogo() {
    if (catalogo || cargando) return;
    setCargando(true);
    try {
      const mod = await import('./cie10-catalogo');
      setCatalogo(mod.CIE10);
    } finally {
      setCargando(false);
    }
  }

  // Índice por código para pintar el nombre en los chips.
  const porCodigo = useMemo(() => {
    const m = new Map<string, string>();
    catalogo?.forEach((e) => m.set(e.codigo, e.nombre));
    return m;
  }, [catalogo]);

  const resultados = useMemo(() => {
    if (!catalogo) return [];
    const q = normalizar(query.trim());
    if (q.length < 2) return [];
    const esCodigo = /^[A-Z]\d{0,3}$/.test(q);
    const ya = new Set(codigos);
    const out: Cie10Entry[] = [];
    for (const e of catalogo) {
      if (ya.has(e.codigo)) continue;
      const hit = esCodigo ? e.codigo.startsWith(q) : normalizar(e.nombre).includes(q) || e.codigo.startsWith(q);
      if (hit) {
        out.push(e);
        if (out.length >= MAX_RESULTADOS) break;
      }
    }
    return out;
  }, [catalogo, query, codigos]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Posición fija bajo el input, para escapar del overflow del modal.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    setListStyle({ position: 'fixed', top: r.bottom + 6, left: r.left, width: r.width, zIndex: 9999 });
  }, [open, codigos.length]);

  // Cerrar al click fuera (trigger o lista).
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!wrapRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  function agregar(c: string) {
    setCodigos((prev) => (prev.includes(c) ? prev : [...prev, c]));
    setQuery('');
    inputRef.current?.focus();
    // Se queda abierto a propósito: lo normal es cargar varios seguidos.
  }

  function quitar(c: string) {
    setCodigos((prev) => prev.filter((x) => x !== c));
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(resultados.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = resultados[activeIndex];
      if (r) agregar(r.codigo);
    } else if (e.key === 'Backspace' && query === '' && codigos.length > 0) {
      // Backspace sobre el input vacío quita el último chip, como en cualquier tag-input.
      quitar(codigos[codigos.length - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  }

  const mostrarLista = open && (cargando || query.trim().length >= 2);

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="text-[10.5px] font-semibold text-[var(--p-text-2)] tracking-widest uppercase">
          {label}
          {codigos.length > 0 && (
            <span className="ml-1.5 normal-case tracking-normal font-medium text-[var(--p-text-3)]">
              · {codigos.length} {codigos.length === 1 ? 'diagnóstico' : 'diagnósticos'}
            </span>
          )}
        </label>
      )}

      <div
        ref={wrapRef}
        onClick={() => inputRef.current?.focus()}
        className={`w-full min-h-[44px] bg-[var(--p-input)] border rounded-xl px-2.5 py-1.5 flex flex-wrap items-center gap-1.5 cursor-text transition ${
          open ? 'border-[var(--p-accent)] bg-[var(--p-input-2)]' : 'border-[var(--p-line)]'
        }`}
      >
        {codigos.map((c) => (
          <span
            key={c}
            title={porCodigo.get(c) ?? c}
            className="inline-flex items-center gap-1 max-w-full pl-2 pr-1 py-1 rounded-lg text-[12px] bg-[rgba(var(--p-accent-rgb),0.10)] text-[var(--p-accent)] border border-[rgba(var(--p-accent-rgb),0.25)]"
          >
            <span className="font-mono font-bold">{c}</span>
            {porCodigo.get(c) && (
              <span className="truncate max-w-[220px] text-[var(--p-text-2)]">{porCodigo.get(c)}</span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                quitar(c);
              }}
              aria-label={`Quitar ${c}`}
              className="ml-0.5 rounded p-0.5 text-[var(--p-text-3)] hover:text-[var(--p-danger)] hover:bg-[rgba(var(--p-danger-rgb),0.10)]"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <div className="flex items-center gap-1.5 flex-1 min-w-[160px]">
          <Search size={13} className="text-[var(--p-text-3)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setOpen(true);
              void asegurarCatalogo();
            }}
            onKeyDown={onKey}
            placeholder={codigos.length === 0 ? 'Escribe código o nombre: M54, lumbalgia…' : 'Agregar otro…'}
            className="flex-1 min-w-0 bg-transparent border-none outline-none text-[13.5px] text-[var(--p-text)] placeholder:text-[var(--p-text-3)] py-1"
          />
        </div>
      </div>

      {mostrarLista &&
        createPortal(
          <div
            ref={listRef}
            className="panel-theme bg-[var(--p-surface-5)] border border-[var(--p-accent)] rounded-2xl shadow-2xl overflow-hidden"
            style={{ ...listStyle, transformOrigin: 'top center', animation: 'panelScaleY 180ms ease-out' }}
          >
            <ul className="max-h-[260px] overflow-y-auto p-1.5 list-none m-0">
              {cargando ? (
                <li className="px-4 py-4 flex items-center justify-center gap-2 text-xs text-[var(--p-text-3)]">
                  <Loader2 size={14} className="animate-spin" /> Cargando catálogo…
                </li>
              ) : resultados.length === 0 ? (
                <li className="px-4 py-4 text-center text-xs text-[var(--p-text-3)]">Sin resultados para «{query.trim()}»</li>
              ) : (
                resultados.map((r, idx) => (
                  <li
                    key={r.codigo}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onMouseDown={(e) => e.preventDefault() /* no robar el foco del input */}
                    onClick={() => agregar(r.codigo)}
                    className={`flex items-baseline gap-2.5 px-3 py-2 rounded-[9px] text-[13px] cursor-pointer text-[var(--p-text)] ${
                      activeIndex === idx ? 'bg-[var(--p-input)]' : ''
                    }`}
                  >
                    <span className="font-mono font-bold text-[var(--p-accent)] shrink-0 w-[46px]">{r.codigo}</span>
                    <span className="truncate">{r.nombre}</span>
                  </li>
                ))
              )}
            </ul>
            <div className="px-3 py-2 border-t border-[var(--p-line)] bg-[var(--p-surface-4)] flex justify-between text-[10.5px] text-[var(--p-text-3)]">
              <span>↑↓ navegar · Enter agregar</span>
              <span>{resultados.length >= MAX_RESULTADOS ? `primeros ${MAX_RESULTADOS} — afiná la búsqueda` : 'Esc cerrar'}</span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

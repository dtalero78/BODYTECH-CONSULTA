import type { ReactNode } from 'react';
import type { TabId } from './types';

export interface TabDef<T extends string = TabId> {
  id: T;
  label: string;
  /** Cantidad de campos diligenciados */
  filled: number;
  /** Total esperado */
  total: number;
  /** Si true, dot warning (incompleto crítico) */
  warn?: boolean;
  /** Ícono del ítem en el sidebar. Si falta, se cae al número de orden. */
  icon?: ReactNode;
  /**
   * Etiqueta corta para el sidebar, cuando el nombre completo de la sección no
   * cabe en la columna. El nombre largo se sigue usando como título de sección
   * en el header y como tooltip.
   */
  shortLabel?: string;
}

interface PanelSideNavProps<T extends string = TabId> {
  active: T;
  onChange: (id: T) => void;
  tabs: ReadonlyArray<TabDef<T>>;
  /** Rótulo de la sección (estilo SECTION_LABEL del Panel Coordinador). */
  eyebrow?: string;
  /** Bloque de marca del sidebar: qué panel es. */
  brandTitle: string;
  brandSubtitle: string;
  /** Rail de solo íconos, para cuando el panel va angosto. */
  collapsed?: boolean;
  /** Contenido opcional al pie del sidebar (ej. botón de consulta guiada). */
  footer?: ReactNode;
}

/**
 * Navegación de secciones de la historia clínica como sidebar vertical,
 * en el mismo lenguaje visual que el `NavItem` del Panel Coordinador
 * (píldora activa con ring interno + barra de acento a la izquierda,
 * contador tabular a la derecha).
 *
 * Sustituye a la tira horizontal de tabs: con 7 secciones la tira obligaba a
 * scroll horizontal y escondía el progreso de las secciones no visibles;
 * en columna las 7 se ven de un vistazo con su estado.
 */
export function PanelSideNav<T extends string = TabId>({
  active,
  onChange,
  tabs,
  eyebrow = 'Secciones',
  brandTitle,
  brandSubtitle,
  collapsed = false,
  footer,
}: PanelSideNavProps<T>) {
  const totalFilled = tabs.reduce((a, t) => a + t.filled, 0);
  const totalFields = tabs.reduce((a, t) => a + t.total, 0);
  const pct = totalFields > 0 ? Math.round((totalFilled / totalFields) * 100) : 0;

  return (
    <aside
      className={`shrink-0 flex flex-col border-r border-[var(--p-line)] bg-[var(--p-surface-2)] ${
        collapsed ? 'w-[58px]' : 'w-[232px]'
      }`}
    >
      {/* Bloque de marca, igual que el aside del Panel Coordinador. Vive acá y no
          en el header de la página porque en la consulta en vivo el panel se
          monta dentro de `VideoRoom`, que no tiene header donde ponerlo.
          Ojo: `logoNegro.png` no se ve sobre `.panel-theme-dark`; si algún día
          se vuelve a ese tema hay que cambiarlo por `logoBlanco.png`. */}
      <div
        className={`shrink-0 border-b border-[var(--p-line)] flex items-center gap-3 ${
          collapsed ? 'px-2 py-3 justify-center' : 'px-4 py-3.5'
        }`}
      >
        <img
          src="/logoNegro.png"
          alt="Bodytech"
          className={`object-contain shrink-0 ${collapsed ? 'h-5' : 'h-6'}`}
        />
        {!collapsed && (
          <div className="leading-tight min-w-0">
            <div className="text-[13.5px] font-semibold text-[var(--p-text)] tracking-tight truncate">
              {brandTitle}
            </div>
            <div className="text-[11px] text-[var(--p-text-3)] -mt-0.5 truncate">
              {brandSubtitle}
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2.5 pt-3.5 pb-2">
        {!collapsed && (
          <div className="px-2.5 pb-2 text-[10.5px] uppercase tracking-[0.1em] text-[var(--p-text-3)] font-semibold">
            {eyebrow}
          </div>
        )}
        <div className="space-y-0.5">
          {tabs.map((t, idx) => (
            <SideNavItem
              key={t.id}
              index={idx + 1}
              tab={t}
              active={t.id === active}
              collapsed={collapsed}
              onClick={() => onChange(t.id)}
            />
          ))}
        </div>
      </nav>

      {/* Progreso global de la historia */}
      <div className="border-t border-[var(--p-line)] px-3 py-2.5">
        {collapsed ? (
          <div
            className="text-[10px] font-semibold text-center text-[var(--p-text-2)] tabular-nums"
            title={`${totalFilled} de ${totalFields} campos diligenciados`}
          >
            {pct}%
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10.5px] uppercase tracking-[0.1em] text-[var(--p-text-3)] font-semibold">
                Progreso
              </span>
              <span className="text-[11px] font-semibold text-[var(--p-text-2)] tabular-nums">
                {totalFilled}/{totalFields}
              </span>
            </div>
            <div className="h-[5px] rounded-[3px] bg-[var(--p-input-2)] overflow-hidden">
              <div
                className="h-full bg-[var(--p-accent)] rounded-[3px] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        )}
      </div>

      {footer && <div className="border-t border-[var(--p-line)] p-2.5">{footer}</div>}
    </aside>
  );
}

function SideNavItem<T extends string>({
  index,
  tab,
  active,
  collapsed,
  onClick,
}: {
  index: number;
  tab: TabDef<T>;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const dot = tab.warn
    ? 'bg-[var(--p-warn)]'
    : tab.filled === 0
      ? 'bg-[var(--p-text-3)]'
      : 'bg-[var(--p-ok)]';

  const stateCls = active
    ? 'bg-[var(--p-surface)] text-[var(--p-text)] shadow-[inset_0_0_0_1px_var(--p-line)]'
    : 'text-[var(--p-text-2)] hover:bg-[var(--p-input-2)] hover:text-[var(--p-text)]';

  const title = `${tab.label} — ${tab.filled}/${tab.total}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? 'page' : undefined}
      className={`relative w-full flex items-center gap-[11px] rounded-md text-[13.5px] font-medium transition-colors ${
        collapsed ? 'justify-center px-0 py-[9px]' : 'px-[10px] py-[7px]'
      } ${stateCls}`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-[-10px] top-1.5 bottom-1.5 w-0.5 rounded-sm bg-[var(--p-accent)]"
        />
      )}

      <span
        className={`inline-flex items-center justify-center w-[20px] h-[20px] rounded-full text-[10px] font-bold shrink-0 ${
          active
            ? 'bg-[var(--p-accent)] text-[var(--p-on-accent)]'
            : 'bg-[var(--p-input-2)] text-[var(--p-text-3)]'
        }`}
      >
        {tab.icon ?? index}
      </span>

      {!collapsed && (
        <>
          <span className="truncate flex-1 text-left">{tab.shortLabel ?? tab.label}</span>
          <span className="text-[10.5px] font-semibold text-[var(--p-text-3)] tabular-nums shrink-0">
            {tab.filled}/{tab.total}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
        </>
      )}

      {collapsed && (
        <span
          className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${dot}`}
        />
      )}
    </button>
  );
}

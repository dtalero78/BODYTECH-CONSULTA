import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Download,
  Pencil,
  CalendarClock,
  MoreHorizontal,
  ChevronDown,
} from 'lucide-react';
import authService from '../../services/auth.service';
import profesionalesService, { Profesional, Rol } from '../../services/profesionales.service';
import { ProfesionalFormModal } from './ProfesionalFormModal';
import { DisponibilidadModal } from './DisponibilidadModal';
import {
  FONT_INTER,
  FONT_MONO,
  MonoAvatar,
  Pill,
  SECTION_LABEL,
  initialsOf,
} from './_tokens';

interface Props {
  reloadKey: number;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
  reportCount?: (count: number | null) => void;
}

function nombreCompleto(p: Profesional): string {
  if (p.alias) return p.alias;
  return [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
    .filter(Boolean)
    .join(' ');
}

export function ProfesionalesView({ reloadKey, showToast, reportCount }: Props) {
  const navigate = useNavigate();
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRol, setFilterRol] = useState<'todos' | Rol>('todos');
  const [filterActivo, setFilterActivo] = useState<'todos' | 'activos' | 'inactivos'>('activos');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Profesional | null>(null);

  const [dispoOpen, setDispoOpen] = useState(false);
  const [dispoTarget, setDispoTarget] = useState<Profesional | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<Profesional | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const filters: { rol?: Rol; activo?: boolean; search?: string } = {};
      if (filterRol !== 'todos') filters.rol = filterRol;
      if (filterActivo === 'activos') filters.activo = true;
      if (filterActivo === 'inactivos') filters.activo = false;
      if (search.trim()) filters.search = search.trim();
      const list = await profesionalesService.list(filters);
      setProfesionales(list);
    } catch (err: unknown) {
      const e = err as { response?: { status?: number } };
      const status = e?.response?.status;
      const msg =
        status === 401
          ? 'Sesión expirada. Inicia sesión de nuevo.'
          : 'Error cargando profesionales.';
      showToast({ type: 'error', message: msg });
      if (status === 401) {
        authService.logout();
        navigate('/coordinador-login', { replace: true });
      }
    } finally {
      setLoading(false);
    }
  }, [filterRol, filterActivo, search, navigate, showToast]);

  useEffect(() => {
    const t = setTimeout(reload, 300);
    return () => clearTimeout(t);
  }, [reload, reloadKey]);

  // Reportar el conteo al sidebar (activos visibles)
  useEffect(() => {
    if (!reportCount) return;
    if (loading) return;
    const activos = profesionales.filter((p) => p.activo).length;
    reportCount(activos);
  }, [profesionales, loading, reportCount]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(p: Profesional) {
    setEditing(p);
    setFormOpen(true);
  }
  function openDispo(p: Profesional) {
    setDispoTarget(p);
    setDispoOpen(true);
  }
  async function confirmDeleteProfesional() {
    if (!confirmDelete) return;
    try {
      await profesionalesService.softDelete(confirmDelete.id);
      showToast({
        type: 'success',
        message: `${nombreCompleto(confirmDelete)} fue desactivado.`,
      });
      setConfirmDelete(null);
      reload();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      const msg = e?.response?.data?.error?.message || 'Error desactivando profesional.';
      showToast({ type: 'error', message: msg });
    }
  }

  // Stats para el subtítulo
  const stats = useMemo(() => {
    const activos = profesionales.filter((p) => p.activo).length;
    const inactivos = profesionales.length - activos;
    return { activos, inactivos };
  }, [profesionales]);

  // ----- Reactivar (set activo=true) -----
  async function reactivar(p: Profesional) {
    try {
      // El service usa update completo; pasamos solo lo necesario aprovechando partial.
      // Algunas instalaciones no permiten editar `activo` por PUT — si falla
      // mostramos el error y dejamos el flujo intacto.
      await profesionalesService.update(p.id, {
        rol: p.rol,
        codigo: p.codigo,
        primerNombre: p.primerNombre,
        primerApellido: p.primerApellido,
      });
      showToast({ type: 'success', message: `${nombreCompleto(p)} reactivado.` });
      reload();
    } catch {
      showToast({
        type: 'error',
        message: 'No se pudo reactivar — usa el formulario de edición.',
      });
      openEdit(p);
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="bg-white rounded-xl overflow-hidden"
        style={{ boxShadow: 'inset 0 0 0 1px #e4e4e7' }}
      >
        {/* Header */}
        <div className="px-8 pt-6 pb-5 flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] text-zinc-400 mb-1 tracking-tight"
              style={{ fontFamily: FONT_MONO }}
            >
              / profesionales
            </div>
            <h2
              className="text-[26px] font-semibold tracking-tight text-zinc-900 leading-tight"
              style={{ fontFamily: FONT_INTER }}
            >
              Profesionales
            </h2>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              <span className="tabular-nums">{stats.activos}</span> activos ·{' '}
              <span className="tabular-nums">{stats.inactivos}</span> inactivos
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar profesional…"
                className="h-9 w-[280px] pl-9 pr-12 border border-zinc-200 rounded-md text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
                style={{ fontFamily: FONT_INTER }}
              />
              <kbd
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center h-5 px-1.5 rounded border border-zinc-200 bg-zinc-50 text-[10.5px] text-zinc-500"
                style={{ fontFamily: FONT_MONO }}
              >
                ⌘K
              </kbd>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 transition-colors"
              title="Exportar"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar
            </button>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-white transition-colors"
              style={{ background: '#1f3a8a' }}
              onMouseDown={(e) => e.currentTarget.style.setProperty('background', '#1e3a8a')}
              onMouseUp={(e) => e.currentTarget.style.setProperty('background', '#1f3a8a')}
            >
              <Plus className="w-3.5 h-3.5" />
              Agregar profesional
            </button>
          </div>
        </div>

        {/* Filter strip */}
        <div className="px-8 py-3 border-y border-zinc-200 bg-zinc-50 flex items-center gap-3">
          <span className={SECTION_LABEL}>Filtros</span>
          <ChipSelect
            label="Rol"
            value={filterRol}
            onChange={(v) => setFilterRol(v as 'todos' | Rol)}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'medico', label: 'Médico' },
              { value: 'coach', label: 'Coach' },
            ]}
            active={filterRol !== 'todos'}
          />
          <ChipSelect
            label="Estado"
            value={filterActivo}
            onChange={(v) => setFilterActivo(v as 'todos' | 'activos' | 'inactivos')}
            options={[
              { value: 'activos', label: 'Activos' },
              { value: 'inactivos', label: 'Inactivos' },
              { value: 'todos', label: 'Activos e inactivos' },
            ]}
            active={filterActivo !== 'activos'}
          />
          <div className="ml-auto text-[12px] text-zinc-500">
            <span className="tabular-nums font-medium text-zinc-700" style={{ fontFamily: FONT_MONO }}>
              {profesionales.length}
            </span>{' '}
            resultados
          </div>
        </div>

        {/* Tabla */}
        {loading ? (
          <div className="py-16 text-center text-[13px] text-zinc-500">
            Cargando profesionales…
          </div>
        ) : profesionales.length === 0 ? (
          <div className="py-16 text-center text-[13px] text-zinc-500">
            {search.trim()
              ? 'No se encontraron profesionales con esos filtros.'
              : 'Aún no hay profesionales. Crea el primero.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" style={{ fontFamily: FONT_INTER }}>
              <thead className="bg-[#fcfcfb] border-b border-zinc-200">
                <tr className={SECTION_LABEL.replace('text-[10.5px]', '')}>
                  <th className="text-left px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold w-[32%]">
                    Profesional
                  </th>
                  <th className="text-left px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Rol
                  </th>
                  <th className="text-left px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Especialidad
                  </th>
                  <th className="text-right px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Consulta
                  </th>
                  <th className="text-left px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Licencia
                  </th>
                  <th className="text-left px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Estado
                  </th>
                  <th className="text-right px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {profesionales.map((p) => {
                  const nombre = nombreCompleto(p);
                  const inactivo = !p.activo;
                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-zinc-100 hover:bg-zinc-50 transition-colors ${
                        inactivo ? 'bg-zinc-50' : ''
                      }`}
                      style={{ height: 56 }}
                    >
                      <td className="px-[14px] py-2.5">
                        <div className="flex items-center gap-3">
                          <div className={inactivo ? 'grayscale opacity-75' : ''}>
                            <MonoAvatar
                              initials={initialsOf(p.primerNombre, p.primerApellido)}
                              variant={inactivo ? 'muted' : 'default'}
                            />
                          </div>
                          <div className="min-w-0">
                            <div
                              className={`text-[14px] font-medium truncate ${
                                inactivo ? 'text-zinc-400' : 'text-zinc-900'
                              }`}
                              style={{ fontFamily: FONT_INTER }}
                            >
                              {nombre}
                            </div>
                            <div
                              className={`text-[11px] truncate ${
                                inactivo ? 'text-zinc-400' : 'text-zinc-500'
                              }`}
                              style={{ fontFamily: FONT_MONO }}
                            >
                              {p.codigo}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={`px-[14px] py-2.5 ${inactivo ? 'text-zinc-400' : 'text-zinc-700'}`}>
                        {p.rol === 'medico' ? 'Médico' : 'Coach'}
                      </td>
                      <td className={`px-[14px] py-2.5 ${inactivo ? 'text-zinc-400' : 'text-zinc-700'}`}>
                        {p.especialidad || '—'}
                      </td>
                      <td
                        className={`px-[14px] py-2.5 text-right tabular-nums ${
                          inactivo ? 'text-zinc-400' : 'text-zinc-700'
                        }`}
                      >
                        {p.tiempoConsulta} min
                      </td>
                      <td
                        className={`px-[14px] py-2.5 ${inactivo ? 'text-zinc-400' : 'text-zinc-600'}`}
                        style={{ fontFamily: p.numeroLicencia ? FONT_MONO : FONT_INTER }}
                      >
                        {p.numeroLicencia || '—'}
                      </td>
                      <td className="px-[14px] py-2.5">
                        {p.activo ? (
                          <Pill variant="ok">Activo</Pill>
                        ) : (
                          <Pill variant="mute">Inactivo</Pill>
                        )}
                      </td>
                      <td className="px-[14px] py-2.5 text-right">
                        {p.activo ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => openEdit(p)}
                              title="Editar"
                              className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
                            >
                              <Pencil className="w-[14px] h-[14px]" />
                            </button>
                            <button
                              onClick={() => openDispo(p)}
                              title="Disponibilidad"
                              className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
                            >
                              <CalendarClock className="w-[14px] h-[14px]" />
                            </button>
                            <button
                              onClick={() => setConfirmDelete(p)}
                              title="Más / Desactivar"
                              className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
                            >
                              <MoreHorizontal className="w-[14px] h-[14px]" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => reactivar(p)}
                            className="text-[12.5px] font-medium hover:underline"
                            style={{ color: '#1f3a8a' }}
                          >
                            Reactivar →
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer paginación (estética; el contrato del list() actual no pagina) */}
        {!loading && profesionales.length > 0 && (
          <div className="px-8 py-3.5 bg-[#fcfcfb] text-[12px] text-zinc-500 flex items-center justify-between border-t border-zinc-200">
            <div>
              Mostrando{' '}
              <span className="tabular-nums" style={{ fontFamily: FONT_MONO }}>
                1–{profesionales.length}
              </span>{' '}
              de{' '}
              <span className="tabular-nums" style={{ fontFamily: FONT_MONO }}>
                {profesionales.length}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Modal crear/editar */}
      {formOpen && (
        <ProfesionalFormModal
          key={editing ? `edit-${editing.id}` : 'new'}
          isOpen={formOpen}
          onClose={() => setFormOpen(false)}
          editing={editing}
          onSaved={(p) => {
            showToast({
              type: 'success',
              message: editing
                ? `${nombreCompleto(p)} actualizado.`
                : `${nombreCompleto(p)} creado.`,
            });
            reload();
          }}
          onError={(message) => showToast({ type: 'error', message })}
        />
      )}

      {/* Modal disponibilidad */}
      <DisponibilidadModal
        isOpen={dispoOpen}
        onClose={() => setDispoOpen(false)}
        profesional={dispoTarget}
        onSaved={() => {
          showToast({ type: 'success', message: 'Disponibilidad guardada.' });
          setDispoOpen(false);
        }}
        onError={(message) => showToast({ type: 'error', message })}
      />

      {/* Confirmación de borrado */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div
            className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6"
            style={{ fontFamily: FONT_INTER }}
          >
            <h3 className="text-[15px] font-semibold text-zinc-900 mb-2">
              Desactivar profesional
            </h3>
            <p className="text-[13px] text-zinc-600 mb-5">
              ¿Estás seguro de desactivar a <strong>{nombreCompleto(confirmDelete)}</strong>? No
              se borrará del sistema, solo dejará de aparecer en listas activas y no podrá
              recibir nuevas citas.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-[13px] text-zinc-600 hover:bg-zinc-100 rounded-md"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteProfesional}
                className="px-4 py-2 bg-red-600 text-white rounded-md text-[13px] font-medium hover:bg-red-700"
              >
                Desactivar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChipSelect — <select> nativo estilizado como filter chip
// ---------------------------------------------------------------------------

interface ChipSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  active?: boolean;
}

function ChipSelect({ label, value, onChange, options, active = false }: ChipSelectProps) {
  const baseCls =
    'relative inline-flex items-center h-[30px] rounded-md border text-[12.5px] font-medium transition-colors';
  const stateCls = active
    ? 'bg-[#eef2ff] text-[#1e3a8a]'
    : 'bg-white text-zinc-800';
  const borderColor = active ? '#1f3a8a' : '#d4d4d8';
  return (
    <div
      className={`${baseCls} ${stateCls}`}
      style={{ fontFamily: FONT_INTER, borderColor }}
    >
      <span
        className={`pl-[11px] pr-1 font-normal ${active ? 'text-[#1e3a8a]/70' : 'text-zinc-500'}`}
      >
        {label}:
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent pl-0 pr-7 h-[30px] outline-none text-[12.5px] font-medium cursor-pointer"
        style={{ fontFamily: FONT_INTER }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}

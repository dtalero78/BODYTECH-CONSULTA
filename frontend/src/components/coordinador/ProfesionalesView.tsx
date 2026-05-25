import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  Calendar,
  Edit2,
  Trash2,
  Stethoscope,
  Dumbbell,
} from 'lucide-react';
import authService from '../../services/auth.service';
import profesionalesService, { Profesional, Rol } from '../../services/profesionales.service';
import { ProfesionalFormModal } from './ProfesionalFormModal';
import { DisponibilidadModal } from './DisponibilidadModal';

interface Props {
  reloadKey: number;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

export function ProfesionalesView({ reloadKey, showToast }: Props) {
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
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.status === 401
          ? 'Sesión expirada. Inicia sesión de nuevo.'
          : 'Error cargando profesionales.';
      showToast({ type: 'error', message: msg });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((err as any)?.response?.status === 401) {
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
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.error?.message || 'Error desactivando profesional.';
      showToast({ type: 'error', message: msg });
    }
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div className="flex flex-wrap gap-2 items-center flex-1">
            <div className="relative flex-1 min-w-[240px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, código o alias..."
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={filterRol}
              onChange={(e) => setFilterRol(e.target.value as 'todos' | Rol)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="todos">Todos los roles</option>
              <option value="medico">Médicos</option>
              <option value="coach">Coaches</option>
            </select>
            <select
              value={filterActivo}
              onChange={(e) =>
                setFilterActivo(e.target.value as 'todos' | 'activos' | 'inactivos')
              }
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="activos">Solo activos</option>
              <option value="inactivos">Solo inactivos</option>
              <option value="todos">Activos e inactivos</option>
            </select>
          </div>
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Nuevo profesional
          </button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="text-center py-16">
          <p className="text-sm text-gray-500">Cargando profesionales...</p>
        </div>
      ) : profesionales.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
          <p className="text-sm text-gray-500">
            {search.trim()
              ? 'No se encontraron profesionales con esos filtros.'
              : 'Aún no hay profesionales. Crea el primero.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profesionales.map((p) => (
            <ProfesionalCard
              key={p.id}
              profesional={p}
              onEdit={() => openEdit(p)}
              onDisponibilidad={() => openDispo(p)}
              onDelete={() => setConfirmDelete(p)}
            />
          ))}
        </div>
      )}

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
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-2">
              Desactivar profesional
            </h3>
            <p className="text-sm text-gray-600 mb-5">
              ¿Estás seguro de desactivar a <strong>{nombreCompleto(confirmDelete)}</strong>? No
              se borrará del sistema, solo dejará de aparecer en listas activas y no podrá
              recibir nuevas citas.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteProfesional}
                className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700"
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
// Card
// ---------------------------------------------------------------------------

function nombreCompleto(p: Profesional): string {
  if (p.alias) return p.alias;
  return [p.primerNombre, p.segundoNombre, p.primerApellido, p.segundoApellido]
    .filter(Boolean)
    .join(' ');
}

interface CardProps {
  profesional: Profesional;
  onEdit: () => void;
  onDisponibilidad: () => void;
  onDelete: () => void;
}

function ProfesionalCard({ profesional, onEdit, onDisponibilidad, onDelete }: CardProps) {
  const rolIcon =
    profesional.rol === 'medico' ? (
      <Stethoscope className="w-4 h-4" />
    ) : (
      <Dumbbell className="w-4 h-4" />
    );
  const rolColor =
    profesional.rol === 'medico'
      ? 'bg-blue-50 text-blue-700 border-blue-200'
      : 'bg-purple-50 text-purple-700 border-purple-200';

  return (
    <div
      className={`bg-white border rounded-2xl p-4 hover:shadow-md transition-shadow ${
        profesional.activo ? 'border-gray-200' : 'border-gray-200 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-800 truncate">
            {nombreCompleto(profesional)}
          </h3>
          <p className="text-xs text-gray-500 truncate">{profesional.codigo}</p>
        </div>
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium border rounded-full ${rolColor}`}
        >
          {rolIcon}
          {profesional.rol === 'medico' ? 'Médico' : 'Coach'}
        </span>
      </div>

      <div className="space-y-1.5 mb-4">
        {profesional.especialidad && (
          <p className="text-xs text-gray-600">
            <span className="text-gray-400">Especialidad:</span> {profesional.especialidad}
          </p>
        )}
        <p className="text-xs text-gray-600">
          <span className="text-gray-400">Consulta:</span> {profesional.tiempoConsulta} min
        </p>
        {profesional.numeroLicencia && (
          <p className="text-xs text-gray-600">
            <span className="text-gray-400">Licencia:</span> {profesional.numeroLicencia}
          </p>
        )}
        {!profesional.activo && <p className="text-xs font-medium text-red-600">Inactivo</p>}
      </div>

      <div className="flex gap-2 pt-3 border-t border-gray-100">
        <button
          onClick={onDisponibilidad}
          className="flex-1 px-2 py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded-lg flex items-center justify-center gap-1"
          title="Fijar disponibilidad"
        >
          <Calendar className="w-3.5 h-3.5" />
          Horarios
        </button>
        <button
          onClick={onEdit}
          className="flex-1 px-2 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded-lg flex items-center justify-center gap-1"
          title="Editar"
        >
          <Edit2 className="w-3.5 h-3.5" />
          Editar
        </button>
        {profesional.activo && (
          <button
            onClick={onDelete}
            className="px-2 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg"
            title="Desactivar"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

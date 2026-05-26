import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  BarChart3,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import authService from '../../services/auth.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import calendarioService, {
  Modalidad,
  HorariosDisponibles,
} from '../../services/calendario.service';

const API = import.meta.env.VITE_API_BASE_URL || '';

function authHeaders() {
  const token = authService.getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface OrdenItem {
  _id: string;
  numeroId: string;
  primerNombre: string;
  segundoNombre?: string;
  primerApellido: string;
  segundoApellido?: string;
  celular: string;
  empresa?: string;
  codEmpresa?: string;
  tipoExamen?: string;
  examenes?: string;
  medico?: string;
  fechaAtencion?: string;
  horaAtencion?: string;
  atendido?: string;
  ciudad?: string;
}

type ModalState = null | 'new' | OrdenItem;

interface FormData {
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  numeroId: string;
  celular: string;
  medico: string;
  tipoExamen: string;
  examenes: string;
  empresa: string;
  fechaAtencion: string;
  horaAtencion: string;
  ciudad: string;
  atendido: string;
}

const EMPTY_FORM: FormData = {
  primerNombre: '',
  segundoNombre: '',
  primerApellido: '',
  segundoApellido: '',
  numeroId: '',
  celular: '',
  medico: '',
  tipoExamen: '',
  examenes: '',
  empresa: '',
  fechaAtencion: '',
  horaAtencion: '',
  ciudad: '',
  atendido: 'PENDIENTE',
};

function fmtFecha(fechaStr?: string, horaStr?: string) {
  if (!fechaStr) return '—';
  try {
    const [y, m, d] = fechaStr.slice(0, 10).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const datePart = date.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    if (!horaStr) return datePart;
    const [hh, mm] = horaStr.split(':');
    const h = parseInt(hh, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${datePart} · ${h12}:${mm} ${ampm}`;
  } catch {
    return fechaStr;
  }
}

function statusBadge(status?: string) {
  const s = (status || 'PENDIENTE').toUpperCase();
  if (s === 'ATENDIDO') return 'bg-green-100 text-green-800';
  if (s === 'NO CONTESTA') return 'bg-red-100 text-red-800';
  if (s === 'PENDIENTE') return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-600';
}

function nombreCompleto(o: OrdenItem) {
  return [o.primerNombre, o.segundoNombre, o.primerApellido, o.segundoApellido]
    .filter(Boolean)
    .join(' ');
}

interface Props {
  reloadKey?: number;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

export function OrdenesView({ reloadKey = 0, showToast }: Props) {
  const [filters, setFilters] = useState({ status: 'all', q: '', from: '', to: '' });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [ordenes, setOrdenes] = useState<OrdenItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOrden, setModalOrden] = useState<ModalState>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrdenItem | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Profesionales (médicos + coaches) + slots disponibles
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  const [horarios, setHorarios] = useState<HorariosDisponibles | null>(null);
  const [loadingHorarios, setLoadingHorarios] = useState(false);

  // Carga profesionales (médicos + coaches activos) una sola vez
  useEffect(() => {
    profesionalesService
      .list({ activo: true })
      .then(setProfesionales)
      .catch(() => setProfesionales([]));
  }, []);

  const medicoSeleccionado = useMemo(
    () => profesionales.find((p) => p.codigo === formData.medico) ?? null,
    [profesionales, formData.medico]
  );

  // Cargar slots cuando hay médico + fecha + modalidad (sólo si el modal está abierto)
  useEffect(() => {
    if (modalOrden === null) {
      setHorarios(null);
      return;
    }
    if (!medicoSeleccionado || !formData.fechaAtencion) {
      setHorarios(null);
      return;
    }
    let cancelled = false;
    setLoadingHorarios(true);
    calendarioService
      .getHorariosDisponibles(formData.fechaAtencion, medicoSeleccionado.id, modalidad)
      .then((data) => {
        if (!cancelled) setHorarios(data);
      })
      .catch(() => {
        if (!cancelled) setHorarios(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingHorarios(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modalOrden, medicoSeleccionado, formData.fechaAtencion, modalidad]);

  const fetchOrdenes = useCallback(async (currentFilters: typeof filters, currentPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {
        page: String(currentPage),
        limit: '20',
      };
      if (currentFilters.status !== 'all') params.status = currentFilters.status;
      if (currentFilters.q) params.q = currentFilters.q;
      if (currentFilters.from) params.from = currentFilters.from;
      if (currentFilters.to) params.to = currentFilters.to;

      const res = await axios.get(`${API}/api/medical-panel/ordenes`, {
        params,
        headers: authHeaders(),
      });
      setOrdenes(res.data.ordenes ?? []);
      setTotal(res.data.total ?? 0);
      setTotalPages(res.data.totalPages ?? 0);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      setError(e.response?.data?.message || e.message || 'Error al cargar órdenes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrdenes(filters, page);
  }, [filters, page, fetchOrdenes, reloadKey]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setFilters((f) => ({ ...f, q: searchInput }));
      setPage(0);
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModalOrden(null);
        setDeleteTarget(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function openNew() {
    setFormData(EMPTY_FORM);
    setModalOrden('new');
  }

  function openEdit(o: OrdenItem) {
    setFormData({
      primerNombre: o.primerNombre ?? '',
      segundoNombre: o.segundoNombre ?? '',
      primerApellido: o.primerApellido ?? '',
      segundoApellido: o.segundoApellido ?? '',
      numeroId: o.numeroId ?? '',
      celular: o.celular ?? '',
      medico: o.medico ?? '',
      tipoExamen: o.tipoExamen ?? '',
      examenes: o.examenes ?? '',
      empresa: o.empresa ?? '',
      fechaAtencion: o.fechaAtencion ?? '',
      horaAtencion: o.horaAtencion ?? '',
      ciudad: o.ciudad ?? '',
      atendido: o.atendido ?? 'PENDIENTE',
    });
    setModalOrden(o);
  }

  function handleFilterStatus(s: string) {
    setFilters((f) => ({ ...f, status: s }));
    setPage(0);
  }

  function handleDateFilter(key: 'from' | 'to', val: string) {
    setFilters((f) => ({ ...f, [key]: val }));
    setPage(0);
  }

  function handleField(key: keyof FormData, val: string) {
    setFormData((f) => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    const isNew = modalOrden === 'new';

    const missing: string[] = [];
    if (!formData.primerNombre.trim()) missing.push('Primer Nombre');
    if (!formData.primerApellido.trim()) missing.push('Primer Apellido');
    if (!formData.numeroId.trim()) missing.push('Número de Cédula');
    if (!formData.celular.trim()) missing.push('Celular');
    if (!formData.medico.trim()) missing.push('Médico');
    if (!formData.fechaAtencion) missing.push('Fecha de Atención');
    if (!formData.horaAtencion) missing.push('Hora de Atención');
    if (missing.length > 0) {
      showToast({
        type: 'error',
        message: `Campos requeridos: ${missing.join(', ')}`,
      });
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string> = {};
      (Object.keys(formData) as (keyof FormData)[]).forEach((k) => {
        if (formData[k] !== '') body[k] = formData[k];
      });

      if (isNew) {
        await axios.post(`${API}/api/medical-panel/ordenes`, body, { headers: authHeaders() });
        showToast({ type: 'success', message: 'Orden creada correctamente.' });
      } else {
        const id = (modalOrden as OrdenItem)._id;
        await axios.patch(`${API}/api/medical-panel/ordenes/${id}`, body, {
          headers: authHeaders(),
        });
        showToast({ type: 'success', message: 'Orden actualizada.' });
      }
      setModalOrden(null);
      fetchOrdenes(filters, page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; message?: string } }; message?: string };
      showToast({
        type: 'error',
        message:
          e.response?.data?.error ||
          e.response?.data?.message ||
          e.message ||
          'Error al guardar.',
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/api/medical-panel/ordenes/${deleteTarget._id}`, {
        headers: authHeaders(),
      });
      showToast({ type: 'success', message: 'Orden eliminada.' });
      setDeleteTarget(null);
      fetchOrdenes(filters, page);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      showToast({
        type: 'error',
        message: e.response?.data?.message || e.message || 'Error al eliminar.',
      });
    } finally {
      setDeleting(false);
    }
  }

  const STATUS_TABS = [
    { key: 'all', label: 'Todos' },
    { key: 'PENDIENTE', label: 'Pendiente' },
    { key: 'ATENDIDO', label: 'Atendido' },
    { key: 'NO CONTESTA', label: 'No Contesta' },
  ];

  const isEditMode = modalOrden !== null && modalOrden !== 'new';

  return (
    <div>
      {/* Toolbar superior */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Órdenes</h2>
          <p className="text-xs text-gray-500">
            {total} {total === 1 ? 'orden encontrada' : 'órdenes encontradas'}
          </p>
        </div>
        <button
          onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva Orden
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3 mb-4">
        <div className="flex gap-1 flex-wrap">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleFilterStatus(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filters.status === tab.key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="flex-1 min-w-[200px] relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por nombre, documento..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Desde</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => handleDateFilter('from', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-500 whitespace-nowrap">Hasta</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => handleDateFilter('to', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm mb-4">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      )}

      {/* Tabla — desktop */}
      {!loading && ordenes.length > 0 && (
        <>
          <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Paciente</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Documento</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Empresa / Tipo</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Exámenes</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Médico</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Fecha cita</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-600">Estado</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-600">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {ordenes.map((o) => (
                    <tr key={o._id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                            {o.primerNombre?.[0]}
                            {o.primerApellido?.[0]}
                          </div>
                          <div>
                            <div className="font-medium text-gray-800">
                              {o.primerNombre} {o.primerApellido}
                            </div>
                            <div className="text-xs text-gray-400">{o.celular}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-600">{o.numeroId}</td>
                      <td className="px-4 py-3">
                        <div className="text-gray-800">{o.empresa || '—'}</div>
                        <div className="text-xs text-gray-400">{o.tipoExamen || ''}</div>
                      </td>
                      <td
                        className="px-4 py-3 text-gray-600 truncate max-w-[180px]"
                        title={o.examenes || ''}
                      >
                        {o.examenes || '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{o.medico || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {fmtFecha(o.fechaAtencion, o.horaAtencion)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(
                            o.atendido
                          )}`}
                        >
                          {o.atendido || 'PENDIENTE'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <a
                            href={`/calidad?historiaId=${o._id}`}
                            title="Evaluar calidad de consulta"
                            className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                          >
                            <BarChart3 className="w-4 h-4" />
                          </a>
                          <button
                            onClick={() => openEdit(o)}
                            title="Editar"
                            className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(o)}
                            title="Eliminar"
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between bg-gray-50">
                <span className="text-sm text-gray-500">
                  Página {page + 1} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-white transition-colors"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40 hover:bg-white transition-colors"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Cards — mobile */}
          <div className="md:hidden space-y-3">
            {ordenes.map((o) => (
              <div
                key={o._id}
                className="bg-white rounded-2xl border border-gray-200 p-4 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-800">{nombreCompleto(o)}</div>
                    <div className="text-xs text-gray-400">CC {o.numeroId}</div>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${statusBadge(
                      o.atendido
                    )}`}
                  >
                    {o.atendido || 'PENDIENTE'}
                  </span>
                </div>
                <div className="text-sm text-gray-600 space-y-0.5">
                  {o.empresa && <div>{o.empresa}</div>}
                  <div className="text-xs text-gray-400">
                    {fmtFecha(o.fechaAtencion, o.horaAtencion)}
                  </div>
                  {o.medico && <div className="text-xs text-gray-500">Médico: {o.medico}</div>}
                </div>
                <div className="flex gap-2 mt-1">
                  <button
                    onClick={() => openEdit(o)}
                    className="flex-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium transition-colors"
                  >
                    Ver / Editar
                  </button>
                  <button
                    onClick={() => setDeleteTarget(o)}
                    className="px-3 py-2 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 text-sm font-medium transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
            {totalPages > 1 && (
              <div className="flex items-center justify-between py-2">
                <span className="text-sm text-gray-500">
                  Página {page + 1} de {totalPages}
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page === 0}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && ordenes.length === 0 && !error && (
        <div className="text-center py-16 text-gray-400">
          <FileText className="mx-auto mb-4 w-12 h-12 text-gray-300" />
          <p className="text-base font-medium text-gray-500">No hay órdenes con estos filtros</p>
          <p className="text-sm mt-1">Prueba ajustando los filtros o crea una nueva orden</p>
        </div>
      )}

      {/* Modal crear / editar */}
      {modalOrden !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setModalOrden(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-bold text-gray-800">
                {isEditMode ? 'Editar Orden' : 'Nueva Orden'}
              </h2>
              <button
                onClick={() => setModalOrden(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Datos del paciente */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Datos del paciente
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField
                    label="Primer Nombre *"
                    value={formData.primerNombre}
                    onChange={(v) => handleField('primerNombre', v)}
                  />
                  <FormField
                    label="Segundo Nombre"
                    value={formData.segundoNombre}
                    onChange={(v) => handleField('segundoNombre', v)}
                  />
                  <FormField
                    label="Primer Apellido *"
                    value={formData.primerApellido}
                    onChange={(v) => handleField('primerApellido', v)}
                  />
                  <FormField
                    label="Segundo Apellido"
                    value={formData.segundoApellido}
                    onChange={(v) => handleField('segundoApellido', v)}
                  />
                  <FormField
                    label="Número de Cédula *"
                    value={formData.numeroId}
                    onChange={(v) => handleField('numeroId', v)}
                  />
                  <FormField
                    label="Celular *"
                    value={formData.celular}
                    onChange={(v) => handleField('celular', v)}
                  />
                </div>
              </div>

              {/* Datos de la cita */}
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Datos de la cita
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Médico *</label>
                    <select
                      value={formData.medico}
                      onChange={(e) => {
                        handleField('medico', e.target.value);
                        // Al cambiar médico, la hora previa puede no estar disponible
                        handleField('horaAtencion', '');
                      }}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Seleccionar profesional...</option>
                      {profesionales.map((p) => (
                        <option key={p.id} value={p.codigo}>
                          {p.alias || `${p.primerNombre} ${p.primerApellido}`} · {p.codigo} ·{' '}
                          {p.rol === 'coach' ? 'Coach' : 'Médico'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Modalidad</label>
                    <select
                      value={modalidad}
                      onChange={(e) => {
                        setModalidad(e.target.value as Modalidad);
                        handleField('horaAtencion', '');
                      }}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="virtual">Virtual</option>
                      <option value="presencial">Presencial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tipo de Examen</label>
                    <select
                      value={formData.tipoExamen}
                      onChange={(e) => handleField('tipoExamen', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Seleccionar...</option>
                      <option value="Ingreso">Ingreso</option>
                      <option value="Periódico">Periódico</option>
                      <option value="Egreso">Egreso</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <FormField
                    label="Empresa"
                    value={formData.empresa}
                    onChange={(v) => handleField('empresa', v)}
                  />
                  <div className="sm:col-span-2">
                    <FormField
                      label="Exámenes"
                      value={formData.examenes}
                      onChange={(v) => handleField('examenes', v)}
                      placeholder="Ej: EXAMEN MÉDICO OCUPACIONAL, AUDIOMETRÍA"
                    />
                  </div>
                  <FormField
                    label="Ciudad"
                    value={formData.ciudad}
                    onChange={(v) => handleField('ciudad', v)}
                  />
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fecha de Atención *</label>
                    <input
                      type="date"
                      value={formData.fechaAtencion}
                      onChange={(e) => {
                        handleField('fechaAtencion', e.target.value);
                        handleField('horaAtencion', '');
                      }}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Slots de hora según disponibilidad del médico */}
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">
                      Hora de Atención *{' '}
                      <span className="text-gray-400">(según disponibilidad del médico)</span>
                    </label>
                    {!medicoSeleccionado || !formData.fechaAtencion ? (
                      <div className="border border-gray-200 rounded-lg p-3 text-xs text-gray-400">
                        Selecciona médico y fecha para ver los horarios disponibles.
                      </div>
                    ) : loadingHorarios ? (
                      <div className="border border-gray-200 rounded-lg p-3 text-xs text-gray-400">
                        Cargando horarios...
                      </div>
                    ) : !horarios || horarios.horarios.length === 0 ? (
                      <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-xs text-amber-800 flex-1">
                          <p className="font-medium">Sin disponibilidad configurada</p>
                          <p>
                            {medicoSeleccionado.alias ||
                              `${medicoSeleccionado.primerNombre} ${medicoSeleccionado.primerApellido}`}{' '}
                            no tiene horarios en modalidad <strong>{modalidad}</strong> para este
                            día. Puedes ingresar una hora manual:
                          </p>
                          <input
                            type="time"
                            value={formData.horaAtencion}
                            onChange={(e) => handleField('horaAtencion', e.target.value)}
                            step="600"
                            className="mt-2 px-2 py-1 border border-amber-300 rounded-md text-xs"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                          {horarios.horarios.map((slot) => (
                            <button
                              key={slot.hora}
                              type="button"
                              onClick={() =>
                                slot.disponible && handleField('horaAtencion', slot.hora)
                              }
                              disabled={!slot.disponible}
                              className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                                formData.horaAtencion === slot.hora
                                  ? 'bg-blue-600 text-white border-blue-600'
                                  : slot.disponible
                                    ? 'bg-white text-gray-700 border-gray-200 hover:bg-blue-50 hover:border-blue-300'
                                    : 'bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed line-through'
                              }`}
                            >
                              {slot.hora}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {horarios.horarios.filter((s) => s.disponible).length} libres de{' '}
                          {horarios.horarios.length} · bloques de {horarios.tiempoConsulta} min
                        </p>
                      </>
                    )}
                  </div>

                  {isEditMode && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Estado</label>
                      <select
                        value={formData.atendido}
                        onChange={(e) => handleField('atendido', e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="PENDIENTE">PENDIENTE</option>
                        <option value="ATENDIDO">ATENDIDO</option>
                        <option value="NO CONTESTA">NO CONTESTA</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-t border-gray-200 px-6 py-4 flex justify-end gap-3 bg-gray-50 rounded-b-2xl">
              <button
                onClick={() => setModalOrden(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmación de borrado */}
      {deleteTarget !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Eliminar orden</h3>
                <p className="text-sm text-gray-500">
                  {nombreCompleto(deleteTarget)} · Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {deleting ? 'Eliminando...' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface FormFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}

function FormField({ label, value, onChange, type = 'text', placeholder }: FormFieldProps) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  );
}

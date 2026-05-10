import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || '';

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
    // Normaliza "2026-03-14 23:40:00+00" → toma solo los primeros 10 chars
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

export function OrdenesPage() {
  const [filters, setFilters] = useState({ status: 'all', q: '', from: '', to: '' });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(0);
  const [ordenes, setOrdenes] = useState<OrdenItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOrden, setModalOrden] = useState<ModalState>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      const res = await axios.get(`${API}/api/medical-panel/ordenes`, { params });
      setOrdenes(res.data.ordenes ?? []);
      setTotal(res.data.total ?? 0);
      setTotalPages(res.data.totalPages ?? 0);
    } catch (err: any) {
      setError(err.response?.data?.message || err.message || 'Error al cargar órdenes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrdenes(filters, page);
  }, [filters, page, fetchOrdenes]);

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
        setDeleteId(null);
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

    // Validación frontend antes de enviar
    const missing: string[] = [];
    if (!formData.primerNombre.trim()) missing.push('Primer Nombre');
    if (!formData.primerApellido.trim()) missing.push('Primer Apellido');
    if (!formData.numeroId.trim()) missing.push('Número de Cédula');
    if (!formData.celular.trim()) missing.push('Celular');
    if (!formData.medico.trim()) missing.push('Médico');
    if (!formData.fechaAtencion) missing.push('Fecha de Atención');
    if (!formData.horaAtencion) missing.push('Hora de Atención');
    if (missing.length > 0) {
      alert(`Campos requeridos:\n• ${missing.join('\n• ')}`);
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, string> = {};
      (Object.keys(formData) as (keyof FormData)[]).forEach((k) => {
        if (formData[k] !== '') body[k] = formData[k];
      });

      if (isNew) {
        await axios.post(`${API}/api/medical-panel/ordenes`, body);
      } else {
        const id = (modalOrden as OrdenItem)._id;
        await axios.patch(`${API}/api/medical-panel/ordenes/${id}`, body);
      }
      setModalOrden(null);
      fetchOrdenes(filters, page);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } }; message?: string };
      alert(axiosErr.response?.data?.error || axiosErr.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await axios.delete(`${API}/api/medical-panel/ordenes/${deleteId}`);
      setDeleteId(null);
      fetchOrdenes(filters, page);
    } catch (err: any) {
      alert(err.response?.data?.message || err.message || 'Error al eliminar');
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
    <div className="min-h-screen bg-gray-50 font-figtree">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Órdenes</h1>
              <p className="text-sm text-gray-500">
                {total} {total === 1 ? 'orden encontrada' : 'órdenes encontradas'}
              </p>
            </div>
            {total > 0 && (
              <span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2.5 py-0.5 rounded-full">
                {total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <a href="/panel-medico" className="text-sm text-gray-500 hover:text-gray-700 hover:underline">
              Volver al panel
            </a>
            <button
              onClick={openNew}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Nueva Orden
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Filters */}
        <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
          {/* Status tabs */}
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
          {/* Search + dates */}
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[200px] relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
                />
              </svg>
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

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        )}

        {/* Table — desktop */}
        {!loading && ordenes.length > 0 && (
          <>
            <div className="hidden md:block bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
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
                  <tbody className="divide-y">
                    {ordenes.map((o) => (
                      <tr key={o._id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                              {o.primerNombre?.[0]}{o.primerApellido?.[0]}
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
                        <td className="px-4 py-3 text-gray-600 truncate max-w-[180px]" title={o.examenes || ''}>
                          {o.examenes || '—'}
                        </td>
                        <td className="px-4 py-3 text-gray-600">{o.medico || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                          {fmtFecha(o.fechaAtencion, o.horaAtencion)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${statusBadge(o.atendido)}`}>
                            {o.atendido || 'PENDIENTE'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              onClick={() => openEdit(o)}
                              title="Editar"
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 0 1 2.828 2.828L11.828 15.828a2 2 0 0 1-1.414.586H7v-3.414a2 2 0 0 1 .586-1.414z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeleteId(o._id)}
                              title="Eliminar"
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="border-t px-4 py-3 flex items-center justify-between bg-gray-50">
                  <span className="text-sm text-gray-500">
                    Página {page + 1} de {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-white transition-colors"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40 hover:bg-white transition-colors"
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
                <div key={o._id} className="bg-white rounded-xl border shadow-sm p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-gray-800">{nombreCompleto(o)}</div>
                      <div className="text-xs text-gray-400">CC {o.numeroId}</div>
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold shrink-0 ${statusBadge(o.atendido)}`}>
                      {o.atendido || 'PENDIENTE'}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 space-y-0.5">
                    {o.empresa && <div>{o.empresa}</div>}
                    <div className="text-xs text-gray-400">{fmtFecha(o.fechaAtencion, o.horaAtencion)}</div>
                    {o.medico && <div className="text-xs text-gray-500">Médico: {o.medico}</div>}
                  </div>
                  <button
                    onClick={() => openEdit(o)}
                    className="w-full mt-1 px-3 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium transition-colors"
                  >
                    Ver / Editar
                  </button>
                </div>
              ))}
              {totalPages > 1 && (
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-gray-500">Página {page + 1} de {totalPages}</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40"
                    >
                      Anterior
                    </button>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      className="px-3 py-1.5 border rounded-lg text-sm disabled:opacity-40"
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
            <svg className="mx-auto mb-4 w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-3-3v6M4 6h16M4 10h16M4 14h10M4 18h6" />
            </svg>
            <p className="text-base font-medium text-gray-500">No hay órdenes con estos filtros</p>
            <p className="text-sm mt-1">Prueba ajustando los filtros o crea una nueva orden</p>
          </div>
        )}
      </div>

      {/* Modal crear / editar */}
      {modalOrden !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setModalOrden(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center justify-between rounded-t-xl">
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
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Primer Nombre *</label>
                    <input
                      type="text"
                      value={formData.primerNombre}
                      onChange={(e) => handleField('primerNombre', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Segundo Nombre</label>
                    <input
                      type="text"
                      value={formData.segundoNombre}
                      onChange={(e) => handleField('segundoNombre', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Primer Apellido *</label>
                    <input
                      type="text"
                      value={formData.primerApellido}
                      onChange={(e) => handleField('primerApellido', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Segundo Apellido</label>
                    <input
                      type="text"
                      value={formData.segundoApellido}
                      onChange={(e) => handleField('segundoApellido', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Número de Cédula *</label>
                    <input
                      type="text"
                      value={formData.numeroId}
                      onChange={(e) => handleField('numeroId', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Celular *</label>
                    <input
                      type="text"
                      value={formData.celular}
                      onChange={(e) => handleField('celular', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
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
                    <input
                      type="text"
                      value={formData.medico}
                      onChange={(e) => handleField('medico', e.target.value)}
                      placeholder="Ej: BODYTECH, NUBIA"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
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
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">Exámenes</label>
                    <input
                      type="text"
                      value={formData.examenes}
                      onChange={(e) => handleField('examenes', e.target.value)}
                      placeholder="Ej: EXAMEN MÉDICO OCUPACIONAL, AUDIOMETRÍA"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Empresa</label>
                    <input
                      type="text"
                      value={formData.empresa}
                      onChange={(e) => handleField('empresa', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Ciudad</label>
                    <input
                      type="text"
                      value={formData.ciudad}
                      onChange={(e) => handleField('ciudad', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Fecha de Atención *</label>
                    <input
                      type="date"
                      value={formData.fechaAtencion}
                      onChange={(e) => handleField('fechaAtencion', e.target.value)}
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Hora de Atención *</label>
                    <input
                      type="time"
                      value={formData.horaAtencion}
                      onChange={(e) => handleField('horaAtencion', e.target.value)}
                      step="600"
                      className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
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

            <div className="border-t px-6 py-4 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
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
      {deleteId !== null && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteId(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0 1 16.138 21H7.862a2 2 0 0 1-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">Eliminar orden</h3>
                <p className="text-sm text-gray-500">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteId(null)}
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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import axios from 'axios';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  MoreHorizontal,
  AlertTriangle,
  ChevronDown,
  Download,
  X,
} from 'lucide-react';
import authService from '../../services/auth.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import calendarioService, {
  Modalidad,
  HorariosDisponibles,
} from '../../services/calendario.service';
import {
  FONT_INTER,
  FONT_MONO,
  MonoAvatar,
  Pill,
  SECTION_LABEL,
  initialsOf,
} from './_tokens';

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
  createdAt?: string;
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

function fmtFechaCorta(fechaStr?: string) {
  if (!fechaStr) return '—';
  try {
    const [y, m, d] = fechaStr.slice(0, 10).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return fechaStr;
  }
}

function fmtFechaHora(fechaStr?: string, horaStr?: string) {
  if (!fechaStr) return '—';
  try {
    const [y, m, d] = fechaStr.slice(0, 10).split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const datePart = date.toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
    });
    if (!horaStr) return datePart;
    return `${datePart} · ${horaStr.slice(0, 5)}`;
  } catch {
    return fechaStr;
  }
}

function statusVariant(status?: string): 'ok' | 'warn' | 'bad' | 'mute' {
  const s = (status || 'PENDIENTE').toUpperCase();
  if (s === 'ATENDIDO') return 'ok';
  if (s === 'NO CONTESTA') return 'bad';
  if (s === 'PENDIENTE') return 'warn';
  return 'mute';
}

function nombreCompleto(o: OrdenItem) {
  return [o.primerNombre, o.segundoNombre, o.primerApellido, o.segundoApellido]
    .filter(Boolean)
    .join(' ');
}

// "ORD-YYYY-XXXX" derivado del _id + createdAt (estética; el ID real es _id).
function ordenCodigo(o: OrdenItem): string {
  const year = o.createdAt
    ? new Date(o.createdAt).getUTCFullYear()
    : new Date().getUTCFullYear();
  const suffix = (o._id || '').slice(-4).toUpperCase().padStart(4, '0');
  return `ORD-${year}-${suffix}`;
}

interface Props {
  reloadKey?: number;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
  reportCount?: (count: number | null) => void;
}

export function OrdenesView({ reloadKey = 0, showToast, reportCount }: Props) {
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

  // Cargar slots cuando hay médico + fecha + modalidad
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

  // Reportar conteo al sidebar
  useEffect(() => {
    if (!reportCount) return;
    reportCount(total);
  }, [total, reportCount]);

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

  const STATUS_OPTIONS = [
    { value: 'all', label: 'Todos' },
    { value: 'PENDIENTE', label: 'Pendiente' },
    { value: 'ATENDIDO', label: 'Atendido' },
    { value: 'NO CONTESTA', label: 'No contesta' },
  ];

  const isEditMode = modalOrden !== null && modalOrden !== 'new';

  // Subtítulo: total · pendientes
  const pendientesCount = ordenes.filter((o) => (o.atendido || 'PENDIENTE').toUpperCase() === 'PENDIENTE').length;

  return (
    <div className="space-y-4" style={{ fontFamily: FONT_INTER }}>
      <div
        className="bg-white rounded-xl overflow-hidden"
        style={{ boxShadow: 'inset 0 0 0 1px #e4e4e7' }}
      >
        {/* Header */}
        <div className="px-8 pt-6 pb-5 flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] text-zinc-400 mb-1"
              style={{ fontFamily: FONT_MONO }}
            >
              / órdenes
            </div>
            <h2 className="text-[26px] font-semibold tracking-tight text-zinc-900 leading-tight">
              Órdenes
            </h2>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              <span className="tabular-nums">{total}</span> emitidas ·{' '}
              <span className="tabular-nums">{pendientesCount}</span> pendientes en página
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Buscar paciente, documento…"
                className="h-9 w-[280px] pl-9 pr-12 border border-zinc-200 rounded-md text-[13px] text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400"
              />
              <kbd
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center h-5 px-1.5 rounded border border-zinc-200 bg-zinc-50 text-[10.5px] text-zinc-500"
                style={{ fontFamily: FONT_MONO }}
              >
                ⌘K
              </kbd>
            </div>
            <button
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md text-[13px] font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar
            </button>
            <button
              onClick={openNew}
              className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md text-[13px] font-medium text-white"
              style={{ background: '#1f3a8a' }}
            >
              <Plus className="w-3.5 h-3.5" />
              Nueva orden
            </button>
          </div>
        </div>

        {/* Filter strip */}
        <div className="px-8 py-3 border-y border-zinc-200 bg-zinc-50 flex items-center gap-3 flex-wrap">
          <span className={SECTION_LABEL}>Filtros</span>
          <ChipSelect
            label="Estado"
            value={filters.status}
            onChange={(v) => handleFilterStatus(v)}
            options={STATUS_OPTIONS}
            active={filters.status !== 'all'}
            onClear={filters.status !== 'all' ? () => handleFilterStatus('all') : undefined}
          />
          <ChipDate
            label="Desde"
            value={filters.from}
            onChange={(v) => handleDateFilter('from', v)}
            onClear={filters.from ? () => handleDateFilter('from', '') : undefined}
          />
          <ChipDate
            label="Hasta"
            value={filters.to}
            onChange={(v) => handleDateFilter('to', v)}
            onClear={filters.to ? () => handleDateFilter('to', '') : undefined}
          />
          <div className="ml-auto text-[12px] text-zinc-500">
            <span
              className="tabular-nums font-medium text-zinc-700"
              style={{ fontFamily: FONT_MONO }}
            >
              {total}
            </span>{' '}
            resultados
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border-b border-red-200 text-red-700 px-8 py-3 text-[13px]">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-7 w-7 border-b-2" style={{ borderColor: '#1f3a8a' }} />
          </div>
        ) : ordenes.length === 0 && !error ? (
          <div className="py-16 text-center text-[13px] text-zinc-500">
            No hay órdenes con estos filtros.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-[#fcfcfb] border-b border-zinc-200">
                <tr>
                  <Th>ID / fecha</Th>
                  <Th width="28%">Paciente</Th>
                  <Th>Médico</Th>
                  <Th>Tipo</Th>
                  <Th>Atención</Th>
                  <Th>Estado</Th>
                  <Th align="right">Acciones</Th>
                </tr>
              </thead>
              <tbody>
                {ordenes.map((o) => {
                  const variant = statusVariant(o.atendido);
                  return (
                    <tr
                      key={o._id}
                      className="border-b border-zinc-100 hover:bg-zinc-50 transition-colors"
                      style={{ height: 58 }}
                    >
                      <td className="px-[14px] py-2.5">
                        <div
                          className="text-[12px] text-zinc-900 font-medium"
                          style={{ fontFamily: FONT_MONO }}
                        >
                          {ordenCodigo(o)}
                        </div>
                        <div
                          className="text-[10.5px] text-zinc-400"
                          style={{ fontFamily: FONT_MONO }}
                        >
                          {fmtFechaCorta(o.createdAt) || '—'}
                        </div>
                      </td>
                      <td className="px-[14px] py-2.5">
                        <div className="flex items-center gap-3">
                          <MonoAvatar
                            initials={initialsOf(o.primerNombre, o.primerApellido)}
                          />
                          <div className="min-w-0">
                            <div className="text-[14px] font-medium text-zinc-900 truncate">
                              {o.primerNombre} {o.primerApellido}
                            </div>
                            <div
                              className="text-[11px] text-zinc-500 truncate"
                              style={{ fontFamily: FONT_MONO }}
                            >
                              CC {o.numeroId}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-[14px] py-2.5 text-zinc-700">
                        {o.medico || '—'}
                      </td>
                      <td className="px-[14px] py-2.5 text-zinc-700">
                        {o.tipoExamen || '—'}
                      </td>
                      <td className="px-[14px] py-2.5 tabular-nums text-zinc-700">
                        {fmtFechaHora(o.fechaAtencion, o.horaAtencion)}
                      </td>
                      <td className="px-[14px] py-2.5">
                        <Pill variant={variant}>
                          {(o.atendido || 'PENDIENTE').toUpperCase()}
                        </Pill>
                      </td>
                      <td className="px-[14px] py-2.5 text-right">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => openEdit(o)}
                            title="Editar"
                            className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                          >
                            <Pencil className="w-[14px] h-[14px]" />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(o)}
                            title="Eliminar"
                            className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-[14px] h-[14px]" />
                          </button>
                          <button
                            title="Más"
                            className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                          >
                            <MoreHorizontal className="w-[14px] h-[14px]" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer paginación */}
        {!loading && ordenes.length > 0 && (
          <div className="px-8 py-3.5 bg-[#fcfcfb] text-[12px] text-zinc-500 flex items-center justify-between border-t border-zinc-200">
            <div>
              Mostrando{' '}
              <span className="tabular-nums" style={{ fontFamily: FONT_MONO }}>
                {page * 20 + 1}–{Math.min((page + 1) * 20, total)}
              </span>{' '}
              de{' '}
              <span className="tabular-nums" style={{ fontFamily: FONT_MONO }}>
                {total}
              </span>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                  aria-label="Anterior"
                >
                  ‹
                </button>
                <span
                  className="h-7 px-2 inline-flex items-center justify-center rounded border border-zinc-300 text-zinc-900 tabular-nums"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {page + 1}
                </span>
                <span className="text-zinc-400 text-[11px] px-1">de</span>
                <span
                  className="text-zinc-500 tabular-nums px-1"
                  style={{ fontFamily: FONT_MONO }}
                >
                  {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="h-7 w-7 inline-flex items-center justify-center rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40"
                  aria-label="Siguiente"
                >
                  ›
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal crear / editar — restyle leve, contrato funcional intacto */}
      {modalOrden !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setModalOrden(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
            style={{ fontFamily: FONT_INTER }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-zinc-200 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <h2 className="text-[16px] font-semibold text-zinc-900">
                {isEditMode ? 'Editar orden' : 'Nueva orden'}
              </h2>
              <button
                onClick={() => setModalOrden(null)}
                className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h3 className={`${SECTION_LABEL} mb-3`}>Datos del paciente</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormField label="Primer Nombre *" value={formData.primerNombre} onChange={(v) => handleField('primerNombre', v)} />
                  <FormField label="Segundo Nombre" value={formData.segundoNombre} onChange={(v) => handleField('segundoNombre', v)} />
                  <FormField label="Primer Apellido *" value={formData.primerApellido} onChange={(v) => handleField('primerApellido', v)} />
                  <FormField label="Segundo Apellido" value={formData.segundoApellido} onChange={(v) => handleField('segundoApellido', v)} />
                  <FormField label="Número de Cédula *" value={formData.numeroId} onChange={(v) => handleField('numeroId', v)} />
                  <FormField label="Celular *" value={formData.celular} onChange={(v) => handleField('celular', v)} />
                </div>
              </div>

              <div>
                <h3 className={`${SECTION_LABEL} mb-3`}>Datos de la cita</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Médico *</label>
                    <select
                      value={formData.medico}
                      onChange={(e) => {
                        handleField('medico', e.target.value);
                        handleField('horaAtencion', '');
                      }}
                      className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full bg-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="">Seleccionar profesional…</option>
                      {profesionales.map((p) => (
                        <option key={p.id} value={p.codigo}>
                          {p.alias || `${p.primerNombre} ${p.primerApellido}`} · {p.codigo} ·{' '}
                          {p.rol === 'coach' ? 'Coach' : 'Médico'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Modalidad</label>
                    <select
                      value={modalidad}
                      onChange={(e) => {
                        setModalidad(e.target.value as Modalidad);
                        handleField('horaAtencion', '');
                      }}
                      className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full bg-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="virtual">Virtual</option>
                      <option value="presencial">Presencial</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Tipo de Examen</label>
                    <select
                      value={formData.tipoExamen}
                      onChange={(e) => handleField('tipoExamen', e.target.value)}
                      className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full bg-white focus:outline-none focus:border-zinc-400"
                    >
                      <option value="">Seleccionar…</option>
                      <option value="Ingreso">Ingreso</option>
                      <option value="Periódico">Periódico</option>
                      <option value="Egreso">Egreso</option>
                      <option value="Otro">Otro</option>
                    </select>
                  </div>
                  <FormField label="Empresa" value={formData.empresa} onChange={(v) => handleField('empresa', v)} />
                  <div className="sm:col-span-2">
                    <FormField label="Exámenes" value={formData.examenes} onChange={(v) => handleField('examenes', v)} placeholder="Ej: EXAMEN MÉDICO OCUPACIONAL, AUDIOMETRÍA" />
                  </div>
                  <FormField label="Ciudad" value={formData.ciudad} onChange={(v) => handleField('ciudad', v)} />
                  <div>
                    <label className="block text-[11px] text-zinc-500 mb-1">Fecha de Atención *</label>
                    <input
                      type="date"
                      value={formData.fechaAtencion}
                      onChange={(e) => {
                        handleField('fechaAtencion', e.target.value);
                        handleField('horaAtencion', '');
                      }}
                      className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full focus:outline-none focus:border-zinc-400"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="block text-[11px] text-zinc-500 mb-1">
                      Hora de Atención *{' '}
                      <span className="text-zinc-400">(según disponibilidad del médico)</span>
                    </label>
                    {!medicoSeleccionado || !formData.fechaAtencion ? (
                      <div className="border border-zinc-200 rounded-md p-3 text-[12px] text-zinc-400">
                        Selecciona médico y fecha para ver los horarios disponibles.
                      </div>
                    ) : loadingHorarios ? (
                      <div className="border border-zinc-200 rounded-md p-3 text-[12px] text-zinc-400">
                        Cargando horarios…
                      </div>
                    ) : !horarios || horarios.horarios.length === 0 ? (
                      <div className="border border-amber-200 bg-amber-50 rounded-md p-3 flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                        <div className="text-[12px] text-amber-800 flex-1">
                          <p className="font-medium">Sin disponibilidad configurada</p>
                          <p>
                            {medicoSeleccionado.alias ||
                              `${medicoSeleccionado.primerNombre} ${medicoSeleccionado.primerApellido}`}{' '}
                            no tiene horarios en modalidad <strong>{modalidad}</strong> para este día. Puedes
                            ingresar una hora manual:
                          </p>
                          <input
                            type="time"
                            value={formData.horaAtencion}
                            onChange={(e) => handleField('horaAtencion', e.target.value)}
                            step="600"
                            className="mt-2 px-2 py-1 border border-amber-300 rounded-md text-[12px]"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-48 overflow-y-auto border border-zinc-200 rounded-md p-2">
                          {horarios.horarios.map((slot) => (
                            <button
                              key={slot.hora}
                              type="button"
                              onClick={() => slot.disponible && handleField('horaAtencion', slot.hora)}
                              disabled={!slot.disponible}
                              className={`px-2 py-1.5 text-[12px] rounded-md border tabular-nums ${
                                formData.horaAtencion === slot.hora
                                  ? 'text-white border-transparent'
                                  : slot.disponible
                                    ? 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50'
                                    : 'bg-zinc-50 text-zinc-300 border-zinc-200 cursor-not-allowed line-through'
                              }`}
                              style={
                                formData.horaAtencion === slot.hora
                                  ? { background: '#1f3a8a' }
                                  : undefined
                              }
                            >
                              {slot.hora}
                            </button>
                          ))}
                        </div>
                        <p className="text-[10.5px] text-zinc-400 mt-1">
                          {horarios.horarios.filter((s) => s.disponible).length} libres de{' '}
                          {horarios.horarios.length} · bloques de {horarios.tiempoConsulta} min
                        </p>
                      </>
                    )}
                  </div>

                  {isEditMode && (
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">Estado</label>
                      <select
                        value={formData.atendido}
                        onChange={(e) => handleField('atendido', e.target.value)}
                        className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full bg-white focus:outline-none focus:border-zinc-400"
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

            <div className="border-t border-zinc-200 px-6 py-4 flex justify-end gap-3 bg-zinc-50 rounded-b-xl">
              <button
                onClick={() => setModalOrden(null)}
                className="px-4 py-2 text-[13px] text-zinc-700 border border-zinc-200 rounded-md hover:bg-white"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-[13px] font-medium text-white rounded-md disabled:opacity-50"
                style={{ background: '#1f3a8a' }}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal eliminar */}
      {deleteTarget !== null && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => setDeleteTarget(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6"
            style={{ fontFamily: FONT_INTER }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900 text-[14px]">Eliminar orden</h3>
                <p className="text-[12.5px] text-zinc-500">
                  {nombreCompleto(deleteTarget)} · esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-[13px] text-zinc-700 border border-zinc-200 rounded-md hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-[13px] font-medium bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Helpers locales: Th, FormField, ChipSelect, ChipDate
// ----------------------------------------------------------------------------

function Th({
  children,
  align = 'left',
  width,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  width?: string;
}) {
  return (
    <th
      className={`px-[14px] py-[10px] text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
      style={width ? { width } : undefined}
    >
      {children}
    </th>
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
      <label className="block text-[11px] text-zinc-500 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="border border-zinc-200 rounded-md px-3 py-2 text-[13px] w-full focus:outline-none focus:border-zinc-400"
      />
    </div>
  );
}

function ChipSelect({
  label,
  value,
  onChange,
  options,
  active = false,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  active?: boolean;
  onClear?: () => void;
}) {
  const stateCls = active ? 'bg-[#eef2ff] text-[#1e3a8a]' : 'bg-white text-zinc-800';
  const borderColor = active ? '#1f3a8a' : '#d4d4d8';
  return (
    <div
      className={`relative inline-flex items-center h-[30px] rounded-md border text-[12.5px] font-medium ${stateCls}`}
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
      {active && onClear ? (
        <button
          onClick={onClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/60"
          aria-label="Quitar"
        >
          <X className="w-3 h-3 text-[#1e3a8a]" />
        </button>
      ) : (
        <ChevronDown className="w-3 h-3 text-zinc-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      )}
    </div>
  );
}

function ChipDate({
  label,
  value,
  onChange,
  onClear,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onClear?: () => void;
}) {
  const active = !!value;
  const stateCls = active ? 'bg-[#eef2ff] text-[#1e3a8a]' : 'bg-white text-zinc-800';
  const borderColor = active ? '#1f3a8a' : '#d4d4d8';
  return (
    <div
      className={`relative inline-flex items-center h-[30px] rounded-md border text-[12.5px] font-medium ${stateCls}`}
      style={{ fontFamily: FONT_INTER, borderColor }}
    >
      <span
        className={`pl-[11px] pr-1 font-normal ${active ? 'text-[#1e3a8a]/70' : 'text-zinc-500'}`}
      >
        {label}:
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent h-[30px] outline-none text-[12.5px] font-medium pr-7"
        style={{ fontFamily: FONT_INTER }}
      />
      {active && onClear && (
        <button
          onClick={onClear}
          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-white/60"
          aria-label="Quitar"
        >
          <X className="w-3 h-3 text-[#1e3a8a]" />
        </button>
      )}
    </div>
  );
}

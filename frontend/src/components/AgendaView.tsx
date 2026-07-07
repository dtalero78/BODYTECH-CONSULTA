import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pencil,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
  MessageCircle,
} from 'lucide-react';
import medicalPanelService, {
  OrdenRow,
} from '../services/medical-panel.service';
import { WhatsappChatDrawer } from './WhatsappChatDrawer';

interface AgendaViewProps {
  medicoCode: string;
}

/**
 * Tipos de examen aceptados — mismo conjunto que `AgendarCitaModal`.
 * Se duplica intencionalmente acá para minimizar el cambio de superficie
 * (el spec lo permite explícitamente).
 */
const TIPO_EXAMEN_OPTIONS: string[] = [
  'Periódico',
  'Ingreso',
  'Retiro',
  'Post-incapacidad',
  'Especial',
  'Consulta médica',
  'Otro',
];

/**
 * Fecha actual en TZ Colombia (UTC-5) como `YYYY-MM-DD`.
 * Replica el patrón de `todayInColombiaYYYYMMDD` de `AgendarCitaModal`:
 * resta 5h sobre `Date.now()` y lee `getUTC*` para no depender de la
 * zona horaria local del navegador / server (el server prod corre UTC).
 */
function todayInColombiaYYYYMMDD(): string {
  const t = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * "Hoy + 7 días" en TZ Colombia (UTC-5) como `YYYY-MM-DD`.
 */
function sevenDaysFromColombiaYYYYMMDD(): string {
  const t = new Date(
    Date.now() - 5 * 60 * 60 * 1000 + 7 * 24 * 60 * 60 * 1000
  );
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formatea una fecha → `DD/MM/YYYY` tomando sólo la parte `YYYY-MM-DD` inicial.
 * `fechaAtencion` viene como TEXT con formatos mezclados: fecha sola
 * (`2026-05-14`), ISO con hora/offset (`2026-06-03T17:00:00.000+00:00`) o con
 * espacio (`2026-03-14 23:40:00+00`). Antes hacíamos `split('-')` y los valores
 * con hora se renderizaban como `03T17:00:00.000+00:00/06/2026`.
 * NO usar `new Date(s).toLocaleDateString()` — `'2026-05-14'` se parsea como UTC
 * y en TZ Colombia mostraría el día anterior.
 */
function fmtFecha(s: string): string {
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

function fullName(row: OrdenRow): string {
  return [
    row.primerNombre,
    row.segundoNombre,
    row.primerApellido,
    row.segundoApellido,
  ]
    .filter(Boolean)
    .join(' ');
}

interface EditForm {
  fechaAtencion: string;
  horaAtencion: string;
  tipoExamen: string;
  empresa: string;
  celular: string;
}

interface EditModalProps {
  orden: OrdenRow;
  medicoCode: string;
  onClose: () => void;
}

function EditModal({ orden, medicoCode, onClose }: EditModalProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<EditForm>({
    fechaAtencion: orden.fechaAtencion || '',
    horaAtencion: orden.horaAtencion || '',
    tipoExamen: orden.tipoExamen || '',
    empresa: orden.empresa || '',
    celular: orden.celular || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inputClass =
    'w-full px-3 py-2 bg-[#2a3942] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884]';

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await medicalPanelService.updateOrden(orden.id, {
        fechaAtencion: form.fechaAtencion,
        horaAtencion: form.horaAtencion,
        tipoExamen: form.tipoExamen || undefined,
        empresa: form.empresa || undefined,
        celular: form.celular,
      });
      // Invalida por prefijo todas las páginas / filtros de la agenda.
      queryClient.invalidateQueries({ queryKey: ['ordenes', medicoCode] });
      onClose();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Error al guardar los cambios';
      setError(typeof msg === 'string' ? msg : 'Error al guardar los cambios');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1f2c34] rounded-2xl shadow-2xl max-w-md w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Editar Cita</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6 space-y-4">
            <div className="text-sm text-gray-400">
              Afiliado:{' '}
              <span className="text-white font-medium">{fullName(orden)}</span>
              <span className="text-gray-600 mx-2">·</span>
              Doc: <span className="text-white">{orden.numeroId}</span>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Fecha de atención
              </label>
              <input
                type="date"
                name="fechaAtencion"
                value={form.fechaAtencion}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Hora de atención
              </label>
              <input
                type="time"
                name="horaAtencion"
                value={form.horaAtencion}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Tipo de examen
              </label>
              <select
                name="tipoExamen"
                value={form.tipoExamen}
                onChange={handleChange}
                className={inputClass}
              >
                <option value="">-- Seleccionar --</option>
                {TIPO_EXAMEN_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Empresa
              </label>
              <input
                type="text"
                name="empresa"
                value={form.empresa}
                onChange={handleChange}
                className={inputClass}
                placeholder="Empresa"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Celular
              </label>
              <input
                type="text"
                name="celular"
                value={form.celular}
                onChange={handleChange}
                className={inputClass}
                placeholder="Ej: 3001234567"
              />
            </div>
          </div>

          {error && (
            <div className="mx-6 mb-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div className="border-t border-gray-700 px-6 py-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="bg-[#00a884] hover:bg-[#008f6f] text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Guardando...
                </>
              ) : (
                'Guardar cambios'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteConfirmProps {
  orden: OrdenRow;
  medicoCode: string;
  onClose: () => void;
}

function DeleteConfirm({ orden, medicoCode, onClose }: DeleteConfirmProps) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setError(null);
    setDeleting(true);
    try {
      await medicalPanelService.deleteOrden(orden.id);
      queryClient.invalidateQueries({ queryKey: ['ordenes', medicoCode] });
      onClose();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Error al eliminar la cita';
      setError(typeof msg === 'string' ? msg : 'Error al eliminar la cita');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1f2c34] rounded-2xl shadow-2xl max-w-sm w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold text-white mb-2">¿Eliminar esta cita?</h3>
        <p className="text-white mb-1">{fullName(orden)}</p>
        <p className="text-gray-400 text-sm mb-4">
          Esta acción no se puede deshacer.
        </p>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {deleting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Eliminando...
              </>
            ) : (
              'Sí, eliminar'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AgendaView({ medicoCode }: AgendaViewProps) {
  const [fechaDesde, setFechaDesde] = useState<string>(todayInColombiaYYYYMMDD());
  const [fechaHasta, setFechaHasta] = useState<string>(
    sevenDaysFromColombiaYYYYMMDD()
  );
  const [busqueda, setBusqueda] = useState<string>('');
  const [debouncedBusqueda, setDebouncedBusqueda] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [editingOrden, setEditingOrden] = useState<OrdenRow | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [chatOrden, setChatOrden] = useState<OrdenRow | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<boolean>(false);

  // Debounce de la búsqueda (~400ms) — no dispara fetch en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedBusqueda(busqueda), 400);
    return () => clearTimeout(t);
  }, [busqueda]);

  // Resetear `page` cuando cambian los filtros (NO incluir `page` en deps
  // para no crear un loop con la paginación).
  useEffect(() => {
    setPage(1);
  }, [fechaDesde, fechaHasta, debouncedBusqueda]);

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: [
      'ordenes',
      medicoCode,
      fechaDesde,
      fechaHasta,
      debouncedBusqueda,
      page,
    ],
    queryFn: () =>
      medicalPanelService.listOrdenes({
        medico: medicoCode,
        fechaDesde,
        fechaHasta,
        busqueda: debouncedBusqueda || undefined,
        // Agenda cronológica: ordenar por hora de atención ascendente.
        sort: 'fecha_asc',
        // `page` es 1-based para la UI ("Página X de N"), pero el backend
        // pagina en base 0 (offset = page * limit). Sin restar 1, page=1
        // generaba offset=20 y se saltaba la única página de resultados
        // (la tabla salía vacía aunque el contador `total` fuera correcto).
        page: page - 1,
        limit: 20,
      }),
    staleTime: 30_000,
  });

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 0;
  const rows: OrdenRow[] = data?.ordenes ?? [];

  const deletingOrden =
    deletingId !== null ? rows.find((r) => r.id === deletingId) ?? null : null;

  return (
    <div className="bg-[#1f2c34] rounded-2xl shadow-xl p-6">
      <h2 className="text-xl font-bold text-white mb-4">Agenda</h2>

      {/* Barra de filtros */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Desde
          </label>
          <input
            type="date"
            value={fechaDesde}
            onChange={(e) => setFechaDesde(e.target.value)}
            className="bg-[#2a3942] border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#00a884]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Hasta
          </label>
          <input
            type="date"
            value={fechaHasta}
            onChange={(e) => setFechaHasta(e.target.value)}
            className="bg-[#2a3942] border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-[#00a884]"
          />
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="block text-xs font-medium text-gray-400 mb-1">
            Buscar
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
              <Search size={16} />
            </div>
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar afiliado, cédula..."
              className="w-full bg-[#2a3942] border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884]"
            />
          </div>
        </div>
        <div className="bg-[#2a3942] border border-gray-600 rounded-lg px-3 py-2 text-sm text-white flex items-center gap-2">
          <span>{total} citas</span>
          {isFetching && !isLoading && (
            <Loader2 size={14} className="animate-spin text-gray-400" />
          )}
        </div>
      </div>

      {isError && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm mb-4">
          Error al cargar citas
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#2a3942] text-gray-300">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Fecha</th>
              <th className="text-left px-3 py-2 font-semibold">Hora</th>
              <th className="text-left px-3 py-2 font-semibold">Afiliado</th>
              <th className="text-left px-3 py-2 font-semibold">Cédula</th>
              <th className="text-left px-3 py-2 font-semibold">Teléfono</th>
              <th className="text-left px-3 py-2 font-semibold">Tipo Examen</th>
              <th className="text-left px-3 py-2 font-semibold">Empresa</th>
              <th className="text-right px-3 py-2 font-semibold">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 size={18} className="animate-spin" />
                    <span>Cargando citas...</span>
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8 text-gray-400">
                  No hay citas en el rango seleccionado
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-gray-700/50 hover:bg-[#2a3942]/60 transition"
                >
                  <td className="px-3 py-2 text-white whitespace-nowrap">
                    {fmtFecha(row.fechaAtencion)}
                  </td>
                  <td className="px-3 py-2 text-white whitespace-nowrap">
                    {row.horaAtencion}
                  </td>
                  <td className="px-3 py-2 text-white">{fullName(row)}</td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                    {row.numeroId}
                  </td>
                  <td className="px-3 py-2 text-gray-300 whitespace-nowrap">
                    {row.celular || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-300">
                    {row.tipoExamen || '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-300">
                    {row.empresa || '—'}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setChatOrden(row)}
                        disabled={!row.celular}
                        className="text-[#00a884] hover:text-[#00c298] transition disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Chat de WhatsApp"
                        title={row.celular ? 'Chat de WhatsApp' : 'Sin celular'}
                      >
                        <MessageCircle size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingOrden(row)}
                        className="text-blue-400 hover:text-blue-300 transition"
                        aria-label="Editar"
                        title="Editar"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeletingId(row.id);
                          setDeleteConfirm(true);
                        }}
                        className="text-red-400 hover:text-red-300 transition"
                        aria-label="Eliminar"
                        title="Eliminar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="flex items-center gap-1 px-4 py-2 bg-[#2a3942] text-white rounded-lg hover:bg-[#3a4952] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={16} />
            Anterior
          </button>
          <span className="text-gray-400">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages}
            className="flex items-center gap-1 px-4 py-2 bg-[#2a3942] text-white rounded-lg hover:bg-[#3a4952] transition disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Siguiente
            <ChevronRight size={16} />
          </button>
        </div>
      )}

      {/* Chat de WhatsApp del paciente */}
      {chatOrden !== null && (
        <WhatsappChatDrawer
          celular={chatOrden.celular}
          nombre={fullName(chatOrden)}
          onClose={() => setChatOrden(null)}
        />
      )}

      {/* Modal de edición */}
      {editingOrden !== null && (
        <EditModal
          orden={editingOrden}
          medicoCode={medicoCode}
          onClose={() => setEditingOrden(null)}
        />
      )}

      {/* Confirmación de eliminación */}
      {deleteConfirm && deletingOrden !== null && (
        <DeleteConfirm
          orden={deletingOrden}
          medicoCode={medicoCode}
          onClose={() => {
            setDeleteConfirm(false);
            setDeletingId(null);
          }}
        />
      )}
    </div>
  );
}

export default AgendaView;

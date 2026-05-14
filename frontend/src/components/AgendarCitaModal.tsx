import { useEffect, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import medicalPanelService from '../services/medical-panel.service';

interface AgendarCitaModalProps {
  open: boolean;
  medicoCode: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormState {
  numeroId: string;
  primerNombre: string;
  segundoNombre: string;
  primerApellido: string;
  segundoApellido: string;
  celular: string;
  empresa: string;
  tipoExamen: string;
  fechaAtencion: string;
  horaAtencion: string;
  ciudad: string;
}

/**
 * Devuelve la fecha actual en zona horaria Colombia (UTC-5) como YYYY-MM-DD.
 * Hace la resta de 5h sobre `Date.now()` y luego lee `getUTC*` para no
 * depender de la zona horaria local del navegador / servidor (en producción
 * el server corre UTC y `toLocaleDateString` con TZ específica es frágil
 * entre engines). Mismo patrón que `colombiaDay()` del backend.
 */
function todayInColombiaYYYYMMDD(): string {
  const t = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = t.getUTCFullYear();
  const m = String(t.getUTCMonth() + 1).padStart(2, '0');
  const d = String(t.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function initialForm(): FormState {
  return {
    numeroId: '',
    primerNombre: '',
    segundoNombre: '',
    primerApellido: '',
    segundoApellido: '',
    celular: '',
    empresa: '',
    tipoExamen: '',
    fechaAtencion: todayInColombiaYYYYMMDD(),
    horaAtencion: '08:00',
    ciudad: '',
  };
}

const TIPO_EXAMEN_OPTIONS: string[] = [
  'Periódico',
  'Ingreso',
  'Retiro',
  'Post-incapacidad',
  'Especial',
  'Consulta médica',
  'Otro',
];

export function AgendarCitaModal({
  open,
  medicoCode,
  onClose,
  onSuccess,
}: AgendarCitaModalProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLookedUp, setLastLookedUp] = useState<string>('');

  // Reset al abrir (false → true). Limpia campos, error y el cache del
  // último lookup. No resetear cuando `open` está estable evita perder
  // datos en re-renders del padre.
  useEffect(() => {
    if (open) {
      setForm(initialForm());
      setError(null);
      setSearching(false);
      setSubmitting(false);
      setLastLookedUp('');
    }
  }, [open]);

  if (!open) return null;

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleDocumentoBlur = async () => {
    const doc = form.numeroId.trim();
    if (doc.length < 5) return;
    if (doc === lastLookedUp) return;
    setLastLookedUp(doc);
    setSearching(true);
    try {
      const result = await medicalPanelService.lookupPatientForOrden(doc);
      if (result) {
        setForm((prev) => ({
          ...prev,
          primerNombre: result.primerNombre || prev.primerNombre,
          segundoNombre:
            result.segundoNombre !== undefined
              ? result.segundoNombre || ''
              : prev.segundoNombre,
          primerApellido: result.primerApellido || prev.primerApellido,
          segundoApellido:
            result.segundoApellido !== undefined
              ? result.segundoApellido || ''
              : prev.segundoApellido,
          celular: result.celular || prev.celular,
        }));
      }
      // Si no hay resultado, no mostramos error — el usuario completará
      // los campos manualmente.
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const required: Array<keyof FormState> = [
      'primerNombre',
      'primerApellido',
      'numeroId',
      'celular',
      'fechaAtencion',
      'horaAtencion',
    ];
    const missing = required.some((k) => !String(form[k] ?? '').trim());
    if (missing) {
      setError('Completa los campos obligatorios');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        primerNombre: form.primerNombre.trim(),
        segundoNombre: form.segundoNombre.trim() || undefined,
        primerApellido: form.primerApellido.trim(),
        segundoApellido: form.segundoApellido.trim() || undefined,
        numeroId: form.numeroId.trim(),
        celular: form.celular.trim(),
        empresa: form.empresa.trim() || undefined,
        tipoExamen: form.tipoExamen.trim() || undefined,
        medico: medicoCode,
        fechaAtencion: form.fechaAtencion,
        horaAtencion: form.horaAtencion,
        ciudad: form.ciudad.trim() || undefined,
      };
      await medicalPanelService.createOrden(payload);
      onSuccess();
      onClose();
    } catch (err: any) {
      const msg =
        err?.response?.data?.error ||
        err?.response?.data?.message ||
        'Error al agendar la cita';
      setError(typeof msg === 'string' ? msg : 'Error al agendar la cita');
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 bg-[#2a3942] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-[#00a884]';

  return (
    <div
      className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#1f2c34] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-xl font-bold text-white">Agendar Cita</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white transition"
            aria-label="Cerrar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-6">
            {/* Documento (numeroId) */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Documento <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  name="numeroId"
                  value={form.numeroId}
                  onChange={handleChange}
                  onBlur={handleDocumentoBlur}
                  className={`${inputClass} pr-10`}
                  placeholder="Número de documento"
                  autoComplete="off"
                />
                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-gray-400">
                  {searching ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Search size={18} />
                  )}
                </div>
              </div>
            </div>

            {/* Primer nombre */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Primer nombre <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="primerNombre"
                value={form.primerNombre}
                onChange={handleChange}
                className={inputClass}
                placeholder="Primer nombre"
              />
            </div>

            {/* Segundo nombre */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Segundo nombre
              </label>
              <input
                type="text"
                name="segundoNombre"
                value={form.segundoNombre}
                onChange={handleChange}
                className={inputClass}
                placeholder="Segundo nombre"
              />
            </div>

            {/* Primer apellido */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Primer apellido <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                name="primerApellido"
                value={form.primerApellido}
                onChange={handleChange}
                className={inputClass}
                placeholder="Primer apellido"
              />
            </div>

            {/* Segundo apellido */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Segundo apellido
              </label>
              <input
                type="text"
                name="segundoApellido"
                value={form.segundoApellido}
                onChange={handleChange}
                className={inputClass}
                placeholder="Segundo apellido"
              />
            </div>

            {/* Celular */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Celular <span className="text-red-400">*</span>
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

            {/* Empresa */}
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

            {/* Tipo de examen */}
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

            {/* Ciudad */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Ciudad
              </label>
              <input
                type="text"
                name="ciudad"
                value={form.ciudad}
                onChange={handleChange}
                className={inputClass}
                placeholder="Ciudad"
              />
            </div>

            {/* Fecha de atención */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Fecha de atención <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                name="fechaAtencion"
                value={form.fechaAtencion}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            {/* Hora de atención */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Hora de atención <span className="text-red-400">*</span>
              </label>
              <input
                type="time"
                name="horaAtencion"
                value={form.horaAtencion}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="mx-6 mb-4 bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Footer */}
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
              disabled={submitting}
              className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Agendando...
                </>
              ) : (
                'Agendar Cita'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AgendarCitaModal;

import { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2 } from 'lucide-react';
import medicalPanelService from '../services/medical-panel.service';
import calendarioService, { Modalidad, SlotHora } from '../services/calendario.service';
import profesionalesService, { Profesional } from '../services/profesionales.service';

interface AgendarCitaModalProps {
  open: boolean;
  /** Código del médico fijo (panel del profesional). Si se omite junto con
   *  `allowMedicoSelect`, no se podrá agendar hasta elegir uno. */
  medicoCode?: string;
  /** Cuando es true (dashboard admin) se muestra un selector de profesional. */
  allowMedicoSelect?: boolean;
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
 * depender de la zona horaria local del navegador / servidor.
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
    horaAtencion: '',
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

function nombreProfesional(p: Profesional): string {
  return (
    p.alias?.trim() ||
    [p.primerNombre, p.primerApellido].filter(Boolean).join(' ') ||
    p.codigo
  );
}

export function AgendarCitaModal({
  open,
  medicoCode,
  allowMedicoSelect = false,
  onClose,
  onSuccess,
}: AgendarCitaModalProps) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLookedUp, setLastLookedUp] = useState<string>('');

  // Agendamiento por cupos
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  const [selectedMedico, setSelectedMedico] = useState<string>('');
  const [medicos, setMedicos] = useState<Profesional[]>([]);
  const [slots, setSlots] = useState<SlotHora[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsLoaded, setSlotsLoaded] = useState(false);

  // Reset al abrir (false → true).
  useEffect(() => {
    if (open) {
      setForm(initialForm());
      setError(null);
      setSearching(false);
      setSubmitting(false);
      setLastLookedUp('');
      setModalidad('virtual');
      setSelectedMedico(medicoCode ?? '');
      setSlots([]);
      setSlotsLoaded(false);
    }
  }, [open, medicoCode]);

  // Cargar profesionales activos (para resolver profesionalId y el selector admin).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    profesionalesService
      .list({ activo: true })
      .then((list) => {
        if (!cancelled) setMedicos(list);
      })
      .catch(() => {
        if (!cancelled) setMedicos([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const profesional = useMemo(
    () => medicos.find((m) => m.codigo === selectedMedico) ?? null,
    [medicos, selectedMedico]
  );
  const profesionalId = profesional?.id ?? null;

  // Cargar horarios disponibles cuando hay fecha + profesional + modalidad.
  useEffect(() => {
    if (!open) return;
    if (!profesionalId || !form.fechaAtencion) {
      setSlots([]);
      setSlotsLoaded(false);
      return;
    }
    let cancelled = false;
    setLoadingSlots(true);
    setSlotsLoaded(false);
    calendarioService
      .getHorariosDisponibles(form.fechaAtencion, profesionalId, modalidad)
      .then((res) => {
        if (cancelled) return;
        setSlots(res?.horarios ?? []);
        setSlotsLoaded(true);
        // Si la hora elegida ya no está disponible, límpiala.
        setForm((prev) => {
          const stillOk = (res?.horarios ?? []).some(
            (s) => s.hora === prev.horaAtencion && s.disponible
          );
          return stillOk ? prev : { ...prev, horaAtencion: '' };
        });
      })
      .catch(() => {
        if (cancelled) return;
        setSlots([]);
        setSlotsLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, profesionalId, form.fechaAtencion, modalidad]);

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
    } finally {
      setSearching(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedMedico) {
      setError('Selecciona el profesional para la cita');
      return;
    }

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
      setError('Completa los campos obligatorios (incluida la hora)');
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
        medico: selectedMedico,
        fechaAtencion: form.fechaAtencion,
        horaAtencion: form.horaAtencion,
        ciudad: form.ciudad.trim() || undefined,
        modalidad,
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

  // ¿Mostramos grilla de slots o input manual de hora?
  const hasSlots = slots.length > 0;
  const showManualHora = !profesionalId || (slotsLoaded && !hasSlots && !loadingSlots);

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
            {/* Selector de profesional (sólo admin) */}
            {allowMedicoSelect && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Profesional <span className="text-red-400">*</span>
                </label>
                <select
                  value={selectedMedico}
                  onChange={(e) => {
                    setSelectedMedico(e.target.value);
                    setForm((prev) => ({ ...prev, horaAtencion: '' }));
                  }}
                  className={inputClass}
                >
                  <option value="">-- Seleccionar profesional --</option>
                  {medicos.map((m) => (
                    <option key={m.id} value={m.codigo}>
                      {nombreProfesional(m)} ({m.codigo})
                    </option>
                  ))}
                </select>
              </div>
            )}

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

            {/* Modalidad */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Modalidad
              </label>
              <div className="flex rounded-lg overflow-hidden border border-gray-600">
                {(['virtual', 'presencial'] as Modalidad[]).map((mod) => (
                  <button
                    key={mod}
                    type="button"
                    onClick={() => {
                      setModalidad(mod);
                      setForm((prev) => ({ ...prev, horaAtencion: '' }));
                    }}
                    className={`flex-1 px-3 py-2 text-sm font-medium transition-colors capitalize ${
                      modalidad === mod
                        ? 'bg-[#00a884] text-white'
                        : 'bg-[#2a3942] text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {mod}
                  </button>
                ))}
              </div>
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
                min={todayInColombiaYYYYMMDD()}
                onChange={handleChange}
                className={inputClass}
              />
            </div>

            {/* Horarios disponibles */}
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Hora de atención <span className="text-red-400">*</span>
                {profesional && (
                  <span className="text-gray-500 font-normal ml-2">
                    · turnos de {profesional.tiempoConsulta} min
                  </span>
                )}
              </label>

              {!selectedMedico ? (
                <p className="text-sm text-gray-500">
                  Selecciona un profesional para ver los horarios disponibles.
                </p>
              ) : loadingSlots ? (
                <div className="flex items-center gap-2 text-gray-400 text-sm py-2">
                  <Loader2 size={16} className="animate-spin" /> Cargando horarios…
                </div>
              ) : hasSlots ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {slots.map((s) => {
                    const selected = form.horaAtencion === s.hora;
                    return (
                      <button
                        key={s.hora}
                        type="button"
                        disabled={!s.disponible}
                        onClick={() =>
                          setForm((prev) => ({ ...prev, horaAtencion: s.hora }))
                        }
                        className={`px-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                          selected
                            ? 'bg-[#00a884] text-white'
                            : s.disponible
                              ? 'bg-[#2a3942] text-gray-200 hover:bg-gray-700 border border-gray-600'
                              : 'bg-[#2a3942]/40 text-gray-600 line-through cursor-not-allowed'
                        }`}
                        title={s.disponible ? 'Disponible' : 'Ocupado'}
                      >
                        {s.hora}
                      </button>
                    );
                  })}
                </div>
              ) : showManualHora ? (
                <>
                  <input
                    type="time"
                    name="horaAtencion"
                    value={form.horaAtencion}
                    onChange={handleChange}
                    step={600}
                    className={inputClass}
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Este profesional no tiene horarios configurados para este día.
                    Puedes ingresar la hora manualmente (se valida que no choque con
                    otra cita).
                  </p>
                </>
              ) : null}
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

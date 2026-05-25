import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Copy } from 'lucide-react';
import profesionalesService, {
  Profesional,
  Modalidad,
  Rango,
  DiaRangos,
} from '../../services/profesionales.service';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  profesional: Profesional | null;
  onSaved: () => void;
  onError: (message: string) => void;
}

const DIAS = [
  { id: 1, label: 'Lunes' },
  { id: 2, label: 'Martes' },
  { id: 3, label: 'Miércoles' },
  { id: 4, label: 'Jueves' },
  { id: 5, label: 'Viernes' },
  { id: 6, label: 'Sábado' },
  { id: 0, label: 'Domingo' },
];

const NEW_RANGE: Rango = { horaInicio: '08:00', horaFin: '17:00' };

interface DiaState {
  activo: boolean;
  rangos: Rango[];
}

function emptyDiaState(): DiaState {
  return { activo: false, rangos: [] };
}

export function DisponibilidadModal({ isOpen, onClose, profesional, onSaved, onError }: Props) {
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  // Estado por día (clave: diaSemana 0-6).
  const [diasState, setDiasState] = useState<Record<number, DiaState>>(() => {
    const obj: Record<number, DiaState> = {};
    for (const d of DIAS) obj[d.id] = emptyDiaState();
    return obj;
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Cargar disponibilidad existente cada vez que cambia profesional o modalidad.
  useEffect(() => {
    if (!isOpen || !profesional) return;

    let cancelled = false;
    setLoading(true);
    profesionalesService
      .getDisponibilidad(profesional.id, modalidad)
      .then((data) => {
        if (cancelled) return;
        const next: Record<number, DiaState> = {};
        for (const d of DIAS) next[d.id] = emptyDiaState();
        for (const dia of data.dias) {
          next[dia.diaSemana] = {
            activo: dia.rangos.length > 0,
            rangos: dia.rangos.map((r) => ({
              horaInicio: r.horaInicio.slice(0, 5),
              horaFin: r.horaFin.slice(0, 5),
            })),
          };
        }
        setDiasState(next);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg =
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (err as any)?.response?.data?.error?.message || 'Error cargando disponibilidad.';
        onError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, profesional, modalidad]);

  if (!isOpen || !profesional) return null;

  function toggleDia(dia: number) {
    setDiasState((prev) => {
      const current = prev[dia];
      if (current.activo) {
        return { ...prev, [dia]: { activo: false, rangos: [] } };
      }
      return { ...prev, [dia]: { activo: true, rangos: [{ ...NEW_RANGE }] } };
    });
  }

  function updateRango(dia: number, idx: number, key: keyof Rango, value: string) {
    setDiasState((prev) => {
      const current = prev[dia];
      const newRangos = current.rangos.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
      return { ...prev, [dia]: { ...current, rangos: newRangos } };
    });
  }

  function addRango(dia: number) {
    setDiasState((prev) => ({
      ...prev,
      [dia]: { ...prev[dia], rangos: [...prev[dia].rangos, { ...NEW_RANGE }] },
    }));
  }

  function removeRango(dia: number, idx: number) {
    setDiasState((prev) => {
      const current = prev[dia];
      const newRangos = current.rangos.filter((_, i) => i !== idx);
      return {
        ...prev,
        [dia]: { activo: newRangos.length > 0, rangos: newRangos },
      };
    });
  }

  function copiarATodos(diaFuente: number) {
    setDiasState((prev) => {
      const fuente = prev[diaFuente];
      if (!fuente.activo || fuente.rangos.length === 0) return prev;
      const next = { ...prev };
      for (const d of DIAS) {
        if (d.id === diaFuente) continue;
        next[d.id] = {
          activo: true,
          rangos: fuente.rangos.map((r) => ({ ...r })),
        };
      }
      return next;
    });
  }

  async function handleGuardar() {
    if (!profesional) return;
    // Validar localmente
    const dias: DiaRangos[] = [];
    for (const d of DIAS) {
      const state = diasState[d.id];
      if (!state.activo) continue;
      if (state.rangos.length === 0) continue;
      for (const r of state.rangos) {
        if (r.horaInicio >= r.horaFin) {
          onError(`${d.label}: la hora de inicio debe ser anterior a la hora de fin.`);
          return;
        }
      }
      dias.push({ diaSemana: d.id, rangos: state.rangos });
    }

    setSaving(true);
    try {
      await profesionalesService.replaceDisponibilidad(profesional.id, modalidad, dias);
      onSaved();
    } catch (err: unknown) {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.error?.message ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.message ||
        'Error guardando disponibilidad.';
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  const nombreCompleto = profesional.alias
    ? profesional.alias
    : [profesional.primerNombre, profesional.primerApellido].filter(Boolean).join(' ');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end">
      <div className="bg-white w-full max-w-xl h-full overflow-y-auto shadow-xl">
        {/* Header sticky */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Fijar disponibilidad</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {nombreCompleto} · {profesional.codigo}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs modalidad */}
        <div className="px-5 pt-4">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
            {(['virtual', 'presencial'] as Modalidad[]).map((m) => (
              <button
                key={m}
                onClick={() => setModalidad(m)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  modalidad === m
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {m === 'virtual' ? 'Virtual' : 'Presencial'}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-2">
            La disponibilidad se guarda por separado para cada modalidad.
          </p>
        </div>

        {/* Grilla días */}
        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-gray-500 text-center py-8">Cargando disponibilidad...</p>
          ) : (
            DIAS.map((d) => {
              const state = diasState[d.id];
              return (
                <div
                  key={d.id}
                  className={`rounded-lg border ${
                    state.activo ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between p-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={state.activo}
                        onChange={() => toggleDia(d.id)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">{d.label}</span>
                    </label>
                    {state.activo && state.rangos.length > 0 && (
                      <button
                        onClick={() => copiarATodos(d.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                        title="Copiar estos rangos a todos los días"
                      >
                        <Copy className="w-3.5 h-3.5" />
                        Copiar a todos
                      </button>
                    )}
                  </div>

                  {state.activo && (
                    <div className="px-3 pb-3 space-y-2">
                      {state.rangos.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={r.horaInicio}
                            onChange={(e) => updateRango(d.id, i, 'horaInicio', e.target.value)}
                            className="px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-xs text-gray-400">a</span>
                          <input
                            type="time"
                            value={r.horaFin}
                            onChange={(e) => updateRango(d.id, i, 'horaFin', e.target.value)}
                            className="px-2 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => removeRango(d.id, i)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                            title="Eliminar rango"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addRango(d.id)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar rango
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer sticky */}
        <div className="p-5 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleGuardar}
            disabled={saving || loading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar disponibilidad'}
          </button>
        </div>
      </div>
    </div>
  );
}

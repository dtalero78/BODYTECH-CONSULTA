import { useState, useEffect, useMemo } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import calendarioService, {
  Modalidad,
  HorariosDisponibles,
} from '../../services/calendario.service';
import { Profesional } from '../../services/profesionales.service';
import { CitaListItem } from '../../services/calendario.service';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  citas: CitaListItem[];
  profesionales: Profesional[];
  fechaActual: string; // YYYY-MM-DD (la fecha del día seleccionado)
  onSaved: (afectadas: number) => void;
  onError: (message: string) => void;
}

type ModoFecha = 'mantener' | 'cambiar';

export function ReasignarModal({
  isOpen,
  onClose,
  citas,
  profesionales,
  fechaActual,
  onSaved,
  onError,
}: Props) {
  const [nuevoMedicoCodigo, setNuevoMedicoCodigo] = useState('');
  const [modoFecha, setModoFecha] = useState<ModoFecha>('mantener');
  const [nuevaFecha, setNuevaFecha] = useState(fechaActual);
  const [nuevaHora, setNuevaHora] = useState('');
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  const [horarios, setHorarios] = useState<HorariosDisponibles | null>(null);
  const [loadingHorarios, setLoadingHorarios] = useState(false);
  const [saving, setSaving] = useState(false);

  // Reset al abrir
  useEffect(() => {
    if (isOpen) {
      setNuevoMedicoCodigo('');
      setModoFecha('mantener');
      setNuevaFecha(fechaActual);
      setNuevaHora('');
      setModalidad('virtual');
      setHorarios(null);
    }
  }, [isOpen, fechaActual]);

  // Cargar slots cuando se selecciona médico + fecha en modo cambiar
  useEffect(() => {
    if (!isOpen || modoFecha !== 'cambiar' || !nuevoMedicoCodigo || !nuevaFecha) {
      setHorarios(null);
      return;
    }
    const prof = profesionales.find((p) => p.codigo === nuevoMedicoCodigo);
    if (!prof) {
      setHorarios(null);
      return;
    }
    let cancelled = false;
    setLoadingHorarios(true);
    calendarioService
      .getHorariosDisponibles(nuevaFecha, prof.id, modalidad)
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
  }, [isOpen, modoFecha, nuevoMedicoCodigo, nuevaFecha, modalidad, profesionales]);

  const medicoSeleccionado = useMemo(
    () => profesionales.find((p) => p.codigo === nuevoMedicoCodigo) ?? null,
    [profesionales, nuevoMedicoCodigo]
  );

  if (!isOpen) return null;

  async function handleSubmit() {
    if (!nuevoMedicoCodigo) {
      onError('Selecciona un médico destino.');
      return;
    }
    if (modoFecha === 'cambiar' && (!nuevaFecha || !nuevaHora)) {
      onError('Cuando cambias la fecha/hora, ambos campos son requeridos.');
      return;
    }
    setSaving(true);
    try {
      const payload: {
        citaIds: string[];
        nuevoMedicoCodigo: string;
        nuevaFechaAtencion?: string;
        nuevaHoraAtencion?: string;
      } = {
        citaIds: citas.map((c) => c.id),
        nuevoMedicoCodigo,
      };
      if (modoFecha === 'cambiar') {
        // Construir fechaAtencion ISO con offset Colombia (-05:00)
        payload.nuevaFechaAtencion = `${nuevaFecha}T${nuevaHora}:00-05:00`;
        payload.nuevaHoraAtencion = nuevaHora;
      }
      const result = await calendarioService.reasignarBulk(payload);
      onSaved(result.afectadas);
      onClose();
    } catch (err: unknown) {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.error?.message || 'Error reasignando citas.';
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-[55] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h2 className="text-lg font-semibold text-gray-800">Reasignar médico</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Resumen citas */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-sm font-medium text-blue-800">
              {citas.length} cita{citas.length !== 1 ? 's' : ''} seleccionada{citas.length !== 1 ? 's' : ''}
            </p>
            <p className="text-xs text-blue-600 mt-0.5 truncate">
              {citas.slice(0, 3).map((c) => c.nombre).join(', ')}
              {citas.length > 3 ? ` y ${citas.length - 3} más` : ''}
            </p>
          </div>

          {/* Médico destino */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">
              Médico destino *
            </label>
            <select
              value={nuevoMedicoCodigo}
              onChange={(e) => setNuevoMedicoCodigo(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Seleccionar profesional...</option>
              {profesionales
                .filter((p) => p.activo)
                .map((p) => (
                  <option key={p.id} value={p.codigo}>
                    {p.alias || `${p.primerNombre} ${p.primerApellido}`} · {p.codigo} · {p.rol === 'coach' ? 'Coach' : 'Médico'}
                  </option>
                ))}
            </select>
          </div>

          {/* Modo fecha */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">Fecha y hora</label>
            <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
              {(['mantener', 'cambiar'] as ModoFecha[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setModoFecha(m)}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                    modoFecha === m
                      ? 'bg-white text-blue-600 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m === 'mantener' ? 'Mantener fecha/hora' : 'Cambiar fecha/hora'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {modoFecha === 'mantener'
                ? 'Cada cita conserva su fecha y hora actuales.'
                : 'Todas las citas se moverán a la misma fecha y hora.'}
            </p>
          </div>

          {/* Si cambiar: fecha + hora */}
          {modoFecha === 'cambiar' && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">
                    Nueva fecha *
                  </label>
                  <input
                    type="date"
                    value={nuevaFecha}
                    onChange={(e) => setNuevaFecha(e.target.value)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">Modalidad</label>
                  <select
                    value={modalidad}
                    onChange={(e) => setModalidad(e.target.value as Modalidad)}
                    className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="virtual">Virtual</option>
                    <option value="presencial">Presencial</option>
                  </select>
                </div>
              </div>

              {/* Slots libres del médico */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Hora * <span className="text-gray-400">(según disponibilidad del médico)</span>
                </label>
                {!medicoSeleccionado ? (
                  <div className="border border-gray-200 rounded-lg p-3 text-xs text-gray-400">
                    Selecciona un médico para ver sus horarios.
                  </div>
                ) : loadingHorarios ? (
                  <div className="border border-gray-200 rounded-lg p-3 text-xs text-gray-400">
                    Cargando horarios...
                  </div>
                ) : !horarios || horarios.horarios.length === 0 ? (
                  <div className="border border-amber-200 bg-amber-50 rounded-lg p-3 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      <p className="font-medium">Sin disponibilidad</p>
                      <p>
                        {medicoSeleccionado.alias || `${medicoSeleccionado.primerNombre} ${medicoSeleccionado.primerApellido}`}{' '}
                        no tiene horarios configurados en modalidad <strong>{modalidad}</strong> para
                        este día. Puedes elegir un horario manual o configurar su disponibilidad
                        primero.
                      </p>
                      <input
                        type="time"
                        value={nuevaHora}
                        onChange={(e) => setNuevaHora(e.target.value)}
                        className="mt-2 px-2 py-1 border border-amber-300 rounded-md text-xs"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-2">
                    {horarios.horarios.map((slot) => (
                      <button
                        key={slot.hora}
                        type="button"
                        onClick={() => slot.disponible && setNuevaHora(slot.hora)}
                        disabled={!slot.disponible}
                        className={`px-2 py-1.5 text-xs rounded-md border transition-colors ${
                          nuevaHora === slot.hora
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
                )}
                {horarios && horarios.horarios.length > 0 && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    {horarios.horarios.filter((s) => s.disponible).length} slots libres de{' '}
                    {horarios.horarios.length} totales · bloques de {horarios.tiempoConsulta} min
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-5 border-t border-gray-100 sticky bottom-0 bg-white flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !nuevoMedicoCodigo}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Reasignando...' : `Reasignar ${citas.length} cita${citas.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DisponibilidadDiaModal — Editar la disponibilidad de TODOS los profesionales
// para UNA fecha concreta (override puntual), sin afectar el patrón semanal.
//
// Lo abre CalendarioView en modo "Disponibilidad" al hacer clic en un día.
// Carga el estado efectivo de cada profesional ese día (override existente o,
// si no hay, el patrón semanal pre-cargado). El coordinador puede:
//   - ajustar las franjas horarias del día,
//   - marcar al profesional como "No disponible este día" (bloqueo),
//   - restablecer al patrón semanal (borra el override).
// Guarda sólo los profesionales modificados.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Trash2, Search, RotateCcw, CalendarOff } from 'lucide-react';
import calendarioService, {
  DiaResumenProfesional,
  Modalidad,
  Rango,
} from '../../services/calendario.service';
import profesionalesService from '../../services/profesionales.service';
import { FONT_INTER, FONT_MONO } from './_tokens';

interface Props {
  fecha: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const NEW_RANGE: Rango = { horaInicio: '08:00', horaFin: '17:00' };

// Estado editable por profesional.
interface ProfEdit {
  base: DiaResumenProfesional; // estado cargado del servidor (referencia para "dirty")
  bloqueado: boolean;
  rangos: Rango[];
  overridden: boolean; // hay override explícito (servidor)
}

function hhmm(s: string): string {
  return s.slice(0, 5);
}

function rangosEqual(a: Rango[], b: Rango[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (hhmm(a[i].horaInicio) !== hhmm(b[i].horaInicio) || hhmm(a[i].horaFin) !== hhmm(b[i].horaFin)) {
      return false;
    }
  }
  return true;
}

// ¿El estado editado difiere de lo que hay en servidor?
function isDirty(p: ProfEdit): boolean {
  // Sin override en servidor y sin bloqueo: dirty sólo si el usuario cambió las franjas
  // respecto al patrón semanal pre-cargado, o activó el bloqueo.
  if (p.bloqueado !== p.base.bloqueado) return true;
  if (p.bloqueado) return false; // si bloqueado y base también bloqueado, ya cubierto arriba
  return !rangosEqual(p.rangos, p.base.rangos);
}

export function DisponibilidadDiaModal({ fecha, onClose, onSaved, showToast }: Props) {
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<number, ProfEdit>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await calendarioService.getDisponibilidadDia(fecha, modalidad);
      const next: Record<number, ProfEdit> = {};
      for (const p of data.profesionales) {
        next[p.profesionalId] = {
          base: p,
          bloqueado: p.bloqueado,
          rangos: p.rangos.map((r) => ({ horaInicio: hhmm(r.horaInicio), horaFin: hhmm(r.horaFin) })),
          overridden: p.overridden,
        };
      }
      setEdits(next);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: e?.response?.data?.error?.message || 'Error cargando disponibilidad del día.' });
    } finally {
      setLoading(false);
    }
  }, [fecha, modalidad, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const fechaFormateada = useMemo(() => {
    const [y, m, d] = fecha.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString('es-CO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }, [fecha]);

  const lista = useMemo(() => {
    const arr = Object.values(edits);
    const q = search.trim().toLowerCase();
    const filtered = q
      ? arr.filter(
          (p) =>
            p.base.nombre.toLowerCase().includes(q) || p.base.codigo.toLowerCase().includes(q)
        )
      : arr;
    return filtered.sort((a, b) => {
      if (a.base.rol !== b.base.rol) return (a.base.rol || '').localeCompare(b.base.rol || '');
      return a.base.nombre.localeCompare(b.base.nombre);
    });
  }, [edits, search]);

  const dirtyCount = useMemo(() => Object.values(edits).filter(isDirty).length, [edits]);

  // --- mutadores de estado ---
  function toggleBloqueado(id: number) {
    setEdits((prev) => {
      const cur = prev[id];
      const bloqueado = !cur.bloqueado;
      return {
        ...prev,
        [id]: {
          ...cur,
          bloqueado,
          // Al desbloquear, si no quedan rangos, sembrar uno por comodidad.
          rangos: bloqueado ? cur.rangos : cur.rangos.length > 0 ? cur.rangos : [{ ...NEW_RANGE }],
        },
      };
    });
  }

  function updateRango(id: number, idx: number, key: keyof Rango, value: string) {
    setEdits((prev) => {
      const cur = prev[id];
      const rangos = cur.rangos.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
      return { ...prev, [id]: { ...cur, rangos } };
    });
  }

  function addRango(id: number) {
    setEdits((prev) => {
      const cur = prev[id];
      return { ...prev, [id]: { ...cur, rangos: [...cur.rangos, { ...NEW_RANGE }] } };
    });
  }

  function removeRango(id: number, idx: number) {
    setEdits((prev) => {
      const cur = prev[id];
      return { ...prev, [id]: { ...cur, rangos: cur.rangos.filter((_, i) => i !== idx) } };
    });
  }

  // Validación de un profesional antes de guardar.
  function validate(p: ProfEdit): string | null {
    if (p.bloqueado) return null;
    for (const r of p.rangos) {
      if (hhmm(r.horaInicio) >= hhmm(r.horaFin)) {
        return `${p.base.nombre}: la hora de inicio debe ser anterior a la hora de fin.`;
      }
    }
    return null;
  }

  async function guardarUno(id: number) {
    const p = edits[id];
    if (!p) return;
    const err = validate(p);
    if (err) {
      showToast({ type: 'error', message: err });
      return;
    }
    try {
      const saved = await profesionalesService.replaceDisponibilidadFecha(id, {
        fecha,
        modalidad,
        bloqueado: p.bloqueado,
        rangos: p.bloqueado ? [] : p.rangos,
      });
      // Refrescar base con lo guardado.
      setEdits((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          base: { ...prev[id].base, bloqueado: saved.bloqueado, rangos: saved.rangos, overridden: saved.overridden, source: saved.overridden ? 'override' : 'weekly' },
          bloqueado: saved.bloqueado,
          rangos: saved.rangos.map((r) => ({ horaInicio: hhmm(r.horaInicio), horaFin: hhmm(r.horaFin) })),
          overridden: saved.overridden,
        },
      }));
      showToast({ type: 'success', message: `Disponibilidad de ${p.base.nombre} actualizada.` });
      onSaved();
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: ex?.response?.data?.error?.message || 'Error guardando disponibilidad.' });
    }
  }

  async function restablecer(id: number) {
    const p = edits[id];
    if (!p) return;
    try {
      await profesionalesService.deleteDisponibilidadFecha(id, fecha, modalidad);
      showToast({ type: 'success', message: `${p.base.nombre}: restablecido al patrón semanal.` });
      onSaved();
      // Recargar para traer el patrón semanal efectivo.
      await load();
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: ex?.response?.data?.error?.message || 'Error restableciendo.' });
    }
  }

  async function guardarTodos() {
    const dirty = Object.values(edits).filter(isDirty);
    if (dirty.length === 0) {
      showToast({ type: 'error', message: 'No hay cambios para guardar.' });
      return;
    }
    // Validar todos primero.
    for (const p of dirty) {
      const err = validate(p);
      if (err) {
        showToast({ type: 'error', message: err });
        return;
      }
    }
    setSavingAll(true);
    let okCount = 0;
    try {
      for (const p of dirty) {
        await profesionalesService.replaceDisponibilidadFecha(p.base.profesionalId, {
          fecha,
          modalidad,
          bloqueado: p.bloqueado,
          rangos: p.bloqueado ? [] : p.rangos,
        });
        okCount++;
      }
      showToast({ type: 'success', message: `${okCount} profesional${okCount !== 1 ? 'es' : ''} actualizado${okCount !== 1 ? 's' : ''}.` });
      onSaved();
      await load();
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: ex?.response?.data?.error?.message || `Error tras guardar ${okCount}. Reintenta.` });
      await load();
    } finally {
      setSavingAll(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={onClose}>
      <div
        className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl"
        style={{ fontFamily: FONT_INTER }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-zinc-100 sticky top-0 bg-white z-10">
          <div>
            <div className="text-[11px] text-zinc-400" style={{ fontFamily: FONT_MONO }}>
              / disponibilidad del día
            </div>
            <h2 className="text-lg font-semibold text-zinc-900 capitalize">{fechaFormateada}</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Edita la disponibilidad solo de este día. El patrón semanal de los demás días no se modifica.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-zinc-100 text-zinc-500"
            aria-label="Cerrar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs modalidad + búsqueda */}
        <div className="px-5 pt-4 space-y-3">
          <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg">
            {(['virtual', 'presencial'] as Modalidad[]).map((m) => (
              <button
                key={m}
                onClick={() => setModalidad(m)}
                className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  modalidad === m ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {m === 'virtual' ? 'Virtual' : 'Presencial'}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar profesional por nombre o código…"
              className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Lista de profesionales */}
        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-8">Cargando disponibilidad…</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No hay profesionales activos.</p>
          ) : (
            lista.map((p) => {
              const dirty = isDirty(p);
              return (
                <div
                  key={p.base.profesionalId}
                  className={`rounded-lg border ${
                    p.bloqueado
                      ? 'border-red-200 bg-red-50/30'
                      : p.overridden
                        ? 'border-blue-200 bg-blue-50/30'
                        : 'border-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-zinc-800 truncate">
                        {p.base.nombre}
                      </div>
                      <div className="text-[11px] text-zinc-500" style={{ fontFamily: FONT_MONO }}>
                        {p.base.codigo} · {p.base.rol === 'coach' ? 'Coach' : 'Médico'} ·{' '}
                        {p.overridden ? (
                          <span className="text-blue-600">override de este día</span>
                        ) : (
                          <span className="text-zinc-400">según patrón semanal</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.overridden && (
                        <button
                          onClick={() => restablecer(p.base.profesionalId)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-800 flex items-center gap-1"
                          title="Restablecer al patrón semanal"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Restablecer
                        </button>
                      )}
                      <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-zinc-600">
                        <input
                          type="checkbox"
                          checked={p.bloqueado}
                          onChange={() => toggleBloqueado(p.base.profesionalId)}
                          className="w-3.5 h-3.5 rounded text-red-600 focus:ring-red-500"
                        />
                        <CalendarOff className="w-3.5 h-3.5" />
                        No disponible
                      </label>
                    </div>
                  </div>

                  {!p.bloqueado && (
                    <div className="px-3 pb-3 space-y-2">
                      {p.rangos.length === 0 && (
                        <p className="text-[11px] text-zinc-400">Sin franjas. Agrega un rango horario.</p>
                      )}
                      {p.rangos.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <input
                            type="time"
                            value={r.horaInicio}
                            onChange={(e) => updateRango(p.base.profesionalId, i, 'horaInicio', e.target.value)}
                            className="px-2 py-1.5 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <span className="text-xs text-zinc-400">a</span>
                          <input
                            type="time"
                            value={r.horaFin}
                            onChange={(e) => updateRango(p.base.profesionalId, i, 'horaFin', e.target.value)}
                            className="px-2 py-1.5 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <button
                            onClick={() => removeRango(p.base.profesionalId, i)}
                            className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                            title="Eliminar rango"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => addRango(p.base.profesionalId)}
                          className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 mt-1"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Agregar rango
                        </button>
                        {dirty && (
                          <button
                            onClick={() => guardarUno(p.base.profesionalId)}
                            className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md mt-1"
                          >
                            Guardar
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {p.bloqueado && dirty && (
                    <div className="px-3 pb-3 flex justify-end">
                      <button
                        onClick={() => guardarUno(p.base.profesionalId)}
                        className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-md"
                      >
                        Guardar bloqueo
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-zinc-100 sticky bottom-0 bg-white flex gap-3 justify-end items-center">
          {dirtyCount > 0 && (
            <span className="text-xs text-zinc-500 mr-auto">
              {dirtyCount} cambio{dirtyCount !== 1 ? 's' : ''} sin guardar
            </span>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg"
          >
            Cerrar
          </button>
          <button
            onClick={guardarTodos}
            disabled={savingAll || loading || dirtyCount === 0}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {savingAll ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}

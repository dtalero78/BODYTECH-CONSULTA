// ============================================================================
// DisponibilidadDiaModal — Editar la disponibilidad de los profesionales para
// UNA fecha concreta (override puntual), sin afectar el patrón semanal.
//
// Lo abre CalendarioView en modo "Agenda de Turnos" al hacer clic en un día.
// Carga el estado efectivo de cada profesional ese día (override existente o,
// si no hay, el patrón semanal pre-cargado). El coordinador puede:
//   - filtrar por SEDE (dropdown) y por rol (médico/coach),
//   - ajustar las franjas horarias del día (individual),
//   - marcar al profesional como "No disponible este día" (bloqueo),
//   - restablecer al patrón semanal (borra el override),
//   - SELECCIONAR varios y aplicar en BULK un horario / bloqueo / restablecer.
// Guarda sólo los profesionales modificados.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { X, Plus, Trash2, Search, RotateCcw, CalendarOff, ChevronDown, Clock } from 'lucide-react';
import calendarioService, {
  DiaResumenProfesional,
  Modalidad,
  Rango,
} from '../../services/calendario.service';
import profesionalesService from '../../services/profesionales.service';
import authService, { Sede } from '../../services/auth.service';
import { FONT_INTER, FONT_MONO } from './_tokens';

interface Props {
  fecha: string; // YYYY-MM-DD
  onClose: () => void;
  onSaved: () => void;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const NEW_RANGE: Rango = { horaInicio: '08:00', horaFin: '17:00' };
type RolFiltro = 'todos' | 'medico' | 'coach';

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
  if (p.bloqueado !== p.base.bloqueado) return true;
  if (p.bloqueado) return false;
  return !rangosEqual(p.rangos, p.base.rangos);
}

export function DisponibilidadDiaModal({ fecha, onClose, onSaved, showToast }: Props) {
  const [modalidad, setModalidad] = useState<Modalidad>('virtual');
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [search, setSearch] = useState('');
  const [edits, setEdits] = useState<Record<number, ProfEdit>>({});

  // Sede + rol (filtros). La sede inicial es la del coordinador logueado.
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [sede, setSede] = useState<string>(() => authService.getSedeId() || '');
  const [rolFiltro, setRolFiltro] = useState<RolFiltro>('todos');

  // Selección múltiple + barra de acción masiva.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkRangos, setBulkRangos] = useState<Rango[]>([{ ...NEW_RANGE }]);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Cargar lista de sedes una vez.
  useEffect(() => {
    authService
      .getSedes()
      .then((s) => {
        setSedes(s);
        // Si el coordinador no tenía sede o no está en la lista, usar la primera.
        setSede((cur) => cur || (s[0]?.sedeId ?? ''));
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!sede) return;
    setLoading(true);
    try {
      const data = await calendarioService.getDisponibilidadDia(fecha, modalidad, sede);
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
      setSelected(new Set()); // limpiar selección al recargar (cambia el conjunto)
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: e?.response?.data?.error?.message || 'Error cargando disponibilidad del día.' });
    } finally {
      setLoading(false);
    }
  }, [fecha, modalidad, sede, showToast]);

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
    const filtered = arr.filter((p) => {
      if (rolFiltro !== 'todos' && p.base.rol !== rolFiltro) return false;
      if (!q) return true;
      return p.base.nombre.toLowerCase().includes(q) || p.base.codigo.toLowerCase().includes(q);
    });
    return filtered.sort((a, b) => {
      if (a.base.rol !== b.base.rol) return (a.base.rol || '').localeCompare(b.base.rol || '');
      return a.base.nombre.localeCompare(b.base.nombre);
    });
  }, [edits, search, rolFiltro]);

  const dirtyCount = useMemo(() => Object.values(edits).filter(isDirty).length, [edits]);

  const filteredIds = useMemo(() => lista.map((p) => p.base.profesionalId), [lista]);
  const allSelected = filteredIds.length > 0 && filteredIds.every((id) => selected.has(id));

  // --- mutadores de estado (individual) ---
  function toggleBloqueado(id: number) {
    setEdits((prev) => {
      const cur = prev[id];
      const bloqueado = !cur.bloqueado;
      return {
        ...prev,
        [id]: {
          ...cur,
          bloqueado,
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

  // --- selección ---
  function toggleSelected(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const id of filteredIds) next.delete(id);
      } else {
        for (const id of filteredIds) next.add(id);
      }
      return next;
    });
  }

  // --- barra de acción masiva ---
  function validarRangos(rangos: Rango[]): string | null {
    if (rangos.length === 0) return 'Agrega al menos un rango horario.';
    for (const r of rangos) {
      if (hhmm(r.horaInicio) >= hhmm(r.horaFin)) {
        return 'En la franja masiva, la hora de inicio debe ser anterior a la de fin.';
      }
    }
    return null;
  }

  function aplicarHorarioBulk() {
    const err = validarRangos(bulkRangos);
    if (err) {
      showToast({ type: 'error', message: err });
      return;
    }
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        if (!next[id]) continue;
        next[id] = { ...next[id], bloqueado: false, rangos: bulkRangos.map((r) => ({ ...r })) };
      }
      return next;
    });
    showToast({ type: 'success', message: `Horario aplicado a ${selected.size} profesional(es). Revisa y guarda.` });
  }

  function aplicarBloqueoBulk() {
    setEdits((prev) => {
      const next = { ...prev };
      for (const id of selected) {
        if (!next[id]) continue;
        next[id] = { ...next[id], bloqueado: true };
      }
      return next;
    });
    showToast({ type: 'success', message: `Marcados como NO disponibles ${selected.size}. Revisa y guarda.` });
  }

  function updateBulkRango(idx: number, key: keyof Rango, value: string) {
    setBulkRangos((prev) => prev.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
  }
  function addBulkRango() {
    setBulkRangos((prev) => [...prev, { ...NEW_RANGE }]);
  }
  function removeBulkRango(idx: number) {
    setBulkRangos((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  // Restablecer en bulk al patrón semanal (DELETE inmediato por cada seleccionado).
  async function restablecerBulk() {
    if (selected.size === 0) return;
    setBulkBusy(true);
    let ok = 0;
    try {
      for (const id of selected) {
        await profesionalesService.deleteDisponibilidadFecha(id, fecha, modalidad, sede);
        ok++;
      }
      showToast({ type: 'success', message: `${ok} profesional(es) restablecido(s) al patrón semanal.` });
      onSaved();
      await load();
    } catch (e: unknown) {
      const ex = e as { response?: { data?: { error?: { message?: string } } } };
      showToast({ type: 'error', message: ex?.response?.data?.error?.message || `Error tras restablecer ${ok}.` });
      await load();
    } finally {
      setBulkBusy(false);
    }
  }

  // --- validación + guardado ---
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
        sede,
      });
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
      await profesionalesService.deleteDisponibilidadFecha(id, fecha, modalidad, sede);
      showToast({ type: 'success', message: `${p.base.nombre}: restablecido al patrón semanal.` });
      onSaved();
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
          sede,
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

        {/* Filtros: sede + modalidad + rol + búsqueda */}
        <div className="px-5 pt-4 space-y-3">
          {/* Sede + modalidad */}
          <div className="flex gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Sede</label>
              <div className="relative">
                <select
                  value={sede}
                  onChange={(e) => setSede(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2 border border-zinc-200 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {sedes.length === 0 && <option value={sede}>{sede || 'Cargando…'}</option>}
                  {sedes.map((s) => (
                    <option key={s.sedeId} value={s.sedeId}>
                      {s.nombre} {s.ciudad ? `(${s.ciudad})` : ''}
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-zinc-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            <div className="min-w-[160px]">
              <label className="block text-[11px] font-medium text-zinc-500 mb-1">Modalidad</label>
              <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg">
                {(['virtual', 'presencial'] as Modalidad[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setModalidad(m)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      modalidad === m ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    {m === 'virtual' ? 'Virtual' : 'Presencial'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Rol + búsqueda */}
          <div className="flex gap-3 flex-wrap items-center">
            <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg text-xs font-medium">
              {([['todos', 'Todos'], ['medico', 'Médicos'], ['coach', 'Coaches']] as [RolFiltro, string][]).map(
                ([val, label]) => (
                  <button
                    key={val}
                    onClick={() => setRolFiltro(val)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${
                      rolFiltro === val ? 'bg-white text-blue-600 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`}
                  >
                    {label}
                  </button>
                )
              )}
            </div>
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre o código…"
                className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Seleccionar todos (de la lista filtrada) */}
          {lista.length > 0 && (
            <label className="flex items-center gap-2 text-xs text-zinc-600 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
              />
              Seleccionar todos los visibles ({lista.length})
              {selected.size > 0 && (
                <span className="text-blue-600 font-medium">· {selected.size} seleccionado(s)</span>
              )}
            </label>
          )}
        </div>

        {/* Barra de acción masiva (cuando hay selección) */}
        {selected.size > 0 && (
          <div className="mx-5 mt-3 p-3 rounded-lg border border-blue-200 bg-blue-50/40 space-y-2">
            <div className="text-[12px] font-semibold text-blue-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Acción masiva · {selected.size} profesional(es)
            </div>
            {/* Editor de franjas masivas */}
            <div className="space-y-1.5">
              {bulkRangos.map((r, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="time"
                    value={r.horaInicio}
                    onChange={(e) => updateBulkRango(i, 'horaInicio', e.target.value)}
                    className="px-2 py-1.5 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-zinc-400">a</span>
                  <input
                    type="time"
                    value={r.horaFin}
                    onChange={(e) => updateBulkRango(i, 'horaFin', e.target.value)}
                    className="px-2 py-1.5 border border-zinc-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {bulkRangos.length > 1 && (
                    <button
                      onClick={() => removeBulkRango(i)}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                      title="Eliminar rango"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addBulkRango}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Agregar rango
              </button>
            </div>
            {/* Botones de acción masiva */}
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                onClick={aplicarHorarioBulk}
                className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 px-3 py-1.5 rounded-md"
              >
                Aplicar horario a seleccionados
              </button>
              <button
                onClick={aplicarBloqueoBulk}
                className="text-xs font-medium text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-md inline-flex items-center gap-1"
              >
                <CalendarOff className="w-3.5 h-3.5" />
                No disponible
              </button>
              <button
                onClick={restablecerBulk}
                disabled={bulkBusy}
                className="text-xs font-medium text-zinc-700 bg-white border border-zinc-200 hover:bg-zinc-50 px-3 py-1.5 rounded-md inline-flex items-center gap-1 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {bulkBusy ? 'Restableciendo…' : 'Restablecer al patrón semanal'}
              </button>
            </div>
            <p className="text-[10.5px] text-zinc-500">
              "Aplicar horario" y "No disponible" se guardan al presionar <b>Guardar cambios</b>. "Restablecer" se aplica de inmediato.
            </p>
          </div>
        )}

        {/* Lista de profesionales */}
        <div className="p-5 space-y-3">
          {loading ? (
            <p className="text-sm text-zinc-500 text-center py-8">Cargando disponibilidad…</p>
          ) : lista.length === 0 ? (
            <p className="text-sm text-zinc-500 text-center py-8">No hay profesionales para este filtro.</p>
          ) : (
            lista.map((p) => {
              const dirty = isDirty(p);
              const isSel = selected.has(p.base.profesionalId);
              return (
                <div
                  key={p.base.profesionalId}
                  className={`rounded-lg border ${
                    isSel
                      ? 'border-blue-400 ring-1 ring-blue-300'
                      : p.bloqueado
                        ? 'border-red-200 bg-red-50/30'
                        : p.overridden
                          ? 'border-blue-200 bg-blue-50/30'
                          : 'border-zinc-200'
                  }`}
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => toggleSelected(p.base.profesionalId)}
                        className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500 shrink-0"
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-zinc-800 truncate">{p.base.nombre}</div>
                        <div className="text-[11px] text-zinc-500" style={{ fontFamily: FONT_MONO }}>
                          {p.base.codigo} · {p.base.rol === 'coach' ? 'Coach' : 'Médico'} ·{' '}
                          {p.overridden ? (
                            <span className="text-blue-600">override de este día</span>
                          ) : (
                            <span className="text-zinc-400">según patrón semanal</span>
                          )}
                        </div>
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

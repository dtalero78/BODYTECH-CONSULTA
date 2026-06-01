import { useState, useEffect, useRef, type ReactNode } from 'react';
import { ClipboardList, HeartPulse, Dumbbell, Plus, Trash2 } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField, TextareaField, PillToggleField } from '../fields';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';
import { useFieldAutoSave } from '../hooks/useFieldAutoSave';
import { Dropdown } from '../Dropdown';

interface AnamnesisTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  isMaxed: boolean;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'motivo' | 'antecedentes' | 'deportivos' | null;

const OBJETIVO_OPTS: ReadonlyArray<DropdownOption> = [
  'Bajar de Peso',
  'Tonificar y Definición',
  'Aumentar Masa muscular',
  'Mejorar condición Física',
  'Fortalecimiento y Estabilidad',
  'Rehabilitación Funcional',
  'Salud',
].map((v) => ({ value: v, label: v }));

const MODALIDAD_OPTS: ReadonlyArray<DropdownOption> = [
  'Intramural',
  'Extramural',
  'Telemedicina',
  'Domiciliaria',
].map((v) => ({ value: v, label: v }));

const SERVICIO_ATENCION_OPTS: ReadonlyArray<DropdownOption> = [
  'Apoyo diagnóstico y complementación terapéutica',
  'Consulta externa',
].map((v) => ({ value: v, label: v }));

const LUGAR_ATENCION_OPTS: ReadonlyArray<DropdownOption> = [
  'Institucional',
  'Domiciliario',
  'Tele-orientación',
].map((v) => ({ value: v, label: v }));

const PUERTA_ENTRADA_OPTS: ReadonlyArray<DropdownOption> = [
  'Consulta externa',
  'Urgencias',
  'Hospitalización',
  'Otra',
].map((v) => ({ value: v, label: v }));

const CAUSA_OPTS: ReadonlyArray<DropdownOption> = [
  'Promoción y mantenimiento de la salud',
  'Detección temprana',
  'Diagnóstico',
  'Tratamiento',
  'Rehabilitación',
  'Paliación',
  'Atención inicial',
  'Otra',
].map((v) => ({ value: v, label: v }));

const TIPO_CONSULTA_OPTS: ReadonlyArray<DropdownOption> = [
  'Primera vez',
  'Control',
  'Seguimiento',
  'Urgente',
  'Particular',
  'Por convenio',
  'Tele-consulta',
  'Reapertura',
  'Otra',
].map((v) => ({ value: v, label: v }));

const ANT_PATOLOGICO_TIPO_OPTS: ReadonlyArray<DropdownOption> = [
  'Hipotiroidismo',
  'Hipertensión',
  'Enfermedades gastrointestinales',
  'Enfermedades pulmonares',
  'Enfermedad coronaria',
  'Dislipidemia',
  'Diabetes',
  'Cáncer',
  'Arritmias',
  'Alteraciones de glicemia',
].map((v) => ({ value: v, label: v }));

const ANT_QUIRURGICO_TIEMPO_OPTS: ReadonlyArray<DropdownOption> = [
  'Menor a 3 meses',
  'De 3 a 6 meses',
  'Mayor a 6 meses',
].map((v) => ({ value: v, label: v }));

const ANT_OSTEOMUSCULAR_TIPO_OPTS: ReadonlyArray<DropdownOption> = [
  'Otro',
  'Luxación',
  'Lesión Tendinosa',
  'Lesión Muscular',
  'Lesión Ligamentaria',
  'Fractura',
  'Esguince',
  'Contusión',
].map((v) => ({ value: v, label: v }));

const ANT_FAMILIAR_TIPO_OPTS: ReadonlyArray<DropdownOption> = [
  'Otro',
  'Diabetes primer grado',
  'Cerebrocardiovascular primer grado',
  'Cáncer primer grado',
].map((v) => ({ value: v, label: v }));

const ANT_ALERGICOS_CATEGORIA_OPTS: ReadonlyArray<DropdownOption> = [
  'Alimento',
  'Químico',
  'Biológico',
  'Ambiental',
  'Otro',
].map((v) => ({ value: v, label: v }));

const ANT_OSTEOMUSCULAR_LATERALIDAD_OPTS: ReadonlyArray<DropdownOption> = [
  'Derecha',
  'Izquierda',
  'Bilateral',
].map((v) => ({ value: v, label: v }));

const ANT_OSTEOMUSCULAR_EVOLUCION_OPTS: ReadonlyArray<DropdownOption> = [
  'Agudo',
  'Crónico',
  'Recurrente',
  'Resuelto',
].map((v) => ({ value: v, label: v }));

const ANT_FAMILIARES_CONSANGUINIDAD_OPTS: ReadonlyArray<DropdownOption> = [
  'Primer grado (padres, hermanos, hijos)',
  'Segundo grado (abuelos, tíos, nietos)',
  'Tercer grado (primos)',
  'Otro',
].map((v) => ({ value: v, label: v }));

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

export function clasificarActividad(
  dias: number | null | undefined,
  minutos: number | null | undefined,
): string | null {
  // Guard contra null/undefined/NaN/Infinity para evitar `NaN * x` o `Infinity` en cálculo.
  if (
    dias === null ||
    dias === undefined ||
    minutos === null ||
    minutos === undefined ||
    !Number.isFinite(dias) ||
    !Number.isFinite(minutos)
  ) {
    return null;
  }
  // No clasificar como 'Sedentario' por defecto si los inputs son 0 — devolver null
  // (no clasificable) para no escribir un nivel inexacto al servidor.
  if (dias <= 0 || minutos <= 0) return null;
  const minSemana = dias * minutos;
  if (minSemana < 150) return 'Irregularmente activo';
  if (minSemana < 300) return 'Activo';
  return 'Muy activo';
}

// ---- Múltiples antecedentes osteomusculares ----

interface OmEntrada {
  id: string;
  tipo: string;
  lateralidad: string;
  evolucion: string;
  fecha: string;
  obs: string;
}

function parseOmList(json: string | undefined): OmEntrada[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function OmListManager({
  historiaId,
  listaJson,
  legacyTipo,
  legacyLateralidad,
  legacyEvolucion,
  legacyObs,
  onPatchLocal,
}: {
  historiaId: string | undefined;
  listaJson: string | undefined;
  legacyTipo?: string;
  legacyLateralidad?: string;
  legacyEvolucion?: string;
  legacyObs?: string;
  onPatchLocal: (field: string, value: unknown) => void;
}) {
  // hasMigratedRef garantiza que la auto-migración legacy se ejecute UNA SOLA VEZ
  // por carga de historia. Si no, cada refetch del padre podría re-migrar y
  // pisar ediciones del médico.
  const hasMigratedRef = useRef(false);

  const [entries, setEntries] = useState<OmEntrada[]>(() => {
    const list = parseOmList(listaJson);
    // Auto-migrar datos del formato anterior si la lista está vacía
    if (list.length === 0 && (legacyTipo || legacyObs)) {
      hasMigratedRef.current = true;
      return [
        {
          id: 'legacy-0',
          tipo: legacyTipo || '',
          lateralidad: legacyLateralidad || '',
          evolucion: legacyEvolucion || '',
          fecha: '',
          obs: legacyObs || '',
        },
      ];
    }
    if (list.length > 0) hasMigratedRef.current = true;
    return list;
  });

  const [showForm, setShowForm] = useState(false);
  const emptyForm = { tipo: '', lateralidad: '', evolucion: '', fecha: '', obs: '' };
  const [form, setForm] = useState(emptyForm);

  // Sync desde fuera (refetch / patchLocal).
  //
  // Reglas:
  //  - Si el incoming es deep-equal a lo que ya tenemos en estado, NO hacemos
  //    setEntries (rompe el bucle de useEffect que dispararía cada render).
  //  - Si incoming tiene entradas y difiere del estado actual, adoptamos
  //    incoming (vino del servidor, es la fuente de verdad).
  //  - Si incoming está vacío y ya marcamos hasMigratedRef, NO sobrescribimos —
  //    el doctor pudo haber eliminado todas las entradas localmente y aún no se
  //    persistió.
  useEffect(() => {
    const incoming = parseOmList(listaJson);
    setEntries((prev) => {
      if (incoming.length === 0) {
        // No pisar el estado local si el servidor sigue null y ya migramos
        if (hasMigratedRef.current) return prev;
        return prev.length === 0 ? prev : [];
      }
      // Deep-compare por contenido para evitar re-renders en loop
      const sameLength = prev.length === incoming.length;
      const sameContent =
        sameLength &&
        prev.every((p, i) => {
          const q = incoming[i];
          return (
            p.id === q.id &&
            p.tipo === q.tipo &&
            p.lateralidad === q.lateralidad &&
            p.evolucion === q.evolucion &&
            p.fecha === q.fecha &&
            p.obs === q.obs
          );
        });
      if (sameContent) return prev;
      hasMigratedRef.current = true;
      return incoming;
    });
  }, [listaJson]);

  // Serializar para auto-save
  const serialized = entries.length === 0 ? null : JSON.stringify(entries);

  useFieldAutoSave({
    historiaId,
    field: 'ant_osteomuscular_lista',
    value: serialized,
    onSaved: onPatchLocal,
    serverValue: listaJson || null,
  });

  const addEntry = () => {
    if (!form.tipo) return;
    setEntries((prev) => [...prev, { ...form, id: Date.now().toString(36) }]);
    setForm(emptyForm);
    setShowForm(false);
  };

  const removeEntry = (id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const TIPO_OPTS = ANT_OSTEOMUSCULAR_TIPO_OPTS;
  const LAT_OPTS = ANT_OSTEOMUSCULAR_LATERALIDAD_OPTS;
  const EVO_OPTS = ANT_OSTEOMUSCULAR_EVOLUCION_OPTS;

  return (
    <div className="md:col-span-2 pt-1">
      {/* Lista de entradas existentes */}
      {entries.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {entries.map((entry, idx) => (
            <div
              key={entry.id}
              className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[#1a2530] border border-[#324049]"
            >
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-[#e9edef]">
                  {idx + 1}. {entry.tipo || '—'}
                  {entry.lateralidad && ` · ${entry.lateralidad}`}
                  {entry.evolucion && ` · ${entry.evolucion}`}
                  {entry.fecha && (
                    <span className="text-[#6b7882] font-normal ml-1">({entry.fecha})</span>
                  )}
                </div>
                {entry.obs && (
                  <div className="text-[11.5px] text-[#a4b1b9] mt-0.5 line-clamp-2">{entry.obs}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(entry.id)}
                className="text-[#6b7882] hover:text-[#ef4444] transition-colors shrink-0 mt-0.5"
                title="Eliminar"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Formulario de nuevo antecedente */}
      {showForm && (
        <div className="mb-3 p-3.5 rounded-xl bg-[#1a2530] border border-[#00a884]/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Tipo de lesión <span className="text-[#ef4444]">*</span>
              </label>
              <Dropdown
                value={form.tipo}
                options={TIPO_OPTS}
                onChange={(v) => setForm((f) => ({ ...f, tipo: v }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Lateralidad
              </label>
              <Dropdown
                value={form.lateralidad}
                options={LAT_OPTS}
                onChange={(v) => setForm((f) => ({ ...f, lateralidad: v }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Evolución
              </label>
              <Dropdown
                value={form.evolucion}
                options={EVO_OPTS}
                onChange={(v) => setForm((f) => ({ ...f, evolucion: v }))}
                placeholder="Seleccionar..."
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Fecha aproximada
              </label>
              <input
                type="date"
                value={form.fecha}
                onChange={(e) => setForm((f) => ({ ...f, fecha: e.target.value }))}
                className="w-full bg-[#2a3942] border border-[#324049] text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none focus:border-[#00a884] transition-colors"
              />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1.5">
              <label className="text-[10.5px] font-semibold text-[#a4b1b9] tracking-widest uppercase">
                Observaciones
              </label>
              <textarea
                rows={2}
                value={form.obs}
                onChange={(e) => setForm((f) => ({ ...f, obs: e.target.value }))}
                placeholder="Descripción, tratamiento, recurrencia..."
                className="w-full bg-[#2a3942] border border-[#324049] text-[#e9edef] px-3.5 py-2.5 rounded-xl text-[13.5px] outline-none focus:border-[#00a884] resize-y transition-colors"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(emptyForm); }}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] text-[#a4b1b9] hover:text-[#e9edef] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={addEntry}
              disabled={!form.tipo}
              className="px-3.5 py-1.5 rounded-lg text-[12.5px] bg-[#00a884] text-white font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#00c99a] transition-colors"
            >
              Agregar
            </button>
          </div>
        </div>
      )}

      {/* Botón para mostrar formulario */}
      {!showForm && (
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 text-[12.5px] text-[#00a884] hover:text-[#00c99a] font-semibold transition-colors"
        >
          <Plus size={14} />
          Agregar antecedente osteomuscular
        </button>
      )}
    </div>
  );
}

interface AntRowProps {
  label: string;
  flagField: string;
  flagValue: unknown;
  historiaId: string | undefined;
  onPatchLocal: (field: string, value: unknown) => void;
  children?: ReactNode;
}

/**
 * Fila de antecedente: header con label + PillToggleField. Cuando flagValue=true,
 * el children (sub-campos) se revela con animación grid-template-rows.
 */
function AntRow({ label, flagField, flagValue, historiaId, onPatchLocal, children }: AntRowProps) {
  const open = coerceBool(flagValue);
  return (
    <div className="border-b border-dashed border-[#324049] pb-4 mb-4 last:border-b-0 last:mb-0 last:pb-0">
      <div className="flex items-center justify-between gap-4">
        <div className="text-[13.5px] font-semibold text-[#e9edef] flex-1">{label}</div>
        <PillToggleField
          historiaId={historiaId}
          field={flagField}
          initialValue={flagValue}
          onSaved={onPatchLocal}
          inline
        />
      </div>
      {children && (
        <div className={`reveal-grid ${open ? 'is-open' : ''}`}>
          <div>
            <div className="pt-3.5 grid grid-cols-1 md:grid-cols-2 gap-3.5">{children}</div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AnamnesisTab({ historiaId, data, isMaxed, onPatchLocal }: AnamnesisTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  // ----- Card 2.1: Motivo de consulta -----
  const motivoVals = [
    data?.objetivoBodytech,
    data?.modalidad,
    data?.servicioAtencion,
    data?.lugarAtencion,
    data?.puertaEntrada,
    data?.causa,
    data?.tipoConsulta,
    data?.motivoConsultaTexto,
  ];
  const motivoFilled = motivoVals.filter(isFilled).length;
  const motivoState =
    motivoFilled === 0 ? 'empty' : motivoFilled === motivoVals.length ? 'complete' : 'partial';
  const motivoSubtitle =
    motivoFilled === 0
      ? 'Sin información'
      : motivoState === 'complete'
        ? `${data?.objetivoBodytech || '—'} · ${data?.tipoConsulta || '—'}`
        : `${motivoFilled} de ${motivoVals.length} campos completos`;

  // ----- Card 2.2: Antecedentes -----
  const isFemenino = data?.generoBiologico === 'Femenino';
  const antRowsCount = isFemenino ? 8 : 7;
  const antFlags = [
    coerceBool(data?.antPatologicoFlag),
    coerceBool(data?.antQuirurgicoFlag),
    coerceBool(data?.antOsteomuscularFlag),
    coerceBool(data?.antFarmacologicoFlag),
    coerceBool(data?.antAlergicosFlag),
    coerceBool(data?.antFamiliaresFlag),
    ...(isFemenino ? [coerceBool(data?.embarazoActual)] : []),
    coerceBool(data?.planificacionFamiliarFlag),
  ];
  const antFilled = antFlags.filter((f) => f).length;
  const antState = antFilled === 0 ? 'empty' : antFilled === antRowsCount ? 'complete' : 'partial';
  const antSubtitle =
    antFilled === 0
      ? 'Sin antecedentes registrados'
      : `${antFilled} de ${antRowsCount} antecedentes registrados`;

  // ---- Card 2.3: Antecedentes deportivos -----
  // actividad_frecuencia = días/semana (número 0-7), actividad_duracion_min = minutos (número)
  const frecDias = typeof data?.actividadFrecuencia === 'string' && data.actividadFrecuencia !== ''
    ? Number(data.actividadFrecuencia)
    : typeof data?.actividadFrecuencia === 'number'
      ? data.actividadFrecuencia
      : null;
  const durMin = data?.actividadDuracionMin ?? null;

  const nivelActividad = clasificarActividad(frecDias, durMin);

  const deportVals = [
    frecDias !== null ? String(frecDias) : null,
    durMin !== null ? String(durMin) : null,
  ];
  const deportFilled = deportVals.filter(isFilled).length;
  const deportState =
    deportFilled === 0 ? 'empty' : deportFilled === deportVals.length ? 'complete' : 'partial';
  const deportSubtitle =
    deportFilled === 0
      ? 'Sin información'
      : nivelActividad
        ? `${nivelActividad} · ${frecDias} días · ${durMin} min/sesión`
        : `${deportFilled} de ${deportVals.length} campos completos`;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<ClipboardList size={16} />}
        title="Motivo de consulta"
        subtitle={motivoSubtitle}
        state={motivoState}
        completionPct={Math.round((motivoFilled / motivoVals.length) * 100)}
        onEdit={() => setOpenModal('motivo')}
      />
      <Card
        icon={<HeartPulse size={16} />}
        title="Antecedentes"
        subtitle={antSubtitle}
        state={antState}
        completionPct={Math.round((antFilled / antRowsCount) * 100)}
        onEdit={() => setOpenModal('antecedentes')}
      />
      <Card
        icon={<Dumbbell size={16} />}
        title="Antecedentes deportivos"
        subtitle={deportSubtitle}
        state={deportState}
        span2
        completionPct={Math.round((deportFilled / deportVals.length) * 100)}
        onEdit={() => setOpenModal('deportivos')}
      />

      {/* ============ Modal Motivo de consulta ============ */}
      <Modal
        open={openModal === 'motivo'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Motivo de consulta"
        title="Motivo de consulta"
        icon={<ClipboardList size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="objetivo_bodytech"
            initialValue={data?.objetivoBodytech}
            onSaved={onPatchLocal}
            label="Objetivo Bodytech"
            options={OBJETIVO_OPTS}
            placeholder="Seleccionar..."
          />
          <SelectField
            historiaId={historiaId}
            field="modalidad"
            initialValue={data?.modalidad}
            onSaved={onPatchLocal}
            label="Modalidad"
            options={MODALIDAD_OPTS}
            placeholder="Intramural (sugerido)"
          />
          <SelectField
            historiaId={historiaId}
            field="servicio_atencion"
            initialValue={data?.servicioAtencion}
            onSaved={onPatchLocal}
            label="Servicio de atención"
            options={SERVICIO_ATENCION_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="lugar_atencion"
            initialValue={data?.lugarAtencion}
            onSaved={onPatchLocal}
            label="Lugar de atención"
            options={LUGAR_ATENCION_OPTS}
            placeholder="Institucional (sugerido)"
          />
          <SelectField
            historiaId={historiaId}
            field="puerta_entrada"
            initialValue={data?.puertaEntrada}
            onSaved={onPatchLocal}
            label="Puerta de entrada"
            options={PUERTA_ENTRADA_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="causa"
            initialValue={data?.causa}
            onSaved={onPatchLocal}
            label="Causa"
            options={CAUSA_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="tipo_consulta"
            initialValue={data?.tipoConsulta}
            onSaved={onPatchLocal}
            label="Tipo de consulta"
            options={TIPO_CONSULTA_OPTS}
          />
          <div className="md:col-span-2">
            <TextareaField
              historiaId={historiaId}
              field="motivo_consulta_texto"
              initialValue={data?.motivoConsultaTexto}
              onSaved={onPatchLocal}
              label="Motivo de consulta (descripción)"
              placeholder="Describir motivo de la consulta..."
              minHeight={80}
              rows={4}
            />
          </div>
        </div>
      </Modal>

      {/* ============ Modal Antecedentes ============ */}
      <Modal
        open={openModal === 'antecedentes'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Antecedentes"
        title="Antecedentes del afiliado"
        icon={<HeartPulse size={18} />}
        isMaxed={isMaxed}
      >
        <div>
          {/* 1. Patológico */}
          <AntRow
            label="Antecedente Patológico"
            flagField="ant_patologico_flag"
            flagValue={data?.antPatologicoFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <SelectField
              historiaId={historiaId}
              field="ant_patologico_tipo"
              initialValue={data?.antPatologicoTipo}
              onSaved={onPatchLocal}
              label="Tipo"
              options={ANT_PATOLOGICO_TIPO_OPTS}
            />
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_patologico_obs"
                initialValue={data?.antPatologicoObs}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
          </AntRow>

          {/* 2. Quirúrgico */}
          <AntRow
            label="Antecedente Quirúrgico"
            flagField="ant_quirurgico_flag"
            flagValue={data?.antQuirurgicoFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <SelectField
              historiaId={historiaId}
              field="ant_quirurgico_tiempo"
              initialValue={data?.antQuirurgicoTiempo}
              onSaved={onPatchLocal}
              label="Tiempo desde la cirugía"
              options={ANT_QUIRURGICO_TIEMPO_OPTS}
            />
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_quirurgico_obs"
                initialValue={data?.antQuirurgicoObs}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
          </AntRow>

          {/* 3. Osteomuscular */}
          <AntRow
            label="Antecedente Osteomuscular"
            flagField="ant_osteomuscular_flag"
            flagValue={data?.antOsteomuscularFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <OmListManager
              historiaId={historiaId}
              listaJson={data?.antOsteomuscularLista}
              legacyTipo={data?.antOsteomuscularTipo}
              legacyLateralidad={data?.antOsteomuscularLateralidad}
              legacyEvolucion={data?.antOsteomuscularEvolucion}
              legacyObs={data?.antOsteomuscularObs}
              onPatchLocal={onPatchLocal}
            />
          </AntRow>

          {/* 4. Farmacológico */}
          <AntRow
            label="Antecedente Farmacológico"
            flagField="ant_farmacologico_flag"
            flagValue={data?.antFarmacologicoFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_farmacologico_obs"
                initialValue={data?.antFarmacologicoObs}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
          </AntRow>

          {/* 5. Alérgico */}
          <AntRow
            label="Antecedente Alérgico"
            flagField="ant_alergicos_flag"
            flagValue={data?.antAlergicosFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <SelectField
              historiaId={historiaId}
              field="ant_alergicos_tipo"
              initialValue={data?.antAlergicosTipo}
              onSaved={onPatchLocal}
              label="Categoría"
              options={ANT_ALERGICOS_CATEGORIA_OPTS}
            />
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_alergicos_obs"
                initialValue={data?.antAlergicosObs}
                onSaved={onPatchLocal}
                label="Descripción y observaciones"
                rows={2}
                placeholder="Agente alérgico, reacción, tratamiento..."
              />
            </div>
          </AntRow>

          {/* 6. Familiar */}
          <AntRow
            label="Antecedente Familiar"
            flagField="ant_familiares_flag"
            flagValue={data?.antFamiliaresFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <SelectField
              historiaId={historiaId}
              field="ant_familiares_tipo"
              initialValue={data?.antFamiliaresTipo}
              onSaved={onPatchLocal}
              label="Tipo de antecedente"
              options={ANT_FAMILIAR_TIPO_OPTS}
            />
            <SelectField
              historiaId={historiaId}
              field="ant_familiares_consanguinidad"
              initialValue={data?.antFamiliaresConsanguinidad}
              onSaved={onPatchLocal}
              label="Grado de consanguinidad"
              options={ANT_FAMILIARES_CONSANGUINIDAD_OPTS}
            />
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_familiares_obs"
                initialValue={data?.antFamiliaresObs}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
          </AntRow>

          {/* 7. Embarazo (solo Femenino) */}
          {isFemenino && (
            <AntRow
              label="Estado actual de embarazo"
              flagField="embarazo_actual"
              flagValue={data?.embarazoActual}
              historiaId={historiaId}
              onPatchLocal={onPatchLocal}
            >
              <TextField
                historiaId={historiaId}
                field="partos"
                initialValue={data?.partos}
                onSaved={onPatchLocal}
                label="Partos"
                type="text"
                placeholder="0"
              />
              <TextField
                historiaId={historiaId}
                field="cesareas"
                initialValue={data?.cesareas}
                onSaved={onPatchLocal}
                label="Cesáreas"
                type="text"
                placeholder="0"
              />
              <TextField
                historiaId={historiaId}
                field="abortos"
                initialValue={data?.abortos}
                onSaved={onPatchLocal}
                label="Abortos"
                type="text"
                placeholder="0"
              />
              <TextField
                historiaId={historiaId}
                field="fum"
                initialValue={
                  data?.fum instanceof Date
                    ? data.fum.toISOString().split('T')[0]
                    : typeof data?.fum === 'string' && data.fum
                      ? data.fum.split('T')[0]
                      : ''
                }
                onSaved={onPatchLocal}
                label="Fecha última menstruación"
                type="date"
              />
            </AntRow>
          )}

          {/* 8. Planificación familiar */}
          <AntRow
            label="Planificación familiar"
            flagField="planificacion_familiar_flag"
            flagValue={data?.planificacionFamiliarFlag}
            historiaId={historiaId}
            onPatchLocal={onPatchLocal}
          >
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="planificacion"
                initialValue={data?.planificacion}
                onSaved={onPatchLocal}
                label="Método de planificación familiar"
                rows={2}
                placeholder="Método anticonceptivo, tiempo de uso, observaciones..."
              />
            </div>
          </AntRow>
        </div>
      </Modal>

      {/* ============ Modal Antecedentes deportivos ============ */}
      <Modal
        open={openModal === 'deportivos'}
        onClose={() => setOpenModal(null)}
        crumb="Anamnesis · Antecedentes deportivos"
        title="Antecedentes deportivos"
        icon={<Dumbbell size={18} />}
        isMaxed={isMaxed}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <TextField
            historiaId={historiaId}
            field="actividad_frecuencia"
            initialValue={data?.actividadFrecuencia}
            onSaved={onPatchLocal}
            label="Días de actividad por semana (0–7)"
            type="number"
            placeholder="0"
          />
          <TextField
            historiaId={historiaId}
            field="actividad_duracion_min"
            initialValue={data?.actividadDuracionMin}
            onSaved={onPatchLocal}
            label="Duración por sesión (minutos)"
            type="number"
            placeholder="0"
          />
          {nivelActividad && (
            <div className="md:col-span-2 flex items-center gap-3 p-3.5 rounded-xl bg-[#1a2530] border border-[#324049]">
              <div className="text-[11.5px] text-[#6b7882] uppercase tracking-widest font-semibold flex-1">
                Nivel de actividad calculado
              </div>
              <div className={`text-[13.5px] font-bold ${
                nivelActividad === 'Muy activo' ? 'text-[#34d399]' :
                nivelActividad === 'Activo' ? 'text-[#60a5fa]' :
                nivelActividad === 'Irregularmente activo' ? 'text-[#fbbf24]' :
                'text-[#ef4444]'
              }`}>
                {nivelActividad}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

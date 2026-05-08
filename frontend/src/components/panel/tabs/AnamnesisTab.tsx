import { useState, type ReactNode } from 'react';
import { ClipboardList, HeartPulse, Dumbbell } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, SelectField, TextareaField, PillToggleField } from '../fields';
import type { MedicalHistoryFull } from '../types';
import type { DropdownOption } from '../Dropdown';

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

const ACTIVIDAD_FRECUENCIA_OPTS: ReadonlyArray<DropdownOption> = [
  'Nunca',
  '1-2 veces/semana',
  '3-4 veces/semana',
  '5+ veces/semana',
].map((v) => ({ value: v, label: v }));

const ACTIVIDAD_DURACION_OPTS: ReadonlyArray<DropdownOption> = [
  '<30 min',
  '30-60 min',
  '60-90 min',
  '>90 min',
].map((v) => ({ value: v, label: v }));

const ACTIVIDAD_FUERZA_OPTS: ReadonlyArray<DropdownOption> = [
  'Nunca',
  '1-2 veces',
  '3-4 veces',
  '5+ veces',
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

  // ----- Card 2.3: Antecedentes deportivos -----
  const deportVals = [data?.actividadFrecuencia, data?.actividadDuracion, data?.actividadFuerzaSemanalLabel];
  const deportFilled = deportVals.filter(isFilled).length;
  const deportState =
    deportFilled === 0 ? 'empty' : deportFilled === deportVals.length ? 'complete' : 'partial';
  const deportSubtitle =
    deportFilled === 0
      ? 'Sin información'
      : deportState === 'complete'
        ? `${data?.actividadFrecuencia} · ${data?.actividadDuracion}`
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
        title="Antecedentes del paciente"
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
            <SelectField
              historiaId={historiaId}
              field="ant_osteomuscular_tipo"
              initialValue={data?.antOsteomuscularTipo}
              onSaved={onPatchLocal}
              label="Tipo"
              options={ANT_OSTEOMUSCULAR_TIPO_OPTS}
            />
            <div className="md:col-span-2">
              <TextareaField
                historiaId={historiaId}
                field="ant_osteomuscular_obs"
                initialValue={data?.antOsteomuscularObs}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
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
          />

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
              label="Tipo"
              options={ANT_FAMILIAR_TIPO_OPTS}
            />
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
          />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <SelectField
            historiaId={historiaId}
            field="actividad_frecuencia"
            initialValue={data?.actividadFrecuencia}
            onSaved={onPatchLocal}
            label="Frecuencia de actividad física"
            options={ACTIVIDAD_FRECUENCIA_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="actividad_duracion"
            initialValue={data?.actividadDuracion}
            onSaved={onPatchLocal}
            label="Duración por sesión"
            options={ACTIVIDAD_DURACION_OPTS}
          />
          <SelectField
            historiaId={historiaId}
            field="actividad_fuerza_semanal_label"
            initialValue={data?.actividadFuerzaSemanalLabel}
            onSaved={onPatchLocal}
            label="Ejercicio de fuerza por semana"
            options={ACTIVIDAD_FUERZA_OPTS}
          />
        </div>
      </Modal>
    </div>
  );
}

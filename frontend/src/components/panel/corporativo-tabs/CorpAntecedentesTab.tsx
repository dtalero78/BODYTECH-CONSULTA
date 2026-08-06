import { useState } from 'react';
import { Users, User } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField, PillToggleField } from '../fields';
import type { MedicalHistoryFull } from '../types';

interface CorpAntecedentesTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
}

type ModalKey = 'familiares' | 'personales' | null;

const FAMILIARES: ReadonlyArray<{ label: string; field: string }> = [
  { label: 'Enfermedad cardiaca', field: 'mc_fam_cardiaca' },
  { label: 'Enfermedad respiratoria', field: 'mc_fam_respiratoria' },
  { label: 'MSC o IAM', field: 'mc_fam_msc_iam' },
  { label: 'Hipertensión arterial', field: 'mc_fam_hta' },
  { label: 'Enfermedad cerebrovascular', field: 'mc_fam_cerebrovascular' },
  { label: 'Diabetes', field: 'mc_fam_diabetes' },
  { label: 'Cáncer', field: 'mc_fam_cancer' },
  { label: 'Otros', field: 'mc_fam_otros' },
];

const PERSONALES_BOOL: ReadonlyArray<{ label: string; field: string }> = [
  { label: 'Enfermedad cardiaca', field: 'mc_per_cardiaca' },
  { label: 'Enfermedad respiratoria', field: 'mc_per_respiratoria' },
  { label: 'Hipertensión arterial', field: 'mc_per_hta' },
  { label: 'Enfermedad renal', field: 'mc_per_renal' },
  { label: 'Enfermedad metabólica', field: 'mc_per_metabolica' },
  { label: 'Enfermedad cerebrovascular', field: 'mc_per_cerebrovascular' },
  { label: 'Tabaquismo', field: 'mc_per_tabaquismo' },
  { label: 'Alcohol', field: 'mc_per_alcohol' },
];

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
}

function camel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/**
 * Los antecedentes ginecobstétricos solo aplican a pacientes mujeres. Se mira
 * `genero_biologico` (el que se diligencia en Identificación) y, si aún no está,
 * se cae al `genero` legacy que trae la ficha del afiliado, para no esconder la
 * sección en historias que ya venían con el dato desde la admisión.
 */
function esFemenino(data: MedicalHistoryFull | null): boolean {
  const raw = data?.generoBiologico || data?.genero;
  if (!raw) return false;
  return String(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .startsWith('f');
}

/** Normaliza una fecha (Date o ISO) al `yyyy-mm-dd` que espera `<input type="date">`. */
function toDateInput(v: unknown): string {
  if (v instanceof Date) return v.toISOString().split('T')[0];
  if (typeof v === 'string' && v) return v.split('T')[0];
  return '';
}

export function CorpAntecedentesTab({ historiaId, data, onPatchLocal }: CorpAntecedentesTabProps) {
  const [openModal, setOpenModal] = useState<ModalKey>(null);

  const famActivos = FAMILIARES.map((f) => coerceBool(data?.[camel(f.field)])).filter(Boolean).length;
  const perActivos = PERSONALES_BOOL.map((f) => coerceBool(data?.[camel(f.field)])).filter(Boolean).length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Users size={16} />}
        title="Antecedentes familiares"
        subtitle={
          famActivos === 0
            ? 'Niega todos los antecedentes'
            : `${famActivos} de ${FAMILIARES.length} antecedentes positivos`
        }
        state={famActivos === 0 ? 'empty' : 'partial'}
        completionPct={100}
        onEdit={() => setOpenModal('familiares')}
      />
      <Card
        icon={<User size={16} />}
        title="Antecedentes personales"
        subtitle={
          perActivos === 0
            ? 'Niega todos los antecedentes'
            : `${perActivos} de ${PERSONALES_BOOL.length} antecedentes positivos`
        }
        state={perActivos === 0 ? 'empty' : 'partial'}
        completionPct={100}
        onEdit={() => setOpenModal('personales')}
      />

      {/* ============ Familiares ============ */}
      <Modal
        open={openModal === 'familiares'}
        onClose={() => setOpenModal(null)}
        crumb="Antecedentes · Familiares"
        title="Antecedentes familiares"
        icon={<Users size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {FAMILIARES.map((f) => (
              <div
                key={f.field}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--p-line)] bg-[var(--p-surface-2)]"
              >
                <span className="text-[13px] text-[var(--p-text)]">{f.label}</span>
                <PillToggleField
                  historiaId={historiaId}
                  field={f.field}
                  initialValue={data?.[camel(f.field)]}
                  onSaved={onPatchLocal}
                  trueLabel="Sí"
                  falseLabel="Niega"
                  inline
                />
              </div>
            ))}
          </div>
          <TextareaField
            historiaId={historiaId}
            field="mc_fam_observaciones"
            initialValue={data?.mcFamObservaciones}
            onSaved={onPatchLocal}
            label="Observaciones"
            rows={2}
          />
        </div>
      </Modal>

      {/* ============ Personales ============ */}
      <Modal
        open={openModal === 'personales'}
        onClose={() => setOpenModal(null)}
        crumb="Antecedentes · Personales"
        title="Antecedentes personales"
        icon={<User size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PERSONALES_BOOL.map((f) => (
              <div
                key={f.field}
                className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-[var(--p-line)] bg-[var(--p-surface-2)]"
              >
                <span className="text-[13px] text-[var(--p-text)]">{f.label}</span>
                <PillToggleField
                  historiaId={historiaId}
                  field={f.field}
                  initialValue={data?.[camel(f.field)]}
                  onSaved={onPatchLocal}
                  trueLabel="Sí"
                  falseLabel="Niega"
                  inline
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-dashed border-[var(--p-line)] grid grid-cols-1 md:grid-cols-2 gap-3.5">
            <TextField
              historiaId={historiaId}
              field="mc_per_vacunas_covid"
              initialValue={data?.mcPerVacunasCovid}
              onSaved={onPatchLocal}
              label="Vacunas COVID-19"
              placeholder="Ej. Esquema completo"
            />
            <TextField
              historiaId={historiaId}
              field="mc_per_antecedente_covid"
              initialValue={data?.mcPerAntecedenteCovid}
              onSaved={onPatchLocal}
              label="Antecedente COVID-19"
              placeholder="Ej. Niega"
            />
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_osteomuscular"
                initialValue={data?.mcPerOsteomuscular}
                onSaved={onPatchLocal}
                label="Osteomusculares"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_quirurgicos"
                initialValue={data?.mcPerQuirurgicos}
                onSaved={onPatchLocal}
                label="Quirúrgicos"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_alergicos"
                initialValue={data?.mcPerAlergicos}
                onSaved={onPatchLocal}
                label="Alérgicos"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_farmacologicos"
                initialValue={data?.mcPerFarmacologicos}
                onSaved={onPatchLocal}
                label="Farmacológicos"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_paraclinicos"
                initialValue={data?.mcPerParaclinicos}
                onSaved={onPatchLocal}
                label="Paraclínicos"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_alimentacion"
                initialValue={data?.mcPerAlimentacion}
                onSaved={onPatchLocal}
                label="Alimentación"
                rows={2}
              />
            </div>
            <div>
              <TextareaField
                historiaId={historiaId}
                field="mc_per_observaciones"
                initialValue={data?.mcPerObservaciones}
                onSaved={onPatchLocal}
                label="Observaciones"
                rows={2}
              />
            </div>
          </div>

          {/* Ginecobstétricos — solo para pacientes mujeres. Reusa las columnas
              que ya existen para el panel de consulta estándar. */}
          {esFemenino(data) && (
            <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
              <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">
                Antecedentes ginecobstétricos
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5">
                <TextField
                  historiaId={historiaId}
                  field="fum"
                  initialValue={toDateInput(data?.fum)}
                  onSaved={onPatchLocal}
                  label="Fecha última menstruación"
                  type="date"
                />
                <PillToggleField
                  historiaId={historiaId}
                  field="embarazo_actual"
                  initialValue={data?.embarazoActual}
                  onSaved={onPatchLocal}
                  label="Embarazo"
                  trueLabel="Sí"
                  falseLabel="No"
                />
                <TextField
                  historiaId={historiaId}
                  field="partos"
                  initialValue={data?.partos}
                  onSaved={onPatchLocal}
                  label="Número de partos"
                  type="number"
                  min={0}
                  max={30}
                />
                <TextField
                  historiaId={historiaId}
                  field="planificacion"
                  initialValue={data?.planificacion}
                  onSaved={onPatchLocal}
                  label="Planificación"
                  placeholder="¿Cuál método?"
                />
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

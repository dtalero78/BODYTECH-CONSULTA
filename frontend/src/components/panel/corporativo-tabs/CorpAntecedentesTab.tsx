import { Users, User } from 'lucide-react';
import { Card } from '../Card';
import { Modal } from '../Modal';
import { TextField, TextareaField, PillToggleField } from '../fields';
import { AccionRapida } from './LlenadoRapido';
import { soloVacios } from './llenado';
import { useAbrirSolicitado } from './useAbrirSolicitado';
import { camelCampo, tieneValor } from './completitud';
import type { MedicalHistoryFull } from '../types';
import { useModalChain } from '../useModalChain';
import { FAMILIARES, PERSONALES_BOOL } from './camposCorporativo';

interface CorpAntecedentesTabProps {
  historiaId: string | undefined;
  data: MedicalHistoryFull | null;
  onPatchLocal: (field: string, value: unknown) => void;
  /** Modal que el panel pide abrir (salto desde "lo que falta"). */
  abrir?: string | null;
  onAbierto?: () => void;
}

type ModalKey = 'familiares' | 'personales';

/** Recorrido clínico de la sección: define el "Siguiente" del pie de cada modal. */
const ORDEN: ReadonlyArray<ModalKey> = ['familiares', 'personales'];
const ETIQUETAS: Record<ModalKey, string> = {
  familiares: 'Antecedentes familiares',
  personales: 'Antecedentes personales',
};

// Las listas viven en camposCorporativo: son las mismas que deciden qué exige la historia.

/**
 * Los antecedentes personales que se escriben y que la historia exige. "Niega
 * todos" les pone "Niega" si están vacíos: es lo que el médico escribía a mano
 * en cada uno cuando el paciente no refiere nada.
 */
const PERSONALES_TEXTO_OBLIGATORIOS: ReadonlyArray<string> = [
  'mc_per_osteomuscular',
  'mc_per_quirurgicos',
  'mc_per_alergicos',
  'mc_per_farmacologicos',
];

function coerceBool(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'string') {
    const x = v.trim();
    return x === 'true' || x === 'Sí' || x === 'SI' || x === 'sí' || x === 'si';
  }
  return false;
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

/**
 * Subtítulo y estado de un grupo de Sí/Niega. Un antecedente sin responder NO
 * es un antecedente negado: antes el card decía "Niega todos los antecedentes"
 * con los ocho sin tocar, y la sección se veía lista.
 */
function resumenGrupo(
  data: MedicalHistoryFull | null,
  campos: ReadonlyArray<string>,
  extraSinResponder = 0
): { subtitle: string; state: 'empty' | 'partial' | 'complete'; pct: number } {
  const positivos = campos.filter((f) => coerceBool(data?.[camelCampo(f)])).length;
  const sinResponder = campos.filter((f) => !tieneValor(data?.[camelCampo(f)])).length + extraSinResponder;
  const total = campos.length + extraSinResponder;
  if (sinResponder === campos.length + extraSinResponder && positivos === 0 && extraSinResponder === 0) {
    return { subtitle: 'Sin responder', state: 'empty', pct: 0 };
  }
  const partes = [
    positivos > 0
      ? `${positivos} de ${campos.length} antecedentes positivos`
      : sinResponder === 0
        ? 'Niega todos los antecedentes'
        : null,
    sinResponder > 0 ? `${sinResponder} sin responder` : null,
  ].filter(Boolean);
  return {
    subtitle: partes.join(' · '),
    state: sinResponder > 0 ? 'partial' : 'complete',
    pct: Math.round(((total - sinResponder) / Math.max(total, 1)) * 100),
  };
}

export function CorpAntecedentesTab({ historiaId, data, onPatchLocal, abrir, onAbierto }: CorpAntecedentesTabProps) {
  const { setOpen: setOpenModal, chain } = useModalChain(ORDEN, ETIQUETAS);
  useAbrirSolicitado(abrir, ORDEN, setOpenModal, onAbierto);

  const famCampos = FAMILIARES.map((f) => f.field);
  const perCampos = PERSONALES_BOOL.map((f) => f.field);
  const perTextosVacios = PERSONALES_TEXTO_OBLIGATORIOS.filter((f) => !tieneValor(data?.[camelCampo(f)])).length;

  const fam = resumenGrupo(data, famCampos);
  const per = resumenGrupo(data, perCampos, perTextosVacios);

  const nieganFamiliares = soloVacios(data, Object.fromEntries(famCampos.map((f) => [f, false])));
  const nieganPersonales = soloVacios(data, {
    ...Object.fromEntries(perCampos.map((f) => [f, false])),
    ...Object.fromEntries(PERSONALES_TEXTO_OBLIGATORIOS.map((f) => [f, 'Niega'])),
  });

  const accionFamiliares = (
    <AccionRapida
      label="Niega todos"
      titulo="Marca «Niega» en los antecedentes familiares que siguen sin responder. No cambia los que ya marcaste."
      valores={nieganFamiliares}
      historiaId={historiaId}
      onPatchLocal={onPatchLocal}
    />
  );
  const accionPersonales = (
    <AccionRapida
      label="Niega todos"
      titulo="Marca «Niega» en los antecedentes sin responder y escribe «Niega» en osteomusculares, quirúrgicos, alérgicos y farmacológicos si están vacíos. No cambia lo que ya está diligenciado."
      valores={nieganPersonales}
      historiaId={historiaId}
      onPatchLocal={onPatchLocal}
    />
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card
        icon={<Users size={16} />}
        title="Antecedentes familiares"
        subtitle={fam.subtitle}
        state={fam.state}
        completionPct={fam.pct}
        onEdit={() => setOpenModal('familiares')}
      >
        {accionFamiliares}
      </Card>
      <Card
        icon={<User size={16} />}
        title="Antecedentes personales"
        subtitle={per.subtitle}
        state={per.state}
        completionPct={per.pct}
        onEdit={() => setOpenModal('personales')}
      >
        {accionPersonales}
      </Card>

      {/* ============ Familiares ============ */}
      <Modal
        {...chain('familiares')}
        crumb="Antecedentes · Familiares"
        title="Antecedentes familiares"
        icon={<Users size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="flex flex-col gap-3">
          <div className="-mt-3">{accionFamiliares}</div>
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
                  initialValue={data?.[camelCampo(f.field)]}
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
        {...chain('personales')}
        crumb="Antecedentes · Personales"
        title="Antecedentes personales"
        icon={<User size={18} />}
        isMaxed
        showEyePill={false}
        size="wide"
      >
        <div className="flex flex-col gap-4">
          <div className="-mt-3">{accionPersonales}</div>
          {/* Los dos bloques son de naturaleza distinta y el equipo médico pidió que
              se notara: arriba lo que se responde Sí/Niega, abajo lo que se escribe.
              Antes sólo los separaba una línea punteada, sin decir qué era cada cosa. */}
          <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Antecedentes a interrogar</div>
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
                  initialValue={data?.[camelCampo(f.field)]}
                  onSaved={onPatchLocal}
                  trueLabel="Sí"
                  falseLabel="Niega"
                  inline
                />
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-dashed border-[var(--p-line)]">
            <div className="text-[11px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase mb-3">Detalle y descripción</div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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

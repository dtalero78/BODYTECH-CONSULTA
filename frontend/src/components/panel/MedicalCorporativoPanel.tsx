import { useRef, useState } from 'react';
import { Cloud, CloudOff } from 'lucide-react';
import { PatientStrip } from './PatientStrip';
import { PanelSideNav, type TabDef } from './PanelSideNav';
import { SaveProvider, useSaveCtx } from './SaveContext';
import { useMedicalHistory } from './hooks/useMedicalHistory';
import { useContainerWidth } from './hooks/useContainerWidth';
import type { MedicalHistoryFull, SaveStatus } from './types';
import { CorpIdentificacionTab } from './corporativo-tabs/CorpIdentificacionTab';
import { CorpAnamnesisTab } from './corporativo-tabs/CorpAnamnesisTab';
import { CorpAntecedentesTab } from './corporativo-tabs/CorpAntecedentesTab';
import { CorpActividadFisicaTab } from './corporativo-tabs/CorpActividadFisicaTab';
import { CorpExamenFisicoTab } from './corporativo-tabs/CorpExamenFisicoTab';
import { CorpDiagnosticoRiesgoTab } from './corporativo-tabs/CorpDiagnosticoRiesgoTab';
import { CorpPrescripcionTab } from './corporativo-tabs/CorpPrescripcionTab';

interface MedicalCorporativoPanelProps {
  historiaId: string;
}

// Tabs propios de este panel — deliberadamente NO comparten el TabId de
// `types.ts` (t1..t7) para no acoplar este panel al orchestrator estándar.
type CorpTabId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'c7';

const TAB_LABELS: Record<CorpTabId, string> = {
  c1: 'Identificación',
  c2: 'Anamnesis',
  c3: 'Antecedentes',
  c4: 'Actividad física',
  c5: 'Examen físico',
  c6: 'Diagnóstico y riesgo',
  c7: 'Análisis y prescripción',
};

function isFilled(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

function computeCorpTabsCount(data: MedicalHistoryFull | null): ReadonlyArray<TabDef<CorpTabId>> {
  const t1 = [data?.mcDireccion, data?.email, data?.grupoSanguineo, data?.ocupacion, data?.eps, data?.fechaNacimiento, data?.telefonoResidencia].filter(isFilled).length;
  const t2 = [data?.motivoConsultaTexto, data?.mcEnfermedadActual].filter(isFilled).length;
  const t3 = [data?.mcFamObservaciones, data?.mcPerOsteomuscular, data?.mcPerQuirurgicos, data?.mcPerAlergicos].filter(isFilled).length;
  const t4 = [
    data?.mcAfMinutosSesion,
    data?.mcAfSesionesSemana,
    data?.mcAfMeses,
    data?.mcAfExperienciaGym,
    data?.mcAfModalidad,
    data?.mcAfObjetivo,
  ].filter(isFilled).length;
  const t5 = [data?.mcPeso, data?.mcTalla, data?.tas, data?.tad, data?.mcRuffierFc1, data?.mcHandgripDer1, data?.mcExamenObservaciones].filter(isFilled).length;
  const t6 = [
    data?.mcDxNutricional,
    data?.mcDxCardiovascular,
    data?.mcDxOsteomuscular,
    data?.mcRiesgoAcsm,
    data?.mcRiesgoBodytech,
    data?.downtonRiesgo,
    data?.aptitud,
  ].filter(isFilled).length;
  // La prescripción de ejercicio pasó a las columnas `presc_*` del panel del rol
  // Médico (mismo componente), así que el contador mira una sección de cada
  // bloque de ese tab más lo propio del examen ocupacional.
  const t7 = [
    data?.mcAnalisis,
    data?.prescGenerales,
    data?.prescCardioIntensidad,
    data?.prescFuerzaIntensidad,
    data?.prescFlexTipo,
    data?.prescClaseModalidad,
    data?.mcRemision,
  ].filter(isFilled).length;

  return [
    { id: 'c1', label: TAB_LABELS.c1, filled: t1, total: 7 },
    { id: 'c2', label: TAB_LABELS.c2, filled: t2, total: 2 },
    { id: 'c3', label: TAB_LABELS.c3, filled: t3, total: 4 },
    { id: 'c4', label: TAB_LABELS.c4, filled: t4, total: 6 },
    { id: 'c5', label: TAB_LABELS.c5, filled: t5, total: 7 },
    { id: 'c6', label: TAB_LABELS.c6, shortLabel: 'Diagnóstico', filled: t6, total: 7 },
    { id: 'c7', label: TAB_LABELS.c7, shortLabel: 'Prescripción', filled: t7, total: 7 },
  ];
}

function relativeTime(date: Date | null): string {
  if (!date) return '—';
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return 'ahora';
  if (diff < 60) return `hace ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  return `hace ${h} h`;
}

/** Header simple del panel corporativo — sin PDF ni toggle de maximizar (no hay video). */
function CorpHeader({ sectionTitle, saveState, onRetry }: { sectionTitle: string; saveState: SaveStatus; onRetry: () => void }) {
  const saveLabel = saveState.error
    ? 'Error al guardar — clic para reintentar'
    : saveState.saving
      ? 'Guardando…'
      : saveState.lastSavedAt
        ? `Guardado ${relativeTime(saveState.lastSavedAt)}`
        : 'Sin cambios';
  const pillCls = saveState.error
    ? 'bg-[rgba(var(--p-danger-rgb),0.12)] text-[var(--p-danger)] border-[rgba(var(--p-danger-rgb),0.25)]'
    : saveState.saving
      ? 'bg-[rgba(var(--p-accent-rgb),0.18)] text-[var(--p-accent)] border-[rgba(var(--p-accent-rgb),0.4)] animate-pulse'
      : 'bg-[rgba(var(--p-ok-rgb),0.12)] text-[var(--p-ok)] border-[rgba(var(--p-ok-rgb),0.25)]';

  return (
    <div className="flex items-center gap-3 px-5 py-2.5 border-b border-[var(--p-line)] shrink-0 z-20 bg-[var(--p-surface)]">
      <div className="flex flex-col min-w-0">
        <span className="text-[10.5px] font-semibold text-[var(--p-text-3)] tracking-widest uppercase">
          Sección
        </span>
        <span className="text-[15px] font-bold text-[var(--p-text)] truncate">{sectionTitle}</span>
      </div>
      <button
        type="button"
        onClick={() => saveState.error && onRetry()}
        title={saveLabel}
        aria-label={saveLabel}
        className={`ml-auto w-9 h-9 rounded-[10px] grid place-items-center flex-shrink-0 border transition ${pillCls}`}
      >
        {saveState.error ? <CloudOff size={16} /> : <Cloud size={16} />}
      </button>
    </div>
  );
}

function PanelInner({ historiaId }: MedicalCorporativoPanelProps) {
  const { data, loading, error, patchLocal } = useMedicalHistory(historiaId);
  const [activeTab, setActiveTab] = useState<CorpTabId>('c1');
  const { aggregate, retryAll } = useSaveCtx();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  // width === 0 es "todavía sin medir" (primer render), no "angosto".
  const navCollapsed = width > 0 && width < 900;

  const tabs = computeCorpTabsCount(data);
  const sectionTitle = TAB_LABELS[activeTab];

  return (
    <div
      ref={rootRef}
      className="panel-theme relative flex flex-col flex-1 min-h-0 overflow-hidden"
      // Este panel es standalone a pantalla completa (no un dock del 25% junto al
      // video como el panel de consulta estándar), así que se agranda con `zoom`
      // el tipográfico compacto compartido (Card/Modal/fields.tsx) en vez de
      // tocar esos componentes — son reusados por el panel de consulta acoplado.
      style={{ backgroundColor: 'var(--p-bg)', zoom: 1.4 }}
    >
      <CorpHeader sectionTitle={sectionTitle} saveState={aggregate} onRetry={retryAll} />

      {/* La fila (sidebar + contenido) es el contenedor posicionado; el que
          scrollea NO lo está. Los modales son `absolute inset-0`, así que se
          anclan al área visible del panel y no al origen del contenido
          scrolleado — si el scroller fuera el posicionado, abrir un modal
          estando abajo lo dejaría por encima de la vista, que es justo lo que
          reportó el equipo médico. Anclar a la fila (y no solo a la columna de
          contenido) también hace que el velo tape el sidebar: sin eso se puede
          cambiar de sección con un modal abierto y desmontarlo con un
          auto-guardado en vuelo. */}
      <div className="flex-1 min-h-0 flex relative">
        {!loading && !error && (
          <PanelSideNav
            active={activeTab}
            onChange={setActiveTab}
            tabs={tabs}
            brandTitle="Médico Corporativo"
            brandSubtitle="examen ocupacional"
            collapsed={navCollapsed}
          />
        )}

        <div className="flex-1 min-w-0 min-h-0">
          <div className="h-full overflow-y-auto">
        {loading && (
          <div className="p-6 text-center text-[var(--p-text-2)] text-sm">Cargando historia clínica...</div>
        )}
        {error && (
          <div className="m-5 p-4 rounded-xl border border-[rgba(var(--p-danger-rgb),0.40)] bg-[rgba(var(--p-danger-rgb),0.08)] text-[var(--p-danger)] text-sm">
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <PatientStrip data={data} />
            <div className="p-5 pb-16">
              {activeTab === 'c1' && (
                <CorpIdentificacionTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c2' && (
                <CorpAnamnesisTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c3' && (
                <CorpAntecedentesTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c4' && (
                <CorpActividadFisicaTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c5' && (
                <CorpExamenFisicoTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c6' && (
                <CorpDiagnosticoRiesgoTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
              {activeTab === 'c7' && (
                <CorpPrescripcionTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} />
              )}
            </div>
          </>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Orchestrator del panel Médico Corporativo — examen ocupacional presencial,
 * sin videollamada. Hermano de `MedicalConsultationPanel` (consulta) y
 * `MedicalHistoryPanel` (nutrición): mismo patrón (SaveProvider propio, tabs
 * propias), pero standalone — no se monta dentro de `VideoRoom`.
 */
export function MedicalCorporativoPanel(props: MedicalCorporativoPanelProps) {
  return (
    <SaveProvider>
      <PanelInner {...props} />
    </SaveProvider>
  );
}

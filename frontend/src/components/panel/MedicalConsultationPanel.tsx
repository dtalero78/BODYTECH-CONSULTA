import { useEffect, useState } from 'react';
import { PanelHeader } from './PanelHeader';
import { PatientStrip } from './PatientStrip';
import { Tabs, type TabDef } from './Tabs';
import { FAB } from './FAB';
import { SaveProvider, useSaveCtx } from './SaveContext';
import { useMedicalHistory } from './hooks/useMedicalHistory';
import type { MedicalHistoryFull, TabId } from './types';
import { DatosBasicosTab } from './tabs/DatosBasicosTab';
import { AnamnesisTab } from './tabs/AnamnesisTab';
import { RiesgoTab } from './tabs/RiesgoTab';
import { ExamenFisicoTab } from './tabs/ExamenFisicoTab';
import { IntervencionTab } from './tabs/IntervencionTab';
import { ConductaTab } from './tabs/ConductaTab';
import { ObservacionesTab } from './tabs/ObservacionesTab';

interface MedicalConsultationPanelProps {
  historiaId: string;
  isMaxed: boolean;
  onToggleMaxed: () => void;
}

const TAB_LABELS: Record<TabId, string> = {
  t1: 'Datos Básicos',
  t2: 'Anamnesis',
  t3: 'Clasificación de riesgo',
  t4: 'Examen físico',
  t5: 'Intervención y procedimiento',
  t6: 'Conducta y remisión',
  t7: 'Observaciones',
};

function computeTabsCount(data: MedicalHistoryFull | null): TabDef[] {
  const t1Filled = [
    data?.generoBiologico,
    data?.identidadGenero,
    data?.grupoSanguineo,
    data?.fechaNacimiento,
    data?.estadoCivil,
    data?.paisResidencia,
    data?.municipio,
    data?.zonaTerritorial,
    data?.telefonoResidencia,
    data?.contactoEmergenciaNombre,
    data?.ocupacion,
    data?.eps,
    data?.tipoVinculacion,
  ].filter((v) => v !== null && v !== undefined && v !== '').length;
  return [
    { id: 't1', label: 'Datos Básicos', filled: t1Filled, total: 13 },
    { id: 't2', label: 'Anamnesis', filled: 0, total: 3 },
    { id: 't3', label: 'Clasificación de riesgo', filled: 0, total: 3, warn: true },
    { id: 't4', label: 'Examen físico', filled: 0, total: 15 },
    { id: 't5', label: 'Intervención', filled: 0, total: 2 },
    { id: 't6', label: 'Conducta', filled: 0, total: 1 },
    { id: 't7', label: 'Observaciones', filled: 0, total: 1 },
  ];
}

function PanelInner({ historiaId, isMaxed, onToggleMaxed }: MedicalConsultationPanelProps) {
  const { data, loading, error, patchLocal } = useMedicalHistory(historiaId);
  const [activeTab, setActiveTab] = useState<TabId>('t1');
  const [fabOpen, setFabOpen] = useState(false);
  const { aggregate, retryAll } = useSaveCtx();

  // Atajo M y N — solo si el foco no está en un editable.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (
        t.tagName === 'INPUT' ||
        t.tagName === 'TEXTAREA' ||
        t.tagName === 'SELECT' ||
        t.isContentEditable
      ) {
        return;
      }
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        onToggleMaxed();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setFabOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onToggleMaxed]);

  const tabs = computeTabsCount(data);
  const sectionTitle = TAB_LABELS[activeTab];

  return (
    <div className="relative flex flex-col h-full bg-[#0b141a] overflow-hidden font-figtree">
      <PanelHeader
        data={data}
        isMaxed={isMaxed}
        onToggleMaxed={onToggleMaxed}
        saveState={aggregate}
        sectionTitle={sectionTitle}
        onRetrySave={retryAll}
      />
      <div className="flex-1 overflow-y-auto relative">
        {loading && (
          <div className="p-6 text-center text-[#a4b1b9] text-sm">Cargando historia clínica...</div>
        )}
        {error && (
          <div className="m-5 p-4 rounded-xl border border-[#ef4444]/40 bg-[rgba(239,68,68,0.08)] text-[#ef4444] text-sm">
            {error}
          </div>
        )}
        {!loading && !error && (
          <>
            <PatientStrip data={data} />
            <Tabs active={activeTab} onChange={setActiveTab} tabs={tabs} />
            <div className="p-5 pb-32">
              {activeTab === 't1' && (
                <DatosBasicosTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't2' && <AnamnesisTab />}
              {activeTab === 't3' && <RiesgoTab />}
              {activeTab === 't4' && <ExamenFisicoTab />}
              {activeTab === 't5' && <IntervencionTab />}
              {activeTab === 't6' && <ConductaTab />}
              {activeTab === 't7' && <ObservacionesTab />}
            </div>
          </>
        )}
      </div>
      <FAB isMaxed={isMaxed} externalOpen={fabOpen} onOpenChange={setFabOpen} />
    </div>
  );
}

/**
 * Orchestrator del panel — componente público.
 */
export function MedicalConsultationPanel(props: MedicalConsultationPanelProps) {
  return (
    <SaveProvider>
      <PanelInner {...props} />
    </SaveProvider>
  );
}

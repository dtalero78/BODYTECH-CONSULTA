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
  ].filter(isFilled).length;

  // ----- t2: Anamnesis (3 secciones) -----
  const t2Section1 =
    [
      data?.objetivoBodytech,
      data?.modalidad,
      data?.servicioAtencion,
      data?.lugarAtencion,
      data?.puertaEntrada,
      data?.causa,
      data?.tipoConsulta,
      data?.motivoConsultaTexto,
    ].filter(isFilled).length >= 1;

  const anyAntFlag =
    coerceBool(data?.antPatologicoFlag) ||
    coerceBool(data?.antQuirurgicoFlag) ||
    coerceBool(data?.antOsteomuscularFlag) ||
    coerceBool(data?.antFarmacologicoFlag) ||
    coerceBool(data?.antAlergicosFlag) ||
    coerceBool(data?.antFamiliaresFlag) ||
    coerceBool(data?.embarazoActual) ||
    coerceBool(data?.planificacionFamiliarFlag);
  const anyAntDetail =
    isFilled(data?.antPatologicoTipo) ||
    isFilled(data?.antQuirurgicoObs) ||
    isFilled(data?.antOsteomuscularTipo) ||
    isFilled(data?.antFarmacologicoObs);
  const t2Section2 = anyAntFlag || anyAntDetail;

  const t2Section3 =
    isFilled(data?.actividadFrecuencia) || data?.actividadDuracionMin != null;

  const t2Filled = [t2Section1, t2Section2, t2Section3].filter(Boolean).length;

  // ----- t3: Riesgo (3 secciones) -----
  const t3Section1 = isFilled(data?.downtonRiesgo);
  const t3Section2 = isFilled(data?.acsmRiesgo);
  const t3Section3 = isFilled(data?.riesgoFinal);
  const t3Filled = [t3Section1, t3Section2, t3Section3].filter(Boolean).length;
  const t3Warn = data?.riesgoFinal === 'ALTO';

  // ----- t4: Examen físico (15 keys) -----
  const t4Keys = [
    data?.ccPesoNuevo,
    data?.ccEstaturaNuevo,
    data?.ccImcNuevo,
    data?.ccGrasaNuevo,
    data?.ccPerimetroAbdominalNuevo,
    data?.posturaEspalda,
    data?.hallazgosDescripcion,
    data?.hallazgosDolor,
    data?.fuerzaInferior,
    data?.fcm,
    data?.tas,
    data?.tad,
    data?.equilibrioUnipodal,
    data?.riesgoMarcha,
    data?.riesgoOm,
  ];
  const t4Filled = t4Keys.filter(isFilled).length;

  return [
    { id: 't1', label: 'Datos Básicos', filled: t1Filled, total: 13 },
    { id: 't2', label: 'Anamnesis', filled: t2Filled, total: 3 },
    { id: 't3', label: 'Clasificación de riesgo', filled: t3Filled, total: 3, warn: t3Warn },
    { id: 't4', label: 'Examen físico', filled: t4Filled, total: 15 },
    { id: 't5', label: 'Intervención', filled: [data?.intervencionAnalisis, data?.intervencionTipoTecnologia, data?.intervencionTipoMeta, data?.dxTecnologiaSalud].filter(isFilled).length, total: 4 },
    { id: 't6', label: 'Conducta', filled: [data?.aptitud, data?.controlFecha].filter(isFilled).length, total: 2 },
    { id: 't7', label: 'Observaciones', filled: [data?.mdConceptoFinal, data?.mdRecomendacionesMedicasAdicionales].filter(isFilled).length, total: 2 },
  ];
}

function PanelInner({ historiaId, isMaxed, onToggleMaxed }: MedicalConsultationPanelProps) {
  const { data, loading, error, patchLocal, refetch } = useMedicalHistory(historiaId);
  const [activeTab, setActiveTab] = useState<TabId>('t1');
  const [fabOpen, setFabOpen] = useState(false);
  const { aggregate, retryAll } = useSaveCtx();
  // Phase 3 — Transcripción post-llamada.
  const [showTranscriptionBadge, setShowTranscriptionBadge] = useState(false);

  // ----- Phase 3 — Polling del status de transcripción -----
  // Cuando el GET inicial devuelve transcriptionStatus pending|processing,
  // hacemos polling cada 30s. Al detectar 'done', refetcheamos para que los
  // campos auto-rellenados aparezcan en la UI y mostramos un badge verde.
  // Si llega 'error' (o ya viene 'done' / null) no se inicia ningún interval.
  useEffect(() => {
    const status = data?.transcriptionStatus;
    const shouldPoll = status === 'pending' || status === 'processing';
    if (!shouldPoll) return;

    let cancelled = false;
    const interval = window.setInterval(async () => {
      if (cancelled) return;
      try {
        const apiBase = import.meta.env.VITE_API_BASE_URL || '';
        const res = await fetch(
          `${apiBase}/api/video/medical-history/${historiaId}`,
          { credentials: 'omit' }
        );
        if (!res.ok) return;
        const json = await res.json();
        const newStatus = json?.data?.transcriptionStatus;
        if (newStatus === 'done') {
          await refetch();
          if (!cancelled) {
            setShowTranscriptionBadge(true);
          }
          window.clearInterval(interval);
        } else if (newStatus === 'error') {
          // Cortamos polling sin badge. Log a consola para diagnóstico.
          console.warn('[Transcription] pipeline marcó error para', historiaId);
          window.clearInterval(interval);
        }
      } catch (e) {
        // Mantener polling vivo si hay un blip transitorio.
        console.warn('[Transcription] poll fallo transitorio:', e);
      }
    }, 30_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [data?.transcriptionStatus, historiaId, refetch]);

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
        transcriptionReady={showTranscriptionBadge}
        onDismissTranscriptionBadge={() => setShowTranscriptionBadge(false)}
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
              {activeTab === 't2' && (
                <AnamnesisTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't3' && (
                <RiesgoTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't4' && (
                <ExamenFisicoTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't5' && (
                <IntervencionTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't6' && (
                <ConductaTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
              {activeTab === 't7' && (
                <ObservacionesTab
                  historiaId={historiaId}
                  data={data}
                  isMaxed={isMaxed}
                  onPatchLocal={patchLocal}
                />
              )}
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

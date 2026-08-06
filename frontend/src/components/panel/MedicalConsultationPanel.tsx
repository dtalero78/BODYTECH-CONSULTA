import { useEffect, useRef, useState } from 'react';
import { Compass } from 'lucide-react';
import { PanelHeader } from './PanelHeader';
import { PatientStrip } from './PatientStrip';
import { PanelSideNav, type TabDef } from './PanelSideNav';
import { FAB } from './FAB';
import { GuidedConsultation } from './GuidedConsultation';
import { SaveProvider, useSaveCtx } from './SaveContext';
import { useMedicalHistory } from './hooks/useMedicalHistory';
import { useContainerWidth } from './hooks/useContainerWidth';
import type { MedicalHistoryFull, TabId } from './types';
import { DatosBasicosTab } from './tabs/DatosBasicosTab';
import { AnamnesisTab } from './tabs/AnamnesisTab';
import { RiesgoTab } from './tabs/RiesgoTab';
import { ExamenFisicoTab } from './tabs/ExamenFisicoTab';
import { IntervencionTab } from './tabs/IntervencionTab';
import { ConductaTab } from './tabs/ConductaTab';
import { ObservacionesTab } from './tabs/ObservacionesTab';
import { PrescripcionTab } from './tabs/PrescripcionTab';

interface MedicalConsultationPanelProps {
  historiaId: string;
  isMaxed: boolean;
  onToggleMaxed: () => void;
  /**
   * Auto-abrir la consulta guiada al cargar (solo en la consulta en vivo).
   * En navegación de historias (HistoriaDetallePage) queda en false para no
   * abrir el asistente cada vez que se revisa una historia. El botón "Consulta
   * guiada" sigue disponible siempre.
   */
  autoGuide?: boolean;
}

const TAB_LABELS: Record<TabId, string> = {
  t1: 'Datos Básicos',
  t2: 'Anamnesis',
  t3: 'Clasificación de riesgo',
  t4: 'Examen físico',
  t5: 'Intervención y procedimiento',
  t6: 'Conducta y remisión',
  t7: 'Observaciones',
  t8: 'Prescripción',
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

export function computeTabsCount(data: MedicalHistoryFull | null): TabDef[] {
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
    { id: 't3', label: 'Clasificación de riesgo', shortLabel: 'Riesgo', filled: t3Filled, total: 3, warn: t3Warn },
    { id: 't4', label: 'Examen físico', filled: t4Filled, total: 15 },
    { id: 't5', label: 'Intervención', filled: [data?.intervencionAnalisis, data?.intervencionTipoTecnologia, data?.intervencionTipoMeta, data?.dxTecnologiaSalud].filter(isFilled).length, total: 4 },
    { id: 't6', label: 'Conducta', filled: [data?.aptitud, data?.controlFecha].filter(isFilled).length, total: 2 },
    { id: 't7', label: 'Observaciones', filled: [data?.mdConceptoFinal, data?.mdRecomendacionesMedicasAdicionales].filter(isFilled).length, total: 2 },
    { id: 't8', label: 'Prescripción', filled: [isFilled(data?.prescGenerales), [data?.prescCardioFrecuencia, data?.prescCardioIntensidad, data?.prescCardioTiempo, data?.prescCardioTipo].some(isFilled), [data?.prescFuerzaFrecuencia, data?.prescFuerzaIntensidad, data?.prescFuerzaSeries, data?.prescFuerzaRepeticiones, data?.prescFuerzaTipo].some(isFilled), [data?.prescFlexFrecuencia, data?.prescFlexTiempo, data?.prescFlexTipo].some(isFilled), [data?.prescClaseModalidad, data?.prescClaseNombre, data?.prescClaseReemplaza].some(isFilled)].filter(Boolean).length, total: 5 },
  ];
}

function PanelInner({ historiaId, isMaxed, onToggleMaxed, autoGuide }: MedicalConsultationPanelProps) {
  const { data, loading, error, patchLocal } = useMedicalHistory(historiaId);
  const [activeTab, setActiveTab] = useState<TabId>('t1');
  const [fabOpen, setFabOpen] = useState(false);
  const { aggregate, retryAll } = useSaveCtx();
  // Consulta guiada ("modo entrevista"): se auto-abre al comenzar la consulta
  // y se puede reabrir con el botón. Una sola auto-apertura por montaje.
  const [guideOpen, setGuideOpen] = useState(false);
  const autoOpenedGuideRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // Phase 3 — Transcripción post-llamada.
  const [showTranscriptionBadge, setShowTranscriptionBadge] = useState(false);
  // Ref con el último status observado, para detectar la transición a 'done'
  // sin disparar el badge en cargas frescas donde el estado ya viene en 'done'
  // (no fue el resultado de un polling vivo).
  const lastTranscriptionStatusRef = useRef<string | null | undefined>(undefined);

  // ----- Phase 3 — Detección de transición a 'done' -----
  // El polling cada 30s ahora vive en `useMedicalHistory` vía `refetchInterval`.
  // Aquí sólo observamos `transcriptionStatus`: cuando pasa de un estado de
  // polling (`pending`/`processing`) a `done`, mostramos el badge. Cuando pasa
  // a `error`, el `refetchInterval` devuelve `false` y el polling para solo;
  // no mostramos badge.
  useEffect(() => {
    const prev = lastTranscriptionStatusRef.current;
    const curr = data?.transcriptionStatus;
    if (
      (prev === 'pending' || prev === 'processing') &&
      curr === 'done'
    ) {
      setShowTranscriptionBadge(true);
    }
    if (curr === 'error' && (prev === 'pending' || prev === 'processing')) {
      console.warn('[Transcription] pipeline marcó error para', historiaId);
    }
    lastTranscriptionStatusRef.current = curr;
  }, [data?.transcriptionStatus, historiaId]);

  // Auto-abrir la consulta guiada una vez, cuando la historia ya cargó.
  // Solo en la consulta en vivo (autoGuide) — no al navegar historias.
  useEffect(() => {
    if (!autoGuide || autoOpenedGuideRef.current) return;
    if (!loading && !error && data) {
      autoOpenedGuideRef.current = true;
      setGuideOpen(true);
    }
  }, [autoGuide, loading, error, data]);

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
  // Con el video al lado el panel ronda los 1000-1400px; maximizado, la pantalla
  // completa. Por debajo de 900 (pantallas chicas) el sidebar pasa a rail de íconos.
  const width = useContainerWidth(rootRef);
  const navCollapsed = width > 0 && width < 900;
  const navWidth = navCollapsed ? 58 : 232;

  return (
    <div
      ref={rootRef}
      className="panel-theme relative flex flex-col h-full bg-[var(--p-bg)] overflow-hidden"
    >
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
      {/* La fila (sidebar + contenido) es el contenedor posicionado; el que
          scrollea NO lo está. Los modales son `absolute inset-0` y deben
          anclarse al área visible del panel, no al origen del contenido
          scrolleado (si no, abrir un modal estando abajo lo deja por encima de
          la vista). Anclar a la fila también hace que el velo tape el sidebar:
          sin eso se puede cambiar de sección con un modal abierto y
          desmontarlo con un auto-guardado en vuelo. */}
      <div className="flex-1 min-h-0 flex relative">
        {!loading && !error && (
          <PanelSideNav
            active={activeTab}
            onChange={setActiveTab}
            tabs={tabs}
            eyebrow="Consulta"
            collapsed={navCollapsed}
            footer={
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                title="Consulta guiada"
                // Botón secundario en el patrón `CTA_OUTLINE` del Coordinador:
                // contorno neutro, no de color.
                className={`w-full inline-flex items-center gap-2 rounded-md text-[12.5px] font-medium bg-[var(--p-surface)] text-[var(--p-text-2)] border border-[var(--p-line)] hover:bg-[var(--p-input-2)] hover:text-[var(--p-text)] transition ${
                  navCollapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'
                }`}
              >
                <Compass size={15} className="shrink-0" />
                {!navCollapsed && 'Consulta guiada'}
              </button>
            }
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
              {activeTab === 't8' && (
                <PrescripcionTab
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
        </div>
      </div>
      <GuidedConsultation
        historiaId={historiaId}
        data={data}
        isMaxed={isMaxed}
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        onPatchLocal={patchLocal}
      />
      <FAB isMaxed={isMaxed} externalOpen={fabOpen} onOpenChange={setFabOpen} navWidth={navWidth} />
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

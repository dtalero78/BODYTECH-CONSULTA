import { useRef, useState } from 'react';
import { Cloud, CloudOff, CheckCircle2, Loader2 } from 'lucide-react';
import apiService from '../../services/api.service';
import { PatientStrip } from './PatientStrip';
import { PanelSideNav, type TabDef } from './PanelSideNav';
import { SaveProvider, useSaveCtx } from './SaveContext';
import { useMedicalHistory } from './hooks/useMedicalHistory';
import { useContainerWidth } from './hooks/useContainerWidth';
import type { MedicalHistoryFull, SaveStatus } from './types';
import { resumirCompletitud, tieneValor, type CampoCompletitud } from './corporativo-tabs/completitud';
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

/**
 * Campos que cuentan para la completitud de cada sección, con su etiqueta.
 *
 * Antes esto era una muestra arbitraria de columnas: la sección Antecedentes,
 * por ejemplo, contaba 4 campos de texto e ignoraba los 22 toggles Sí/No, así
 * que se podía diligenciar todo y seguir viendo 0/4. El equipo médico reportó
 * exactamente eso — "salen incompletas y no tienes cómo saber cuál falta" —
 * porque el número no correspondía a nada visible en pantalla.
 *
 * Ahora cada sección declara sus campos reales y devuelve además CUÁLES faltan,
 * que es lo que alimenta el tooltip del sidebar.
 */
function camposPorSeccion(
  data: MedicalHistoryFull | null
): Record<CorpTabId, ReadonlyArray<CampoCompletitud>> {
  const d = data;
  return {
    c1: [
      { label: 'Fecha de nacimiento', value: d?.fechaNacimiento },
      { label: 'Género', value: d?.generoBiologico },
      { label: 'Ocupación', value: d?.ocupacion },
      { label: 'EPS', value: d?.eps },
      { label: 'Teléfono', value: d?.telefonoResidencia },
      { label: 'Tipo de consulta', value: d?.tipoConsulta },
      { label: 'Dirección', value: d?.mcDireccion, opcional: true },
      { label: 'Correo', value: d?.email, opcional: true },
      { label: 'RH', value: d?.grupoSanguineo, opcional: true },
    ],
    c2: [
      { label: 'Motivo de consulta', value: d?.motivoConsultaTexto },
      { label: 'Enfermedad actual', value: d?.mcEnfermedadActual },
      { label: 'Síntomas en ejercicio', value: d?.mcSintDolorToracico },
    ],
    c3: [
      { label: 'Antecedentes familiares', value: d?.mcFamCardiaca },
      { label: 'Antecedentes personales', value: d?.mcPerCardiaca },
      { label: 'Osteomusculares', value: d?.mcPerOsteomuscular },
      { label: 'Quirúrgicos', value: d?.mcPerQuirurgicos },
      { label: 'Alérgicos', value: d?.mcPerAlergicos },
      { label: 'Farmacológicos', value: d?.mcPerFarmacologicos },
    ],
    c4: [
      { label: 'Minutos por sesión', value: d?.mcAfMinutosSesion },
      { label: 'Sesiones por semana', value: d?.mcAfSesionesSemana },
      { label: 'Meses de práctica', value: d?.mcAfMeses },
      { label: 'Experiencia en gimnasio', value: d?.mcAfExperienciaGym },
      { label: 'Dónde entrena', value: d?.mcAfModalidad },
      { label: 'Objetivo', value: d?.mcAfObjetivo },
    ],
    c5: [
      { label: 'Peso', value: d?.mcPeso },
      { label: 'Talla', value: d?.mcTalla },
      { label: 'TAS', value: d?.tas },
      { label: 'TAD', value: d?.tad },
      { label: 'Frecuencia cardiaca', value: d?.mcFrecCard },
      { label: 'Test de Ruffier', value: d?.mcRuffierFc2 },
      { label: 'Handgrip', value: d?.mcHandgripDer1 },
      // Opcionales por decisión del equipo médico: no se toman de rutina.
      { label: 'SatO2', value: d?.mcSato2, opcional: true },
      { label: 'Frecuencia respiratoria', value: d?.mcFrecResp, opcional: true },
      { label: 'Perímetro abdominal', value: d?.mcPerimetroAbdominal, opcional: true },
      { label: 'Revisión por sistemas', value: d?.mcRsTorax },
      { label: 'Observaciones del examen', value: d?.mcExamenObservaciones, opcional: true },
    ],
    c6: [
      { label: 'Dx nutricional', value: d?.mcDxNutricional },
      { label: 'Dx cardiovascular', value: d?.mcDxCardiovascular },
      { label: 'Dx osteomuscular', value: d?.mcDxOsteomuscular },
      { label: 'Riesgo ACSM', value: d?.mcRiesgoAcsm },
      { label: 'Riesgo Bodytech', value: d?.mcRiesgoBodytech },
      { label: 'Índice Downton', value: d?.downtonRiesgo },
      { label: 'Aptitud', value: d?.aptitud },
    ],
    c7: [
      { label: 'Análisis', value: d?.mcAnalisis },
      { label: 'Recomendaciones generales', value: d?.prescGenerales },
      { label: 'Cardio', value: d?.prescCardioIntensidad },
      { label: 'Fuerza', value: d?.prescFuerzaIntensidad },
      { label: 'Flexibilidad', value: d?.prescFlexTipo },
      { label: 'Clase grupal', value: d?.prescClaseModalidad, opcional: true },
      { label: 'Remisión', value: d?.mcRemision, opcional: true },
    ],
  };
}

function computeCorpTabsCount(data: MedicalHistoryFull | null): ReadonlyArray<TabDef<CorpTabId>> {
  const campos = camposPorSeccion(data);
  const short: Partial<Record<CorpTabId, string>> = {
    c6: 'Diagnóstico',
    c7: 'Prescripción',
  };
  return (Object.keys(campos) as CorpTabId[]).map((id) => {
    const r = resumirCompletitud(campos[id]);
    return {
      id,
      label: TAB_LABELS[id],
      shortLabel: short[id],
      filled: r.llenos,
      total: r.total,
      faltantes: r.faltantes,
    };
  });
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

  // ---- Finalizar la consulta ----
  // El panel del rol Médico marca la cita como atendida al colgar la
  // videollamada (VideoRoom). Acá no hay llamada, así que ese momento no existe
  // y la consulta se quedaba abierta para siempre: el examen ocupacional es
  // presencial. Además el equipo médico reportó que "en ningún lado me sale
  // grabar" — con auto-guardado campo a campo no había ningún cierre visible,
  // así que trabajaban creyendo que perdían todo.
  const [finalizando, setFinalizando] = useState(false);
  const [finalizadaLocal, setFinalizadaLocal] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const yaFinalizada = finalizadaLocal || tieneValor(data?.fechaConsulta);
  const pendientes = tabs.flatMap((t) => t.faltantes ?? []);

  async function finalizar() {
    if (!historiaId || finalizando) return;
    setFinalizando(true);
    try {
      await apiService.finalizarConsulta(historiaId);
      setFinalizadaLocal(true);
      setConfirmOpen(false);
    } catch {
      // El botón vuelve a habilitarse; el estado de guardado del header sigue
      // siendo la fuente de verdad de que los campos sí quedaron persistidos.
    } finally {
      setFinalizando(false);
    }
  }

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
            footer={
              yaFinalizada ? (
                <div
                  className={`w-full inline-flex items-center gap-2 rounded-md text-[12.5px] font-semibold text-[var(--p-ok)] bg-[rgba(var(--p-ok-rgb),0.10)] border border-[rgba(var(--p-ok-rgb),0.30)] ${
                    navCollapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'
                  }`}
                  title="La consulta quedó registrada como atendida"
                >
                  <CheckCircle2 size={15} className="shrink-0" />
                  {!navCollapsed && 'Consulta finalizada'}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(true)}
                  title="Finalizar consulta"
                  className={`w-full inline-flex items-center gap-2 rounded-md text-[12.5px] font-semibold bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:bg-[var(--p-accent-hover)] transition ${
                    navCollapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'
                  }`}
                >
                  <CheckCircle2 size={15} className="shrink-0" />
                  {!navCollapsed && 'Finalizar consulta'}
                </button>
              )
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

      {/* Confirmación de cierre. Lista lo que falta pero NO bloquea: hay campos
          que legítimamente no aplican a cada paciente, y el criterio de si la
          historia está completa es del médico, no del formulario. */}
      {confirmOpen && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-[rgba(var(--p-scrim-rgb),0.55)] p-6">
          <div className="w-full max-w-md rounded-2xl bg-[var(--p-surface)] border border-[var(--p-line)] p-5 shadow-xl">
            <div className="text-[15px] font-bold text-[var(--p-text)] mb-1">Finalizar consulta</div>
            <div className="text-[13px] text-[var(--p-text-2)] mb-4">
              Los datos se guardan solos a medida que los diligencias. Al finalizar, la
              consulta queda registrada como atendida.
            </div>

            {pendientes.length > 0 ? (
              <div className="mb-4 rounded-xl border border-[rgba(var(--p-warn-rgb),0.35)] bg-[rgba(var(--p-warn-rgb),0.08)] p-3">
                <div className="text-[12px] font-semibold text-[var(--p-warn)] mb-1.5">
                  Quedan {pendientes.length} campos sin diligenciar
                </div>
                <div className="text-[12px] text-[var(--p-text-2)] leading-relaxed">
                  {pendientes.slice(0, 8).join(', ')}
                  {pendientes.length > 8 ? ` y ${pendientes.length - 8} más` : ''}
                </div>
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-[rgba(var(--p-ok-rgb),0.30)] bg-[rgba(var(--p-ok-rgb),0.08)] p-3 text-[12px] font-semibold text-[var(--p-ok)]">
                Todas las secciones están completas.
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="px-3.5 py-2 rounded-md text-[12.5px] font-medium text-[var(--p-text-2)] bg-[var(--p-surface)] border border-[var(--p-line)] hover:bg-[var(--p-input-2)] transition"
              >
                Seguir editando
              </button>
              <button
                type="button"
                onClick={finalizar}
                disabled={finalizando}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-md text-[12.5px] font-semibold bg-[var(--p-accent)] text-[var(--p-on-accent)] hover:bg-[var(--p-accent-hover)] transition disabled:opacity-60"
              >
                {finalizando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                {finalizando ? 'Finalizando…' : 'Finalizar'}
              </button>
            </div>
          </div>
        </div>
      )}
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

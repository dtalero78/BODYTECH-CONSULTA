import { useRef, useState } from 'react';
import { Cloud, CloudOff, CheckCircle2, Loader2, AlertTriangle, FileSpreadsheet, RefreshCw } from 'lucide-react';
import apiService from '../../services/api.service';
import { EXCEL_VALORACIONES_URL } from '../../config/enlaces';
import { PatientStrip } from './PatientStrip';
import { PanelSideNav, type TabDef } from './PanelSideNav';
import { SaveProvider, useSaveCtx } from './SaveContext';
import { useMedicalHistory } from './hooks/useMedicalHistory';
import { useContainerWidth } from './hooks/useContainerWidth';
import type { MedicalHistoryFull, SaveStatus } from './types';
import { resumirCompletitud, tieneValor, type CampoCompletitud } from './corporativo-tabs/completitud';
import { camposPorSeccion, TAB_LABELS, type CorpTabId } from './corporativo-tabs/camposCorporativo';
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

type TabCorp = TabDef<CorpTabId> & { detalle: ReadonlyArray<CampoCompletitud> };

function computeCorpTabsCount(data: MedicalHistoryFull | null): ReadonlyArray<TabCorp> {
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
      detalle: campos[id].filter((c) => !c.opcional && !tieneValor(c.value)),
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

/**
 * La hoja de valoraciones, en otra pestaña. El médico se la pasa a los
 * entrenadores para armar el plan: reportó que al terminar la historia "no me
 * sale o no supe buscar el consolidado de Excel" — el único enlace estaba en el
 * panel del coordinador, donde un médico no entra.
 */
function abrirExcel() {
  window.open(EXCEL_VALORACIONES_URL, '_blank', 'noopener,noreferrer');
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
        onClick={abrirExcel}
        title="Abre el Excel de valoraciones, donde queda cada consulta finalizada con sus recomendaciones"
        className="ml-auto inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] text-[12.5px] font-semibold border border-[var(--p-line)] text-[var(--p-text-2)] bg-[var(--p-surface)] hover:bg-[var(--p-input-2)] transition"
      >
        <FileSpreadsheet size={15} className="text-[var(--p-ok)]" />
        Excel de valoraciones
      </button>
      <button
        type="button"
        onClick={() => saveState.error && onRetry()}
        title={saveLabel}
        aria-label={saveLabel}
        className={`w-9 h-9 rounded-[10px] grid place-items-center flex-shrink-0 border transition ${pillCls}`}
      >
        {saveState.error ? <CloudOff size={16} /> : <Cloud size={16} />}
      </button>
    </div>
  );
}

function PanelInner({ historiaId }: MedicalCorporativoPanelProps) {
  const { data, loading, error, patchLocal } = useMedicalHistory(historiaId);
  const [activeTab, setActiveTab] = useState<CorpTabId>('c1');
  // Modal que se pidió abrir desde la lista de lo que falta. La pestaña lo
  // abre al montarse y avisa (`onAbierto`) para bajar la solicitud.
  const [abrir, setAbrir] = useState<{ tab: CorpTabId; modal: string } | null>(null);
  const { aggregate, retryAll } = useSaveCtx();
  const rootRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(rootRef);
  // width === 0 es "todavía sin medir" (primer render), no "angosto".
  const navCollapsed = width > 0 && width < 900;

  const tabs = computeCorpTabsCount(data);
  const sectionTitle = TAB_LABELS[activeTab];

  const solicitud = (tab: CorpTabId) => (abrir?.tab === tab ? abrir.modal : null);
  const limpiarSolicitud = () => setAbrir(null);

  // ---- Finalizar la consulta ----
  // El panel del rol Médico marca la cita como atendida al colgar la
  // videollamada (VideoRoom). Acá no hay llamada, así que ese momento no existe
  // y la consulta se quedaba abierta para siempre: el examen ocupacional es
  // presencial. Además el equipo médico reportó que "en ningún lado me sale
  // grabar" — con auto-guardado campo a campo no había ningún cierre visible,
  // así que trabajaban creyendo que perdían todo.
  //
  // Finalizar también manda la valoración al Excel de valoraciones y a la
  // carpeta del afiliado en la base global. "Reenviar" repite eso con lo que se
  // haya corregido después (los dos destinos actualizan, no duplican).
  const [finalizando, setFinalizando] = useState(false);
  const [finalizadaLocal, setFinalizadaLocal] = useState(false);
  const [reenviada, setReenviada] = useState(false);
  const [errorCierre, setErrorCierre] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const yaFinalizada = finalizadaLocal || tieneValor(data?.fechaConsulta);
  const pendientes = tabs.flatMap((t) => t.faltantes ?? []);
  const seccionesIncompletas = tabs.filter((t) => t.detalle.length > 0);

  async function finalizar() {
    if (!historiaId || finalizando) return;
    const esReenvio = yaFinalizada;
    setFinalizando(true);
    setErrorCierre(null);
    try {
      await apiService.finalizarConsulta(historiaId);
      setFinalizadaLocal(true);
      setReenviada(esReenvio);
      setConfirmOpen(false);
    } catch {
      // El estado de guardado del header sigue siendo la fuente de verdad de que
      // los campos sí quedaron persistidos; lo que falló es el cierre.
      setErrorCierre('No se pudo finalizar. Revisa la conexión e intenta de nuevo.');
    } finally {
      setFinalizando(false);
    }
  }

  function irA(tab: CorpTabId, modal?: string) {
    setActiveTab(tab);
    setAbrir(modal ? { tab, modal } : null);
    setConfirmOpen(false);
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
            onChange={(id) => irA(id)}
            tabs={tabs}
            brandTitle="Médico Corporativo"
            brandSubtitle="examen ocupacional"
            collapsed={navCollapsed}
            footer={
              yaFinalizada ? (
                <div className="flex flex-col gap-1.5">
                  <div
                    className={`w-full inline-flex items-center gap-2 rounded-md text-[12.5px] font-semibold text-[var(--p-ok)] bg-[rgba(var(--p-ok-rgb),0.10)] border border-[rgba(var(--p-ok-rgb),0.30)] ${
                      navCollapsed ? 'justify-center px-0 py-2' : 'px-3 py-2'
                    }`}
                    title="La consulta quedó registrada como atendida"
                  >
                    <CheckCircle2 size={15} className="shrink-0" />
                    {!navCollapsed && 'Consulta finalizada'}
                  </div>
                  {!navCollapsed && (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          onClick={abrirExcel}
                          className="inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold border border-[var(--p-line)] text-[var(--p-text-2)] bg-[var(--p-surface)] hover:bg-[var(--p-input-2)] transition"
                        >
                          <FileSpreadsheet size={13} className="shrink-0 text-[var(--p-ok)]" />
                          Ver Excel
                        </button>
                        <button
                          type="button"
                          onClick={finalizar}
                          disabled={finalizando}
                          title="Si corregiste algo después de finalizar, actualiza la fila del Excel y la carpeta del afiliado."
                          className="inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold border border-[var(--p-line)] text-[var(--p-text-2)] bg-[var(--p-surface)] hover:bg-[var(--p-input-2)] transition disabled:opacity-60"
                        >
                          {finalizando ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} className="shrink-0" />}
                          Reenviar
                        </button>
                      </div>
                      <div className="text-[11px] leading-snug text-[var(--p-text-3)]">
                        {reenviada
                          ? 'Enviada de nuevo: el Excel se actualiza en unos segundos.'
                          : 'Queda en el Excel en unos segundos, con las recomendaciones para los entrenadores.'}
                      </div>
                    </>
                  )}
                  {errorCierre && !navCollapsed && (
                    <div className="text-[11px] leading-snug text-[var(--p-danger)]">{errorCierre}</div>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setErrorCierre(null);
                    setConfirmOpen(true);
                  }}
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
                <CorpIdentificacionTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c1')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c2' && (
                <CorpAnamnesisTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c2')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c3' && (
                <CorpAntecedentesTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c3')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c4' && (
                <CorpActividadFisicaTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c4')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c5' && (
                <CorpExamenFisicoTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c5')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c6' && (
                <CorpDiagnosticoRiesgoTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c6')} onAbierto={limpiarSolicitud} />
              )}
              {activeTab === 'c7' && (
                <CorpPrescripcionTab historiaId={historiaId} data={data} onPatchLocal={patchLocal} abrir={solicitud('c7')} onAbierto={limpiarSolicitud} />
              )}
            </div>
          </>
        )}
          </div>
        </div>
      </div>

      {/* Confirmación de cierre. Lista lo que falta, sección por sección, y cada
          campo abre la ventana donde se llena. NO bloquea: hay campos que
          legítimamente no aplican a cada paciente, y el criterio de si la
          historia está completa es del médico, no del formulario. */}
      {confirmOpen && (
        <div className="absolute inset-0 z-50 grid place-items-center bg-[rgba(var(--p-scrim-rgb),0.55)] p-6">
          <div className="w-full max-w-md rounded-2xl bg-[var(--p-surface)] border border-[var(--p-line)] p-5 shadow-xl">
            <div className="text-[15px] font-bold text-[var(--p-text)] mb-1">Finalizar consulta</div>
            <div className="text-[13px] text-[var(--p-text-2)] mb-4">
              Los datos se guardan solos a medida que los diligencias. Al finalizar, la
              consulta queda registrada como atendida y pasa al Excel de valoraciones y a
              la carpeta del afiliado.
            </div>

            {seccionesIncompletas.length > 0 ? (
              <div className="mb-4 rounded-xl border border-[rgba(var(--p-warn-rgb),0.35)] bg-[rgba(var(--p-warn-rgb),0.08)] p-3">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--p-warn)] mb-2">
                  <AlertTriangle size={14} className="shrink-0" />
                  {pendientes.length === 1
                    ? 'Queda 1 campo sin diligenciar'
                    : `Quedan ${pendientes.length} campos sin diligenciar`}
                </div>
                {/* Cada campo es un botón que abre SU ventana. Antes el salto
                    dejaba al médico en la pestaña y tenía que abrir card por card
                    para encontrarlo ("me tocó devolverme varias veces"). */}
                <ul className="max-h-[260px] overflow-y-auto space-y-2 m-0 p-0 list-none">
                  {seccionesIncompletas.map((t) => (
                    <li key={t.id}>
                      <div className="text-[12px] font-semibold text-[var(--p-text)] px-1 mb-1">{t.label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {t.detalle.map((c) => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => irA(t.id, c.destino)}
                            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] text-[var(--p-text-2)] bg-[var(--p-surface)] border border-[var(--p-line)] hover:border-[var(--p-accent)] hover:text-[var(--p-accent)] transition"
                          >
                            {c.label}
                            <span className="text-[var(--p-accent)] font-semibold">→</span>
                          </button>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="mb-4 rounded-xl border border-[rgba(var(--p-ok-rgb),0.30)] bg-[rgba(var(--p-ok-rgb),0.08)] p-3 text-[12px] font-semibold text-[var(--p-ok)]">
                Todas las secciones están completas.
              </div>
            )}

            {errorCierre && (
              <div className="mb-3 text-[12px] text-[var(--p-danger)]">{errorCierre}</div>
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
                {finalizando ? 'Finalizando…' : pendientes.length > 0 ? 'Finalizar igual' : 'Finalizar'}
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

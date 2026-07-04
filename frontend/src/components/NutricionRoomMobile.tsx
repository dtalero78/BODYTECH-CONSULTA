import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVideoRoom } from '../hooks/useVideoRoom';
import { useRealtimeTranscription } from '../hooks/useRealtimeTranscription';
import { useConsultationRecorder } from '../hooks/useConsultationRecorder';
import { Participant } from './Participant';
import { WhatsappChatDrawer } from './WhatsappChatDrawer';
import { SCRIPT_NUTRI, GField } from './GuidedNutricion';
import apiService from '../services/api.service';
import '../styles/nutricion-mobile.css';

// ============================================================================
// NutricionRoomMobile — sala de atención en el celular (coach de nutrición).
//
// Implementa el diseño elegido del harness (iter-3): video del paciente
// colapsable a PiP, wizard de un paso por pantalla sobre el guion nutricional
// real (SCRIPT_NUTRI), transcripción en vivo como subtítulo ambiental, dock de
// llamada con chat de WhatsApp, y cierre con "Generar análisis" + "Finalizar".
//
// Persistencia: igual que el panel desktop, la historia se guarda UNA vez al
// finalizar (guardar antes marcaría atendido y dispararía el webhook Trepsi).
// Mientras tanto, los campos se respaldan como borrador en localStorage y el
// chip del header muestra "Borrador · hace Ns".
// ============================================================================

interface Props {
  identity: string;
  roomName: string;
  historiaId?: string;
  pacienteNombre?: string;
  onLeave?: () => void;
}

const CONCEPTO_OPTIONS = [
  'ESTADO NUTRICIONAL NORMAL',
  'SOBREPESO',
  'OBESIDAD GRADO I',
  'OBESIDAD GRADO II',
  'OBESIDAD GRADO III',
  'BAJO PESO',
  'DESNUTRICION',
  'RIESGO NUTRICIONAL',
  'REQUIERE SEGUIMIENTO',
];

function draftKey(historiaId: string) {
  return `nutri-mobile-draft-${historiaId}`;
}

function fmtClock(totalSecs: number): string {
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function NutricionRoomMobile({ identity, roomName, historiaId, pacienteNombre, onLeave }: Props) {
  const {
    room,
    localParticipant,
    remoteParticipants,
    isConnecting,
    isConnected,
    error,
    connectToRoom,
    disconnectFromRoom,
    toggleAudio,
    toggleVideo,
    isAudioEnabled,
    isVideoEnabled,
  } = useVideoRoom({ identity, roomName, role: 'doctor', historiaId });

  const recorder = useConsultationRecorder(room, {
    historiaId: historiaId ?? '',
    active: !!historiaId && isConnected,
    variant: 'nutricional',
  });

  const live = useRealtimeTranscription(room);

  // ----- historia + campos -----
  const [peso, setPeso] = useState('');
  const [talla, setTalla] = useState('');
  const [datos, setDatos] = useState<Record<string, any>>({});
  const [concepto, setConcepto] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [celular, setCelular] = useState('');
  const [nombrePaciente, setNombrePaciente] = useState(pacienteNombre || '');
  const historiaRef = useRef<any>(null);

  // ----- UI -----
  const [stepIdx, setStepIdx] = useState(0);
  const [pip, setPip] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [callSecs, setCallSecs] = useState(0);

  // Conectar al montar (la pantalla de "unirse" ya pasó).
  const connectedOnce = useRef(false);
  useEffect(() => {
    if (!connectedOnce.current) {
      connectedOnce.current = true;
      connectToRoom();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Timer de llamada.
  useEffect(() => {
    if (!isConnected) return;
    const t = setInterval(() => setCallSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isConnected]);

  // Transcripción en vivo: arranca al conectar (asiste el dictado del coach).
  useEffect(() => {
    if (isConnected && live.supported && !live.listening) {
      live.start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, live.supported]);

  // Cargar historia + borrador local.
  useEffect(() => {
    if (!historiaId) return;
    let cancelled = false;
    apiService
      .getMedicalHistory(historiaId)
      .then((data: any) => {
        if (cancelled || !data) return;
        historiaRef.current = data;
        setPeso(data.peso ?? '');
        setTalla(data.talla ?? '');
        setDatos(data.datosNutricionales && typeof data.datosNutricionales === 'object' ? data.datosNutricionales : {});
        setConcepto(data.mdConceptoFinal ?? '');
        setCelular(data.celular ?? '');
        if (!pacienteNombre) {
          const n = [data.primerNombre, data.primerApellido].filter(Boolean).join(' ');
          if (n) setNombrePaciente(n);
        }
        // El borrador local (si existe) gana sobre lo cargado.
        try {
          const raw = localStorage.getItem(draftKey(historiaId));
          if (raw) {
            const d = JSON.parse(raw);
            if (d.peso) setPeso(d.peso);
            if (d.talla) setTalla(d.talla);
            if (d.datos) setDatos((prev) => ({ ...prev, ...d.datos }));
            if (d.concepto) setConcepto(d.concepto);
            if (d.aiSuggestions) setAiSuggestions(d.aiSuggestions);
          }
        } catch {
          /* borrador corrupto → ignorar */
        }
      })
      .catch((e: any) => console.error('[NutriMobile] Error cargando historia:', e?.message ?? e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historiaId]);

  // Borrador en localStorage (debounce). NO persiste al servidor: guardar la
  // historia marca atendido + dispara el webhook Trepsi, así que eso ocurre
  // solo en "Finalizar consulta" (mismo modelo que el panel desktop).
  useEffect(() => {
    if (!historiaId) return;
    const t = setTimeout(() => {
      const ts = Date.now();
      try {
        localStorage.setItem(
          draftKey(historiaId),
          JSON.stringify({ peso, talla, datos, concepto, aiSuggestions, ts })
        );
      } catch {
        /* storage lleno → no bloquear */
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [peso, talla, datos, concepto, aiSuggestions, historiaId]);

  const guideGet = useCallback(
    (key: string): string => {
      if (key === 'peso') return peso ?? '';
      if (key === 'talla') return talla ?? '';
      const v = datos[key];
      return v === undefined || v === null ? '' : String(v);
    },
    [peso, talla, datos]
  );

  const guideSet = useCallback((key: string, value: string) => {
    if (key === 'peso') setPeso(value);
    else if (key === 'talla') setTalla(value);
    else setDatos((prev) => ({ ...prev, [key]: value }));
  }, []);

  // ----- wizard -----
  const steps = SCRIPT_NUTRI;
  const totalSteps = steps.length + 1; // + paso final (concepto y cierre)
  const isFinalStep = stepIdx === steps.length;
  const currentStep = isFinalStep ? null : steps[stepIdx];

  const remote = useMemo(() => {
    const arr = Array.from(remoteParticipants.values());
    return arr.length > 0 ? arr[0] : null;
  }, [remoteParticipants]);

  // ----- generar análisis ("la plataforma") -----
  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const h = historiaRef.current || {};
      const patientData = {
        nombre: nombrePaciente,
        edad: h.edad,
        genero: h.genero,
        peso,
        talla,
        motivoConsulta: datos.motivoConsultaTexto || '',
        objetivoPrincipal: datos.objetivoPrincipal || '',
        datosNutricionales: datos,
      };
      const text = await apiService.generateAISuggestions(patientData);
      // El backend puede embeber un bloque JSON de campos — mostrar solo la prosa.
      const visible = String(text || '')
        .replace(/---JSON_CAMPOS---[\s\S]*?---FIN_JSON---/g, '')
        .trim();
      setAiSuggestions(visible);
    } catch (e: any) {
      console.error('[NutriMobile] Error generando análisis:', e?.message ?? e);
      alert('No se pudo generar el análisis. Intenta de nuevo.');
    } finally {
      setIsGenerating(false);
    }
  };

  // ----- cierre -----
  const closeCall = useCallback(async () => {
    try {
      await recorder.stopAndUpload();
    } catch {
      /* la subida del audio es best-effort */
    }
    try {
      live.stop();
    } catch {
      /* noop */
    }
    disconnectFromRoom();
    try {
      await apiService.endRoom(roomName);
    } catch {
      /* el room igual expira */
    }
    onLeave?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recorder, disconnectFromRoom, roomName, onLeave]);

  const handleHang = async () => {
    if (isFinishing) return;
    const ok = window.confirm('¿Colgar la llamada? La historia NO se guardará todavía.');
    if (!ok) return;
    setIsFinishing(true);
    await closeCall();
  };

  const handleFinalize = async () => {
    if (isFinishing || !historiaId) return;
    setIsFinishing(true);
    try {
      // 1) Si hay transcripción, extraer campos y completar SOLO los vacíos
      //    (las notas del coach ganan) — mismo criterio que el panel desktop.
      let mergedDatos = { ...datos };
      const transcript = live.getTranscript();
      if (transcript && transcript.length > 40) {
        try {
          const extracted: any = await apiService.extractFields(historiaId, transcript, 'nutricional');
          const campos = extracted?.campos ?? extracted ?? {};
          if (campos && typeof campos === 'object') {
            for (const [k, v] of Object.entries(campos)) {
              const cur = mergedDatos[k];
              if ((cur === undefined || cur === null || cur === '') && v) {
                mergedDatos[k] = v;
              }
            }
            setDatos(mergedDatos);
          }
        } catch (e: any) {
          console.warn('[NutriMobile] extractFields falló (continuo con lo del coach):', e?.message);
        }
      }

      // 2) Guardar la historia (única escritura — marca atendido).
      await apiService.updateMedicalHistory({
        historiaId,
        mdConceptoFinal: concepto || 'Consulta nutricional realizada',
        mdRecomendacionesMedicasAdicionales: aiSuggestions || undefined,
        talla: talla || undefined,
        peso: peso || undefined,
        datosNutricionales: mergedDatos,
      });

      // 3) Limpiar borrador y cerrar la llamada.
      try {
        localStorage.removeItem(draftKey(historiaId));
      } catch {
        /* noop */
      }
      await closeCall();
    } catch (e: any) {
      console.error('[NutriMobile] Error al finalizar:', e?.message ?? e);
      alert('No se pudo guardar la historia. Revisa la conexión e intenta de nuevo.');
      setIsFinishing(false);
    }
  };

  // ----- render helpers -----
  const renderField = (f: GField) => {
    const val = guideGet(f.key);
    if (f.kind === 'textarea') {
      return (
        <div className="field-area" key={f.key}>
          {f.label && (
            <div className="nm-field" style={{ marginBottom: 4 }}>
              <label>{f.label}</label>
            </div>
          )}
          <textarea
            rows={f.rows ?? 3}
            placeholder={f.placeholder || ''}
            value={val}
            onChange={(e) => guideSet(f.key, e.target.value)}
          />
          <div className="field-toolbar">
            <span className="char-count">{val.length}</span>
          </div>
        </div>
      );
    }
    if (f.kind === 'select') {
      const inList = !val || (f.options ?? []).some((o) => o.value === val);
      return (
        <div className="nm-field" key={f.key}>
          {f.label && <label>{f.label}</label>}
          <select className="nm-select" value={val} onChange={(e) => guideSet(f.key, e.target.value)}>
            <option value="">Seleccione…</option>
            {(f.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
            {!inList && <option value={val}>{val}</option>}
          </select>
        </div>
      );
    }
    return (
      <div className="nm-field" key={f.key}>
        {f.label && <label>{f.label}</label>}
        <input
          className="nm-input"
          type="text"
          placeholder={f.placeholder || ''}
          value={val}
          onChange={(e) => guideSet(f.key, e.target.value)}
        />
      </div>
    );
  };

  const transcriptTail = (live.interim || live.transcript || '').slice(-90);

  return (
    <div className="nmroot">
      <div className="app">
        {/* HEADER compacto: logo + paciente + cronómetro en una sola fila */}
        <div className="topbar">
          <div className="brand">
            <img src="/bodySinFondo.png" alt="Bodytech" />
          </div>
          <div className="who-min">
            <span className="pdot"></span>
            <span className="pname">{nombrePaciente || 'Paciente'}</span>
          </div>
          <div className="timer">
            <span className="rec"></span>
            <span>{fmtClock(callSecs)}</span>
          </div>
        </div>

        {/* VIDEO */}
        <div className={`video-hero${pip ? ' pip' : ''}`}>
          {remote ? (
            <div style={{ position: 'absolute', inset: 0 }}>
              <Participant participant={remote} />
            </div>
          ) : (
            <div className="conn-state">
              {error ? (
                <span style={{ color: 'var(--danger)' }}>{error}</span>
              ) : isConnecting ? (
                <span>Conectando a la sala…</span>
              ) : (
                <span>Esperando a {nombrePaciente || 'tu afiliado'}…</span>
              )}
            </div>
          )}
          {localParticipant && !pip && (
            <div className="local-thumb">
              <Participant participant={localParticipant} isLocal />
            </div>
          )}
          <div className="overlay">
            <div className="overlay-top">
              <span className="tag">
                <span className="live"></span> {remote ? 'conectada' : isConnected ? 'en sala' : '…'}
              </span>
              <button
                className="collapse-btn"
                onClick={() => setPip((p) => !p)}
                title="Colapsar / expandir"
                aria-label="Colapsar video"
                type="button"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 4h6M4 4v6M20 20h-6M20 20v-6" />
                </svg>
              </button>
            </div>
            <div className="name-tag">{nombrePaciente || 'Paciente'}</div>
          </div>
        </div>

        {/* WIZARD */}
        <div className="wizard">
          <div className="wizard-head">
            <div className="progress-row">
              <div className="progress-label" style={{ marginLeft: 'auto' }}>Consulta guiada</div>
            </div>
            <div className="progress-bar">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div key={i} className={`seg${i <= stepIdx ? ' active' : ''}`}></div>
              ))}
            </div>
          </div>

          {!isFinalStep && currentStep && (
            <div className="step active" key={currentStep.id}>
              <div className="q-eyebrow">Paso {stepIdx + 1}</div>
              <div className="q-title">{currentStep.question}</div>
              {currentStep.hint && <div className="q-help">{currentStep.hint}</div>}
              {currentStep.fields.map(renderField)}
            </div>
          )}

          {isFinalStep && (
            <div className="step active" key="final">
              <div className="q-eyebrow">Paso final</div>
              <div className="q-title">
                Concepto <em>final</em> y plan
              </div>
              <div className="q-help">
                Puedes redactar o dejar que la plataforma proponga un borrador a partir de lo capturado.
              </div>

              <button className="platform-cta" type="button" onClick={handleGenerate} disabled={isGenerating}>
                <div className="spark">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
                  </svg>
                </div>
                <div className="txt">
                  <b>{isGenerating ? 'Generando análisis…' : 'Generar análisis con la plataforma'}</b>
                  <span>Toma la información de los pasos y redacta un concepto editable.</span>
                </div>
              </button>

              <div className="field-area" style={{ marginTop: 10 }}>
                <textarea
                  style={{ minHeight: 110 }}
                  placeholder="Análisis y recomendaciones…"
                  value={aiSuggestions}
                  onChange={(e) => setAiSuggestions(e.target.value)}
                />
              </div>

              <div className="nm-field" style={{ marginTop: 10 }}>
                <label>Concepto final</label>
                <select className="nm-select" value={concepto} onChange={(e) => setConcepto(e.target.value)}>
                  <option value="">Seleccione una opción</option>
                  {CONCEPTO_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </div>

              <button className="finalize-btn" type="button" onClick={handleFinalize} disabled={isFinishing}>
                {isFinishing ? 'Guardando…' : 'Finalizar consulta'}
              </button>
            </div>
          )}
        </div>

        {/* TRANSCRIPT — subtítulo ambiental */}
        {live.supported && (
          <div
            className="transcript"
            onClick={() => (live.listening ? live.stop() : live.start())}
            role="button"
            title={live.listening ? 'Pausar dictado' : 'Reanudar dictado'}
          >
            <div className="waveform" style={{ opacity: live.listening ? 1 : 0.25 }}>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div className="txt">
              {live.listening ? transcriptTail || 'Escuchando…' : 'Dictado en pausa — toca para reanudar'}
            </div>
            <div className="tag-mini">{live.listening ? 'en vivo' : 'pausa'}</div>
          </div>
        )}

        {/* WIZARD NAV */}
        <div className="wizard-nav">
          <button
            className="btn btn-ghost"
            disabled={stepIdx === 0}
            onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
            aria-label="Anterior"
            type="button"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            <span className="lbl">Anterior</span>
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setStepIdx((i) => Math.min(totalSteps - 1, i + 1))}
            disabled={isFinalStep}
            type="button"
          >
            <span>{stepIdx === totalSteps - 2 ? 'Ir al cierre' : 'Continuar'}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>

        {/* DOCK */}
        <div className="dock">
          <button
            className={`ctrl${!isAudioEnabled ? ' muted' : ''}`}
            onClick={toggleAudio}
            aria-pressed={!isAudioEnabled}
            title={isAudioEnabled ? 'Silenciar micrófono' : 'Activar micrófono'}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="12" rx="3" />
              <path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8" />
            </svg>
            <span className="slash"></span>
            <span className="ctrl-label">Muteado</span>
          </button>
          <button
            className={`ctrl${!isVideoEnabled ? ' muted' : ''}`}
            onClick={toggleVideo}
            aria-pressed={!isVideoEnabled}
            title={isVideoEnabled ? 'Apagar cámara' : 'Encender cámara'}
            type="button"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 6h11a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM22 8l-6 4 6 4V8z" />
            </svg>
            <span className="slash"></span>
            <span className="ctrl-label">Sin video</span>
          </button>
          <button className="ctrl hang" onClick={handleHang} title="Colgar" aria-label="Colgar" type="button" disabled={isFinishing}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 8c-4 0-8 1-8 4v3l4-1v-2c1-1 5-1 8-1s7 0 8 1v2l4 1v-3c0-3-4-4-8-4h-8z" transform="rotate(135 12 12)" />
            </svg>
          </button>
          <button
            className="ctrl wa"
            onClick={() => setChatOpen(true)}
            disabled={!celular}
            title={celular ? 'Abrir chat de WhatsApp' : 'Sin celular registrado'}
            aria-label="Abrir chat de WhatsApp"
            type="button"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.5 3.5A11 11 0 003.7 17.2L2 22l4.9-1.6a11 11 0 0016.6-9.4c0-3-1.1-5.7-3-7.5zM12 20a8.4 8.4 0 01-4.3-1.2l-.3-.2-2.9.9.9-2.8-.2-.3A8.5 8.5 0 1112 20zm4.7-6.4c-.3-.1-1.5-.7-1.8-.8-.2-.1-.4-.1-.6.1s-.7.8-.8 1c-.2.2-.3.2-.6.1-1.5-.7-2.4-1.3-3.4-3-.3-.5.3-.4.7-1.4.1-.2 0-.4 0-.5s-.6-1.5-.8-2c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.4-.3.3-1 1-1 2.3s1 2.7 1.1 2.9c.1.2 2 3 4.8 4.2 1.8.7 2.5.8 3.4.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2 0-.1-.2-.2-.5-.3z" />
            </svg>
            <span className="ctrl-label">Chat</span>
          </button>
        </div>
      </div>

      {chatOpen && celular && (
        <WhatsappChatDrawer celular={celular} nombre={nombrePaciente || 'Paciente'} onClose={() => setChatOpen(false)} />
      )}
    </div>
  );
}

export default NutricionRoomMobile;

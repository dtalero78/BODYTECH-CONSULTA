// ============================================================================
// HistoriaDetallePage — Vista standalone de una historia clínica por ID.
//
// Permite abrir el MedicalConsultationPanel sin tener que estar en una
// videollamada activa. Útil desde el panel de Órdenes para revisar / editar
// una historia ya transcrita.
//
// Ruta: /historia/:historiaId
// ============================================================================

import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { MedicalConsultationPanel } from '../components/panel/MedicalConsultationPanel';
import { LlamadasVozPanel } from '../components/LlamadasVozPanel';
import authService from '../services/auth.service';
import { FONT_INTER } from '../components/coordinador/_tokens';

export function HistoriaDetallePage() {
  const { historiaId } = useParams<{ historiaId: string }>();
  const navigate = useNavigate();
  const [isMaxed, setIsMaxed] = useState(true);
  // Las grabaciones de las llamadas son audio de pacientes: solo quien audita.
  const role = authService.getUser()?.role;
  const audita = role === 'coordinador' || role === 'admin';

  if (!historiaId) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-8 max-w-md text-center">
          <h1 className="text-lg font-semibold text-zinc-900 mb-2">Falta el ID</h1>
          <p className="text-sm text-zinc-500">
            La URL debe ser <code>/historia/&lt;historiaId&gt;</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    // `h-screen` (no `min-h-screen`): el panel maneja su propio scroll interno y
    // su raíz es `h-full`, así que necesita una altura definida de la que colgar.
    <div
      className="h-screen bg-zinc-50 flex flex-col"
      style={{ fontFamily: FONT_INTER }}
    >
      {/* Header con back button */}
      <header className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center gap-3 shrink-0 z-30">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          title="Volver"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
            Historia clínica
          </div>
          <div className="text-[13px] text-zinc-700 font-mono truncate">{historiaId}</div>
        </div>
      </header>

      {/* Llamadas del coach con esta persona (solo coordinador/admin) */}
      {audita && <LlamadasVozPanel historiaId={historiaId} />}

      {/* Panel completo */}
      <main className="flex-1 min-h-0 flex flex-col">
        <MedicalConsultationPanel
          historiaId={historiaId}
          isMaxed={isMaxed}
          onToggleMaxed={() => setIsMaxed((v) => !v)}
        />
      </main>
    </div>
  );
}

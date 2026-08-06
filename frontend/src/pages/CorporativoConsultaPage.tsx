// ============================================================================
// CorporativoConsultaPage — panel de examen ocupacional del Médico Corporativo.
//
// Calcado de HistoriaDetallePage.tsx: vista standalone por historiaId, SIN
// videollamada (el médico corporativo examina al paciente presencialmente).
//
// Ruta: /corporativo/:historiaId
// ============================================================================

import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { MedicalCorporativoPanel } from '../components/panel/MedicalCorporativoPanel';
import { FONT_INTER } from '../components/coordinador/_tokens';

export function CorporativoConsultaPage() {
  const { historiaId } = useParams<{ historiaId: string }>();
  const navigate = useNavigate();

  if (!historiaId) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4">
        <div className="bg-white border border-zinc-200 rounded-xl p-8 max-w-md text-center">
          <h1 className="text-lg font-semibold text-zinc-900 mb-2">Falta el ID</h1>
          <p className="text-sm text-zinc-500">
            La URL debe ser <code>/corporativo/&lt;historiaId&gt;</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-screen bg-zinc-50 flex flex-col"
      style={{ fontFamily: FONT_INTER }}
    >
      <header className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          title="Volver"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        {/* El logo vive en el bloque de marca del sidebar del panel, como en el
            Panel Coordinador. Acá sería un duplicado. */}
        <div className="min-w-0">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-400 font-semibold">
            Médico Corporativo · Examen ocupacional
          </div>
          <div className="text-[13px] text-zinc-700 font-mono truncate">{historiaId}</div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex flex-col">
        <MedicalCorporativoPanel historiaId={historiaId} />
      </main>
    </div>
  );
}

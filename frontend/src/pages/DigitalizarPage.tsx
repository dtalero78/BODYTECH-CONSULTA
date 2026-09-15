// ============================================================================
// DigitalizarPage — "Digitalizar" fuera del panel de coordinador.
//
// Los médicos de la UMV también la usan, desde su panel de atención (pedido el
// 15-sep-2026), y ese panel no tiene dónde montar una vista más. Es la MISMA
// vista del coordinador (`DigitalizarView`): el pantallazo, las cédulas por
// verificar y el clic a MyBodytech funcionan igual en los dos lados.
//
// Quién entra lo decide el backend (`/api/digitalizar/acceso`); si dice que no,
// la página lo dice en vez de mostrar una vista que fallaría con 403.
//
// Ruta: /digitalizar
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { DigitalizarView } from '../components/coordinador/DigitalizarView';
import { FONT_INTER } from '../components/coordinador/_tokens';
import digitalizarService from '../services/digitalizar.service';
import authService from '../services/auth.service';

type Toast = { type: 'success' | 'error'; message: string } | null;

export function DigitalizarPage() {
  const navigate = useNavigate();
  const [puede, setPuede] = useState<boolean | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    digitalizarService.acceso().then(setPuede);
  }, []);

  // Estable: DigitalizarView lo usa como dependencia de sus efectos.
  const showToast = useCallback((t: NonNullable<Toast>) => {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const volver = () => {
    const rol = authService.getUser()?.role;
    navigate(rol === 'coordinador' || rol === 'admin' ? '/coordinador' : '/panel-medico');
  };

  return (
    <div className="min-h-screen bg-[#fafaf9] text-zinc-900" style={{ fontFamily: FONT_INTER }}>
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-md shadow-md flex items-center gap-2 text-[13px] max-w-md border ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
          <span>{toast.message}</span>
        </div>
      )}

      <header className="bg-white border-b border-zinc-200 px-6 py-3 flex items-center gap-3">
        <button
          onClick={volver}
          className="p-1.5 rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700"
          title="Volver al panel"
          aria-label="Volver al panel"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <img src="/logoNegro.png" alt="Bodytech" className="h-6 object-contain" />
      </header>

      <main className="px-4 md:px-8 pt-6 pb-10 max-w-[1400px] mx-auto">
        {puede === null && (
          <div className="flex items-center gap-2 text-[13px] text-zinc-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Cargando…
          </div>
        )}
        {puede === false && (
          <div className="max-w-md mx-auto mt-16 bg-white border border-zinc-200 rounded-xl p-8 text-center">
            <h1 className="text-[16px] font-semibold text-zinc-900 mb-2">Sin acceso a Digitalizar</h1>
            <p className="text-[13px] text-zinc-500">
              Esta herramienta es para la UMV. Si deberías tenerla, pídele acceso a la coordinación.
            </p>
          </div>
        )}
        {puede && <DigitalizarView showToast={showToast} />}
      </main>
    </div>
  );
}

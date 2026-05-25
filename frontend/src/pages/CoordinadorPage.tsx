import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  RefreshCw,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Users,
  CalendarDays,
} from 'lucide-react';
import authService from '../services/auth.service';
import { ProfesionalesView } from '../components/coordinador/ProfesionalesView';
import { CalendarioView } from '../components/coordinador/CalendarioView';

type Toast = { type: 'success' | 'error'; message: string } | null;
type Tab = 'profesionales' | 'calendario';

export function CoordinadorPage() {
  const navigate = useNavigate();
  const [toast, setToast] = useState<Toast>(null);
  const [tab, setTab] = useState<Tab>('profesionales');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!authService.isLoggedIn()) {
      navigate('/coordinador-login', { replace: true });
    }
  }, [navigate]);

  function showToast(t: NonNullable<Toast>) {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }

  function handleLogout() {
    authService.logout();
    navigate('/coordinador-login', { replace: true });
  }

  function handleRefresh() {
    setReloadKey((k) => k + 1);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 text-sm max-w-md ${
            toast.type === 'success'
              ? 'bg-green-50 border border-green-200 text-green-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Panel Coordinador</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Gestión de profesionales, disponibilidad y calendario
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="p-2 text-gray-500 hover:bg-gray-100 rounded-lg"
              title="Refrescar"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4" />
              Salir
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 -mb-px">
            <TabButton
              active={tab === 'profesionales'}
              onClick={() => setTab('profesionales')}
              icon={<Users className="w-4 h-4" />}
              label="Profesionales"
            />
            <TabButton
              active={tab === 'calendario'}
              onClick={() => setTab('calendario')}
              icon={<CalendarDays className="w-4 h-4" />}
              label="Calendario"
            />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'profesionales' ? (
          <ProfesionalesView reloadKey={reloadKey} showToast={showToast} />
        ) : (
          <CalendarioView showToast={showToast} key={`cal-${reloadKey}`} />
        )}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

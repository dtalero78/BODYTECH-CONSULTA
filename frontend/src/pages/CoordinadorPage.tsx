import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  AlertCircle,
  UsersRound,
  Sparkles,
  LayoutGrid,
  CalendarDays,
  FileText,
  LineChart,
  ShieldCheck,
  Building2,
  Settings,
  LogOut,
  UserCog,
  Map,
  Fingerprint,
  Database,
} from 'lucide-react';
import authService from '../services/auth.service';
import bodyvibeService from '../services/bodyvibe.service';
import { ProfesionalesView } from '../components/coordinador/ProfesionalesView';
import { CalendarioView } from '../components/coordinador/CalendarioView';
import { OrdenesView } from '../components/coordinador/OrdenesView';
import { IndicadoresView } from '../components/coordinador/IndicadoresView';
import { TorniqueteView } from '../components/coordinador/TorniqueteView';
import { UsuariosView } from '../components/coordinador/UsuariosView';
import { DirectorioView } from '../components/coordinador/DirectorioView';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, initialsOf } from '../components/coordinador/_tokens';
import { useClarity } from '../hooks/useClarity';

type Toast = { type: 'success' | 'error'; message: string } | null;
type View =
  | 'profesionales'
  | 'calendario'
  | 'torniquete'
  | 'ordenes'
  | 'indicadores'
  | 'usuarios'
  | 'directorio';

interface NavBadge {
  text: string;
  variant?: 'mono' | 'alert';
}

export function CoordinadorPage() {
  useClarity();

  const navigate = useNavigate();
  const [toast, setToast] = useState<Toast>(null);
  const [view, setView] = useState<View>('profesionales');
  const [reloadKey] = useState(0);

  // Badges dinámicos por sección (alimentados por las vistas conforme cargan datos).
  const [badges, setBadges] = useState<Record<View, NavBadge | undefined>>({
    profesionales: undefined,
    calendario: undefined,
    torniquete: undefined,
    ordenes: undefined,
    indicadores: undefined,
    directorio: undefined,
    usuarios: undefined,
  });

  useEffect(() => {
    if (!authService.isLoggedIn()) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  // IMPORTANTE: estos callbacks DEBEN ser estables (useCallback) porque se pasan
  // a las vistas hijas y entran como deps en sus useEffect / useCallback. Si se
  // recrearan en cada render dispararían el ciclo:
  //   reportCount → setBadges → re-render CoordinadorPage → nueva ref de
  //   callback → child effect dispara reload → reportCount → ... (loop infinito,
  //   "Maximum update depth exceeded" + ráfagas de fetches duplicados).
  const showToast = useCallback((t: NonNullable<Toast>) => {
    setToast(t);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleLogout = useCallback(() => {
    authService.logout();
    navigate('/login', { replace: true });
  }, [navigate]);

  // Tres callbacks especializados — uno por sección — para evitar pasar arrow
  // functions inline desde el JSX (que también romperían la estabilidad).
  const reportProfesionalesCount = useCallback((count: number | null) => {
    setBadges((b) => ({
      ...b,
      profesionales: count !== null ? { text: String(count), variant: 'mono' } : undefined,
    }));
  }, []);

  const reportCalendarioCount = useCallback((count: number | null) => {
    setBadges((b) => ({
      ...b,
      calendario: count !== null ? { text: String(count), variant: 'mono' } : undefined,
    }));
  }, []);

  const reportOrdenesCount = useCallback((count: number | null) => {
    setBadges((b) => ({
      ...b,
      ordenes: count !== null ? { text: String(count), variant: 'mono' } : undefined,
    }));
  }, []);

  // "Mapa de Rutas": botón privado, visible solo para emails autorizados.
  const MAPA_ALLOWED = ['danieltalero78@gmail.com', 'nikolay.correal@bodytechcorp.com'];
  // BodyVibeTech: la entrada no se muestra a quien no puede entrar — un ítem
  // que lleva a un 403 es peor que no tenerlo. Quién puede construir lo decide
  // el backend (rol + lista de constructores), así que se pregunta en vez de
  // deducirlo acá: una segunda copia de esa regla es una copia que se
  // desactualiza.
  const [puedeConstruir, setPuedeConstruir] = useState(false);
  useEffect(() => {
    bodyvibeService
      .estado()
      .then((e) => setPuedeConstruir(Boolean(e.puedoConstruir)))
      .catch(() => setPuedeConstruir(false));
  }, []);

  // "Aplicaciones" solo aparece si hay al menos una publicada para esta
  // persona. Mismo criterio que los anclajes: nada que lleve a una pantalla
  // vacía. Si falla la consulta, tampoco aparece.
  const [hayApps, setHayApps] = useState(false);
  useEffect(() => {
    bodyvibeService
      .publicados('sueltos')
      .then((lista) => setHayApps(lista.length > 0))
      .catch(() => setHayApps(false));
  }, []);

  const isMapaUser = useMemo(
    () => MAPA_ALLOWED.includes((authService.getUser()?.email || '').toLowerCase()),
    [],
  );

  // "Base Profesionales": muestra la planta COMPLETA de la cadena, con cédulas,
  // incluidas regionales donde el usuario no opera. Por eso va por lista de
  // emails y no por rol — `admin` la abriría a todos los administradores.
  // Esta lista solo decide si se dibuja el ítem; quien manda es el backend
  // (directorio.routes.ts), que devuelve 403 a quien no esté.
  const DIRECTORIO_ALLOWED = ['danieltalero78@gmail.com'];
  const isDirectorioUser = useMemo(
    () => DIRECTORIO_ALLOWED.includes((authService.getUser()?.email || '').toLowerCase()),
    [],
  );

  // Info del usuario para el footer del sidebar (nueva auth RBAC: getUser()).
  const userInfo = useMemo(() => {
    const user = authService.getUser();
    const nombre = user?.nombre || user?.email || 'Usuario';
    const role = user?.role ?? null;
    const rolLabel = role === 'admin' ? 'Administrador' : 'Coordinador';
    const sedeName = user?.esGlobal
      ? 'Todas las sedes'
      : user?.sedes?.length
        ? `${user.sedes.length} sede${user.sedes.length === 1 ? '' : 's'}`
        : 'Bodytech';
    return {
      initials: initialsOf(nombre),
      codigo: nombre,
      sedeName,
      rolLine: `${rolLabel} · ${sedeName}`,
    };
  }, []);

  return (
    <div
      className="min-h-screen flex bg-[#fafaf9] text-zinc-900"
      style={{ fontFamily: FONT_INTER }}
    >
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-md shadow-md flex items-center gap-2 text-[13px] max-w-md border ${
            toast.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
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

      {/* Sidebar */}
      <aside
        className="w-[220px] shrink-0 bg-[#fcfcfb] border-r border-zinc-200 min-h-screen sticky top-0 flex flex-col"
        style={{ fontFamily: FONT_INTER }}
      >
        {/* Bloque de marca */}
        <div className="px-5 pt-5 pb-5 border-b border-zinc-200 flex items-center gap-3">
          <img src="/logoNegro.png" alt="Bodytech" className="h-7 object-contain shrink-0" />
          <div className="leading-tight min-w-0">
            <div className="text-[15px] font-semibold text-zinc-900 tracking-tight truncate">
              Coordinador
            </div>
            <div className="text-[11.5px] font-normal text-zinc-500 -mt-0.5 truncate">
              panel médico
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="px-3 pt-4 pb-2 flex-1 overflow-y-auto">
          <div className={`${SECTION_LABEL} px-3 pb-2`}>OPERACIÓN</div>
          <div className="space-y-0.5 mb-5">
            <NavItem
              icon={<UsersRound className="w-[15px] h-[15px]" />}
              label="Profesionales"
              active={view === 'profesionales'}
              onClick={() => setView('profesionales')}
              badge={badges.profesionales}
            />
            <NavItem
              icon={<CalendarDays className="w-[15px] h-[15px]" />}
              label="Calendario"
              active={view === 'calendario'}
              onClick={() => setView('calendario')}
              badge={badges.calendario}
            />
            <NavItem
              icon={<FileText className="w-[15px] h-[15px]" />}
              label="Afiliados"
              active={view === 'ordenes'}
              onClick={() => setView('ordenes')}
              badge={badges.ordenes}
            />
            <NavItem
              icon={<Fingerprint className="w-[15px] h-[15px]" />}
              label="Torniquete"
              active={view === 'torniquete'}
              onClick={() => setView('torniquete')}
              badge={badges.torniquete}
            />
          </div>

          <div className={`${SECTION_LABEL} px-3 pb-2`}>ANÁLISIS</div>
          <div className="space-y-0.5 mb-5">
            <NavItem
              icon={<LineChart className="w-[15px] h-[15px]" />}
              label="Indicadores"
              active={view === 'indicadores'}
              onClick={() => setView('indicadores')}
              badge={badges.indicadores}
            />
            <NavItem
              icon={<ShieldCheck className="w-[15px] h-[15px]" />}
              label="Calidad"
              disabled
              tooltip="Próximamente"
            />
            {hayApps && (
              <NavItem
                icon={<LayoutGrid className="w-[15px] h-[15px]" />}
                label="Aplicaciones"
                onClick={() => navigate('/apps')}
              />
            )}
          </div>

          <div className={`${SECTION_LABEL} px-3 pb-2`}>SISTEMA</div>
          <div className="space-y-0.5">
            <NavItem
              icon={<UserCog className="w-[15px] h-[15px]" />}
              label="Usuarios"
              active={view === 'usuarios'}
              onClick={() => setView('usuarios')}
            />
            {puedeConstruir && (
              <NavItem
                icon={<Sparkles className="w-[15px] h-[15px]" />}
                label="BodyVibeTech"
                onClick={() => navigate('/bodyvibetech')}
              />
            )}
            {isMapaUser && (
              <NavItem
                icon={<Map className="w-[15px] h-[15px]" />}
                label="Mapa de Rutas"
                onClick={() =>
                  window.open('/mapa-rutas.html', '_blank', 'noopener,noreferrer')
                }
              />
            )}
            {isDirectorioUser && (
              <NavItem
                icon={<Database className="w-[15px] h-[15px]" />}
                label="Base Profesionales"
                active={view === 'directorio'}
                onClick={() => setView('directorio')}
              />
            )}
            <NavItem
              icon={<Building2 className="w-[15px] h-[15px]" />}
              label="Sedes"
              disabled
              tooltip="Próximamente"
            />
            <NavItem
              icon={<Settings className="w-[15px] h-[15px]" />}
              label="Ajustes"
              disabled
              tooltip="Próximamente"
            />
          </div>
        </nav>

        {/* Bloque de usuario */}
        <div className="mt-auto border-t border-zinc-200 px-3 py-3 flex items-center gap-2.5">
          <span
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 text-white font-semibold tracking-tight shrink-0"
            style={{ width: 28, height: 28, fontSize: 11 }}
          >
            {userInfo.initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-medium text-zinc-800 truncate">
              {userInfo.codigo}
            </div>
            <div className="text-[11px] text-zinc-500 truncate">
              {userInfo.rolLine}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100 transition-colors"
            title="Salir"
            aria-label="Salir"
          >
            <LogOut className="w-[14px] h-[14px]" />
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0">
        <div className="px-8 pt-6 pb-8">
          {view === 'profesionales' && (
            <ProfesionalesView
              reloadKey={reloadKey}
              showToast={showToast}
              reportCount={reportProfesionalesCount}
            />
          )}
          {view === 'calendario' && (
            <CalendarioView
              showToast={showToast}
              key={`cal-${reloadKey}`}
              reportCount={reportCalendarioCount}
            />
          )}
          {view === 'ordenes' && (
            <OrdenesView
              reloadKey={reloadKey}
              showToast={showToast}
              reportCount={reportOrdenesCount}
            />
          )}
          {view === 'torniquete' && (
            <TorniqueteView key={`torn-${reloadKey}`} showToast={showToast} />
          )}
          {view === 'indicadores' && (
            <IndicadoresView key={`ind-${reloadKey}`} showToast={showToast} />
          )}
          {view === 'usuarios' && (
            <UsuariosView key={`usr-${reloadKey}`} showToast={showToast} />
          )}
          {view === 'directorio' && isDirectorioUser && (
            <DirectorioView key={`dir-${reloadKey}`} showToast={showToast} />
          )}
        </div>
      </main>
    </div>
  );
}

// ----------------------------------------------------------------------------
// NavItem
// ----------------------------------------------------------------------------

function NavItem({
  icon,
  label,
  active = false,
  disabled = false,
  badge,
  onClick,
  tooltip,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  badge?: NavBadge;
  onClick?: () => void;
  tooltip?: string;
}) {
  const base =
    'relative w-full flex items-center gap-[11px] px-[10px] py-[7px] rounded-md text-[13.5px] font-medium transition-colors';
  let stateCls = 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900';
  if (active) {
    stateCls =
      'bg-white text-zinc-900 shadow-[inset_0_0_0_1px_#e4e4e7]';
  } else if (disabled) {
    stateCls = 'text-zinc-400 cursor-not-allowed opacity-60';
  }

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={tooltip}
      className={`${base} ${stateCls}`}
    >
      {active && (
        <span
          aria-hidden
          className="absolute left-[-12px] top-2 bottom-2 w-0.5 rounded-sm"
          style={{ background: '#1f3a8a' }}
        />
      )}
      <span className="text-zinc-500 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
      {badge && (
        <span
          className={`ml-auto text-[10.5px] tabular-nums ${
            badge.variant === 'alert'
              ? 'bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-full'
              : 'text-zinc-400'
          }`}
          style={{ fontFamily: FONT_MONO }}
        >
          {badge.text}
        </span>
      )}
    </button>
  );
}

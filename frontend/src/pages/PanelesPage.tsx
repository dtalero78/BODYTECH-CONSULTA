// ============================================================================
// PanelesPage — la puerta del creador de la plataforma a todas las pantallas.
//
// Consulta, ACC y Prepagadas entran por el mismo login de bodytech.app, y la
// cascada decide sola a cuál va cada correo: quien tiene cuenta en Consulta
// nunca llega a las otras dos. Mirar las tres pedía tres cuentas de prueba.
// Esta página las junta: las pantallas de Consulta se abren acá mismo, y las de
// ACC y Prepagadas en otra pestaña, con el token que cada app firmó al iniciar
// sesión (`tokensHermanas` en el backend).
//
// Solo la ve quien está en SUPERUSUARIOS: lo decide el backend y acá se
// pregunta. Entrar a una app no da permisos que la persona no tenga allá —
// cada una sigue decidiendo con su propio acceso.
// ============================================================================

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Building2,
  CalendarDays,
  ClipboardList,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  HeartPulse,
  KeyRound,
  LayoutGrid,
  LineChart,
  Loader2,
  LogOut,
  Map as MapIcon,
  MapPin,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Store,
  UserPlus,
  Users,
  UsersRound,
} from 'lucide-react';
import authService, { homePathForRole } from '../services/auth.service';
import panelesService, {
  tokenDe,
  urlDeSalto,
  venceA,
  type ProgramaPanel,
  type TokenPanel,
} from '../services/paneles.service';
import {
  CTA_OUTLINE,
  CTA_PRIMARY,
  FONT_INTER,
  ICON_BUTTON,
  SECTION_LABEL,
  TOKENS,
} from '../components/coordinador/_tokens';

interface Destino {
  label: string;
  detalle: string;
  icono: ReactNode;
  /** Ruta de Consulta, o la pantalla de la app hermana a la que se salta. */
  ruta: string;
}

interface Grupo {
  app: 'consulta' | ProgramaPanel;
  titulo: string;
  dominio: string;
  destinos: Destino[];
}

const NOMBRE_APP: Record<ProgramaPanel, string> = { acc: 'ACC', prepagadas: 'Prepagadas' };

const ICONO = 'h-[16px] w-[16px]';

const GRUPOS: Grupo[] = [
  {
    app: 'consulta',
    titulo: 'Consulta',
    dominio: 'bodytech.app',
    destinos: [
      {
        label: 'Coordinación',
        detalle: 'Team, calendario, afiliados, indicadores y empresas, de todas las unidades',
        icono: <Users className={ICONO} />,
        ruta: '/coordinador',
      },
      { label: 'Órdenes', detalle: 'Órdenes médicas', icono: <FileText className={ICONO} />, ruta: '/ordenes' },
      { label: 'Calidad', detalle: 'Evaluación de las consultas', icono: <ShieldCheck className={ICONO} />, ruta: '/calidad' },
      { label: 'BodyVibeTech', detalle: 'Construir y publicar aplicaciones', icono: <Sparkles className={ICONO} />, ruta: '/bodyvibetech' },
      { label: 'Aplicaciones', detalle: 'Las aplicaciones publicadas', icono: <LayoutGrid className={ICONO} />, ruta: '/apps' },
    ],
  },
  {
    app: 'acc',
    titulo: 'ACC',
    dominio: 'acc.bodytech.app',
    destinos: [
      { label: 'Agenda', detalle: 'Jornadas y turnos de las sedes', icono: <CalendarDays className={ICONO} />, ruta: '/agenda' },
      { label: 'Valoraciones', detalle: 'La lista de tomas, con su Excel', icono: <ClipboardList className={ICONO} />, ruta: '/valoraciones' },
      { label: 'Pacientes', detalle: 'El padrón del programa', icono: <UsersRound className={ICONO} />, ruta: '/pacientes' },
      { label: 'Team', detalle: 'Fisioterapeutas y sus horarios', icono: <UserPlus className={ICONO} />, ruta: '/team' },
      { label: 'Empresas', detalle: 'Clientes y quién entra a su panel', icono: <Building2 className={ICONO} />, ruta: '/empresas' },
      { label: 'Gestión de sedes', detalle: 'Abrir sedes y escribirles el horario', icono: <Store className={ICONO} />, ruta: '/sedes' },
      { label: 'Indicadores', detalle: 'Cómo va el programa', icono: <LineChart className={ICONO} />, ruta: '/indicadores' },
      { label: 'Ciudades', detalle: 'Demanda contra turnos por ciudad', icono: <MapPinned className={ICONO} />, ruta: '/ciudades' },
      { label: 'Panel de una empresa', detalle: 'Lo mismo que ve el cliente, eligiendo la empresa', icono: <FileSpreadsheet className={ICONO} />, ruta: '/informes' },
      { label: 'Mapa por paciente', detalle: 'Dónde vive quien agendó', icono: <MapIcon className={ICONO} />, ruta: '/georreferenciacion' },
      { label: 'Mapa por empresa', detalle: 'Dónde vive la nómina según el padrón', icono: <MapPin className={ICONO} />, ruta: '/georreferenciacion/empresa' },
    ],
  },
  {
    app: 'prepagadas',
    titulo: 'Prepagadas',
    dominio: 'prepagadas.bodytech.app',
    destinos: [
      // Prepagadas no lee `ir`: su /sso abre siempre los indicadores.
      { label: 'Entrar', detalle: 'Indicadores, afiliados, gestión y calendario', icono: <HeartPulse className={ICONO} />, ruta: '/indicadores' },
    ],
  },
];

function hora(t: TokenPanel): string {
  const vence = venceA(t);
  return vence ? vence.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';
}

export default function PanelesPage() {
  const navigate = useNavigate();
  const usuario = authService.getUser();
  const [puede, setPuede] = useState<boolean | null>(null);
  const [pidiendo, setPidiendo] = useState<{ app: ProgramaPanel; destino: Destino } | null>(null);
  // Los tokens viven en localStorage: esto solo fuerza a repintar el estado
  // de cada app cuando llega uno nuevo.
  const [, setVersion] = useState(0);

  useEffect(() => {
    panelesService
      .acceso()
      .then(setPuede)
      .catch(() => setPuede(false));
  }, []);

  if (puede === false) return <Navigate to={homePathForRole(usuario?.role)} replace />;

  const salir = () => {
    authService.logout();
    navigate('/login', { replace: true });
  };

  const abrir = (grupo: Grupo, destino: Destino) => {
    if (grupo.app === 'consulta') {
      navigate(destino.ruta);
      return;
    }
    const t = tokenDe(grupo.app);
    if (!t) {
      setPidiendo({ app: grupo.app, destino });
      return;
    }
    window.open(urlDeSalto(t, destino.ruta), '_blank', 'noopener');
  };

  return (
    <div className="min-h-screen text-zinc-900" style={{ background: TOKENS.surface, fontFamily: FONT_INTER }}>
      <header className="border-b border-zinc-200 bg-white px-5 py-3">
        <div className="mx-auto flex max-w-[1100px] items-center gap-4">
          <h1 className="text-[15px] font-semibold tracking-tight">Paneles</h1>
          <div className="ml-auto flex items-center gap-3">
            {usuario && <span className="hidden text-[12px] text-zinc-500 sm:inline">{usuario.email}</span>}
            <button type="button" onClick={salir} className={ICON_BUTTON} title="Salir" aria-label="Salir">
              <LogOut className="h-[14px] w-[14px]" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-5 py-6">
        {puede === null ? (
          <p className="text-[13px] text-zinc-500">Cargando…</p>
        ) : (
          <>
            <p className="mb-6 text-[13px] text-zinc-500">
              Entras como administrador. Las pantallas de ACC y Prepagadas se abren en otra pestaña.
            </p>

            <div className="space-y-8">
              {GRUPOS.map((grupo) => {
                const token = grupo.app === 'consulta' ? null : tokenDe(grupo.app);
                return (
                  <section key={grupo.app}>
                    <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <h2 className={SECTION_LABEL}>{grupo.titulo}</h2>
                      <span className="font-mono text-[11px] text-zinc-400">{grupo.dominio}</span>
                      {grupo.app !== 'consulta' && (
                        <span className="ml-auto text-[11.5px] text-zinc-500">
                          {token ? `Sesión lista hasta las ${hora(token)}` : 'Pide tu contraseña al entrar'}
                        </span>
                      )}
                    </div>
                    <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {grupo.destinos.map((destino) => (
                        <li key={destino.ruta}>
                          <button
                            type="button"
                            onClick={() => abrir(grupo, destino)}
                            className="group flex h-full w-full items-start gap-3 rounded-lg border border-zinc-200 bg-white p-3.5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                          >
                            <span className="mt-0.5 text-zinc-400 group-hover:text-[#1f3a8a]">{destino.icono}</span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
                                {destino.label}
                                {grupo.app !== 'consulta' && <ExternalLink className="h-[11px] w-[11px] text-zinc-300" />}
                              </span>
                              <span className="mt-0.5 block text-[12px] text-zinc-500">{destino.detalle}</span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </main>

      {pidiendo && (
        <PedirClave
          app={pidiendo.app}
          destino={pidiendo.destino}
          onCerrar={() => setPidiendo(null)}
          onListo={() => setVersion((v) => v + 1)}
        />
      )}
    </div>
  );
}

/**
 * Pide la contraseña cuando el token de esa app ya venció (dura 12 h) o no se
 * pudo pedir al iniciar sesión.
 *
 * Al terminar muestra un botón "Abrir" en vez de abrir solo: la pestaña nueva
 * tiene que salir de un clic. Abierta después de esperar la respuesta del
 * servidor, el navegador la trata como ventana emergente y la bloquea.
 */
function PedirClave({
  app,
  destino,
  onCerrar,
  onListo,
}: {
  app: ProgramaPanel;
  destino: Destino;
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<TokenPanel | null>(null);

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar();
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [onCerrar]);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const t = await panelesService.entrar(app, password);
      setListo(t);
      onListo();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo entrar. Intenta de nuevo.');
    } finally {
      setPassword('');
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/30 p-4" onClick={onCerrar}>
      <div
        className="w-full max-w-[380px] rounded-lg border border-zinc-200 bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {listo ? (
          <>
            <h2 className="text-[15px] font-semibold tracking-tight">Listo</h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              La sesión de {NOMBRE_APP[app]} queda guardada hasta las {hora(listo)}.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={CTA_OUTLINE} onClick={onCerrar}>
                Cerrar
              </button>
              <button
                type="button"
                className={CTA_PRIMARY}
                style={{ background: TOKENS.accent }}
                onClick={() => {
                  window.open(urlDeSalto(listo, destino.ruta), '_blank', 'noopener');
                  onCerrar();
                }}
              >
                Abrir {destino.label}
                <ExternalLink className="h-[13px] w-[13px]" />
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={enviar}>
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <KeyRound className="h-[15px] w-[15px] text-zinc-400" />
              Entrar a {NOMBRE_APP[app]}
            </h2>
            <p className="mt-1 text-[13px] text-zinc-500">
              Escribe tu contraseña para abrir una sesión en {NOMBRE_APP[app]}. Queda guardada 12 horas.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-4 h-9 w-full rounded-md border border-zinc-200 px-3 text-[13px] outline-none focus:border-[#1f3a8a]"
              aria-label="Contraseña"
            />
            {error && <p className="mt-2 text-[12.5px] text-red-700">{error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className={CTA_OUTLINE} onClick={onCerrar}>
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!password || enviando}
                className={`${CTA_PRIMARY} disabled:opacity-60`}
                style={{ background: TOKENS.accent }}
              >
                {enviando && <Loader2 className="h-[14px] w-[14px] animate-spin" />}
                Entrar
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

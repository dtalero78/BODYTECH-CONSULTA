// ============================================================================
// PanelPublicacion — publicar un borrador y revisar lo que otros pidieron.
//
// Dos mitades:
//
//   · Publicar (decisión 04): elegir audiencia es un acto deliberado. No hay
//     opción por defecto ni un botón que publique "a todos" de un clic.
//
//   · Aprobar (decisión 05): la pantalla de revisión muestra las TRES cosas
//     juntas — cómo se ve, qué datos toca, quién lo va a ver. Ver solo lo
//     primero es aprobar el color de algo cuyo riesgo está en lo otro.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import AppSandbox, { ResultadoConsulta } from './AppSandbox';
import bodyvibeService, { AnclajeDisponible, App, Solicitud } from '../../services/bodyvibe.service';

/** Los roles que pueden ser audiencia. `admin` no se lista: ya ve todo. */
const ROLES = [
  { id: 'coordinador', nombre: 'Coordinadores' },
  { id: 'medico', nombre: 'Médicos' },
  { id: 'coach', nombre: 'Coaches' },
  { id: 'auxiliar', nombre: 'Auxiliares' },
  { id: 'torre', nombre: 'Torre' },
];

interface PropsPublicar {
  app: App;
  onCambio: () => void;
}

export function Publicar({ app, onCambio }: PropsPublicar) {
  const [roles, setRoles] = useState<string[]>([]);
  const [alcance, setAlcance] = useState<'sede' | 'global'>('sede');
  const [anclaje, setAnclaje] = useState<string | null>(null);
  const [anclajes, setAnclajes] = useState<AnclajeDisponible[]>([]);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const publicado = app.estado === 'publicado';

  useEffect(() => {
    bodyvibeService.anclajes().then(setAnclajes).catch(() => setAnclajes([]));
  }, []);

  const alternarRol = (id: string) =>
    setRoles((r) => (r.includes(id) ? r.filter((x) => x !== id) : [...r, id]));

  const enviar = async () => {
    setEnviando(true);
    setMensaje(null);
    const r = await bodyvibeService.publicar(app.id, alcance, roles, [], anclaje);
    if (!r.ok) setMensaje(r.mensaje);
    else if (r.publicado) {
      setMensaje('Publicado. Como no cambiaron ni los datos ni la audiencia, no hizo falta aprobación.');
      onCambio();
    } else {
      setMensaje('Queda esperando aprobación. Mientras tanto seguís pudiendo iterarlo.');
      onCambio();
    }
    setEnviando(false);
  };

  const despublicar = async () => {
    const motivo = window.prompt('¿Por qué lo bajás? (queda registrado)') ?? '';
    if (await bodyvibeService.despublicar(app.id, motivo)) {
      setMensaje('Despublicado. Volvió a ser tu borrador, con su código y su historial intactos.');
      onCambio();
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 flex items-center gap-3">
        {publicado && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
            en vivo · v{app.version}
          </span>
        )}
      </div>

      <p className="mb-3 text-[12.5px] text-zinc-500">
        Mientras sea borrador solo lo ves vos. Al publicarlo elegís quién más puede abrirlo.
      </p>

      <div className="mb-3">
        <span className="mb-1.5 block text-[12px] font-medium">¿Quién puede verlo?</span>
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r.id}
              onClick={() => alternarRol(r.id)}
              className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
                roles.includes(r.id)
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
              }`}
            >
              {r.nombre}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <span className="mb-1.5 block text-[12px] font-medium">¿Hasta dónde llega?</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setAlcance('sede')}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              alcance === 'sede'
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-700'
            }`}
          >
            Mi sede
          </button>
          <button
            onClick={() => setAlcance('global')}
            className={`rounded-md border px-2.5 py-1 text-[12px] ${
              alcance === 'global'
                ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                : 'border-zinc-200 dark:border-zinc-700'
            }`}
          >
            Todas las sedes
          </button>
        </div>
        {alcance === 'global' && (
          <p className="mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
            Publicar a todas las sedes es un permiso aparte. Si no lo tenés, el sistema te lo va a decir.
          </p>
        )}
      </div>

      {/* Dónde vive. Suelto = en la pantalla de Aplicaciones; incrustado =
          dentro de una pantalla que ya existe, al pie. */}
      <div className="mb-4">
        <span className="mb-1.5 block text-[12px] font-medium">¿Dónde aparece?</span>
        <select
          value={anclaje ?? ''}
          onChange={(e) => setAnclaje(e.target.value || null)}
          className="w-full max-w-md rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">En la pantalla de Aplicaciones</option>
          {anclajes.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </select>
        {anclaje && (
          <p className="mt-1.5 text-[11.5px] text-zinc-500">
            {anclajes.find((a) => a.id === anclaje)?.descripcion}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={enviar}
          disabled={enviando || roles.length === 0}
          className="rounded-md bg-zinc-900 px-3.5 py-1.5 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {enviando ? 'Enviando…' : publicado ? 'Actualizar publicación' : 'Publicar'}
        </button>
        {publicado && (
          <button
            onClick={despublicar}
            className="rounded-md border border-zinc-200 px-3 py-1.5 text-[13px] dark:border-zinc-700"
          >
            Despublicar
          </button>
        )}
      </div>

      {mensaje && <p className="mt-2 text-[12.5px] text-zinc-600 dark:text-zinc-400">{mensaje}</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Bandeja de quien aprueba. Si la persona no aprueba, la API devuelve vacío y
 * el componente no pinta nada — no hay que preguntarle a nadie por su rol.
 */
export function Bandeja({ onCambio }: { onCambio: () => void }) {
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);

  const recargar = useCallback(() => {
    bodyvibeService.solicitudes().then(setSolicitudes).catch(() => setSolicitudes([]));
  }, []);

  useEffect(recargar, [recargar]);

  // Una solicitud se revisa mirándola correr. La vista previa consulta con el
  // id del app, igual que en producción.
  const consultar = useCallback(
    async (appId: string) =>
      async (sql: string, params: any[]): Promise<ResultadoConsulta> => {
        const r = await bodyvibeService.consultar(sql, params, appId);
        return r.ok ? { ok: true, filas: r.filas, recortado: r.recortado } : { ok: false, mensaje: r.mensaje };
      },
    []
  );

  if (solicitudes.length === 0) return null;

  return (
    <section>
      <p className="mb-3 text-[13px] text-zinc-500">
        {solicitudes.length === 1
          ? 'Una publicación espera tu visto bueno.'
          : `${solicitudes.length} publicaciones esperan tu visto bueno.`}
      </p>

      <ul className="flex flex-col gap-2">
        {solicitudes.map((s) => (
          <li
            key={s.id}
            className="rounded-lg border border-zinc-200 p-3.5 dark:border-zinc-800"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[14px] font-medium">{s.titulo ?? s.appId}</span>
              <span className="text-[12px] text-zinc-500">{s.solicitante}</span>
              <button
                onClick={() => setAbierta(abierta === s.id ? null : s.id)}
                className="ml-auto text-[12.5px] text-zinc-500 underline"
              >
                {abierta === s.id ? 'Ocultar' : 'Revisar'}
              </button>
            </div>

            {/* Las tres cosas que hay que ver juntas, no solo la primera. */}
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
              <div>
                <dt className="inline text-zinc-400">Qué datos toca: </dt>
                <dd className="inline font-mono text-[11.5px]">
                  {s.estantes.length ? s.estantes.join(', ') : 'ninguno'}
                </dd>
              </div>
              <div>
                <dt className="inline text-zinc-400">Quién lo va a ver: </dt>
                <dd className="inline">
                  {s.roles.join(', ')} ·{' '}
                  {s.alcance === 'global' ? 'todas las sedes' : s.sedes.join(', ') || 'su sede'}
                </dd>
              </div>
              <div>
                <dt className="inline text-zinc-400">Dónde aparece: </dt>
                <dd className="inline">
                  {s.anclaje ? `incrustado en ${s.anclaje}` : 'en la pantalla de Aplicaciones'}
                </dd>
              </div>
            </dl>

            {abierta === s.id && (
              <div className="mt-3 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800">
                <VistaPrevia appId={s.appId} codigo={s.codigo} consultarFactory={consultar} />
              </div>
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={async () => {
                  await bodyvibeService.aprobar(s.id);
                  recargar();
                  onCambio();
                }}
                className="rounded-md bg-zinc-900 px-3 py-1.5 text-[12.5px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
              >
                Aprobar y publicar
              </button>
              <button
                onClick={async () => {
                  const motivo = window.prompt('¿Por qué lo rechazás? Se lo mostramos a quien lo pidió.');
                  if (!motivo?.trim()) return;
                  await bodyvibeService.rechazar(s.id, motivo);
                  recargar();
                }}
                className="rounded-md border border-zinc-200 px-3 py-1.5 text-[12.5px] dark:border-zinc-700"
              >
                Rechazar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function VistaPrevia({
  appId,
  codigo,
  consultarFactory,
}: {
  appId: string;
  codigo: string;
  consultarFactory: (appId: string) => Promise<(sql: string, params: any[]) => Promise<ResultadoConsulta>>;
}) {
  const [consultar, setConsultar] = useState<
    ((sql: string, params: any[]) => Promise<ResultadoConsulta>) | null
  >(null);

  useEffect(() => {
    let vivo = true;
    consultarFactory(appId).then((fn) => {
      // `setState` con una función la INVOCA en vez de guardarla; hay que
      // envolverla. Sin esto la vista previa nunca consulta nada.
      if (vivo) setConsultar(() => fn);
    });
    return () => {
      vivo = false;
    };
  }, [appId, consultarFactory]);

  if (!consultar) return <div className="p-6 text-center text-[12px] text-zinc-400">Cargando…</div>;
  return <AppSandbox codigo={codigo} ejecutarConsulta={consultar} altoMinimo={220} />;
}

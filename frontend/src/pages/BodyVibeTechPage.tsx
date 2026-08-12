// ============================================================================
// BodyVibeTechPage — donde se construyen los apps.
//
// Tres zonas: la lista de borradores a la izquierda, el app corriendo en el
// centro, y la conversación abajo. Todo lo que se ve acá es BORRADOR PRIVADO
// (decisión 05): se itera sin pedirle permiso a nadie, y publicar es otra
// pantalla que llega después.
//
// Acá vive también el interruptor general. Hasta ahora existía como endpoint y
// no como botón, y un interruptor al que no se llega no es un interruptor.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import AppSandbox, { ResultadoConsulta } from '../components/bodyvibe/AppSandbox';
import { Bandeja, Publicar } from '../components/bodyvibe/PanelPublicacion';
import { SelectorApariencia } from '../components/bodyvibe/SelectorApariencia';
import bodyvibeService, {
  App,
  EstadoBodyVibe,
  EstadoGasto,
  VersionApp,
} from '../services/bodyvibe.service';

interface Turno {
  pedido: string;
  titulo: string;
  notas?: string;
  costoUsd?: number | null;
}

const dinero = (usd: number) => `USD ${usd.toFixed(2)}`;

export default function BodyVibeTechPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [activo, setActivo] = useState<App | null>(null);
  const [versiones, setVersiones] = useState<VersionApp[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);

  const [pedido, setPedido] = useState('');
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [estado, setEstado] = useState<EstadoBodyVibe | null>(null);
  const [gasto, setGasto] = useState<EstadoGasto | null>(null);

  const recargarCabecera = useCallback(async () => {
    try {
      const [e, g] = await Promise.all([bodyvibeService.estado(), bodyvibeService.gasto()]);
      setEstado(e);
      setGasto(g);
    } catch {
      /* La cabecera es informativa; si falla no bloquea el trabajo. */
    }
  }, []);

  useEffect(() => {
    bodyvibeService.listarApps().then(setApps).catch(() => setApps([]));
    recargarCabecera();
  }, [recargarCabecera]);

  const refrescarActivo = useCallback(async () => {
    if (!activo) return;
    const app = await bodyvibeService.obtenerApp(activo.id);
    setActivo(app);
    setApps((a) => a.map((x) => (x.id === app.id ? app : x)));
  }, [activo]);

  const abrir = useCallback(async (id: string) => {
    setError(null);
    setTurnos([]);
    const app = await bodyvibeService.obtenerApp(id);
    setActivo(app);
    setVersiones(await bodyvibeService.versiones(id));
  }, []);

  const crear = useCallback(async () => {
    const app = await bodyvibeService.crearApp();
    setApps((a) => [app, ...a]);
    setActivo(app);
    setVersiones([]);
    setTurnos([]);
    setError(null);
  }, []);

  const eliminar = useCallback(
    async (id: string) => {
      await bodyvibeService.eliminarApp(id);
      setApps((a) => a.filter((x) => x.id !== id));
      if (activo?.id === id) setActivo(null);
    },
    [activo]
  );

  const generar = useCallback(async () => {
    if (!activo || !pedido.trim() || generando) return;
    setGenerando(true);
    setError(null);

    const texto = pedido.trim();
    const r = await bodyvibeService.generar(
      activo.id,
      texto,
      turnos.map((t) => ({ pedido: t.pedido, titulo: t.titulo }))
    );

    if (!r.ok) {
      setError(r.mensaje);
    } else {
      setActivo(r.app);
      setPedido('');
      setTurnos((t) => [...t, { pedido: texto, titulo: r.app.titulo, notas: r.notas, costoUsd: r.costoUsd }]);
      setApps((a) => a.map((x) => (x.id === r.app.id ? r.app : x)));
      setVersiones(await bodyvibeService.versiones(activo.id));
      recargarCabecera();
    }
    setGenerando(false);
  }, [activo, pedido, generando, turnos, recargarCabecera]);

  const restaurar = useCallback(
    async (version: number) => {
      if (!activo) return;
      const app = await bodyvibeService.restaurar(activo.id, version);
      setActivo(app);
      setVersiones(await bodyvibeService.versiones(activo.id));
    },
    [activo]
  );

  // La ventanilla del recinto. Se pasa al iframe y traduce la forma de la API
  // a la que espera el puente.
  const ejecutarConsulta = useCallback(
    async (sql: string, params: any[]): Promise<ResultadoConsulta> => {
      const r = await bodyvibeService.consultar(sql, params, activo?.id);
      return r.ok
        ? { ok: true, filas: r.filas, recortado: r.recortado }
        : { ok: false, mensaje: r.mensaje };
    },
    [activo]
  );

  const alternarInterruptor = useCallback(async () => {
    if (!estado) return;
    if (estado.activo) {
      const motivo = window.prompt('¿Por qué lo estás apagando? (queda registrado)') ?? '';
      setEstado(await bodyvibeService.apagar(motivo));
    } else {
      setEstado(await bodyvibeService.encender());
    }
  }, [estado]);

  const apagado = estado ? !estado.activo : false;
  const sinRol = estado ? !estado.rolDisponible : false;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* ---- Cabecera ---- */}
      <header className="border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-2">
          <h1 className="text-[15px] font-semibold tracking-tight">BodyVibeTech</h1>

          {gasto && (
            <span className="font-mono text-[11px] text-zinc-500">
              {dinero(gasto.gastadoUsd)} de {dinero(gasto.topeUsd)} este mes
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            {estado && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  apagado
                    ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                }`}
              >
                {apagado ? 'apagado' : 'encendido'}
              </span>
            )}
            <button
              onClick={alternarInterruptor}
              className="rounded-md border border-zinc-200 px-3 py-1.5 text-[12.5px] font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {apagado ? 'Encender' : 'Apagar todo'}
            </button>
          </div>
        </div>

        {sinRol && (
          <p className="mx-auto mt-2 max-w-[1400px] text-[12.5px] text-amber-800 dark:text-amber-300">
            El usuario de solo lectura de la base no está disponible, así que ningún app puede
            consultar datos. Falta configurar <code>POSTGRES_READONLY_PASSWORD</code>.
          </p>
        )}
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col gap-5 p-5 lg:flex-row">
        {/* ---- Borradores ---- */}
        <aside className="w-full shrink-0 lg:w-64">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
              Mis borradores
            </span>
            <button
              onClick={crear}
              className="rounded-md bg-zinc-900 px-2.5 py-1 text-[12px] font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Nuevo
            </button>
          </div>

          {apps.length === 0 && (
            <p className="text-[12.5px] text-zinc-500">
              Todavía no creaste ninguno. Empezá con «Nuevo» y contá qué necesitás.
            </p>
          )}

          <ul className="flex flex-col gap-1">
            {apps.map((a) => (
              <li key={a.id}>
                <div
                  className={`group flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                    activo?.id === a.id
                      ? 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-900'
                      : 'border-transparent hover:bg-white dark:hover:bg-zinc-900'
                  }`}
                >
                  <button onClick={() => abrir(a.id)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-medium">{a.titulo}</span>
                    <span className="block font-mono text-[10.5px] text-zinc-400">
                      v{a.version}
                    </span>
                  </button>
                  <button
                    onClick={() => eliminar(a.id)}
                    title="Eliminar"
                    className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-zinc-400 hover:text-red-600"
                  >
                    ✕
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        {/* ---- El app y la conversación ---- */}
        <main className="min-w-0 flex-1">
          {!activo && (
            <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
              <p className="text-[13.5px] text-zinc-500">
                Elegí un borrador o creá uno nuevo para empezar.
              </p>
            </div>
          )}

          {activo && (
            <>
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-[17px] font-semibold tracking-tight">{activo.titulo}</h2>
                <span className="font-mono text-[11px] text-zinc-400">
                  {activo.id} · v{activo.version}
                </span>
              </div>

              <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
                {activo.codigo ? (
                  <AppSandbox
                    codigo={activo.codigo}
                    ejecutarConsulta={ejecutarConsulta}
                    onError={() => undefined}
                  />
                ) : (
                  <p className="p-10 text-center text-[13px] text-zinc-500">
                    Este borrador está vacío. Contá abajo qué querés que muestre.
                  </p>
                )}
              </div>

              {/* ---- Conversación ---- */}
              <div className="mt-4">
                {turnos.map((t, i) => (
                  <div key={i} className="mb-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700">
                    <p className="text-[13px]">{t.pedido}</p>
                    {t.notas && (
                      <p className="mt-1 text-[12.5px] text-zinc-500">{t.notas}</p>
                    )}
                    {typeof t.costoUsd === 'number' && (
                      <p className="mt-1 font-mono text-[10.5px] text-zinc-400">
                        {dinero(t.costoUsd)}
                      </p>
                    )}
                  </div>
                ))}

                {error && (
                  <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
                    {error}
                  </div>
                )}

                <div className="flex gap-2">
                  <textarea
                    value={pedido}
                    onChange={(e) => setPedido(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generar();
                    }}
                    rows={3}
                    disabled={generando || apagado}
                    placeholder={
                      activo.codigo
                        ? 'Qué querés cambiar…'
                        : 'Contá qué necesitás ver. Por ejemplo: las citas de esta semana por sede, con cuántas se atendieron.'
                    }
                    className="min-w-0 flex-1 resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13.5px] outline-none focus:border-zinc-400 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    onClick={generar}
                    disabled={generando || apagado || !pedido.trim()}
                    className="self-end rounded-md bg-zinc-900 px-4 py-2 text-[13px] font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {generando ? 'Construyendo…' : 'Construir'}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {generando
                    ? 'Construyendo. Puede tardar un par de minutos; el trabajo sigue en el servidor aunque cierres esta pestaña.'
                    : 'Puede tardar un par de minutos. ⌘/Ctrl + Enter también funciona.'}
                </p>
              </div>

              {/* ---- Versiones ---- */}
              {versiones.length > 1 && (
                <div className="mt-6">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                    Versiones
                  </span>
                  <ul className="mt-2 flex flex-col gap-1">
                    {versiones.map((v) => (
                      <li
                        key={v.version}
                        className="flex items-center gap-3 border-b border-zinc-100 py-1.5 text-[12.5px] dark:border-zinc-800"
                      >
                        <span className="font-mono text-[11px] text-zinc-400">v{v.version}</span>
                        <span className="min-w-0 flex-1 truncate text-zinc-600 dark:text-zinc-400">
                          {v.pedido ?? '—'}
                        </span>
                        {v.version !== activo.version && (
                          <button
                            onClick={() => restaurar(v.version)}
                            className="shrink-0 text-[12px] text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                          >
                            Volver a esta
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Publicar app={activo} onCambio={refrescarActivo} />
            </>
          )}

          <Bandeja onCambio={refrescarActivo} />

          {/* Puerta 2: modificar lo que YA existe. No depende de tener un
              borrador abierto — es apariencia de toda la plataforma. */}
          <SelectorApariencia />
        </main>
      </div>
    </div>
  );
}

// ============================================================================
// AppsPublicadosPage — donde la audiencia usa los apps.
//
// La otra punta de la publicación: acá no se construye ni se edita nada, solo
// se abre lo que alguien publicó y un aprobador dejó pasar.
//
// La lista la arma el backend según el rol y las sedes de quien mira, así que
// esta pantalla no decide nada sobre permisos — si un app aparece, es porque su
// audiencia incluye a esta persona.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import AppSandbox, { ResultadoConsulta } from '../components/bodyvibe/AppSandbox';
import bodyvibeService, { AppPublicado } from '../services/bodyvibe.service';

export default function AppsPublicadosPage() {
  const [apps, setApps] = useState<AppPublicado[]>([]);
  const [activo, setActivo] = useState<AppPublicado | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    // Solo los sueltos: los incrustados ya se ven dentro de la pantalla donde
    // alguien los enchufó, y listarlos otra vez acá sería mostrarlos dos veces.
    bodyvibeService
      .publicados('sueltos')
      .then((lista) => {
        setApps(lista);
        // Con uno solo, abrirlo directo: un clic para ver lo único que hay es
        // un clic de más.
        if (lista.length === 1) setActivo(lista[0]);
      })
      .catch(() => setApps([]))
      .finally(() => setCargando(false));
  }, []);

  // El id del app viaja en cada consulta: el backend lo usa para verificar que
  // esta persona esté en la audiencia y que la consulta sea una de las que el
  // app traía cuando se aprobó.
  const ejecutarConsulta = useCallback(
    async (sql: string, params: any[]): Promise<ResultadoConsulta> => {
      const r = await bodyvibeService.consultar(sql, params, activo?.id);
      return r.ok
        ? { ok: true, filas: r.filas, recortado: r.recortado }
        : { ok: false, mensaje: r.mensaje };
    },
    [activo]
  );

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-[1200px] items-center gap-4">
          <h1 className="text-[15px] font-semibold tracking-tight">Aplicaciones</h1>
          {activo && apps.length > 1 && (
            <button
              onClick={() => setActivo(null)}
              className="ml-auto text-[12.5px] text-zinc-500 underline"
            >
              Ver todas
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1200px] p-5">
        {cargando && <p className="text-[13px] text-zinc-500">Cargando…</p>}

        {!cargando && apps.length === 0 && (
          <div className="rounded-lg border border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700">
            <p className="text-[13.5px] text-zinc-500">
              Todavía no hay ninguna aplicación publicada para vos.
            </p>
          </div>
        )}

        {!activo && apps.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((a) => (
              <li key={a.id}>
                <button
                  onClick={() => setActivo(a)}
                  className="h-full w-full rounded-lg border border-zinc-200 bg-white p-4 text-left transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
                >
                  <span className="block text-[14.5px] font-medium">{a.titulo}</span>
                  {a.notas && (
                    <span className="mt-1 block text-[12.5px] text-zinc-500">{a.notas}</span>
                  )}
                  {a.creadorEmail && (
                    <span className="mt-2 block font-mono text-[10.5px] text-zinc-400">
                      {a.creadorEmail}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {activo && (
          <>
            <div className="mb-3">
              <h2 className="text-[17px] font-semibold tracking-tight">{activo.titulo}</h2>
              {activo.notas && (
                <p className="mt-1 text-[12.5px] text-zinc-500">{activo.notas}</p>
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <AppSandbox codigo={activo.codigo} ejecutarConsulta={ejecutarConsulta} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Anclaje — el punto donde un app publicado se enchufa dentro de una pantalla
// que ya existe.
//
// Se coloca una vez en cada pantalla y se queda callado: si nadie publicó nada
// ahí, no renderiza absolutamente nada — ni un título, ni un espacio, ni un
// borde. Una pantalla sin apps incrustados tiene que verse exactamente como
// antes de que BodyVibeTech existiera.
//
// Todo lo que aparezca acá pasó por aprobación, corre dentro del recinto
// aislado y consulta solo las consultas que traía cuando se aprobó. El anclaje
// no decide permisos: pregunta al backend qué le corresponde ver a esta persona
// en este punto.
//
// ⚠️ No colocar dentro de `VideoRoom` ni de `MedicalConsultationPanel`. Ver
// `bodyvibe-anclajes.ts` en el backend: ese panel comparte pantalla con una
// consulta en vivo y ahí solo se permite apariencia.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import AppSandbox, { ResultadoConsulta } from './AppSandbox';
import bodyvibeService, { AppPublicado } from '../../services/bodyvibe.service';

interface Props {
  /** Id declarado en `bodyvibe-anclajes.ts`. */
  id: string;
  className?: string;
}

export function Anclaje({ id, className }: Props) {
  const [apps, setApps] = useState<AppPublicado[]>([]);

  useEffect(() => {
    let vivo = true;
    bodyvibeService
      .publicados(id)
      .then((lista) => vivo && setApps(lista))
      // Un anclaje nunca puede tumbar la pantalla que lo hospeda. Si la
      // consulta falla —o BodyVibeTech está apagado— simplemente no hay nada.
      .catch(() => vivo && setApps([]));
    return () => {
      vivo = false;
    };
  }, [id]);

  if (apps.length === 0) return null;

  return (
    <div className={className ?? 'mt-6 flex flex-col gap-4'}>
      {apps.map((app) => (
        <AppIncrustado key={app.id} app={app} />
      ))}
    </div>
  );
}

function AppIncrustado({ app }: { app: AppPublicado }) {
  const [oculto, setOculto] = useState(false);

  const ejecutarConsulta = useCallback(
    async (sql: string, params: any[]): Promise<ResultadoConsulta> => {
      const r = await bodyvibeService.consultar(sql, params, app.id);
      return r.ok
        ? { ok: true, filas: r.filas, recortado: r.recortado }
        : { ok: false, mensaje: r.mensaje };
    },
    [app.id]
  );

  return (
    <section className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex items-center gap-3 border-b border-zinc-100 px-3.5 py-2 dark:border-zinc-800">
        <span className="text-[12.5px] font-medium">{app.titulo}</span>
        {app.creadorEmail && (
          <span className="font-mono text-[10.5px] text-zinc-400">{app.creadorEmail}</span>
        )}
        {/* Quien no lo quiere ver puede plegarlo. Un app incrustado que no
            se puede cerrar es una pantalla que alguien más te cambió. */}
        <button
          onClick={() => setOculto((o) => !o)}
          className="ml-auto text-[11.5px] text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
        >
          {oculto ? 'Mostrar' : 'Ocultar'}
        </button>
      </header>

      {!oculto && <AppSandbox codigo={app.codigo} ejecutarConsulta={ejecutarConsulta} altoMinimo={160} />}
    </section>
  );
}

export default Anclaje;

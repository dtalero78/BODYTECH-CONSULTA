// ============================================================================
// SelectorApariencia — la puerta 2 de BodyVibeTech.
//
// Deliberadamente NO hay un selector libre de color (decisión 07). Se elige una
// paleta completa, ya verificada contra el mínimo de contraste WCAG AA del lado
// del servidor. La libertad creativa va en las pantallas nuevas, donde no hay
// un paciente del otro lado.
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import bodyvibeService, { Paleta } from '../../services/bodyvibe.service';

const DENSIDADES: { id: string; nombre: string; ayuda: string }[] = [
  { id: 'compacta', nombre: 'Compacta', ayuda: 'Más información en pantalla' },
  { id: 'normal', nombre: 'Normal', ayuda: 'La de siempre' },
  { id: 'amplia', nombre: 'Amplia', ayuda: 'Más aire entre elementos' },
];

export function SelectorApariencia() {
  const [paletas, setPaletas] = useState<Paleta[]>([]);
  const [paleta, setPaleta] = useState('bodytech');
  const [densidad, setDensidad] = useState('normal');
  const [autor, setAutor] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const t = await bodyvibeService.tema();
      setPaletas(t.paletas);
      setPaleta(t.paleta);
      setDensidad(t.densidad);
      setAutor(t.actualizadoPor);
    } catch {
      /* Sin apariencia configurada se muestra la de fábrica. */
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const guardar = async (nuevaPaleta: string, nuevaDensidad: string) => {
    setGuardando(true);
    setMensaje(null);
    const r = await bodyvibeService.guardarTema(nuevaPaleta, nuevaDensidad);
    if (r.ok) {
      setPaleta(nuevaPaleta);
      setDensidad(nuevaDensidad);
      setMensaje('Listo. Cada persona lo ve al recargar su pantalla.');
      // Recarga para que quien lo cambió lo vea aplicado de inmediato: el
      // aplicador de tema lee una sola vez, al arrancar.
      setTimeout(() => window.location.reload(), 700);
    } else {
      setMensaje(r.mensaje);
    }
    setGuardando(false);
  };

  if (paletas.length === 0) return null;

  return (
    <section>
      <p className="mb-5 text-[13px] text-zinc-500">
        Se elige una paleta completa, no colores sueltos: el panel médico comparte pantalla con la
        consulta en vivo y todas estas están verificadas para que el texto clínico se lea. Durante
        una videollamada la personalización se retira sola y vuelve al colgar.
      </p>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        {paletas.map((p) => (
          <button
            key={p.id}
            onClick={() => guardar(p.id, densidad)}
            disabled={guardando}
            className={`rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${
              paleta === p.id
                ? 'border-zinc-900 dark:border-zinc-100'
                : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
            }`}
          >
            <span className="mb-2 flex gap-1" aria-hidden="true">
              {['--p-bg', '--p-surface', '--p-line', '--p-text-2', '--p-violet'].map((t) => (
                <span
                  key={t}
                  className="h-5 w-5 rounded border border-black/10"
                  style={{ background: p.tokens[t] }}
                />
              ))}
            </span>
            <span className="block text-[13.5px] font-medium">{p.nombre}</span>
            <span className="mt-0.5 block text-[12px] text-zinc-500">{p.descripcion}</span>
          </button>
        ))}
      </div>

      <div className="mb-2">
        <span className="mb-1.5 block text-[12px] font-medium">Densidad</span>
        <div className="flex flex-wrap gap-1.5">
          {DENSIDADES.map((d) => (
            <button
              key={d.id}
              onClick={() => guardar(paleta, d.id)}
              disabled={guardando}
              title={d.ayuda}
              className={`rounded-md border px-2.5 py-1 text-[12px] disabled:opacity-50 ${
                densidad === d.id
                  ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                  : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {d.nombre}
            </button>
          ))}
        </div>
      </div>

      {mensaje && <p className="mt-2 text-[12.5px] text-zinc-600 dark:text-zinc-400">{mensaje}</p>}
      {autor && !mensaje && (
        <p className="mt-2 text-[11.5px] text-zinc-400">Último cambio: {autor}</p>
      )}
    </section>
  );
}

export default SelectorApariencia;

// ============================================================================
// BarraVista — "mi vista" de cualquier tabla.
//
// Elegir columnas, guardar esa configuración con nombre, y exportar a Excel.
// Nada de esto genera código ni pasa por aprobación: es la función aburrida que
// resuelve el pedido más frecuente de todos.
//
// Cuando alguien dice "modificame este panel", casi siempre quiere ver otras
// columnas, filtrar distinto, ordenar distinto o sacarlo a Excel. Antes eso
// implicaba que alguien abriera el editor; ahora lo hace quien lo necesita, en
// diez segundos, y queda guardado con su nombre.
//
// Cómo se conecta a una tabla existente: se le pasa el catálogo de columnas y
// qué está visible; la tabla renderiza solo lo visible. `extra` sirve para que
// cada pantalla guarde además lo suyo (un filtro, un orden) sin que este
// componente tenga que saber qué significa.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import vistasService, { VistaGuardada } from '../../services/vistas.service';

export interface ColumnaVista {
  id: string;
  label: string;
  /** Columnas que no se pueden ocultar (la que identifica la fila). */
  fija?: boolean;
}

interface Props {
  /** Identifica la tabla. Estable en el tiempo: es la clave de lo guardado. */
  tablaId: string;
  columnas: ColumnaVista[];
  visibles: string[];
  onVisiblesChange: (ids: string[]) => void;
  /** Filas ya en el orden y con los filtros que el usuario ve. */
  filas: Record<string, unknown>[];
  nombreArchivo?: string;
  /** Estado propio de la pantalla (filtros, orden) que se guarda con la vista. */
  extra?: Record<string, unknown>;
  onCargarExtra?: (extra: Record<string, unknown>) => void;
}

export function BarraVista({
  tablaId,
  columnas,
  visibles,
  onVisiblesChange,
  filas,
  nombreArchivo,
  extra,
  onCargarExtra,
}: Props) {
  const [vistas, setVistas] = useState<VistaGuardada[]>([]);
  const [abierto, setAbierto] = useState<'columnas' | 'vistas' | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const contenedor = useRef<HTMLDivElement | null>(null);

  const cargar = useCallback(() => {
    vistasService.listar(tablaId).then(setVistas).catch(() => setVistas([]));
  }, [tablaId]);

  useEffect(cargar, [cargar]);

  // Cerrar los menús al hacer clic afuera. Sin esto quedan abiertos tapando la
  // tabla que se quería mirar.
  useEffect(() => {
    if (!abierto) return;
    const alClic = (e: MouseEvent) => {
      if (!contenedor.current?.contains(e.target as Node)) setAbierto(null);
    };
    document.addEventListener('mousedown', alClic);
    return () => document.removeEventListener('mousedown', alClic);
  }, [abierto]);

  const alternar = (id: string) => {
    const col = columnas.find((c) => c.id === id);
    if (col?.fija) return;
    onVisiblesChange(
      visibles.includes(id) ? visibles.filter((x) => x !== id) : [...visibles, id]
    );
  };

  const guardar = async () => {
    const nombre = window.prompt('¿Cómo se llama esta vista?', 'Mi vista');
    if (!nombre?.trim()) return;
    const r = await vistasService.guardar(tablaId, nombre, { visibles, extra: extra ?? {} });
    setAviso(r.ok ? 'Vista guardada.' : r.mensaje);
    if (r.ok) cargar();
  };

  const aplicar = (v: VistaGuardada) => {
    const cfg = v.config as { visibles?: string[]; extra?: Record<string, unknown> };
    if (Array.isArray(cfg.visibles)) onVisiblesChange(cfg.visibles);
    if (cfg.extra && onCargarExtra) onCargarExtra(cfg.extra);
    setAbierto(null);
  };

  const exportar = async () => {
    if (filas.length === 0) {
      setAviso('No hay nada que exportar con los filtros actuales.');
      return;
    }
    // Import dinámico: el paquete de Excel solo se descarga al exportar.
    const XLSX = await import('xlsx');
    const cols = columnas.filter((c) => visibles.includes(c.id));

    // Se exporta lo que se VE: mismas columnas, mismo orden, mismos filtros.
    // Un Excel que trae otra cosa que la pantalla es la forma más rápida de
    // perderle la confianza a un reporte.
    const datos = filas.map((f) =>
      Object.fromEntries(cols.map((c) => [c.label, f[c.id] ?? '']))
    );

    const hoja = XLSX.utils.json_to_sheet(datos);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Datos');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(libro, `${nombreArchivo ?? tablaId}_${hoy}.xlsx`);
  };

  const btn =
    'inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800';

  return (
    <div ref={contenedor} className="relative flex flex-wrap items-center gap-2">
      {/* -- Columnas -- */}
      <div className="relative">
        <button onClick={() => setAbierto(abierto === 'columnas' ? null : 'columnas')} className={btn}>
          Columnas ({visibles.length}/{columnas.length})
        </button>
        {abierto === 'columnas' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {columnas.map((c) => (
              <label
                key={c.id}
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-[12.5px] ${
                  c.fija ? 'opacity-50' : 'cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800'
                }`}
              >
                <input
                  type="checkbox"
                  checked={visibles.includes(c.id)}
                  disabled={c.fija}
                  onChange={() => alternar(c.id)}
                />
                {c.label}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* -- Vistas guardadas -- */}
      <div className="relative">
        <button onClick={() => setAbierto(abierto === 'vistas' ? null : 'vistas')} className={btn}>
          Mis vistas{vistas.length > 0 ? ` (${vistas.length})` : ''}
        </button>
        {abierto === 'vistas' && (
          <div className="absolute left-0 top-full z-30 mt-1 w-64 rounded-md border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {vistas.length === 0 && (
              <p className="px-2 py-1.5 text-[12px] text-zinc-500">
                Todavía no ha guardado ninguna. Acomode las columnas y use «Guardar vista».
              </p>
            )}
            {vistas.map((v) => (
              <div
                key={v.id}
                className="group flex items-center gap-1 rounded px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <button onClick={() => aplicar(v)} className="min-w-0 flex-1 truncate text-left text-[12.5px]">
                  {v.nombre}
                </button>
                <button
                  onClick={async () => {
                    await vistasService.eliminar(v.id);
                    cargar();
                  }}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-[11px] text-zinc-400 hover:text-red-600"
                  aria-label={`Eliminar ${v.nombre}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button onClick={guardar} className={btn}>
        Guardar vista
      </button>
      <button onClick={exportar} className={btn}>
        Exportar
      </button>

      {aviso && <span className="text-[11.5px] text-zinc-500">{aviso}</span>}
    </div>
  );
}

export default BarraVista;

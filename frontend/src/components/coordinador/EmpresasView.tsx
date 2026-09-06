// ============================================================================
// EmpresasView — Alta y listado de empresas cliente.
//
// El examen ocupacional del médico corporativo NO se hace en una sede de
// Bodytech: se hace en la empresa que lo contrató. Esta lista es, para esa
// línea, el equivalente al "dónde" que las demás resuelven con la sede.
//
// Vive en la base compartida del cluster, no en la de esta app: la empresa que
// contrata exámenes ocupacionales es la misma que mañana contrata análisis de
// composición corporal en ACC.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { Building, Plus, RefreshCw, X } from 'lucide-react';
import empresasService, { Empresa } from '../../services/empresas.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, CTA_PRIMARY } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

export function EmpresasView({ showToast }: Props) {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [nombre, setNombre] = useState('');
  const [nit, setNit] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setEmpresas(await empresasService.listar());
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (nombre.trim().length < 2) {
      showToast({ type: 'error', message: 'Escribe el nombre de la empresa.' });
      return;
    }
    setGuardando(true);
    try {
      const creada = await empresasService.crear({ nombre, nit: nit.trim() || null });
      // El backend devuelve la existente si ya estaba, así que dar de alta algo
      // repetido no es un error: el resultado que se buscaba ya se cumplió.
      const yaEstaba = empresas.some((x) => x.id === creada.id);
      showToast({
        type: 'success',
        message: yaEstaba ? `${creada.nombre} ya estaba en la lista.` : `${creada.nombre} agregada.`,
      });
      setNombre('');
      setNit('');
      setCreando(false);
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setGuardando(false);
    }
  }

  async function desactivar(emp: Empresa) {
    if (!window.confirm(`¿Quitar "${emp.nombre}" de la lista?\n\nLos exámenes ya hechos en esa empresa no se tocan.`)) {
      return;
    }
    try {
      await empresasService.desactivar(emp.id);
      showToast({ type: 'success', message: `${emp.nombre} quitada de la lista.` });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Building className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Empresas cliente</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={`w-[13px] h-[13px] ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          {!creando && (
            <button onClick={() => setCreando(true)} className={CTA_PRIMARY}>
              <Plus className="w-[14px] h-[14px]" />
              Nueva empresa
            </button>
          )}
        </div>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-5 max-w-[74ch] leading-relaxed">
        Las empresas donde el médico corporativo hace los exámenes ocupacionales. Al agregarlas
        acá quedan disponibles en el formulario del examen, escritas siempre igual — y así se
        puede contar por empresa después.
      </div>

      {creando && (
        <form
          onSubmit={guardar}
          className="mb-5 p-4 bg-white border border-zinc-200 rounded-lg flex flex-wrap items-end gap-3"
        >
          <div>
            <label htmlFor="emp-nombre" className={`block mb-1.5 ${SECTION_LABEL}`}>
              Nombre de la empresa
            </label>
            <input
              id="emp-nombre"
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej. Bancolombia"
              className="h-[32px] w-64 px-3 bg-white border border-zinc-300 rounded-md text-[13px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]"
            />
          </div>
          <div>
            <label htmlFor="emp-nit" className={`block mb-1.5 ${SECTION_LABEL}`}>
              NIT <span className="text-zinc-400 normal-case">(opcional)</span>
            </label>
            <input
              id="emp-nit"
              value={nit}
              onChange={(e) => setNit(e.target.value)}
              placeholder="890903938-8"
              className="h-[32px] w-44 px-3 bg-white border border-zinc-300 rounded-md text-[13px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]"
            />
          </div>
          <button type="submit" disabled={guardando} className={CTA_PRIMARY}>
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCreando(false);
              setNombre('');
              setNit('');
            }}
            className="h-[32px] px-3 text-[12.5px] text-zinc-500 hover:text-zinc-800"
          >
            Cancelar
          </button>
        </form>
      )}

      <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {['Empresa', 'NIT', 'Agregada por', ''].map((h, i) => (
                <th key={i} className={`px-3 py-2 text-left ${SECTION_LABEL}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empresas.length === 0 && !cargando && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  Todavía no hay empresas. Agregá la primera con “Nueva empresa”.
                </td>
              </tr>
            )}
            {empresas.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50/60">
                <td className="px-3 py-2 text-zinc-900">{e.nombre}</td>
                <td className="px-3 py-2 text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                  {e.nit ?? <span className="text-zinc-300">—</span>}
                </td>
                <td className="px-3 py-2 text-zinc-500 text-[11.5px]">
                  {e.creadaPor === 'semilla' ? 'carga inicial' : (e.creadaPor ?? '—')}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => desactivar(e)}
                    title="Quitar de la lista"
                    aria-label={`Quitar ${e.nombre}`}
                    className="p-1 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <X className="w-[14px] h-[14px]" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// AccesosView — Quién tiene acceso a qué aplicación, y quién ya no.
//
// Dos cosas distintas conviven acá, y conviene no confundirlas:
//
//   VER   — el mapa de accesos. Cada aplicación tiene su lista; esto las junta
//           para poder responder «¿a qué tiene acceso esta persona?» sin mirar
//           en tres bases. No cambia nada.
//
//   BAJA  — dar de baja de la ORGANIZACIÓN. Eso SÍ cambia el inicio de sesión:
//           la persona deja de poder entrar a las tres aplicaciones, decidido
//           una sola vez. Es lo que hasta ahora había que hacer app por app —y
//           que ya se falló al menos una vez.
//
// Las filas ámbar son el problema que motivó todo: alguien activo en una
// aplicación e inactivo en otra. Las rojas son quienes ya no entran a ninguna.
// ============================================================================

import { useState, useEffect, useCallback } from 'react';
import { KeyRound, RefreshCw, AlertTriangle, UserMinus, UserPlus } from 'lucide-react';
import accesosService, { PersonaConAccesos, ResumenAccesos } from '../../services/accesos.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const APP_NOMBRE: Record<string, string> = {
  consulta: 'Consulta',
  acc: 'ACC',
  prepagadas: 'Prepagadas',
};

export function AccesosView({ showToast }: Props) {
  const [personas, setPersonas] = useState<PersonaConAccesos[]>([]);
  const [resumen, setResumen] = useState<ResumenAccesos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [actualizando, setActualizando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await accesosService.listar();
      setPersonas(r.personas);
      setResumen(r.resumen);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function actualizar() {
    setActualizando(true);
    try {
      await accesosService.sincronizar();
      await cargar();
      showToast({ type: 'success', message: 'Accesos actualizados.' });
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setActualizando(false);
    }
  }

  async function darDeBaja(p: PersonaConAccesos) {
    const motivo = window.prompt(
      `Dar de baja a ${p.nombre ?? p.email} de TODA la organización.\n\n` +
        'Deja de poder entrar a las tres aplicaciones, no solo a una.\n' +
        'Se puede revertir.\n\nMotivo (opcional):',
    );
    if (motivo === null) return; // canceló
    try {
      await accesosService.darDeBaja(p.email, motivo.trim() || null);
      showToast({ type: 'success', message: `${p.nombre ?? p.email} ya no puede entrar a ninguna aplicación.` });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function reactivar(p: PersonaConAccesos) {
    if (!window.confirm(`¿Devolverle el acceso a ${p.nombre ?? p.email}?\n\nVolverá a entrar donde tenga cuenta activa.`)) return;
    try {
      await accesosService.reactivar(p.email);
      showToast({ type: 'success', message: 'Acceso restablecido.' });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <KeyRound className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Accesos por aplicación</h1>
        </div>
        <button
          onClick={actualizar}
          disabled={actualizando}
          className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw className={`w-[13px] h-[13px] ${actualizando || cargando ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-5 max-w-[74ch] leading-relaxed">
        Cada aplicación tiene su propia lista de usuarios. Esta pantalla las junta para poder
        responder «¿a qué tiene acceso esta persona?» sin mirar en tres lados.{' '}
        <strong>Dar de baja acá la saca de las tres</strong> — es la única acción que hace falta
        cuando alguien deja de trabajar en Bodytech.
      </div>

      {resumen && (
        <div className="flex flex-wrap items-stretch gap-3 mb-5">
          <Recuadro etiqueta="Personas" valor={resumen.personas} />
          <Recuadro etiqueta="En varias aplicaciones" valor={resumen.enVariasApps} />
          <Recuadro etiqueta="Con acceso inconsistente" valor={resumen.inconsistentes} alerta />
          <Recuadro etiqueta="Dadas de baja" valor={resumen.bajas} />
        </div>
      )}

      {resumen && resumen.inconsistentes > 0 && (
        <div className="flex items-start gap-2 mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-amber-900 leading-relaxed">
            <strong>
              {resumen.inconsistentes === 1
                ? 'Hay 1 persona activa en una aplicación e inactiva en otra.'
                : `Hay ${resumen.inconsistentes} personas activas en una aplicación e inactivas en otra.`}
            </strong>{' '}
            Si se le dio de baja, la baja no llegó a todas partes: sigue pudiendo entrar por donde
            quedó activa.
          </div>
        </div>
      )}

      <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {['Persona', 'Correo', 'Cédula', 'Accesos', ''].map((h) => (
                <th key={h} className={`px-3 py-2 text-left ${SECTION_LABEL}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {personas.length === 0 && !cargando && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  Sin datos todavía. Usá «Actualizar».
                </td>
              </tr>
            )}
            {personas.map((p) => (
              <tr
                key={p.email}
                className={`border-b border-zinc-100 last:border-0 ${
                  p.baja ? 'bg-red-50/50' : p.inconsistente ? 'bg-amber-50/40' : 'hover:bg-zinc-50/60'
                }`}
              >
                <td className="px-3 py-2 align-top text-zinc-900">
                  <span className={p.baja ? 'line-through text-zinc-400' : ''}>{p.nombre ?? '—'}</span>
                  {p.baja && (
                    <div className="text-[10.5px] text-red-700 mt-0.5">
                      de baja{p.baja.motivo ? ` · ${p.baja.motivo}` : ''}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                  {p.email}
                </td>
                <td className="px-3 py-2 align-top text-zinc-500" style={{ fontFamily: FONT_MONO }}>
                  {p.documento ?? <span className="text-zinc-300">—</span>}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="flex flex-wrap gap-1.5">
                    {p.accesos.map((a) => (
                      <span
                        key={a.app}
                        title={a.activo ? 'Puede entrar' : 'Desactivada'}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border ${
                          a.activo
                            ? 'bg-green-50 text-green-800 border-green-200'
                            : 'bg-zinc-100 text-zinc-400 border-zinc-200 line-through'
                        }`}
                      >
                        {APP_NOMBRE[a.app] ?? a.app}
                        {a.rol && <span className="opacity-70">· {a.rol}</span>}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                  {p.baja ? (
                    <button
                      onClick={() => reactivar(p)}
                      title="Devolverle el acceso"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-zinc-500 hover:text-green-700 hover:bg-green-50"
                    >
                      <UserPlus className="w-[13px] h-[13px]" />
                      Reactivar
                    </button>
                  ) : (
                    <button
                      onClick={() => darDeBaja(p)}
                      title="Dar de baja de toda la organización"
                      className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-zinc-400 hover:text-red-700 hover:bg-red-50"
                    >
                      <UserMinus className="w-[13px] h-[13px]" />
                      Dar de baja
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Recuadro({ etiqueta, valor, alerta }: { etiqueta: string; valor: number; alerta?: boolean }) {
  return (
    <div className="px-3.5 py-2.5 bg-white border border-zinc-200 rounded-lg min-w-[120px]">
      <div
        className={`text-[20px] font-semibold leading-none ${alerta && valor > 0 ? 'text-amber-700' : 'text-zinc-900'}`}
        style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}
      >
        {valor.toLocaleString('es-CO')}
      </div>
      <div className="text-[11px] text-zinc-500 mt-1.5">{etiqueta}</div>
    </div>
  );
}

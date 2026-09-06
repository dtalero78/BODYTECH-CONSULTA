// ============================================================================
// CreacionUsuariosView — Crear, editar e inhabilitar usuarios de las TRES
// aplicaciones, desde un solo lugar.
//
// Lo que decide a dónde llega la persona al iniciar sesión es la pareja
// APLICACIÓN + ROL. Por eso el formulario los pide juntos y muestra, en
// castellano, a qué panel va a aterrizar: quien crea la cuenta no debería tener
// que saberse de memoria qué hace cada rol.
//
// Los roles NO son una lista común: cada aplicación tiene los suyos (6 en
// Consulta, 2 en ACC, 3 en Prepagadas) y el selector de rol se rearma según la
// aplicación elegida. Un fisioterapeuta no existe como rol en Prepagadas.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { UserPlus, RefreshCw, Pencil, Check, X } from 'lucide-react';
import usuariosGlobalService, {
  Persona,
  AppDestino,
} from '../../services/usuarios-global.service';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, CTA_PRIMARY } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
}

const APP_NOMBRE: Record<AppDestino, string> = {
  consulta: 'Consulta',
  acc: 'ACC · Composición Corporal',
  prepagadas: 'Prepagadas',
};

/** A dónde aterriza cada rol. Es lo que la persona verá al entrar. */
const DESTINO: Record<string, string> = {
  'consulta:admin': 'Panel de coordinador',
  'consulta:coordinador': 'Panel de coordinador',
  'consulta:medico': 'Panel médico (consulta, UMV o corporativo según su especialidad)',
  'consulta:coach': 'Panel médico (nutrición según su especialidad)',
  'consulta:auxiliar': 'Panel de órdenes',
  'consulta:torre': 'Sin módulos asignados todavía',
  'acc:admin': 'Panel de coordinación de ACC',
  'acc:fisioterapeuta': 'Panel del fisioterapeuta de ACC',
  'prepagadas:admin': 'Panel de Prepagadas',
  'prepagadas:asesor': 'Panel de Prepagadas (gestión)',
  'prepagadas:profesional': 'Panel de Prepagadas (atenciones)',
};

const VACIO = {
  email: '',
  nombre: '',
  password: '',
  documento: '',
  app: 'consulta' as AppDestino,
  rol: 'coach',
};

export function CreacionUsuariosView({ showToast }: Props) {
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [roles, setRoles] = useState<Record<AppDestino, string[]> | null>(null);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [form, setForm] = useState({ ...VACIO });
  const [editando, setEditando] = useState<number | null>(null);
  const [nombreEdit, setNombreEdit] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, r] = await Promise.all([
        usuariosGlobalService.listar(),
        usuariosGlobalService.roles(),
      ]);
      setPersonas(p);
      setRoles(r);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setCargando(false);
    }
  }, [showToast]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Al cambiar de aplicación, el rol elegido puede no existir allá.
  const rolesDeLaApp = useMemo(() => roles?.[form.app] ?? [], [roles, form.app]);
  useEffect(() => {
    if (rolesDeLaApp.length > 0 && !rolesDeLaApp.includes(form.rol)) {
      setForm((f) => ({ ...f, rol: rolesDeLaApp[0] }));
    }
  }, [rolesDeLaApp, form.rol]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await usuariosGlobalService.crear({
        email: form.email.trim().toLowerCase(),
        nombre: form.nombre,
        password: form.password,
        documento: form.documento.trim() || null,
        app: form.app,
        rol: form.rol,
      });
      showToast({ type: 'success', message: `${form.nombre} ya puede entrar a ${APP_NOMBRE[form.app]}.` });
      setForm({ ...VACIO });
      setCreando(false);
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setGuardando(false);
    }
  }

  async function alternarActivo(p: Persona) {
    const accion = p.activo ? 'inhabilitar' : 'habilitar';
    if (!window.confirm(`¿${accion === 'inhabilitar' ? 'Inhabilitar' : 'Habilitar'} a ${p.nombre}?`)) return;
    try {
      await usuariosGlobalService.editar(p.id, { activo: !p.activo });
      showToast({ type: 'success', message: `${p.nombre} ${p.activo ? 'inhabilitado' : 'habilitado'}.` });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function cambiarRol(p: Persona, app: AppDestino, rol: string) {
    try {
      await usuariosGlobalService.editar(p.id, { app, rol });
      showToast({ type: 'success', message: `${p.nombre} ahora es ${rol} en ${APP_NOMBRE[app]}.` });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function guardarNombre(p: Persona) {
    if (nombreEdit.trim().length < 2) return;
    try {
      await usuariosGlobalService.editar(p.id, { nombre: nombreEdit });
      setEditando(null);
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  const destino = DESTINO[`${form.app}:${form.rol}`];

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <UserPlus className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Creación de usuarios</h1>
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
              <UserPlus className="w-[14px] h-[14px]" />
              Nuevo usuario
            </button>
          )}
        </div>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-5 max-w-[74ch] leading-relaxed">
        Los usuarios de las tres aplicaciones, en un solo lugar. La{' '}
        <strong>aplicación y el rol</strong> deciden a qué panel llega la persona cuando inicia
        sesión.
      </div>

      {creando && (
        <form onSubmit={crear} className="mb-5 p-4 bg-white border border-zinc-200 rounded-lg">
          <div className="flex flex-wrap gap-3 items-end">
            <Campo etiqueta="Nombre" ancho="w-52">
              <input
                autoFocus
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ana Pérez"
                className={INPUT}
              />
            </Campo>
            <Campo etiqueta="Correo" ancho="w-64">
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="ana.perez@bodytechcorp.com"
                className={INPUT}
              />
            </Campo>
            <Campo etiqueta="Contraseña" ancho="w-44">
              <input
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="mínimo 8 caracteres"
                className={INPUT}
              />
            </Campo>
            <Campo etiqueta="Cédula (opcional)" ancho="w-36">
              <input
                inputMode="numeric"
                value={form.documento}
                onChange={(e) => setForm({ ...form, documento: e.target.value.replace(/\D/g, '') })}
                placeholder="1015420891"
                className={INPUT}
              />
            </Campo>
          </div>

          <div className="flex flex-wrap gap-3 items-end mt-3.5 pt-3.5 border-t border-zinc-100">
            <Campo etiqueta="Aplicación" ancho="w-56">
              <select
                value={form.app}
                onChange={(e) => setForm({ ...form, app: e.target.value as AppDestino })}
                className={INPUT}
              >
                {(Object.keys(APP_NOMBRE) as AppDestino[]).map((a) => (
                  <option key={a} value={a}>
                    {APP_NOMBRE[a]}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Rol" ancho="w-44">
              <select
                value={form.rol}
                onChange={(e) => setForm({ ...form, rol: e.target.value })}
                className={INPUT}
              >
                {rolesDeLaApp.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Campo>
            <button type="submit" disabled={guardando} className={CTA_PRIMARY}>
              {guardando ? 'Creando…' : 'Crear usuario'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreando(false);
                setForm({ ...VACIO });
              }}
              className="h-[32px] px-3 text-[12.5px] text-zinc-500 hover:text-zinc-800"
            >
              Cancelar
            </button>
          </div>

          {destino && (
            <div className="mt-3.5 text-[12.5px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded px-3 py-2">
              Al iniciar sesión va a llegar a: <strong className="text-zinc-900">{destino}</strong>
            </div>
          )}
        </form>
      )}

      <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {['Nombre', 'Correo', 'Aplicación y rol', 'A dónde entra', ''].map((h) => (
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
                  Sin usuarios todavía.
                </td>
              </tr>
            )}
            {personas.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-zinc-100 last:border-0 ${p.activo ? 'hover:bg-zinc-50/60' : 'bg-zinc-50/60'}`}
              >
                <td className="px-3 py-2 align-top">
                  {editando === p.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={nombreEdit}
                        onChange={(e) => setNombreEdit(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && guardarNombre(p)}
                        className="h-[26px] w-40 px-2 border border-zinc-300 rounded text-[12.5px]"
                      />
                      <button onClick={() => guardarNombre(p)} className="p-1 text-green-700" aria-label="Guardar">
                        <Check className="w-[14px] h-[14px]" />
                      </button>
                      <button onClick={() => setEditando(null)} className="p-1 text-zinc-400" aria-label="Cancelar">
                        <X className="w-[14px] h-[14px]" />
                      </button>
                    </div>
                  ) : (
                    <span className={p.activo ? 'text-zinc-900' : 'text-zinc-400 line-through'}>
                      {p.nombre}
                      <button
                        onClick={() => {
                          setEditando(p.id);
                          setNombreEdit(p.nombre);
                        }}
                        className="ml-1.5 p-0.5 text-zinc-300 hover:text-zinc-700 align-middle"
                        aria-label={`Editar el nombre de ${p.nombre}`}
                      >
                        <Pencil className="w-[11px] h-[11px]" />
                      </button>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                  {p.email}
                </td>
                <td className="px-3 py-2 align-top">
                  {p.apps.length === 0 ? (
                    <span className="text-zinc-300">sin acceso</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {p.apps.map((a) => (
                        <div key={a.app} className="flex items-center gap-1.5">
                          <span className="text-zinc-500 text-[11.5px] w-[92px] shrink-0">
                            {a.app === 'acc' ? 'ACC' : a.app === 'consulta' ? 'Consulta' : 'Prepagadas'}
                          </span>
                          <select
                            value={a.rol}
                            onChange={(e) => cambiarRol(p, a.app, e.target.value)}
                            className="h-[24px] px-1 border border-zinc-200 rounded text-[11.5px] bg-white text-zinc-800"
                          >
                            {(roles?.[a.app] ?? [a.rol]).map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 align-top text-zinc-500 text-[11.5px] max-w-[26ch]">
                  {p.apps.map((a) => DESTINO[`${a.app}:${a.rol}`]).filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                  <button
                    onClick={() => alternarActivo(p)}
                    className={`px-1.5 py-1 rounded text-[11px] ${
                      p.activo
                        ? 'text-zinc-400 hover:text-red-700 hover:bg-red-50'
                        : 'text-green-700 hover:bg-green-50'
                    }`}
                  >
                    {p.activo ? 'Inhabilitar' : 'Habilitar'}
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

const INPUT =
  'h-[32px] w-full px-3 bg-white border border-zinc-300 rounded-md text-[13px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]';

function Campo({
  etiqueta,
  ancho,
  children,
}: {
  etiqueta: string;
  ancho: string;
  children: React.ReactNode;
}) {
  return (
    <div className={ancho}>
      <label className={`block mb-1.5 ${SECTION_LABEL}`}>{etiqueta}</label>
      {children}
    </div>
  );
}

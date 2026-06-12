import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, KeyRound, Power, Pencil, X } from 'lucide-react';
import authService, { Role } from '../../services/auth.service';
import usuariosApi, {
  UsuarioItem,
  ProfesionalLite,
  usuariosErrorMessage,
} from '../../services/usuarios.service';
import { FONT_INTER, CTA_PRIMARY, CTA_OUTLINE } from './_tokens';

interface Props {
  reloadKey?: number;
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
  reportCount?: (count: number | null) => void;
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  coordinador: 'Coordinador',
  medico: 'Médico',
  coach: 'Coach',
  auxiliar: 'Auxiliar',
  torre: 'Torre',
};

interface Sede {
  sedeId: string;
  nombre: string;
}

interface FormState {
  id: number | null; // null = crear
  email: string;
  nombre: string;
  password: string;
  rol: Role;
  esGlobal: boolean;
  sedes: string[];
  activo: boolean;
  profesionalId: number | null;
}

const EMPTY_FORM: FormState = {
  id: null,
  email: '',
  nombre: '',
  password: '',
  rol: 'medico',
  esGlobal: false,
  sedes: [],
  activo: true,
  profesionalId: null,
};

const ROLES_CLINICOS: Role[] = ['medico', 'coach'];

export function UsuariosView({ reloadKey = 0, showToast, reportCount }: Props) {
  const actor = authService.getUser();
  const isAdmin = actor?.role === 'admin';

  const rolesAsignables: Role[] = isAdmin
    ? ['admin', 'coordinador', 'medico', 'coach', 'auxiliar', 'torre']
    : ['medico', 'coach', 'auxiliar'];

  const [users, setUsers] = useState<UsuarioItem[]>([]);
  const [sedes, setSedes] = useState<Sede[]>([]);
  const [profesionales, setProfesionales] = useState<ProfesionalLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<FormState | null>(null); // modal crear/editar
  const [pwUser, setPwUser] = useState<UsuarioItem | null>(null); // modal reset
  const [pwValue, setPwValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Sedes que el actor puede asignar (admin: todas; coordinador: las suyas).
  const sedesAsignables = useMemo(() => {
    if (isAdmin) return sedes;
    const own = new Set(actor?.sedes ?? []);
    return sedes.filter((s) => own.has(s.sedeId));
  }, [isAdmin, sedes, actor]);

  const sedeName = useCallback(
    (id: string) => sedes.find((s) => s.sedeId === id)?.nombre ?? id,
    [sedes]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, s, p] = await Promise.all([
        usuariosApi.list(),
        authService.getSedes(),
        usuariosApi.profesionales().catch(() => [] as ProfesionalLite[]),
      ]);
      setUsers(u);
      setSedes(s);
      setProfesionales(p);
      reportCount?.(u.length);
    } catch (err) {
      showToast({ type: 'error', message: usuariosErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }, [showToast, reportCount]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  function openCreate() {
    setForm({ ...EMPTY_FORM, rol: rolesAsignables[0] });
  }

  function openEdit(u: UsuarioItem) {
    setForm({
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      password: '',
      rol: u.rol,
      esGlobal: u.esGlobal,
      sedes: u.sedes,
      activo: u.activo,
      profesionalId: u.profesionalId,
    });
  }

  async function submitForm() {
    if (!form) return;
    if (!form.nombre.trim()) {
      showToast({ type: 'error', message: 'El nombre es obligatorio.' });
      return;
    }
    if (form.id === null) {
      if (!form.email.trim()) {
        showToast({ type: 'error', message: 'El email es obligatorio.' });
        return;
      }
      if (form.password.length < 8) {
        showToast({ type: 'error', message: 'La contraseña debe tener al menos 8 caracteres.' });
        return;
      }
    }
    if (!form.esGlobal && form.sedes.length === 0) {
      showToast({ type: 'error', message: 'Asigna al menos una sede.' });
      return;
    }

    setSaving(true);
    try {
      if (form.id === null) {
        await usuariosApi.create({
          email: form.email.trim(),
          password: form.password,
          nombre: form.nombre.trim(),
          rol: form.rol,
          esGlobal: form.esGlobal,
          sedes: form.esGlobal ? [] : form.sedes,
          profesionalId: ROLES_CLINICOS.includes(form.rol) ? form.profesionalId : null,
        });
        showToast({ type: 'success', message: 'Usuario creado.' });
      } else {
        await usuariosApi.update(form.id, {
          nombre: form.nombre.trim(),
          rol: form.rol,
          activo: form.activo,
          esGlobal: form.esGlobal,
          sedes: form.esGlobal ? [] : form.sedes,
        });
        showToast({ type: 'success', message: 'Usuario actualizado.' });
      }
      setForm(null);
      await load();
    } catch (err) {
      showToast({ type: 'error', message: usuariosErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActivo(u: UsuarioItem) {
    try {
      await usuariosApi.update(u.id, { activo: !u.activo });
      showToast({ type: 'success', message: u.activo ? 'Usuario desactivado.' : 'Usuario activado.' });
      await load();
    } catch (err) {
      showToast({ type: 'error', message: usuariosErrorMessage(err) });
    }
  }

  async function submitPassword() {
    if (!pwUser) return;
    if (pwValue.length < 8) {
      showToast({ type: 'error', message: 'La contraseña debe tener al menos 8 caracteres.' });
      return;
    }
    setSaving(true);
    try {
      await usuariosApi.resetPassword(pwUser.id, pwValue);
      showToast({ type: 'success', message: `Contraseña de ${pwUser.nombre} actualizada.` });
      setPwUser(null);
      setPwValue('');
    } catch (err) {
      showToast({ type: 'error', message: usuariosErrorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  function toggleFormSede(id: string) {
    setForm((f) =>
      f
        ? { ...f, sedes: f.sedes.includes(id) ? f.sedes.filter((s) => s !== id) : [...f.sedes, id] }
        : f
    );
  }

  return (
    <div style={{ fontFamily: FONT_INTER }} className="text-zinc-900">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Usuarios</h1>
          <p className="text-[13px] text-zinc-500">
            Cuentas, roles y acceso por sede{!isAdmin && ' (tus sedes)'}
          </p>
        </div>
        <button onClick={openCreate} className={CTA_PRIMARY} style={{ background: '#1f3a8a' }}>
          <Plus className="w-4 h-4" /> Nuevo usuario
        </button>
      </div>

      {loading ? (
        <div className="text-[13px] text-zinc-500 py-10 text-center">Cargando…</div>
      ) : users.length === 0 ? (
        <div className="text-[13px] text-zinc-500 py-10 text-center border border-dashed border-zinc-200 rounded-lg">
          No hay usuarios todavía.
        </div>
      ) : (
        <div className="border border-zinc-200 rounded-lg overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-zinc-50 text-zinc-500 text-[11px] uppercase tracking-wider">
              <tr>
                <th className="text-left font-semibold px-4 py-2.5">Nombre</th>
                <th className="text-left font-semibold px-4 py-2.5">Email</th>
                <th className="text-left font-semibold px-4 py-2.5">Rol</th>
                <th className="text-left font-semibold px-4 py-2.5">Sedes</th>
                <th className="text-left font-semibold px-4 py-2.5">Estado</th>
                <th className="text-right font-semibold px-4 py-2.5">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((u) => (
                <tr key={u.id} className={u.activo ? '' : 'opacity-50'}>
                  <td className="px-4 py-2.5 font-medium">{u.nombre}</td>
                  <td className="px-4 py-2.5 text-zinc-600">{u.email}</td>
                  <td className="px-4 py-2.5">{ROLE_LABEL[u.rol]}</td>
                  <td className="px-4 py-2.5 text-zinc-600">
                    {u.esGlobal ? 'Todas' : u.sedes.map(sedeName).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-[11px] ${
                        u.activo ? 'bg-green-50 text-green-700' : 'bg-zinc-100 text-zinc-500'
                      }`}
                    >
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(u)}
                        className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                        title="Editar"
                      >
                        <Pencil className="w-[14px] h-[14px]" />
                      </button>
                      <button
                        onClick={() => setPwUser(u)}
                        className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                        title="Resetear contraseña"
                      >
                        <KeyRound className="w-[14px] h-[14px]" />
                      </button>
                      <button
                        onClick={() => toggleActivo(u)}
                        className="p-1.5 rounded text-zinc-400 hover:text-zinc-800 hover:bg-zinc-100"
                        title={u.activo ? 'Desactivar' : 'Activar'}
                      >
                        <Power className="w-[14px] h-[14px]" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal crear / editar */}
      {form && (
        <Modal onClose={() => setForm(null)} title={form.id === null ? 'Nuevo usuario' : 'Editar usuario'}>
          <div className="space-y-3">
            <Field label="Nombre">
              <input
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                className={INPUT}
                autoFocus
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={form.email}
                disabled={form.id !== null}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={`${INPUT} ${form.id !== null ? 'bg-zinc-100 text-zinc-500' : ''}`}
                placeholder="usuario@bodytech.com"
              />
            </Field>
            {form.id === null && (
              <Field label="Contraseña temporal (mín. 8)">
                <input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className={INPUT}
                  placeholder="La compartes con el usuario"
                />
              </Field>
            )}
            <Field label="Rol">
              <select
                value={form.rol}
                onChange={(e) => setForm({ ...form, rol: e.target.value as Role })}
                className={INPUT}
              >
                {rolesAsignables.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </Field>
            {form.id === null && ROLES_CLINICOS.includes(form.rol) && (
              <Field label="Vincular a profesional (opcional)">
                <select
                  value={form.profesionalId ?? ''}
                  onChange={(e) => {
                    const pid = e.target.value ? Number(e.target.value) : null;
                    const prof = profesionales.find((p) => p.id === pid);
                    setForm({
                      ...form,
                      profesionalId: pid,
                      nombre: prof && !form.nombre.trim() ? prof.nombre : form.nombre,
                      sedes:
                        prof?.sedeId && form.sedes.length === 0 ? [prof.sedeId] : form.sedes,
                    });
                  }}
                  className={INPUT}
                >
                  <option value="">— Sin vincular —</option>
                  {profesionales
                    .filter((p) => p.rol === form.rol)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre} · {p.codigo}
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Conecta la cuenta con su ficha (código) para que el panel funcione.
                </p>
              </Field>
            )}
            {isAdmin && (
              <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={form.esGlobal}
                  onChange={(e) => setForm({ ...form, esGlobal: e.target.checked })}
                />
                Acceso global (todas las sedes)
              </label>
            )}
            {!form.esGlobal && (
              <Field label="Sedes">
                <div className="max-h-40 overflow-y-auto border border-zinc-200 rounded-md p-2 space-y-1">
                  {sedesAsignables.length === 0 ? (
                    <p className="text-[12px] text-zinc-400 px-1">No tienes sedes asignables.</p>
                  ) : (
                    sedesAsignables.map((s) => (
                      <label key={s.sedeId} className="flex items-center gap-2 text-[13px] px-1">
                        <input
                          type="checkbox"
                          checked={form.sedes.includes(s.sedeId)}
                          onChange={() => toggleFormSede(s.sedeId)}
                        />
                        {s.nombre}
                      </label>
                    ))
                  )}
                </div>
              </Field>
            )}
            {form.id !== null && (
              <label className="flex items-center gap-2 text-[13px] text-zinc-700">
                <input
                  type="checkbox"
                  checked={form.activo}
                  onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                />
                Activo
              </label>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setForm(null)} className={CTA_OUTLINE} disabled={saving}>
              Cancelar
            </button>
            <button onClick={submitForm} className={CTA_PRIMARY} style={{ background: '#1f3a8a' }} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </Modal>
      )}

      {/* Modal reset contraseña */}
      {pwUser && (
        <Modal onClose={() => setPwUser(null)} title={`Resetear contraseña · ${pwUser.nombre}`}>
          <Field label="Nueva contraseña temporal (mín. 8)">
            <input
              type="text"
              value={pwValue}
              onChange={(e) => setPwValue(e.target.value)}
              className={INPUT}
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setPwUser(null)} className={CTA_OUTLINE} disabled={saving}>
              Cancelar
            </button>
            <button onClick={submitPassword} className={CTA_PRIMARY} style={{ background: '#1f3a8a' }} disabled={saving}>
              {saving ? 'Guardando…' : 'Cambiar contraseña'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const INPUT =
  'w-full px-3 py-2 border border-zinc-200 rounded-md text-[13px] focus:outline-none focus:border-blue-700';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider font-semibold text-zinc-500 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50"
      onClick={onClose}
      style={{ fontFamily: FONT_INTER }}
    >
      <div
        className="bg-white rounded-xl shadow-lg border border-zinc-200 w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-800">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

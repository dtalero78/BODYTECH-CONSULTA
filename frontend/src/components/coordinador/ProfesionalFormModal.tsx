// ============================================================================
// ProfesionalFormModal — dar de alta a una persona.
//
// ── Qué cambió y por qué ────────────────────────────────────────────────────
// La versión anterior mostraba de una vez, y al mismo nivel: foto, rol de la
// ficha, código, cédula, nombres, alias, especialidad, licencia, firma,
// correo (dos veces: el de la ficha y el de la cuenta), aplicación, OTRO rol
// —el de la cuenta—, "todas las sedes", la lista de sedes y cuatro botones
// sueltos que decían "Trepsi · UMV · Corporativo · Nativa". Nada de eso decía
// qué iba a poder hacer la persona, y varias de esas casillas no son
// independientes: un coach de nutrición SIEMPRE es ficha `coach` + cuenta
// `consulta:coach` + programa `trepsi` + sede `bdt-nutricion`.
//
// Ahora el alta empieza por lo único que quien da de alta sí sabe: QUÉ VA A
// HACER la persona (los oficios del Mapa de Rutas, en `perfilesAlta.ts`). De
// ahí salen el rol, la aplicación, el programa y la sede. Después se pregunta
// lo que de verdad cambia entre dos personas del mismo oficio —quién es y su
// correo—, y antes de crear se muestra en castellano lo que va a poder hacer.
//
// Lo opcional (foto, firma, licencia, alias, especialidad, duración) queda
// plegado y dice que es opcional: antes la foto abría el formulario y parecía
// obligatoria.
//
// «Otro caso» conserva los controles crudos: nada de lo que se podía hacer
// antes dejó de poderse.
// ============================================================================

import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Upload, Trash2, ChevronDown, ChevronRight, Check, Copy } from 'lucide-react';
import authService from '../../services/auth.service';
import profesionalesService, {
  Profesional,
  ProfesionalInput,
  RolDirectorio,
} from '../../services/profesionales.service';
import {
  PERFILES,
  PROGRAMAS,
  ROLES_APP,
  Perfil,
  PerfilId,
  Preset,
  AppDestino,
  perfilPorId,
  pideSedes,
  resumenAlta,
  tieneAgenda,
} from './perfilesAlta';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, TOKENS } from './_tokens';

// Tamaño máximo de la firma en bytes (base64 ya codificado pesa ~33% más
// que el archivo original, así que limitamos el archivo crudo a ~1.5 MB
// para quedar bajo 2 MB en base64).
const MAX_FIRMA_BYTES = 1.5 * 1024 * 1024;

// Foto de perfil: se acepta un archivo original de hasta ~15 MB y se reescala
// en el navegador a un avatar pequeño (lado mayor 450px, JPEG q0.8) antes de
// guardarlo como data URL. Así la foto pesa decenas de KB y es apta para
// incluirse en los listados sin inflar el payload.
const MAX_FOTO_SOURCE_BYTES = 15 * 1024 * 1024;
const FOTO_MAX_SIDE = 450;
const FOTO_QUALITY = 0.8;

/** Reescala una imagen a un JPEG data URL con lado mayor <= maxSide. */
function downscaleToDataUrl(file: File, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo procesar la imagen.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err instanceof Error ? err : new Error('No se pudo procesar la imagen.'));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen.'));
    };
    img.src = url;
  });
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** `null` cuando el oficio no agenda en Consulta: no hay ficha que devolver. */
  onSaved: (p: Profesional | null) => void;
  // Si llega `editing`, el modal está en modo edición.
  editing: Profesional | null;
  onError: (message: string) => void;
}

const EMPTY: ProfesionalInput = {
  rol: 'medico',
  codigo: '',
  documento: null,
  primerNombre: '',
  segundoNombre: null,
  primerApellido: '',
  segundoApellido: null,
  alias: null,
  especialidad: null,
  numeroLicencia: null,
  tipoLicencia: null,
  fechaVencimientoLicencia: null,
  tiempoConsulta: 30,
  firma: null,
  foto: null,
  email: null,
  celular: null,
};

const INPUT =
  'w-full px-3 py-2 border border-zinc-200 rounded-md text-[13px] text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400';
const LABEL = 'block text-[11.5px] font-medium text-zinc-500 mb-1';

export function ProfesionalFormModal({ isOpen, onClose, onSaved, editing, onError }: Props) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [perfilId, setPerfilId] = useState<PerfilId | null>(null);
  // Copia editable del preset: el oficio lo propone, la pantalla lo puede
  // ajustar (sedes de una coordinadora, o todo a mano en «Otro caso»).
  const [preset, setPreset] = useState<Preset>(perfilPorId('manual').preset);
  const [form, setForm] = useState<ProfesionalInput>(EMPTY);
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [verExtras, setVerExtras] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [sedesDisponibles, setSedesDisponibles] = useState<{ sedeId: string; nombre: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    authService
      .getSedes()
      .then((s) => setSedesDisponibles(s))
      .catch(() => setSedesDisponibles([]));
  }, [isOpen]);

  useEffect(() => {
    if (editing) {
      setPaso(2);
      setPerfilId(null);
      setForm({
        rol: editing.rol,
        codigo: editing.codigo,
        documento: editing.documento,
        primerNombre: editing.primerNombre,
        segundoNombre: editing.segundoNombre,
        primerApellido: editing.primerApellido,
        segundoApellido: editing.segundoApellido,
        alias: editing.alias,
        especialidad: editing.especialidad,
        numeroLicencia: editing.numeroLicencia,
        tipoLicencia: editing.tipoLicencia,
        fechaVencimientoLicencia: editing.fechaVencimientoLicencia,
        tiempoConsulta: editing.tiempoConsulta,
        firma: editing.firma,
        foto: editing.foto,
        email: editing.email,
        celular: editing.celular,
      });
      setCorreo(editing.email ?? '');
      setVerExtras(true);
      return;
    }
    setPaso(1);
    setPerfilId(null);
    setPreset(perfilPorId('manual').preset);
    setForm(EMPTY);
    setCorreo('');
    setVerExtras(false);
    // La clave se genera al abrir: si hay que buscar el botón para que
    // aparezca, la mitad de las veces no se genera.
    setPassword(generarClave());
  }, [editing, isOpen]);

  const conAgenda = tieneAgenda(preset.rolFicha);
  const perfil = perfilId ? perfilPorId(perfilId) : null;
  const esManual = perfilId === 'manual';
  const hayQuePreguntarSedes = esManual || pideSedes(preset);

  const nombreSedes = useMemo(
    () =>
      preset.sedes.map(
        (id) => sedesDisponibles.find((s) => s.sedeId === id)?.nombre ?? id,
      ),
    [preset.sedes, sedesDisponibles],
  );

  const resumen = useMemo(
    () =>
      resumenAlta(preset, {
        nombre: [form.primerNombre, form.primerApellido].filter(Boolean).join(' '),
        correo,
        sedesElegidas: nombreSedes,
        codigo: form.codigo,
      }),
    [preset, form.primerNombre, form.primerApellido, form.codigo, correo, nombreSedes],
  );

  if (!isOpen) return null;

  function update<K extends keyof ProfesionalInput>(key: K, value: ProfesionalInput[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function elegirPerfil(p: Perfil) {
    setPerfilId(p.id);
    setPreset({ ...p.preset, sedes: [...p.preset.sedes], programas: [...p.preset.programas] });
    setForm((f) => ({
      ...f,
      rol: p.preset.rolFicha,
      ...(p.preset.tiempoConsulta ? { tiempoConsulta: p.preset.tiempoConsulta } : {}),
    }));
    setPaso(2);
  }

  function toggleSede(sedeId: string) {
    setPreset((p) => ({
      ...p,
      sedes: p.sedes.includes(sedeId)
        ? p.sedes.filter((x) => x !== sedeId)
        : [...p.sedes, sedeId],
    }));
  }

  async function handleFirmaUpload(file: File) {
    if (file.size > MAX_FIRMA_BYTES) {
      onError(
        `La firma pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Máximo permitido: 1.5 MB.`
      );
      return;
    }
    if (!file.type.startsWith('image/')) {
      onError('La firma debe ser una imagen (PNG, JPG, SVG).');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') update('firma', result);
    };
    reader.onerror = () => onError('No se pudo leer el archivo.');
    reader.readAsDataURL(file);
  }

  async function handleFotoUpload(file: File) {
    if (!file.type.startsWith('image/')) {
      onError('La foto debe ser una imagen (PNG, JPG o WEBP).');
      return;
    }
    if (file.size > MAX_FOTO_SOURCE_BYTES) {
      onError(`La foto pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. Máximo permitido: 15 MB.`);
      return;
    }
    try {
      update('foto', await downscaleToDataUrl(file, FOTO_MAX_SIDE, FOTO_QUALITY));
    } catch (err: unknown) {
      onError((err as Error)?.message || 'No se pudo procesar la imagen.');
    }
  }

  async function copiarAcceso() {
    try {
      await navigator.clipboard.writeText(`Correo: ${correo}\nContraseña: ${password}`);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      onError('No se pudo copiar. Seleccioná el texto a mano.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.primerNombre.trim() || !form.primerApellido.trim()) {
      onError('El nombre y el apellido son obligatorios.');
      return;
    }
    if (conAgenda && !form.codigo.trim()) {
      onError('Quien atiende necesita un código de agenda. Podés usar su cédula.');
      return;
    }
    if (!editing && !(form.documento ?? '').trim()) {
      onError('La cédula es obligatoria: es con lo que la persona queda en el directorio.');
      return;
    }
    if (!editing && correo.trim() && password.length < 8) {
      onError('La contraseña provisional debe tener al menos 8 caracteres.');
      return;
    }
    if (
      !editing &&
      correo.trim() &&
      preset.app === 'consulta' &&
      !preset.esGlobal &&
      preset.sedes.length === 0
    ) {
      onError('Elegí a qué unidades atiende, o marcá todas.');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        onSaved(await profesionalesService.update(editing.id, { ...form, email: correo || null }));
        onClose();
        return;
      }
      const alta = await profesionalesService.create(
        {
          ...form,
          rol: preset.rolFicha,
          // Sin agenda no hay código: la ficha ni siquiera se crea.
          codigo: conAgenda ? form.codigo.trim() : '',
          email: correo.trim() || null,
          cuenta:
            correo.trim() && preset.app
              ? {
                  email: correo.trim().toLowerCase(),
                  password,
                  app: preset.app,
                  rol: preset.rolApp,
                  sedes: preset.esGlobal ? [] : preset.sedes,
                  esGlobal: preset.esGlobal,
                  programas: preset.programas,
                }
              : undefined,
        },
        // La ficha vive en la sede del oficio, no en la de quien da el alta.
        preset.sedeFicha ?? undefined,
      );
      onSaved(alta.profesional);
      // La ficha quedó; si la cuenta no, se dice — no se finge que todo salió.
      if (alta.errorCuenta) onError(alta.errorCuenta);
      onClose();
    } catch (err: unknown) {
      const msg =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.response?.data?.error?.message ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (err as any)?.message ||
        'Error guardando profesional.';
      onError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={{ fontFamily: FONT_INTER }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 sticky top-0 bg-white rounded-t-xl z-10">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-800">
              {editing ? 'Editar profesional' : 'Nueva persona'}
            </h2>
            {!editing && (
              <p className="text-[12px] text-zinc-500 mt-0.5">
                {paso === 1
                  ? 'Paso 1 de 2 · ¿Qué va a hacer?'
                  : `Paso 2 de 2 · ${perfil?.titulo ?? 'Datos'}`}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-zinc-100 text-zinc-400"
            aria-label="Cerrar"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* ── PASO 1 · el oficio ───────────────────────────────────────── */}
        {!editing && paso === 1 && (
          <div className="p-5">
            <p className="text-[13px] text-zinc-600 mb-4 leading-relaxed max-w-[62ch]">
              Elegí qué va a hacer la persona. Con eso quedan puestos su rol, la aplicación a la
              que entra, su programa y su sede; después solo hay que decir quién es.
            </p>
            {(['atiende', 'gestiona', 'otro'] as const).map((grupo) => (
              <div key={grupo} className="mb-4">
                <div className={`${SECTION_LABEL} mb-2`}>
                  {grupo === 'atiende'
                    ? 'Atiende pacientes'
                    : grupo === 'gestiona'
                      ? 'Gestiona la operación'
                      : 'Si ninguno encaja'}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PERFILES.filter((p) => p.grupo === grupo).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => elegirPerfil(p)}
                      className="text-left border border-zinc-200 rounded-lg p-3 hover:border-blue-400 hover:bg-blue-50/40 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13.5px] font-medium text-zinc-800">{p.titulo}</span>
                        <ChevronRight className="w-4 h-4 text-zinc-300" />
                      </div>
                      <p className="text-[12px] text-zinc-500 mt-1 leading-snug">{p.hace}</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── PASO 2 · quién es ────────────────────────────────────────── */}
        {(editing || paso === 2) && (
          <form onSubmit={handleSubmit} className="p-5 space-y-5">
            {perfil?.nota && (
              <div className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                {perfil.nota}
              </div>
            )}

            {/* Quién es */}
            <div className="space-y-3">
              <div className={SECTION_LABEL}>Quién es</div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL} htmlFor="pf-nombre1">Primer nombre *</label>
                  <input
                    type="text"
                    id="pf-nombre1"
                    value={form.primerNombre}
                    onChange={(e) => update('primerNombre', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pf-apellido1">Primer apellido *</label>
                  <input
                    type="text"
                    id="pf-apellido1"
                    value={form.primerApellido}
                    onChange={(e) => update('primerApellido', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pf-nombre2">Segundo nombre</label>
                  <input
                    type="text"
                    id="pf-nombre2"
                    value={form.segundoNombre ?? ''}
                    onChange={(e) => update('segundoNombre', e.target.value || null)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={LABEL} htmlFor="pf-apellido2">Segundo apellido</label>
                  <input
                    type="text"
                    id="pf-apellido2"
                    value={form.segundoApellido ?? ''}
                    onChange={(e) => update('segundoApellido', e.target.value || null)}
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL} htmlFor="pf-documento">Cédula {editing ? '' : '*'}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    id="pf-documento"
                    value={form.documento ?? ''}
                    onChange={(e) => {
                      const doc = e.target.value.replace(/\D/g, '');
                      update('documento', doc || null);
                      // El código de agenda casi siempre es la cédula. Se
                      // propone y se puede cambiar; así nadie se inventa uno.
                      if (!editing && conAgenda && !form.codigo) update('codigo', doc);
                    }}
                    placeholder="1015420891"
                    className={INPUT}
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Con esto queda en el directorio de la cadena.
                  </p>
                </div>
                <div>
                  <label className={LABEL} htmlFor="pf-celular">Celular</label>
                  <input
                    type="tel"
                    id="pf-celular"
                    value={form.celular ?? ''}
                    onChange={(e) => update('celular', e.target.value || null)}
                    placeholder="+573001234567"
                    className={INPUT}
                  />
                </div>
              </div>

              {conAgenda && (
                <div>
                  <label className={LABEL} htmlFor="pf-codigo">Código de agenda *</label>
                  <input
                    type="text"
                    id="pf-codigo"
                    value={form.codigo}
                    onChange={(e) => update('codigo', e.target.value.toUpperCase())}
                    placeholder="1015420891"
                    className={INPUT}
                    disabled={!!editing}
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    {editing
                      ? 'El código no se puede cambiar.'
                      : 'Con el que quedan marcadas sus citas. Se propone su cédula.'}
                  </p>
                </div>
              )}
            </div>

            {/* Cómo entra */}
            {!editing && (
              <div className="space-y-3 pt-4 border-t border-zinc-100">
                <div className={SECTION_LABEL}>Cómo entra</div>
                <div>
                  <label className={LABEL} htmlFor="pf-correo">Correo</label>
                  <input
                    type="email"
                    id="pf-correo"
                    value={correo}
                    onChange={(e) => setCorreo(e.target.value)}
                    placeholder="nombre.apellido@bodytechcorp.com"
                    className={INPUT}
                  />
                  <p className="text-[11px] text-zinc-400 mt-1">
                    Es su usuario. Si todavía no lo tenés, dejalo vacío: queda registrada y sin
                    cuenta, y se le crea después.
                  </p>
                </div>

                {correo.trim() !== '' && (
                  <div>
                    <label className={LABEL} htmlFor="pf-clave">Contraseña provisional</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        id="pf-clave"
                    value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="mínimo 8 caracteres"
                        className={INPUT}
                        style={{ fontFamily: FONT_MONO }}
                      />
                      <button
                        type="button"
                        onClick={() => setPassword(generarClave())}
                        className="px-3 h-[38px] border border-zinc-200 rounded-md text-[12.5px] text-zinc-600 hover:bg-zinc-50 shrink-0"
                      >
                        Otra
                      </button>
                      <button
                        type="button"
                        onClick={copiarAcceso}
                        className="px-3 h-[38px] border border-zinc-200 rounded-md text-[12.5px] text-zinc-600 hover:bg-zinc-50 shrink-0 inline-flex items-center gap-1.5"
                      >
                        {copiado ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                        {copiado ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Se la entregás a la persona. Después no se puede volver a ver.
                    </p>
                  </div>
                )}

                {/* Unidades: sólo cuando el oficio no las fija. */}
                {hayQuePreguntarSedes && preset.app === 'consulta' && (
                  <div>
                    <label className={LABEL}>A qué unidades de servicio atiende</label>
                    {/* Son tres y no las cinco del Mapa de Rutas: Nutrición
                        Presencial y ACC no se atienden desde esta aplicación,
                        así que marcarlas acá no daría acceso a nada. A esas se
                        entra eligiendo ese oficio en el paso anterior, que crea
                        la cuenta en la aplicación de ACC. */}
                    <p className="text-[11px] text-zinc-400 mb-1.5">
                      Son las de esta aplicación. Nutrición Presencial y ACC se atienden desde la
                      aplicación de ACC: para eso se elige ese oficio en el paso anterior.
                    </p>
                    <label className="flex items-center gap-2 text-[13px] text-zinc-700 mb-1.5">
                      <input
                        type="checkbox"
                        checked={preset.esGlobal}
                        onChange={(e) => setPreset({ ...preset, esGlobal: e.target.checked })}
                      />
                      Todas las unidades
                    </label>
                    {!preset.esGlobal && (
                      <div className="border border-zinc-200 rounded-md p-3 grid grid-cols-2 gap-y-1.5">
                        {sedesDisponibles.length === 0 ? (
                          <p className="text-[12px] text-zinc-400">No hay unidades para asignar.</p>
                        ) : (
                          sedesDisponibles.map((s) => (
                            <label key={s.sedeId} className="flex items-center gap-2 text-[13px]">
                              <input
                                type="checkbox"
                                checked={preset.sedes.includes(s.sedeId)}
                                onChange={() => toggleSede(s.sedeId)}
                              />
                              {s.nombre}
                            </label>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* «Otro caso»: los controles crudos, para lo que no es rutina. */}
                {esManual && (
                  <div className="space-y-3 border border-zinc-200 rounded-md p-3 bg-zinc-50/60">
                    <p className="text-[12px] text-zinc-500">
                      Configuración a mano. Cada casilla es independiente: revisá el resumen de
                      abajo antes de crear.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={LABEL}>Rol en el directorio</label>
                        <select
                          value={preset.rolFicha}
                          onChange={(e) =>
                            setPreset({ ...preset, rolFicha: e.target.value as RolDirectorio })
                          }
                          className={INPUT}
                        >
                          <option value="medico">Médico</option>
                          <option value="coach">Coach</option>
                          <option value="nutricionista">Nutricionista</option>
                          <option value="fisioterapeuta">Fisioterapeuta</option>
                          <option value="evaluador">Evaluador</option>
                          <option value="administrativo">Administrativo</option>
                        </select>
                      </div>
                      <div>
                        <label className={LABEL}>Entra a</label>
                        <select
                          value={preset.app ?? 'consulta'}
                          onChange={(e) => {
                            const app = e.target.value as AppDestino;
                            setPreset({ ...preset, app, rolApp: ROLES_APP[app][0] });
                          }}
                          className={INPUT}
                        >
                          <option value="consulta">Consulta</option>
                          <option value="acc">ACC</option>
                          <option value="prepagadas">Prepagadas</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className={LABEL}>Qué puede hacer ahí</label>
                      <select
                        value={preset.rolApp}
                        onChange={(e) => setPreset({ ...preset, rolApp: e.target.value })}
                        className={INPUT}
                      >
                        {ROLES_APP[preset.app ?? 'consulta'].map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                    {preset.app === 'consulta' && (
                      <div>
                        <label className={LABEL}>
                          Programa <span className="text-zinc-400">(de dónde le llegan las citas)</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {PROGRAMAS.map((pr) => {
                            const puesto = preset.programas.includes(pr.v);
                            return (
                              <button
                                key={pr.v}
                                type="button"
                                onClick={() =>
                                  setPreset({
                                    ...preset,
                                    programas: puesto
                                      ? preset.programas.filter((x) => x !== pr.v)
                                      : [...preset.programas, pr.v],
                                  })
                                }
                                className={`px-2.5 py-1 rounded-md border text-[12px] ${
                                  puesto
                                    ? 'bg-blue-50 border-blue-300 text-blue-800'
                                    : 'bg-white border-zinc-200 text-zinc-500'
                                }`}
                              >
                                {pr.t}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Opcionales, plegados: antes la foto abría el formulario y
                parecía obligatoria. */}
            <div className="pt-4 border-t border-zinc-100">
              <button
                type="button"
                onClick={() => setVerExtras((v) => !v)}
                className="flex items-center gap-1.5 text-[12.5px] text-zinc-600 hover:text-zinc-900"
              >
                {verExtras ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
                Datos opcionales · foto, firma, licencia y duración de la consulta
              </button>
              {verExtras && (
                <div className="mt-4 space-y-4">
                  <p className="text-[12px] text-zinc-500">
                    Nada de esto es obligatorio. La firma y la licencia salen en el PDF de la
                    historia; la foto, en el tablero del día.
                  </p>

                  {/* Foto */}
                  <div className="flex items-center gap-4">
                    {form.foto ? (
                      <img
                        src={form.foto}
                        alt="Foto de perfil"
                        className="w-16 h-16 rounded-full object-cover border border-zinc-200 bg-zinc-100 shrink-0"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-full border-2 border-dashed border-zinc-200 bg-zinc-50 flex items-center justify-center text-zinc-300 shrink-0">
                        <Upload className="w-4 h-4" />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => fotoInputRef.current?.click()}
                        className="px-3 py-1.5 text-[12px] text-blue-700 hover:bg-blue-50 rounded-md border border-blue-200 inline-flex items-center gap-1.5"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {form.foto ? 'Reemplazar foto' : 'Subir foto'}
                      </button>
                      {form.foto && (
                        <button
                          type="button"
                          onClick={() => update('foto', null)}
                          className="px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 rounded-md border border-red-200 inline-flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Quitar
                        </button>
                      )}
                    </div>
                    <input
                      ref={fotoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFotoUpload(file);
                        if (e.target) e.target.value = '';
                      }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL} htmlFor="pf-alias">
                        Alias <span className="text-zinc-400">(lo que ve el afiliado)</span>
                      </label>
                      <input
                        type="text"
                        id="pf-alias"
                    value={form.alias ?? ''}
                        onChange={(e) => update('alias', e.target.value || null)}
                        placeholder="Dr. Juan Pérez"
                        className={INPUT}
                      />
                    </div>
                    <div>
                      <label className={LABEL} htmlFor="pf-especialidad">Especialidad</label>
                      <input
                        type="text"
                        id="pf-especialidad"
                    value={form.especialidad ?? ''}
                        onChange={(e) => update('especialidad', e.target.value || null)}
                        placeholder="Medicina general"
                        className={INPUT}
                      />
                    </div>
                  </div>

                  {conAgenda && (
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className={LABEL}>Duración de la consulta (min)</label>
                        <input
                          type="number"
                          min={5}
                          max={240}
                          value={form.tiempoConsulta ?? 30}
                          onChange={(e) =>
                            update('tiempoConsulta', parseInt(e.target.value, 10) || 30)
                          }
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label className={LABEL}>Número de licencia</label>
                        <input
                          type="text"
                          value={form.numeroLicencia ?? ''}
                          onChange={(e) => update('numeroLicencia', e.target.value || null)}
                          className={INPUT}
                        />
                      </div>
                      <div>
                        <label className={LABEL}>Vence</label>
                        <input
                          type="date"
                          value={form.fechaVencimientoLicencia ?? ''}
                          onChange={(e) =>
                            update('fechaVencimientoLicencia', e.target.value || null)
                          }
                          className={INPUT}
                        />
                      </div>
                    </div>
                  )}

                  {conAgenda && (
                    <div>
                      <label className={LABEL}>
                        Firma <span className="text-zinc-400">(PNG, JPG o SVG · máx 1.5 MB)</span>
                      </label>
                      {form.firma ? (
                        <div className="flex items-start gap-3 border border-zinc-200 rounded-md p-3">
                          <img
                            src={form.firma}
                            alt="Firma"
                            className="h-16 w-auto max-w-[200px] object-contain border border-zinc-100 rounded bg-white"
                          />
                          <div className="flex flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => fileInputRef.current?.click()}
                              className="px-3 py-1.5 text-[12px] text-blue-700 hover:bg-blue-50 rounded-md border border-blue-200"
                            >
                              Reemplazar
                            </button>
                            <button
                              type="button"
                              onClick={() => update('firma', null)}
                              className="px-3 py-1.5 text-[12px] text-red-600 hover:bg-red-50 rounded-md border border-red-200"
                            >
                              Quitar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full px-4 py-5 border-2 border-dashed border-zinc-200 rounded-md text-[12.5px] text-zinc-500 hover:bg-zinc-50 hover:border-blue-300 flex flex-col items-center gap-1.5"
                        >
                          <Upload className="w-4 h-4 text-zinc-400" />
                          Subir firma
                        </button>
                      )}
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/svg+xml"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFirmaUpload(file);
                          if (e.target) e.target.value = '';
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* El resumen: lo que va a quedar, en castellano. */}
            {!editing && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3">
                <div className={`${SECTION_LABEL} mb-1.5`}>Al crear</div>
                <ul className="space-y-1">
                  {resumen.map((linea) => (
                    <li key={linea} className="flex gap-2 text-[12.5px] text-zinc-700">
                      <Check className="w-3.5 h-3.5 text-green-600 shrink-0 mt-[3px]" />
                      <span>{linea}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 justify-between pt-3 border-t border-zinc-100">
              <div>
                {!editing && (
                  <button
                    type="button"
                    onClick={() => setPaso(1)}
                    className="px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-100 rounded-md"
                  >
                    ← Cambiar qué hace
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-100 rounded-md"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-white rounded-md text-[13px] font-medium disabled:opacity-50"
                  style={{ background: TOKENS.accent }}
                >
                  {saving ? 'Guardando…' : editing ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Contraseña provisional legible: sin caracteres que se confundan al dictarla. */
function generarClave(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const n = new Uint32Array(12);
  crypto.getRandomValues(n);
  return Array.from(n, (v) => abc[v % abc.length]).join('');
}

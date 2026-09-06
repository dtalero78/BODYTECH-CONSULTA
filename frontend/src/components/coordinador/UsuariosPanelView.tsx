// ============================================================================
// UsuariosPanelView — Usuarios. Uno solo, para las tres aplicaciones.
//
// Antes esto vivía en tres pantallas que se pisaban: «Usuarios» (sólo Consulta,
// con sedes y vínculo al profesional), «Creación de usuarios» (las tres apps,
// sin sedes ni vínculo) y «Accesos» (el mapa y la baja). Quien creaba una
// cuenta tenía que saber en cuál de las tres estaba lo que necesitaba, y un
// médico creado desde la segunda quedaba sin sedes y sin ficha: entraba, pero
// no podía agendar.
//
// Acá hay una sola lista y una sola hoja por persona:
//
//   LISTA  — todas las personas, buscables, filtrables por aplicación y estado.
//   HOJA   — sus datos, TODOS sus accesos (uno por aplicación, con su rol) y,
//            si tiene Consulta, sus sedes y su ficha de profesional.
//
// Dos acciones distintas conviven, y conviene no confundirlas:
//   INHABILITAR  — apaga la cuenta. Reversible, y es lo normal.
//   DAR DE BAJA  — sale de la organización: deja de entrar a LAS TRES
//                  aplicaciones de una vez. Es lo que antes había que hacer app
//                  por app, y que ya se falló al menos una vez.
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  UserPlus, RefreshCw, Search, Power, UserMinus, Pencil, X, AlertTriangle, Dices,
  ClipboardList, CalendarClock,
} from 'lucide-react';
import usuariosGlobalService, {
  Persona, AppDestino, EditarPersona,
} from '../../services/usuarios-global.service';
import authService, { Role } from '../../services/auth.service';
import usuariosApi, { ProfesionalLite } from '../../services/usuarios.service';
import profesionalesService, { Profesional } from '../../services/profesionales.service';
import { ProfesionalFormModal } from './ProfesionalFormModal';
import { DisponibilidadModal } from './DisponibilidadModal';
import { FONT_INTER, FONT_MONO, SECTION_LABEL, CTA_PRIMARY, CTA_OUTLINE } from './_tokens';

interface Props {
  showToast: (t: { type: 'success' | 'error'; message: string }) => void;
  reportCount?: (count: number | null) => void;
}

const APPS: AppDestino[] = ['consulta', 'acc', 'prepagadas'];

const APP_NOMBRE: Record<AppDestino, string> = {
  consulta: 'Consulta',
  acc: 'ACC',
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

/**
 * Roles de Consulta que exigen ficha de profesional. Sin ella el panel responde
 * SIN_PROFESIONAL y la agenda sale vacía: la cuenta parece funcionar y no
 * funciona. Le pasó a un coach que llevaba meses así.
 */
const ROLES_CLINICOS = ['medico', 'coach'];

/**
 * A qué programa pertenece la persona. Mismo vocabulario que el origen de las
 * citas: si la persona es de Trepsi y la cita es de Trepsi, se llaman igual.
 * Es una lista porque alguien puede cubrir dos.
 */
const PROGRAMAS: { v: string; t: string; cls: string }[] = [
  { v: 'trepsi', t: 'Trepsi', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  { v: 'umv', t: 'UMV', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  { v: 'corporativo', t: 'Corporativo', cls: 'bg-teal-50 text-teal-700 border-teal-200' },
  { v: 'mybodytech', t: 'MyBodytech', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  { v: 'nativa', t: 'Nativa', cls: 'bg-zinc-100 text-zinc-600 border-zinc-200' },
];

/**
 * Lo que un coordinador puede repartir. El servidor aplica el mismo límite —
 * esto es para que la interfaz no ofrezca lo que va a rechazar.
 */
const ROLES_GESTIONABLES_COORD = ['medico', 'coach', 'auxiliar'];

interface AccesoHoja {
  app: AppDestino;
  rol: string;
  activo: boolean;
  /** No estaba antes: hay que crearlo, no editarlo. */
  nuevo?: boolean;
}

interface Hoja {
  id: number | null; // null = persona nueva
  email: string;
  nombre: string;
  documento: string;
  celular: string;
  password: string;
  accesos: AccesoHoja[];
  // Sólo Consulta: de allá cuelgan.
  esGlobal: boolean;
  sedes: string[];
  profesionalId: number | null;
  programas: string[];
}

/** Contraseña temporal legible: sin caracteres que se confundan al dictarla. */
function generarClave(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const n = new Uint32Array(12);
  crypto.getRandomValues(n);
  return Array.from(n, (v) => abc[v % abc.length]).join('');
}

type FiltroEstado = 'todos' | 'activos' | 'inhabilitados' | 'baja' | 'inconsistentes';

export function UsuariosPanelView({ showToast, reportCount }: Props) {
  const actor = authService.getUser();
  const esAdmin = actor?.role === 'admin';

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [roles, setRoles] = useState<Record<AppDestino, string[]> | null>(null);
  const [sedes, setSedes] = useState<{ sedeId: string; nombre: string }[]>([]);
  const [profesionales, setProfesionales] = useState<ProfesionalLite[]>([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [hoja, setHoja] = useState<Hoja | null>(null);

  // La ficha se edita con el modal que ya existe: es el mismo formulario, y
  // duplicarlo sería tener dos sitios donde arreglar el mismo campo.
  const [fichaEditando, setFichaEditando] = useState<Profesional | null>(null);
  const [creandoFicha, setCreandoFicha] = useState(false);
  const [dispoDe, setDispoDe] = useState<Profesional | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [filtroApp, setFiltroApp] = useState<'todas' | AppDestino>('todas');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>('todos');
  const [filtroPrograma, setFiltroPrograma] = useState<string>('todos');

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [p, r, s, prof] = await Promise.all([
        usuariosGlobalService.listar(),
        usuariosGlobalService.roles(),
        authService.getSedes().catch(() => []),
        usuariosApi.profesionales().catch(() => [] as ProfesionalLite[]),
      ]);
      setPersonas(p);
      setRoles(r);
      setSedes(s);
      setProfesionales(prof);
      reportCount?.(p.length);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setCargando(false);
    }
  }, [showToast, reportCount]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // Sedes que el actor puede asignar: un coordinador no reparte sedes ajenas.
  const sedesAsignables = useMemo(() => {
    if (esAdmin) return sedes;
    const propias = new Set(actor?.sedes ?? []);
    return sedes.filter((s) => propias.has(s.sedeId));
  }, [esAdmin, sedes, actor]);

  /** Un coordinador sólo administra Consulta, y sólo roles no privilegiados. */
  const appsVisibles = useMemo<AppDestino[]>(() => (esAdmin ? APPS : ['consulta']), [esAdmin]);
  const rolesDe = useCallback(
    (app: AppDestino) => {
      const todos = roles?.[app] ?? [];
      return esAdmin ? todos : todos.filter((r) => ROLES_GESTIONABLES_COORD.includes(r));
    },
    [roles, esAdmin],
  );

  const nombreSede = useCallback(
    (id: string) => sedes.find((s) => s.sedeId === id)?.nombre ?? id,
    [sedes],
  );

  /** Los programas de la persona, guardados en el alcance de su acceso a Consulta. */
  const programasDe = useCallback(
    (p: Persona) =>
      ((p.apps.find((a) => a.app === 'consulta')?.alcance as { programas?: string[] })?.programas ??
        []) as string[],
    [],
  );

  /** ¿Su rol en Consulta exige ficha? Si la falta, entra y no puede agendar. */
  const esClinico = useCallback(
    (p: Persona) =>
      ROLES_CLINICOS.includes(p.apps.find((a) => a.app === 'consulta')?.rol ?? ''),
    [],
  );

  /** Activa en una aplicación e inactiva en otra: la baja no llegó a todas partes. */
  const esInconsistente = useCallback(
    (p: Persona) => p.apps.some((a) => a.activo) && p.apps.some((a) => !a.activo),
    [],
  );

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return personas.filter((p) => {
      if (q && ![p.nombre, p.email, p.documento ?? ''].some((v) => v.toLowerCase().includes(q)))
        return false;
      if (filtroApp !== 'todas' && !p.apps.some((a) => a.app === filtroApp)) return false;
      if (filtroEstado === 'activos' && (!p.activo || p.baja)) return false;
      if (filtroEstado === 'inhabilitados' && p.activo) return false;
      if (filtroEstado === 'baja' && !p.baja) return false;
      if (filtroEstado === 'inconsistentes' && !esInconsistente(p)) return false;
      if (filtroPrograma !== 'todos' && !programasDe(p).includes(filtroPrograma)) return false;
      return true;
    });
  }, [personas, busqueda, filtroApp, filtroEstado, filtroPrograma, esInconsistente, programasDe]);

  const conteoInconsistentes = useMemo(
    () => personas.filter(esInconsistente).length,
    [personas, esInconsistente],
  );

  // ── Abrir la hoja ─────────────────────────────────────────────────────────
  function abrirNueva() {
    setHoja({
      id: null,
      email: '',
      nombre: '',
      documento: '',
      celular: '',
      password: generarClave(),
      accesos: [{ app: 'consulta', rol: rolesDe('consulta')[0] ?? 'coach', activo: true, nuevo: true }],
      esGlobal: false,
      sedes: [],
      profesionalId: null,
      programas: [],
    });
  }

  function abrirPersona(p: Persona) {
    const consulta = p.apps.find((a) => a.app === 'consulta');
    const alc = (consulta?.alcance ?? {}) as {
      sedes?: string[];
      esGlobal?: boolean;
      profesionalId?: number | null;
      celular?: string | null;
      programas?: string[];
    };
    setHoja({
      id: p.id,
      email: p.email,
      nombre: p.nombre,
      documento: p.documento ?? '',
      celular: alc.celular ?? '',
      password: '',
      accesos: p.apps.map((a) => ({ app: a.app, rol: a.rol, activo: a.activo })),
      esGlobal: Boolean(alc.esGlobal),
      sedes: alc.sedes ?? [],
      profesionalId: alc.profesionalId ?? null,
      programas: alc.programas ?? [],
    });
  }

  // ── Guardar ───────────────────────────────────────────────────────────────
  const tieneConsulta = hoja?.accesos.some((a) => a.app === 'consulta') ?? false;
  const rolConsulta = hoja?.accesos.find((a) => a.app === 'consulta')?.rol ?? '';
  const pideProfesional = tieneConsulta && ROLES_CLINICOS.includes(rolConsulta);

  function validar(h: Hoja): string | null {
    if (h.nombre.trim().length < 2) return 'El nombre es obligatorio.';
    if (h.accesos.length === 0) return 'Asigna al menos una aplicación.';
    if (h.id === null) {
      if (!h.email.trim()) return 'El correo es obligatorio.';
      if (h.password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    } else if (h.password && h.password.length < 8) {
      return 'La contraseña debe tener al menos 8 caracteres.';
    }
    // Sin sedes, un usuario de Consulta no ve nada: es un error silencioso.
    if (tieneConsulta && !h.esGlobal && h.sedes.length === 0) return 'Asigna al menos una sede.';
    // El servidor lo rechaza igual; decirlo acá evita el viaje y explica por qué.
    if (pideProfesional && h.profesionalId == null)
      return 'Un médico o coach debe quedar vinculado a su ficha de profesional, o su agenda sale vacía.';
    return null;
  }

  async function guardar() {
    if (!hoja) return;
    const error = validar(hoja);
    if (error) {
      showToast({ type: 'error', message: error });
      return;
    }
    setGuardando(true);
    try {
      const consultaCampos = tieneConsulta
        ? {
            sedes: hoja.esGlobal ? [] : hoja.sedes,
            esGlobal: hoja.esGlobal,
            profesionalId: pideProfesional ? hoja.profesionalId : null,
            programas: hoja.programas,
          }
        : {};

      const email = hoja.email.trim().toLowerCase();
      /** Un acceso, en la forma que espera el alta. */
      const alta = (a: AccesoHoja, conClave: boolean) => ({
        email,
        nombre: hoja.nombre.trim(),
        documento: hoja.documento.trim() || null,
        celular: hoja.celular.trim() || null,
        app: a.app,
        rol: a.rol,
        ...(conClave ? { password: hoja.password } : {}),
        ...(a.app === 'consulta' ? consultaCampos : {}),
      });

      if (hoja.id === null) {
        // El primero crea a la persona; los siguientes le agregan el acceso, y
        // el servidor le conserva la contraseña que acaba de quedar puesta.
        for (const [i, a] of hoja.accesos.entries()) {
          await usuariosGlobalService.crear(alta(a, i === 0));
        }
        showToast({
          type: 'success',
          message: `${hoja.nombre.trim()} ya puede entrar a ${hoja.accesos
            .map((a) => APP_NOMBRE[a.app])
            .join(' y ')}.`,
        });
      } else {
        const previa = personas.find((p) => p.id === hoja.id);
        const base: EditarPersona = { ...consultaCampos };
        if (hoja.nombre.trim() !== previa?.nombre) base.nombre = hoja.nombre.trim();
        if ((hoja.documento.trim() || null) !== (previa?.documento ?? null))
          base.documento = hoja.documento.trim() || null;
        if (hoja.password) base.password = hoja.password;
        // Sólo si CAMBIÓ: puede venir en blanco por no estar reflejado todavía,
        // y mandarlo así borraría el número al que llega el informe diario.
        const celularPrevio =
          ((previa?.apps.find((x) => x.app === 'consulta')?.alcance as { celular?: string | null })
            ?.celular ?? '') || '';
        if (tieneConsulta && hoja.celular.trim() !== celularPrevio)
          base.celular = hoja.celular.trim() || null;
        if (Object.keys(base).length > 0) await usuariosGlobalService.editar(hoja.id, base);

        // Un PATCH por acceso cambiado; los nuevos entran por el alta, que a
        // quien ya existe le agrega el acceso sin tocarle la contraseña.
        for (const a of hoja.accesos) {
          const antes = previa?.apps.find((x) => x.app === a.app);
          if (a.nuevo || !antes) {
            await usuariosGlobalService.crear(alta(a, false));
          } else if (antes.rol !== a.rol || antes.activo !== a.activo) {
            await usuariosGlobalService.editar(hoja.id, {
              app: a.app,
              rol: a.rol,
              accesoActivo: a.activo,
            });
          }
        }
        showToast({ type: 'success', message: 'Cambios guardados.' });
      }
      setHoja(null);
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    } finally {
      setGuardando(false);
    }
  }

  /** Trae la ficha completa: la lista sólo carga lo justo para pintarla. */
  async function abrirFicha(idFicha: number, modo: 'editar' | 'disponibilidad') {
    try {
      const p = await profesionalesService.getById(idFicha);
      if (modo === 'editar') setFichaEditando(p);
      else setDispoDe(p);
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'No se pudo abrir la ficha' });
    }
  }

  // ── Acciones de fila ──────────────────────────────────────────────────────
  /**
   * Encender o apagar la cuenta. Hay DOS interruptores —la persona y su acceso a
   * cada aplicación— y el login exige los dos; encender sólo el de arriba deja
   * un botón que parece funcionar y no cambia nada. Así que al habilitar a
   * alguien cuyos accesos están TODOS apagados, se encienden también: si alguno
   * quedó activo a propósito, los demás no se tocan.
   *
   * Al inhabilitar basta con apagar la persona: los accesos se conservan como
   * estaban, para que al volver quede como antes.
   */
  async function alternarActivo(p: Persona) {
    const apagados = p.apps.length > 0 && p.apps.every((a) => !a.activo);
    const reviveAccesos = !p.activo && apagados;
    const pregunta = p.activo
      ? `¿Inhabilitar a ${p.nombre}?`
      : reviveAccesos
        ? `¿Habilitar a ${p.nombre}?\n\nVolverá a entrar a ${p.apps
            .map((a) => APP_NOMBRE[a.app])
            .join(' y ')}.`
        : `¿Habilitar a ${p.nombre}?`;
    if (!window.confirm(pregunta)) return;
    try {
      await usuariosGlobalService.editar(p.id, { activo: !p.activo });
      if (reviveAccesos) {
        for (const a of p.apps) {
          await usuariosGlobalService.editar(p.id, { app: a.app, rol: a.rol, accesoActivo: true });
        }
      }
      showToast({
        type: 'success',
        message: `${p.nombre} ${p.activo ? 'inhabilitado' : 'habilitado'}.`,
      });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  async function alternarBaja(p: Persona) {
    if (p.baja) {
      if (!window.confirm(`¿Devolverle el acceso a ${p.nombre}?\n\nVolverá a entrar donde tenga cuenta activa.`))
        return;
      try {
        await usuariosGlobalService.baja(p.id, false);
        showToast({ type: 'success', message: 'Acceso restablecido.' });
        await cargar();
      } catch (e) {
        showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
      }
      return;
    }
    const motivo = window.prompt(
      `Dar de baja a ${p.nombre} de TODA la organización.\n\n` +
        'Deja de poder entrar a las tres aplicaciones, no sólo a una.\n' +
        'Se puede revertir.\n\nMotivo (opcional):',
    );
    if (motivo === null) return;
    try {
      await usuariosGlobalService.baja(p.id, true, motivo.trim() || null);
      showToast({ type: 'success', message: `${p.nombre} ya no entra a ninguna aplicación.` });
      await cargar();
    } catch (e) {
      showToast({ type: 'error', message: e instanceof Error ? e.message : 'Error' });
    }
  }

  const appsLibres = hoja
    ? appsVisibles.filter((a) => !hoja.accesos.some((x) => x.app === a))
    : [];

  return (
    <div style={{ fontFamily: FONT_INTER }}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <UserPlus className="w-[18px] h-[18px] text-[#1e3a8a]" />
          <h1 className="text-[19px] font-semibold text-zinc-900">Team</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={cargar}
            className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <RefreshCw className={`w-[13px] h-[13px] ${cargando ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
          <button
            onClick={() => setCreandoFicha(true)}
            className="inline-flex items-center gap-1.5 h-[30px] px-2.5 border border-zinc-300 rounded-md text-[12.5px] text-zinc-700 hover:bg-zinc-50"
          >
            <ClipboardList className="w-[13px] h-[13px]" />
            Nuevo profesional
          </button>
          <button onClick={abrirNueva} className={CTA_PRIMARY}>
            <UserPlus className="w-[14px] h-[14px]" />
            Nuevo usuario
          </button>
        </div>
      </div>

      <div className="text-[12.5px] text-zinc-600 mb-4 max-w-[74ch] leading-relaxed">
        Los usuarios de las tres aplicaciones, en un solo lugar. La{' '}
        <strong>aplicación y el rol</strong> deciden a qué panel llega la persona al iniciar
        sesión. <strong>Dar de baja</strong> la saca de las tres a la vez.
      </div>

      {/* Buscar y filtrar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative">
          <Search className="w-[14px] h-[14px] text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, correo o cédula"
            className="h-[32px] w-[268px] pl-8 pr-3 bg-white border border-zinc-300 rounded-md text-[12.5px] focus:outline-none focus:border-[#1f3a8a]"
          />
        </div>
        {esAdmin && (
          <Segmento
            valor={filtroApp}
            onChange={(v) => setFiltroApp(v as 'todas' | AppDestino)}
            opciones={[
              { v: 'todas', t: 'Todas' },
              ...APPS.map((a) => ({ v: a, t: APP_NOMBRE[a] })),
            ]}
          />
        )}
        <Segmento
          valor={filtroEstado}
          onChange={(v) => setFiltroEstado(v as FiltroEstado)}
          opciones={[
            { v: 'todos', t: 'Todos' },
            { v: 'activos', t: 'Activos' },
            { v: 'inhabilitados', t: 'Inhabilitados' },
            ...(esAdmin ? [{ v: 'baja', t: 'De baja' }] : []),
            ...(conteoInconsistentes > 0
              ? [{ v: 'inconsistentes', t: `Inconsistentes · ${conteoInconsistentes}` }]
              : []),
          ]}
        />
        <Segmento
          valor={filtroPrograma}
          onChange={setFiltroPrograma}
          opciones={[{ v: 'todos', t: 'Todo programa' }, ...PROGRAMAS.map((p) => ({ v: p.v, t: p.t }))]}
        />
        <span className="text-[11.5px] text-zinc-400 ml-auto" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {visibles.length} de {personas.length}
        </span>
      </div>

      {conteoInconsistentes > 0 && filtroEstado !== 'inconsistentes' && (
        <div className="flex items-start gap-2 mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-[12.5px] text-amber-900 leading-relaxed">
            {conteoInconsistentes === 1
              ? 'Hay 1 persona activa en una aplicación e inactiva en otra.'
              : `Hay ${conteoInconsistentes} personas activas en una aplicación e inactivas en otra.`}{' '}
            Si se les dio de baja, la baja no llegó a todas partes: siguen pudiendo entrar por donde
            quedaron activas.
          </div>
        </div>
      )}

      <div className="border border-zinc-200 rounded-lg overflow-x-auto bg-white">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200">
              {['Persona', 'Correo', 'Accesos', 'Ficha de agenda', 'A dónde entra', ''].map((h) => (
                <th key={h} className={`px-3 py-2 text-left ${SECTION_LABEL}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibles.length === 0 && !cargando && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-400">
                  {personas.length === 0 ? 'Sin usuarios todavía.' : 'Nadie coincide con la búsqueda.'}
                </td>
              </tr>
            )}
            {visibles.map((p) => {
              const consulta = p.apps.find((a) => a.app === 'consulta');
              const alc = (consulta?.alcance ?? {}) as { sedes?: string[]; esGlobal?: boolean };
              return (
                <tr
                  key={p.id}
                  className={`border-b border-zinc-100 last:border-0 ${
                    p.baja
                      ? 'bg-red-50/50'
                      : esInconsistente(p)
                        ? 'bg-amber-50/40'
                        : p.activo
                          ? 'hover:bg-zinc-50/60'
                          : 'bg-zinc-50/60'
                  }`}
                >
                  <td className="px-3 py-2 align-top">
                    <button
                      onClick={() => abrirPersona(p)}
                      className={`text-left ${p.activo && !p.baja ? 'text-zinc-900 hover:text-[#1f3a8a]' : 'text-zinc-400 line-through'}`}
                    >
                      {p.nombre}
                    </button>
                    {p.documento && (
                      <div className="text-[10.5px] text-zinc-400 mt-0.5" style={{ fontFamily: FONT_MONO }}>
                        {p.documento}
                      </div>
                    )}
                    {p.baja && (
                      <div className="text-[10.5px] text-red-700 mt-0.5">
                        de baja{p.baja.motivo ? ` · ${p.baja.motivo}` : ''}
                      </div>
                    )}
                    {programasDe(p).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {programasDe(p).map((v) => {
                          const meta = PROGRAMAS.find((x) => x.v === v);
                          return (
                            <span
                              key={v}
                              className={`px-1.5 py-0.5 rounded border text-[10px] ${meta?.cls ?? 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}
                            >
                              {meta?.t ?? v}
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-zinc-600" style={{ fontFamily: FONT_MONO }}>
                    {p.email}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {p.apps.length === 0 ? (
                      <span className="text-zinc-300">sin acceso</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {p.apps.map((a) => (
                          <span
                            key={a.app}
                            title={a.activo ? 'Puede entrar' : 'Desactivada'}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] border ${
                              a.activo
                                ? 'bg-green-50 text-green-800 border-green-200'
                                : 'bg-zinc-100 text-zinc-400 border-zinc-200 line-through'
                            }`}
                          >
                            {APP_NOMBRE[a.app]}
                            <span className="opacity-70">· {a.rol}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {p.activo && !p.baja && p.apps.length > 0 && p.apps.every((a) => !a.activo) && (
                      <div className="text-[10.5px] text-amber-700 mt-1">
                        activa, pero sin acceso a ninguna aplicación: no entra
                      </div>
                    )}
                    {consulta && (
                      <div className="text-[10.5px] text-zinc-400 mt-1">
                        {alc.esGlobal
                          ? 'Todas las sedes'
                          : (alc.sedes ?? []).map(nombreSede).join(', ') || (
                              <span className="text-amber-700">sin sedes</span>
                            )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top">
                    {p.ficha ? (
                      <button
                        onClick={() => abrirFicha(p.ficha!.id, 'editar')}
                        className="text-left text-[11.5px] text-zinc-700 hover:text-[#1f3a8a]"
                      >
                        <span style={{ fontFamily: FONT_MONO }}>{p.ficha.codigo}</span>
                        <div className="text-[10.5px] text-zinc-400">
                          {p.ficha.especialidad || p.ficha.rol}
                        </div>
                      </button>
                    ) : esClinico(p) ? (
                      <span className="text-[11px] text-amber-700">
                        sin ficha: no puede agendar
                      </span>
                    ) : (
                      <span className="text-zinc-300 text-[11.5px]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 align-top text-zinc-500 text-[11.5px] max-w-[26ch]">
                    {p.apps.map((a) => DESTINO[`${a.app}:${a.rol}`]).filter(Boolean).join(' · ') ||
                      (p.ficha && p.apps.length === 0 ? (
                        <span className="text-amber-700">tiene ficha, no tiene cuenta: no entra</span>
                      ) : (
                        '—'
                      ))}
                  </td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-0.5">
                      {p.id > 0 && (
                        <IconoAccion titulo="Editar" onClick={() => abrirPersona(p)}>
                          <Pencil className="w-[14px] h-[14px]" />
                        </IconoAccion>
                      )}
                      {p.ficha && (
                        <IconoAccion
                          titulo="Ficha de agenda"
                          onClick={() => abrirFicha(p.ficha!.id, 'editar')}
                        >
                          <ClipboardList className="w-[14px] h-[14px]" />
                        </IconoAccion>
                      )}
                      {p.ficha && (
                        <IconoAccion
                          titulo="Disponibilidad"
                          onClick={() => abrirFicha(p.ficha!.id, 'disponibilidad')}
                        >
                          <CalendarClock className="w-[14px] h-[14px]" />
                        </IconoAccion>
                      )}
                      {p.id > 0 && (
                        <IconoAccion
                          titulo={p.activo ? 'Inhabilitar' : 'Habilitar'}
                          onClick={() => alternarActivo(p)}
                        >
                          <Power className="w-[14px] h-[14px]" />
                        </IconoAccion>
                      )}
                      {esAdmin && p.id > 0 && (
                        <IconoAccion
                          titulo={p.baja ? 'Reactivar en la organización' : 'Dar de baja de la organización'}
                          peligro={!p.baja}
                          onClick={() => alternarBaja(p)}
                        >
                          <UserMinus className="w-[14px] h-[14px]" />
                        </IconoAccion>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Ficha de agenda: el mismo modal de siempre, reusado. Crear ficha es
          además el camino que da de alta a la persona en el directorio y le
          arma la cuenta, todo en un paso. */}
      <ProfesionalFormModal
        isOpen={creandoFicha || fichaEditando !== null}
        editing={fichaEditando}
        onClose={() => {
          setCreandoFicha(false);
          setFichaEditando(null);
        }}
        onSaved={() => {
          setCreandoFicha(false);
          setFichaEditando(null);
          cargar();
        }}
        onError={(m) => showToast({ type: 'error', message: m })}
      />

      {dispoDe && (
        <DisponibilidadModal
          isOpen
          profesional={dispoDe}
          onClose={() => setDispoDe(null)}
          onSaved={() => setDispoDe(null)}
          onError={(m) => showToast({ type: 'error', message: m })}
        />
      )}

      {/* ── Hoja de la persona ───────────────────────────────────────────── */}
      {hoja && (
        <Modal
          title={hoja.id === null ? 'Nuevo usuario' : hoja.nombre || 'Usuario'}
          onClose={() => setHoja(null)}
        >
          <div className="space-y-3.5">
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Nombre">
                <input
                  autoFocus
                  value={hoja.nombre}
                  onChange={(e) => setHoja({ ...hoja, nombre: e.target.value })}
                  placeholder="Ana Pérez"
                  className={INPUT}
                />
              </Campo>
              <Campo etiqueta="Correo">
                <input
                  type="email"
                  value={hoja.email}
                  disabled={hoja.id !== null}
                  onChange={(e) => setHoja({ ...hoja, email: e.target.value })}
                  placeholder="ana.perez@bodytechcorp.com"
                  className={`${INPUT} ${hoja.id !== null ? 'bg-zinc-100 text-zinc-500' : ''}`}
                />
              </Campo>
              <Campo etiqueta="Celular (opcional)">
                <input
                  type="tel"
                  value={hoja.celular}
                  onChange={(e) => setHoja({ ...hoja, celular: e.target.value })}
                  placeholder="+57 300 123 4567"
                  className={INPUT}
                />
              </Campo>
              <Campo etiqueta="Cédula (opcional)">
                <input
                  inputMode="numeric"
                  value={hoja.documento}
                  onChange={(e) => setHoja({ ...hoja, documento: e.target.value.replace(/\D/g, '') })}
                  placeholder="1015420891"
                  className={INPUT}
                />
              </Campo>
              <Campo etiqueta={hoja.id === null ? 'Contraseña temporal' : 'Cambiar contraseña (opcional)'}>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={hoja.password}
                    onChange={(e) => setHoja({ ...hoja, password: e.target.value })}
                    placeholder={hoja.id === null ? 'mínimo 8 caracteres' : 'dejar en blanco = sin cambio'}
                    className={INPUT}
                    style={{ fontFamily: FONT_MONO }}
                  />
                  <button
                    type="button"
                    title="Generar una contraseña"
                    onClick={() => setHoja({ ...hoja, password: generarClave() })}
                    className="shrink-0 h-[32px] px-2 border border-zinc-300 rounded-md text-zinc-500 hover:text-zinc-800 hover:bg-zinc-50"
                  >
                    <Dices className="w-[14px] h-[14px]" />
                  </button>
                </div>
              </Campo>
            </div>

            {/* Accesos */}
            <div className="pt-3 border-t border-zinc-100">
              <div className={`mb-2 ${SECTION_LABEL}`}>Accesos</div>
              <div className="space-y-1.5">
                {hoja.accesos.map((a, i) => (
                  <div key={a.app} className="flex items-center gap-2">
                    <span className="text-[12.5px] text-zinc-700 w-[86px] shrink-0">
                      {APP_NOMBRE[a.app]}
                    </span>
                    <select
                      value={a.rol}
                      onChange={(e) => {
                        const accesos = [...hoja.accesos];
                        accesos[i] = { ...a, rol: e.target.value };
                        setHoja({ ...hoja, accesos });
                      }}
                      className="h-[28px] px-2 border border-zinc-300 rounded text-[12.5px] bg-white"
                    >
                      {(rolesDe(a.app).length > 0 ? rolesDe(a.app) : [a.rol]).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-1.5 text-[12px] text-zinc-600">
                      <input
                        type="checkbox"
                        checked={a.activo}
                        onChange={(e) => {
                          const accesos = [...hoja.accesos];
                          accesos[i] = { ...a, activo: e.target.checked };
                          setHoja({ ...hoja, accesos });
                        }}
                      />
                      activo
                    </label>
                    {a.nuevo && hoja.accesos.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setHoja({ ...hoja, accesos: hoja.accesos.filter((_, j) => j !== i) })
                        }
                        className="p-0.5 text-zinc-300 hover:text-red-700"
                        aria-label={`Quitar ${APP_NOMBRE[a.app]}`}
                      >
                        <X className="w-[13px] h-[13px]" />
                      </button>
                    )}
                    <span className="text-[11px] text-zinc-400 truncate">
                      {DESTINO[`${a.app}:${a.rol}`]}
                    </span>
                  </div>
                ))}
              </div>
              {appsLibres.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const app = e.target.value as AppDestino;
                    if (!app) return;
                    setHoja({
                      ...hoja,
                      accesos: [
                        ...hoja.accesos,
                        { app, rol: rolesDe(app)[0] ?? 'admin', activo: true, nuevo: true },
                      ],
                    });
                  }}
                  className="mt-2 h-[28px] px-2 border border-dashed border-zinc-300 rounded text-[12px] text-zinc-500 bg-white"
                >
                  <option value="">+ Agregar acceso a otra aplicación</option>
                  {appsLibres.map((a) => (
                    <option key={a} value={a}>
                      {APP_NOMBRE[a]}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Lo propio de Consulta */}
            {tieneConsulta && (
              <div className="pt-3 border-t border-zinc-100 space-y-3">
                <div className={SECTION_LABEL}>Consulta · alcance</div>
                {pideProfesional && (
                  <Campo etiqueta="Vincular a su ficha de profesional">
                    <select
                      value={hoja.profesionalId ?? ''}
                      onChange={(e) => {
                        const pid = e.target.value ? Number(e.target.value) : null;
                        const prof = profesionales.find((x) => x.id === pid);
                        setHoja({
                          ...hoja,
                          profesionalId: pid,
                          nombre: prof && !hoja.nombre.trim() ? prof.nombre : hoja.nombre,
                          sedes:
                            prof?.sedeId && hoja.sedes.length === 0 ? [prof.sedeId] : hoja.sedes,
                        });
                      }}
                      className={INPUT}
                    >
                      <option value="">— Sin vincular —</option>
                      {profesionales
                        .filter((x) => x.rol === (rolConsulta as Role))
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre} · {x.codigo}
                          </option>
                        ))}
                    </select>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      Sin ficha, su agenda sale vacía y no puede agendar.
                    </p>
                  </Campo>
                )}
                <Campo etiqueta="Programa">
                  <div className="flex flex-wrap gap-1.5">
                    {PROGRAMAS.map((pr) => {
                      const puesto = hoja.programas.includes(pr.v);
                      return (
                        <button
                          key={pr.v}
                          type="button"
                          onClick={() =>
                            setHoja({
                              ...hoja,
                              programas: puesto
                                ? hoja.programas.filter((x) => x !== pr.v)
                                : [...hoja.programas, pr.v],
                            })
                          }
                          className={`px-2 py-1 rounded border text-[11.5px] ${
                            puesto ? pr.cls : 'bg-white text-zinc-400 border-zinc-200'
                          }`}
                        >
                          {pr.t}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-1">
                    A qué línea pertenece. Puede ser más de una.
                  </p>
                </Campo>
                {esAdmin && (
                  <label className="flex items-center gap-2 text-[12.5px] text-zinc-700">
                    <input
                      type="checkbox"
                      checked={hoja.esGlobal}
                      onChange={(e) => setHoja({ ...hoja, esGlobal: e.target.checked })}
                    />
                    Acceso a todas las sedes
                  </label>
                )}
                {!hoja.esGlobal && (
                  <Campo etiqueta="Sedes">
                    <div className="max-h-36 overflow-y-auto border border-zinc-200 rounded-md p-2 grid grid-cols-2 gap-y-1">
                      {sedesAsignables.length === 0 ? (
                        <p className="text-[12px] text-zinc-400 px-1">No tienes sedes asignables.</p>
                      ) : (
                        sedesAsignables.map((s) => (
                          <label key={s.sedeId} className="flex items-center gap-2 text-[12.5px] px-1">
                            <input
                              type="checkbox"
                              checked={hoja.sedes.includes(s.sedeId)}
                              onChange={() =>
                                setHoja({
                                  ...hoja,
                                  sedes: hoja.sedes.includes(s.sedeId)
                                    ? hoja.sedes.filter((x) => x !== s.sedeId)
                                    : [...hoja.sedes, s.sedeId],
                                })
                              }
                            />
                            {s.nombre}
                          </label>
                        ))
                      )}
                    </div>
                  </Campo>
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setHoja(null)} className={CTA_OUTLINE} disabled={guardando}>
              Cancelar
            </button>
            <button onClick={guardar} className={CTA_PRIMARY} disabled={guardando}>
              {guardando ? 'Guardando…' : hoja.id === null ? 'Crear usuario' : 'Guardar'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const INPUT =
  'h-[32px] w-full px-3 bg-white border border-zinc-300 rounded-md text-[13px] text-zinc-800 focus:outline-none focus:border-[#1f3a8a]';

function Campo({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block mb-1.5 ${SECTION_LABEL}`}>{etiqueta}</label>
      {children}
    </div>
  );
}

function IconoAccion({
  titulo,
  onClick,
  peligro,
  children,
}: {
  titulo: string;
  onClick: () => void;
  peligro?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className={`p-1.5 rounded text-zinc-400 hover:bg-zinc-100 ${
        peligro ? 'hover:text-red-700 hover:bg-red-50' : 'hover:text-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

function Segmento({
  valor,
  onChange,
  opciones,
}: {
  valor: string;
  onChange: (v: string) => void;
  opciones: { v: string; t: string }[];
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-zinc-300 overflow-hidden bg-white">
      {opciones.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={`h-[30px] px-2.5 text-[12px] border-r border-zinc-200 last:border-r-0 ${
            valor === o.v ? 'bg-[#eef2ff] text-[#1f3a8a] font-medium' : 'text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          {o.t}
        </button>
      ))}
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
      className="fixed inset-0 bg-black/30 flex items-start justify-center p-4 z-50 overflow-y-auto"
      onClick={onClose}
      style={{ fontFamily: FONT_INTER }}
    >
      <div
        className="bg-white rounded-xl shadow-lg border border-zinc-200 w-full max-w-2xl p-6 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-zinc-400 hover:text-zinc-800" aria-label="Cerrar">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

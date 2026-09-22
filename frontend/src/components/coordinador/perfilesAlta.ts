// ============================================================================
// perfilesAlta — "¿Qué va a hacer esta persona?", y qué implica eso.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// El alta pedía, en una sola pantalla y sin jerarquía: el rol de la ficha
// (médico / coach / nutricionista / fisio / evaluador / administrativo), la
// aplicación, OTRO rol —el de la cuenta—, las sedes, "todas las sedes", y unos
// botones sueltos que decían "Trepsi · UMV · Corporativo · Nativa". Son cinco
// decisiones acopladas entre sí que sólo entiende quien conoce la base: un
// coach de nutrición SIEMPRE es ficha `coach` + cuenta `consulta:coach` +
// programa `trepsi` + sede `bdt-nutricion`, pero eso había que saberlo.
//
// Acá se elige UNA cosa —el oficio, con el mismo vocabulario del Mapa de
// Rutas— y de ahí salen las cinco. Lo que queda por preguntar es lo que de
// verdad cambia entre dos personas del mismo oficio: quién es, su correo y,
// cuando el oficio no lo fija, a qué sedes llega.
//
// Funciones y datos PUROS: no tocan red ni estado. La pantalla los consume.
// ============================================================================

import type { RolDirectorio } from '../../services/profesionales.service';

export type AppDestino = 'consulta' | 'acc' | 'prepagadas';

export type PerfilId =
  | 'coach-nutricion'
  | 'umv'
  | 'medico-corporativo'
  | 'nutricion-presencial'
  | 'acc'
  | 'coordinacion'
  | 'auxiliar'
  | 'admin'
  | 'manual';

export interface Preset {
  /** Rol con el que la persona queda en el directorio compartido. */
  rolFicha: RolDirectorio;
  /** A qué aplicación entra. `null` = queda en el directorio, sin cuenta. */
  app: AppDestino | null;
  /** Rol dentro de esa aplicación (lo que puede hacer al entrar). */
  rolApp: string;
  /** Línea de atención, mismo vocabulario que el `origen` de las citas. */
  programas: string[];
  /** Sedes de la cuenta de Consulta. Vacío + `esGlobal` = todas. */
  sedes: string[];
  esGlobal: boolean;
  /**
   * Sede donde queda la FICHA de agenda. Es distinta del alcance de la cuenta:
   * la ficha vive en una sola sede (UNIQUE codigo+sede) y, sin esto, quedaba
   * en la sede de quien estuviera creando, que casi nunca es la correcta.
   */
  sedeFicha: string | null;
}

export interface Perfil {
  id: PerfilId;
  /** El oficio, como lo diría un coordinador. */
  titulo: string;
  /** Qué hace la persona. Una línea, sin jerga. */
  hace: string;
  grupo: 'atiende' | 'gestiona' | 'otro';
  /** Aviso cuando el oficio tiene una particularidad que hay que saber. */
  nota?: string;
  preset: Preset;
}

/** Los médicos y coaches son los únicos con agenda propia en Consulta. */
export const ROLES_CON_AGENDA: ReadonlyArray<RolDirectorio> = ['medico', 'coach'];

export function tieneAgenda(rol: RolDirectorio): boolean {
  return (ROLES_CON_AGENDA as readonly string[]).includes(rol);
}

export const PERFILES: Perfil[] = [
  {
    id: 'coach-nutricion',
    titulo: 'Coach de nutrición',
    hace: 'Atiende por videollamada las consultas de nutrición que crea Trepsi.',
    grupo: 'atiende',
    preset: {
      rolFicha: 'coach',
      app: 'consulta',
      rolApp: 'coach',
      programas: ['trepsi'],
      sedes: ['bdt-nutricion'],
      esGlobal: false,
      sedeFicha: 'bdt-nutricion',
    },
  },
  {
    id: 'umv',
    titulo: 'Unidad Médica Virtual',
    hace: 'Atiende por videollamada con el panel de historia médica.',
    grupo: 'atiende',
    preset: {
      rolFicha: 'medico',
      app: 'consulta',
      rolApp: 'medico',
      programas: ['umv'],
      sedes: ['bsl'],
      esGlobal: false,
      sedeFicha: 'bsl',
    },
  },
  {
    id: 'medico-corporativo',
    titulo: 'Médico corporativo',
    hace: 'Va a la empresa y hace la valoración en persona, sin videollamada.',
    grupo: 'atiende',
    preset: {
      rolFicha: 'medico',
      app: 'consulta',
      rolApp: 'medico',
      programas: ['corporativo'],
      sedes: ['corporativo'],
      esGlobal: false,
      sedeFicha: 'corporativo',
    },
  },
  {
    id: 'nutricion-presencial',
    titulo: 'Nutrición presencial',
    hace: 'Atiende en la sede, en persona y sin videollamada.',
    grupo: 'atiende',
    nota: 'Hoy estas nutricionistas entran por la aplicación de ACC; en Consulta no tienen agenda.',
    preset: {
      rolFicha: 'nutricionista',
      app: 'acc',
      rolApp: 'fisioterapeuta',
      programas: [],
      sedes: [],
      esGlobal: false,
      sedeFicha: null,
    },
  },
  {
    id: 'acc',
    titulo: 'Fisio o nutri de ACC',
    hace: 'Atiende a los afiliados de su ciudad desde la aplicación de ACC.',
    grupo: 'atiende',
    preset: {
      rolFicha: 'fisioterapeuta',
      app: 'acc',
      rolApp: 'fisioterapeuta',
      programas: [],
      sedes: [],
      esGlobal: false,
      sedeFicha: null,
    },
  },
  {
    id: 'coordinacion',
    titulo: 'Coordinación',
    hace: 'Agenda, reasigna horas y revisa los tableros de las sedes que le toquen.',
    grupo: 'gestiona',
    preset: {
      rolFicha: 'administrativo',
      app: 'consulta',
      rolApp: 'coordinador',
      programas: [],
      sedes: [],
      esGlobal: false,
      sedeFicha: null,
    },
  },
  {
    id: 'auxiliar',
    titulo: 'Auxiliar de órdenes',
    hace: 'Solo entra al panel de órdenes médicas.',
    grupo: 'gestiona',
    preset: {
      rolFicha: 'administrativo',
      app: 'consulta',
      rolApp: 'auxiliar',
      programas: [],
      sedes: [],
      esGlobal: false,
      sedeFicha: null,
    },
  },
  {
    id: 'admin',
    titulo: 'Administrador',
    hace: 'Ve y puede todo, en todas las sedes.',
    grupo: 'gestiona',
    preset: {
      rolFicha: 'administrativo',
      app: 'consulta',
      rolApp: 'admin',
      programas: [],
      sedes: [],
      esGlobal: true,
      sedeFicha: null,
    },
  },
  {
    id: 'manual',
    titulo: 'Otro caso',
    hace: 'Elegir a mano el rol, la aplicación, el programa y las sedes.',
    grupo: 'otro',
    preset: {
      rolFicha: 'medico',
      app: 'consulta',
      rolApp: 'medico',
      programas: [],
      sedes: [],
      esGlobal: false,
      sedeFicha: null,
    },
  },
];

export function perfilPorId(id: PerfilId): Perfil {
  return PERFILES.find((p) => p.id === id) ?? PERFILES[PERFILES.length - 1];
}

/** Roles válidos de cada aplicación. Espeja `ROLES_POR_APP` del backend. */
export const ROLES_APP: Record<AppDestino, string[]> = {
  consulta: ['medico', 'coach', 'auxiliar', 'coordinador', 'admin', 'torre'],
  acc: ['fisioterapeuta', 'admin'],
  prepagadas: ['profesional', 'asesor', 'admin'],
};

/** Las líneas de atención, con el nombre que usa la gente. */
export const PROGRAMAS: { v: string; t: string }[] = [
  { v: 'trepsi', t: 'Trepsi' },
  { v: 'umv', t: 'UMV' },
  { v: 'corporativo', t: 'Corporativo' },
  { v: 'mybodytech', t: 'MyBodytech' },
  { v: 'nativa', t: 'Agenda propia' },
];

/**
 * ¿Hay que preguntar las sedes? Sólo cuando el oficio no las fija y la cuenta
 * es de Consulta, que es la única aplicación donde el alcance es por sede.
 */
export function pideSedes(p: Preset): boolean {
  return p.app === 'consulta' && !p.esGlobal && p.sedes.length === 0;
}

/**
 * Lo que la persona va a poder hacer, en una frase por línea. Es el resumen
 * que se muestra antes de crear: quien da el alta tiene que poder leer en
 * castellano lo que acaba de armar, sin traducir roles ni banderas.
 */
export function resumenAlta(
  preset: Preset,
  opciones: {
    nombre: string;
    correo: string;
    /** Nombre legible de cada sede elegida, ya resuelto por la pantalla. */
    sedesElegidas: string[];
    codigo: string;
  },
): string[] {
  const out: string[] = [];
  const quien = opciones.nombre.trim() || 'La persona';

  if (!preset.app) {
    out.push(`${quien} queda en el directorio, sin cuenta para entrar.`);
    return out;
  }

  const donde =
    preset.app === 'consulta' ? 'Consulta' : preset.app === 'acc' ? 'ACC' : 'Prepagadas';
  out.push(
    opciones.correo.trim()
      ? `${quien} entra a ${donde} con ${opciones.correo.trim()} y la clave de abajo.`
      : `${quien} queda sin cuenta: falta el correo. Se le puede crear después.`,
  );

  if (tieneAgenda(preset.rolFicha)) {
    out.push(
      `Tiene agenda propia${opciones.codigo ? ` con el código ${opciones.codigo}` : ''}: se le pueden asignar horas y citas.`,
    );
  } else {
    out.push('No tiene agenda en Consulta: no se le asignan citas acá.');
  }

  if (preset.app === 'consulta') {
    out.push(
      preset.esGlobal
        ? 'Ve todas las sedes.'
        : `Ve ${opciones.sedesElegidas.length ? opciones.sedesElegidas.join(', ') : 'las sedes que elijas'}.`,
    );
  }

  if (preset.programas.length) {
    const nombres = preset.programas.map(
      (v) => PROGRAMAS.find((p) => p.v === v)?.t ?? v,
    );
    out.push(`Queda marcada en ${nombres.join(' y ')}, que es de donde le llegan las citas.`);
  }

  return out;
}

// ============================================================================
// bodyvibe-tema.service — La apariencia configurable de la plataforma.
//
// Es la puerta 2 de BodyVibeTech: cambiar cómo se ve lo que YA existe. Y es
// también el ejemplo original que motivó el proyecto ("quiero cambiar el color
// de los paneles de médico").
//
// Decisión 07: en el panel médico solo se permite apariencia, desde una PALETA
// PREAPROBADA y no un selector libre de color. La razón no es estética: ese
// panel comparte pantalla con una consulta en vivo y produce un documento
// legal. Alguien con buen gusto y mala suerte deja un texto gris claro sobre
// fondo blanco y un médico lee mal una tensión arterial.
//
// Por eso acá no hay elección libre de colores. Hay paletas completas, cada una
// verificada contra el estándar de contraste WCAG AA, y la verificación corre
// como test — no como buena intención.
// ============================================================================

import postgresService from './postgres.service';

export interface Paleta {
  id: string;
  nombre: string;
  descripcion: string;
  /** Sobrescrituras de las variables CSS del panel médico (`--p-*`). */
  tokens: Record<string, string>;
}

/** Pares (texto, fondo) que toda paleta debe superar para ser usable. */
export const PARES_CONTRASTE: [string, string][] = [
  ['--p-text', '--p-surface'],
  ['--p-text', '--p-bg'],
  ['--p-text-2', '--p-surface'],
];

/** Mínimo WCAG AA para texto normal. */
export const CONTRASTE_MINIMO = 4.5;

// ---------------------------------------------------------------------------
// Contraste (WCAG 2.1). Se calcula acá, del lado del servidor, para que ninguna
// paleta pueda entrar sin pasar por esta puerta.
// ---------------------------------------------------------------------------

function aRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminancia relativa según WCAG 2.1. */
function luminancia(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contraste(hexA: string, hexB: string): number | null {
  const a = aRgb(hexA);
  const b = aRgb(hexB);
  if (!a || !b) return null;
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

export interface ProblemaContraste {
  texto: string;
  fondo: string;
  ratio: number | null;
}

/** Devuelve los pares que no llegan al mínimo. Vacío = la paleta es usable. */
export function verificarContraste(tokens: Record<string, string>): ProblemaContraste[] {
  const problemas: ProblemaContraste[] = [];
  for (const [texto, fondo] of PARES_CONTRASTE) {
    const c = contraste(tokens[texto] ?? '', tokens[fondo] ?? '');
    if (c === null || c < CONTRASTE_MINIMO) {
      problemas.push({ texto, fondo, ratio: c });
    }
  }
  return problemas;
}

// ---------------------------------------------------------------------------
// Las paletas. Completas y coherentes: se elige una, no se arman colores
// sueltos. Cada una pasa `verificarContraste` — y hay un test que lo comprueba,
// para que agregar una paleta ilegible no sea posible sin que falle el build.
// ---------------------------------------------------------------------------

export const PALETAS: Paleta[] = [
  {
    id: 'bodytech',
    nombre: 'Bodytech',
    descripcion: 'La de siempre. Fondos claros, azul tinta, texto casi negro.',
    tokens: {
      '--p-bg': '#fafaf9',
      '--p-bg-2': '#f4f4f5',
      '--p-surface': '#ffffff',
      '--p-surface-2': '#fafaf9',
      '--p-line': '#e4e4e7',
      '--p-text': '#18181b',
      '--p-text-2': '#52525b',
      '--p-violet': '#1f3a8a',
      '--p-violet-2': '#1e3a8a',
    },
  },
  {
    id: 'sobria',
    nombre: 'Sobria',
    descripcion: 'Sin color de acento fuerte. Para quien prefiere leer sin ruido.',
    tokens: {
      '--p-bg': '#f7f7f8',
      '--p-bg-2': '#efeff1',
      '--p-surface': '#ffffff',
      '--p-surface-2': '#f7f7f8',
      '--p-line': '#e0e0e3',
      '--p-text': '#1a1a1d',
      '--p-text-2': '#4b4b52',
      '--p-violet': '#3f3f46',
      '--p-violet-2': '#52525b',
    },
  },
  {
    id: 'contraste',
    nombre: 'Alto contraste',
    descripcion:
      'Texto más oscuro y bordes más marcados. Útil en consultorios con mucha luz o pantallas viejas.',
    tokens: {
      '--p-bg': '#ffffff',
      '--p-bg-2': '#f2f2f4',
      '--p-surface': '#ffffff',
      '--p-surface-2': '#f7f7f8',
      '--p-line': '#a1a1aa',
      '--p-text': '#000000',
      '--p-text-2': '#27272a',
      '--p-violet': '#12307a',
      '--p-violet-2': '#0f2a6b',
    },
  },
  {
    id: 'calida',
    nombre: 'Cálida',
    descripcion: 'Fondos con un punto de tierra. Misma legibilidad, menos clínico.',
    tokens: {
      '--p-bg': '#faf9f7',
      '--p-bg-2': '#f2f0ec',
      '--p-surface': '#ffffff',
      '--p-surface-2': '#faf9f7',
      '--p-line': '#e5e1da',
      '--p-text': '#1c1a17',
      '--p-text-2': '#57534e',
      '--p-violet': '#1f3a8a',
      '--p-violet-2': '#1e3a8a',
    },
  },
];

export type Densidad = 'compacta' | 'normal' | 'amplia';

export interface Tema {
  paleta: string;
  densidad: Densidad;
  actualizadoPor: string | null;
  actualizadoAt: string | null;
}

const TEMA_POR_DEFECTO: Tema = {
  paleta: 'bodytech',
  densidad: 'normal',
  actualizadoPor: null,
  actualizadoAt: null,
};

class BodyVibeTemaService {
  /** Las opciones que la interfaz puede ofrecer. Nada fuera de acá es elegible. */
  opciones(): { paletas: Paleta[]; densidades: Densidad[] } {
    return { paletas: PALETAS, densidades: ['compacta', 'normal', 'amplia'] };
  }

  async obtener(): Promise<Tema> {
    const filas = await postgresService.query(
      `SELECT paleta, densidad, actualizado_por, actualizado_at FROM bodyvibe_tema WHERE id = 1`
    );
    if (!filas || !filas[0]) return TEMA_POR_DEFECTO;
    return {
      paleta: filas[0].paleta,
      densidad: filas[0].densidad,
      actualizadoPor: filas[0].actualizado_por ?? null,
      actualizadoAt: filas[0].actualizado_at ? new Date(filas[0].actualizado_at).toISOString() : null,
    };
  }

  async guardar(
    paletaId: string,
    densidad: Densidad,
    quien: string
  ): Promise<{ ok: true; tema: Tema } | { ok: false; mensaje: string }> {
    const paleta = PALETAS.find((p) => p.id === paletaId);
    if (!paleta) {
      return {
        ok: false,
        mensaje: 'Esa paleta no existe. Solo se pueden usar las preaprobadas.',
      };
    }
    if (!['compacta', 'normal', 'amplia'].includes(densidad)) {
      return { ok: false, mensaje: 'Esa densidad no existe.' };
    }

    // Doble llave: aunque alguien agregue una paleta al código sin pasar por el
    // test, no se puede dejar activa una que no se lee.
    const problemas = verificarContraste(paleta.tokens);
    if (problemas.length > 0) {
      return {
        ok: false,
        mensaje:
          'Esa paleta no cumple el contraste mínimo para texto clínico. No se puede activar.',
      };
    }

    await postgresService.query(
      `INSERT INTO bodyvibe_tema (id, paleta, densidad, actualizado_por, actualizado_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE
         SET paleta = $1, densidad = $2, actualizado_por = $3, actualizado_at = NOW()`,
      [paletaId, densidad, quien]
    );

    return { ok: true, tema: await this.obtener() };
  }
}

export const bodyvibeTemaService = new BodyVibeTemaService();
export default bodyvibeTemaService;

// ============================================================================
// festivos-colombia — cálculo de festivos oficiales de Colombia sin tabla fija.
//
// Combina:
//   - Fijos (no se corren): 1/1, 1/5, 20/7, 7/8, 8/12, 25/12
//   - Ley Emiliani (se corren al lunes siguiente): 6/1, 19/3, 29/6, 15/8, 12/10,
//     1/11, 11/11
//   - Basados en Pascua (Meeus): Jueves y Viernes Santo (no se corren),
//     Ascensión, Corpus Christi, Sagrado Corazón (todos al lunes siguiente)
//
// Validado vs lista oficial 2026 (18 festivos).
// ============================================================================

/** Domingo de Pascua (algoritmo de Meeus/Butcher). Devuelve mes (1-12) y día. */
function domingoPascua(year: number): { mes: number; dia: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return { mes, dia };
}

function ymdUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate()
  ).padStart(2, '0')}`;
}
function fechaUtc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}
function sumarDias(dt: Date, n: number): Date {
  return new Date(dt.getTime() + n * 86400000);
}
/** Corre la fecha al próximo lunes si no lo es (Ley Emiliani). */
function alLunes(dt: Date): Date {
  return sumarDias(dt, (8 - dt.getUTCDay()) % 7);
}

const _festivosCache = new Map<number, Set<string>>();

/** Set de festivos de Colombia (YYYY-MM-DD) de un año, cacheado. */
export function festivosColombia(year: number): Set<string> {
  const cached = _festivosCache.get(year);
  if (cached) return cached;
  const s = new Set<string>();
  // Fijos (no se corren)
  for (const [m, d] of [[1, 1], [5, 1], [7, 20], [8, 7], [12, 8], [12, 25]]) {
    s.add(ymdUtc(fechaUtc(year, m, d)));
  }
  // Ley Emiliani (se corren al lunes siguiente)
  for (const [m, d] of [[1, 6], [3, 19], [6, 29], [8, 15], [10, 12], [11, 1], [11, 11]]) {
    s.add(ymdUtc(alLunes(fechaUtc(year, m, d))));
  }
  // Basados en Pascua
  const p = domingoPascua(year);
  const pascua = fechaUtc(year, p.mes, p.dia);
  s.add(ymdUtc(sumarDias(pascua, -3))); // Jueves Santo
  s.add(ymdUtc(sumarDias(pascua, -2))); // Viernes Santo
  s.add(ymdUtc(alLunes(sumarDias(pascua, 39)))); // Ascensión
  s.add(ymdUtc(alLunes(sumarDias(pascua, 60)))); // Corpus Christi
  s.add(ymdUtc(alLunes(sumarDias(pascua, 68)))); // Sagrado Corazón
  _festivosCache.set(year, s);
  return s;
}

/**
 * Si la fecha (YYYY-MM-DD, Colombia) es domingo o festivo, devuelve el motivo
 * ('domingo' | 'festivo'); si es día hábil, devuelve null.
 */
export function diaNoLaborable(fecha: string): 'domingo' | 'festivo' | null {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (fechaUtc(y, mo, d).getUTCDay() === 0) return 'domingo';
  if (festivosColombia(y).has(fecha)) return 'festivo';
  return null;
}

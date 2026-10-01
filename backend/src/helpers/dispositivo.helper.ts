// ============================================================================
// Funciones puras del dispositivo de consulta presencial (sin base ni red),
// para poder probarlas solas. Ver dispositivo.service.ts.
// ============================================================================

import crypto from 'crypto';

// Sin 0/O, 1/I/L ni U: el médico copia el código de una pantalla de 2,8".
const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const LARGO_CODIGO = 8;

/** Código de emparejamiento: 8 caracteres (30^8 ≈ 6,5·10^11 combinaciones). */
export function generarCodigo(): string {
  const bytes = crypto.randomBytes(LARGO_CODIGO);
  let s = '';
  for (let i = 0; i < LARGO_CODIGO; i++) s += ALFABETO_CODIGO[bytes[i] % ALFABETO_CODIGO.length];
  return s;
}

/** Como se muestra: "K7P4-QM2X". */
export function formatearCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/**
 * Lo que escribe el médico, normalizado: sin guion ni espacios y en mayúsculas.
 * null si no puede ser un código (largo distinto o un carácter que el alfabeto
 * no tiene, como la O o el 1).
 */
export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null;
  const s = entrada.toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== LARGO_CODIGO) return null;
  for (const ch of s) if (!ALFABETO_CODIGO.includes(ch)) return null;
  return s;
}

/** Secreto o token aleatorio, en base64url. */
export function generarSecreto(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** El token del dispositivo lleva prefijo para distinguirlo de un JWT a simple vista. */
export const PREFIJO_TOKEN = 'dsp_';

export function generarToken(): string {
  return PREFIJO_TOKEN + generarSecreto(32);
}

/** En la base solo queda el hash: quien lea la tabla no puede usar los tokens. */
export function hashSecreto(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

/** Cédula como la guarda la historia: solo dígitos (y letras, para pasaportes). */
export function normalizarCedula(entrada: unknown): string | null {
  if (typeof entrada !== 'string' && typeof entrada !== 'number') return null;
  const s = String(entrada).toUpperCase().replace(/[^0-9A-Z]/g, '');
  return s.length >= 5 && s.length <= 15 ? s : null;
}

export interface Segmento {
  paso: string | null;
  texto: string;
}

/**
 * Junta los segmentos en un solo texto, con un encabezado cada vez que cambia
 * el paso ("## Alergias"). `temas` traduce el id del paso a su rótulo.
 */
export function transcripcionPorPasos(segmentos: Segmento[], temas: Record<string, string>): string {
  const partes: string[] = [];
  let actual: string | null | undefined;
  for (const s of segmentos) {
    const texto = s.texto.trim();
    if (!texto) continue;
    if (s.paso !== actual) {
      actual = s.paso;
      partes.push(`\n## ${(actual && temas[actual]) || actual || 'Sin paso'}`);
    }
    partes.push(texto);
  }
  return partes.join('\n').trim();
}

/** ¿El campo ya tiene algo? Lo que escribió el médico no se pisa. */
export function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

/** Edad cumplida a hoy, desde YYYY-MM-DD (o null si no se puede). */
export function edadDesde(fechaNacimiento: unknown, hoy = new Date()): number | null {
  if (typeof fechaNacimiento !== 'string' && !(fechaNacimiento instanceof Date)) return null;
  const f = new Date(fechaNacimiento);
  if (Number.isNaN(f.getTime())) return null;
  let edad = hoy.getUTCFullYear() - f.getUTCFullYear();
  const m = hoy.getUTCMonth() - f.getUTCMonth();
  if (m < 0 || (m === 0 && hoy.getUTCDate() < f.getUTCDate())) edad--;
  return edad >= 0 && edad < 130 ? edad : null;
}

/** Límites del día de hoy en Colombia (UTC-5), como en medical-panel.service. */
export function hoyColombia(ahora = new Date()): { inicio: Date; fin: Date } {
  const co = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const y = co.getUTCFullYear(), m = co.getUTCMonth(), d = co.getUTCDate();
  return {
    inicio: new Date(Date.UTC(y, m, d, 5, 0, 0, 0)),
    fin: new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999)),
  };
}

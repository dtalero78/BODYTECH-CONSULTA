// ============================================================================
// gestion-report.service — Informe diario "Gestión Coaches Bodytech Trepsi".
//
// Envía a los usuarios con rol `admin` (y celular) un tablero del día con las
// mismas métricas de Indicadores — agendadas, atendidas y no contactadas por
// coach. Se entrega como IMAGEN inline por WhatsApp (header de media de una
// plantilla aprobada): WhatsApp prohíbe saltos de línea en variables de texto,
// así que un informe multi-línea no cabe en una variable — la imagen lo resuelve.
//
// Flujo: getIndicadores → arma ReportData → renderiza PNG (Puppeteer) → lo
// guarda → construye URL pública → envía plantilla twilio/media con
//   {{1}} = URL de la imagen · {{2}} = fecha · alcance.
//
// Datos: reutiliza calendario.service.getIndicadores() (incluye citas Trepsi +
// nativas), acotado por el alcance RBAC de cada admin.
//
// Disparo: worker diario en index.ts. `maybeSendDaily()` reclama el día en
// `gestion_report_log` (INSERT ON CONFLICT DO NOTHING) → at-most-once por día.
//
// Requiere:
//   TWILIO_WHATSAPP_GESTION_TEMPLATE_SID  → plantilla twilio/media aprobada.
//   PUBLIC_BASE_URL                        → base absoluta para la URL de la imagen.
// ============================================================================

import calendarioService from './calendario.service';
import usuariosService from './usuarios.service';
import whatsappService from './whatsapp.service';
import postgresService from './postgres.service';
import gestionReportImageService from './gestion-report-image.service';
import { ReportData, CoachRow } from '../helpers/gestion-report-html';

const TITULO = 'Gestión Coaches Bodytech Trepsi';
const MAX_COACHES = 14; // tope de filas en la imagen; el resto va como "…y N más"

const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

export interface EnvioResumen {
  fecha: string;
  intentos: number;
  enviados: number;
  fallidos: number;
  sinCelular: number;
  sinDatos: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowColombia(): { fecha: string; minutos: number } {
  const c = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, '0');
  const d = String(c.getUTCDate()).padStart(2, '0');
  return { fecha: `${y}-${m}-${d}`, minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
}

function formatFechaCorta(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MESES[Number(mo) - 1]} ${y}`;
}

// ---------------------------------------------------------------------------
// Festivos de Colombia — el informe NO se envía domingos ni festivos.
// Se calculan (no lista fija): fijos, Ley Emiliani (se corren al lunes) y los
// basados en Pascua. Así no hay que mantener una tabla año a año.
// ---------------------------------------------------------------------------

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
function festivosColombia(year: number): Set<string> {
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
 * por el que NO se debe enviar el informe; si es día hábil, devuelve null.
 */
function motivoNoEnviar(fecha: string): string | null {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (fechaUtc(y, mo, d).getUTCDay() === 0) return 'domingo';
  if (festivosColombia(y).has(fecha)) return 'festivo';
  return null;
}

class GestionReportService {
  /**
   * Construye el ReportData (datos del tablero) para un alcance de sedes y fecha.
   * Devuelve null si no hay datos, o `{ data, agendadas }` si hay.
   */
  async buildReportData(
    sedeIds: string[],
    fecha: string,
    scopeLabel: string
  ): Promise<ReportData | null> {
    const res = await calendarioService.getIndicadores(fecha, fecha, sedeIds);
    if (!res.ok || !res.data) return null;
    const d = res.data;

    const todos = d.porMedico.filter((m) => m.medicoCodigo !== '__SIN_ASIGNAR__' && m.agendadas > 0);
    const mostrados = todos.slice(0, MAX_COACHES);
    const coaches: CoachRow[] = mostrados.map((m) => ({
      nombre: m.nombre,
      agendadas: m.agendadas,
      atendidas: m.atendidas,
      noContactadas: m.noContactadas,
      noContacto: m.noContacto,
    }));

    return {
      titulo: TITULO,
      fecha: formatFechaCorta(fecha),
      scopeLabel,
      agendadas: d.agendadas,
      atendidas: d.atendidas,
      noContactadas: d.noContactadas,
      noContacto: d.noContacto,
      coaches,
      restantes: Math.max(0, todos.length - mostrados.length),
    };
  }

  /** Base pública para la URL de la imagen (Twilio la debe poder alcanzar). */
  private publicBaseUrl(): string {
    return (process.env.PUBLIC_BASE_URL || 'https://bodytech.app').replace(/\/+$/, '');
  }

  private async getAllActiveSedes(): Promise<string[]> {
    const rows = await postgresService.query(`SELECT sede_id FROM sedes WHERE activa = true`);
    return rows ? rows.map((r: { sede_id: string }) => r.sede_id) : [];
  }

  private async sedeLabel(sedeIds: string[]): Promise<string> {
    if (sedeIds.length === 0) return 'Sin sede';
    const rows = await postgresService.query(
      `SELECT nombre FROM sedes WHERE sede_id = ANY($1::text[])`,
      [sedeIds]
    );
    const nombres = rows ? rows.map((r: { nombre: string }) => r.nombre) : sedeIds;
    if (nombres.length <= 2) return nombres.join(' · ');
    return `${nombres.slice(0, 2).join(' · ')} +${nombres.length - 2}`;
  }

  /**
   * Renderiza el tablero de un alcance a PNG, lo guarda y devuelve
   * { imageUrl, agendadas }. Devuelve null si no hay datos o falla el render.
   */
  private async prepararImagen(
    sedeIds: string[],
    fecha: string,
    scopeLabel: string
  ): Promise<{ imageUrl: string; agendadas: number } | null> {
    const data = await this.buildReportData(sedeIds, fecha, scopeLabel);
    if (!data || data.agendadas === 0) return null;
    const png = await gestionReportImageService.renderPng(data);
    const token = await gestionReportImageService.store(png);
    if (!token) return null;
    return {
      imageUrl: `${this.publicBaseUrl()}/api/public/gestion-report-image/${token}.png`,
      agendadas: data.agendadas,
    };
  }

  /**
   * Envía el informe del día `fecha` a todos los admins activos con celular.
   * Cada admin recibe el tablero de su alcance RBAC (global → todas las sedes).
   * Se cachea la imagen por conjunto de sedes para no re-renderizar.
   */
  async enviarInformeDiario(fecha: string): Promise<EnvioResumen> {
    const templateSid = process.env.TWILIO_WHATSAPP_GESTION_TEMPLATE_SID || '';
    const resumen: EnvioResumen = {
      fecha,
      intentos: 0,
      enviados: 0,
      fallidos: 0,
      sinCelular: 0,
      sinDatos: 0,
    };
    if (!templateSid) {
      console.warn('⚠️  [Gestión] TWILIO_WHATSAPP_GESTION_TEMPLATE_SID no configurado — no se envía.');
      return resumen;
    }

    const admins = await usuariosService.list({ soloRoles: ['admin'] });
    if (!admins) {
      console.error('❌ [Gestión] No se pudo listar administradores.');
      return resumen;
    }

    const allSedes = await this.getAllActiveSedes();
    const cache = new Map<string, { imageUrl: string; scopeText: string } | null>();

    for (const a of admins) {
      if (!a.activo) continue;
      const celular = (a.celular || '').trim();
      if (!celular) {
        resumen.sinCelular++;
        continue;
      }
      const sedeIds = a.esGlobal ? allSedes : a.sedes;
      if (sedeIds.length === 0) continue;

      const key = [...sedeIds].sort().join(',');
      let prep = cache.get(key);
      if (prep === undefined) {
        const scopeLabel = a.esGlobal ? 'Todas las sedes' : await this.sedeLabel(a.sedes);
        const img = await this.prepararImagen(sedeIds, fecha, scopeLabel);
        prep = img
          ? { imageUrl: img.imageUrl, scopeText: `${formatFechaCorta(fecha)} · ${scopeLabel}` }
          : null;
        cache.set(key, prep);
      }
      if (!prep) {
        resumen.sinDatos++;
        continue; // sin citas ese día en su alcance → no se envía mensaje vacío.
      }

      resumen.intentos++;
      const r = await whatsappService.sendContentTemplate(celular, templateSid, {
        '1': prep.imageUrl,
        '2': prep.scopeText,
      });
      if (r.success) resumen.enviados++;
      else {
        resumen.fallidos++;
        console.error(`❌ [Gestión] Falló envío a ${a.nombre} (${celular}): ${r.error}`);
      }
    }

    return resumen;
  }

  /**
   * Worker diario: si ya pasó la hora objetivo (Colombia) y no se ha enviado hoy,
   * reclama el día de forma atómica y envía. Idempotente entre reinicios/instancias.
   */
  async maybeSendDaily(horaObjetivo = '19:30'): Promise<void> {
    if (!process.env.TWILIO_WHATSAPP_GESTION_TEMPLATE_SID) return; // no configurado → no-op

    const { fecha, minutos } = nowColombia();
    const [hh, mm] = horaObjetivo.split(':').map(Number);
    const target = (Number.isFinite(hh) ? hh : 19) * 60 + (Number.isFinite(mm) ? mm : 30);
    if (minutos < target) return;

    const claimed = await postgresService.query(
      `INSERT INTO gestion_report_log (fecha) VALUES ($1::date)
         ON CONFLICT (fecha) DO NOTHING
         RETURNING fecha`,
      [fecha]
    );
    if (!claimed || claimed.length === 0) return; // ya procesado hoy

    // No enviar domingos ni festivos de Colombia. Se reclamó el día igual (para
    // no re-chequear cada 5 min) y se registra como procesado con 0 enviados.
    const motivo = motivoNoEnviar(fecha);
    if (motivo) {
      await postgresService.query(
        `UPDATE gestion_report_log SET intentos = 0, enviados = 0, enviado_at = NOW() WHERE fecha = $1::date`,
        [fecha]
      );
      console.log(`📊 [Gestión] ${fecha} es ${motivo} en Colombia — no se envía el informe.`);
      return;
    }

    console.log(`📊 [Gestión] Enviando informe diario ${fecha}…`);
    await gestionReportImageService.purgeOld().catch(() => {});
    const res = await this.enviarInformeDiario(fecha);
    await postgresService.query(
      `UPDATE gestion_report_log SET intentos = $2, enviados = $3, enviado_at = NOW() WHERE fecha = $1::date`,
      [fecha, res.intentos, res.enviados]
    );
    console.log(
      `📊 [Gestión] Informe ${fecha}: ${res.enviados}/${res.intentos} enviados · ${res.fallidos} fallidos · ${res.sinDatos} sin datos · ${res.sinCelular} sin celular`
    );
  }
}

export default new GestionReportService();

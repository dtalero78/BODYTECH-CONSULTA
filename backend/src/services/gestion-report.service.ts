// ============================================================================
// gestion-report.service — Informe de Gestión diario por WhatsApp.
//
// Envía a los usuarios con rol `admin` (y celular) un resumen del día con las
// mismas métricas de la vista Indicadores — agendadas, atendidas y no
// contactadas por coach — emulando la estética de encuestas de WhatsApp con
// barras de emojis (la API de WhatsApp Business no permite encuestas nativas).
//
// Datos: reutiliza calendario.service.getIndicadores() (incluye citas Trepsi +
// nativas, resuelto por sede vía EFFECTIVE_SEDE_SQL), acotado por el alcance
// RBAC de cada admin (global → todas las sedes; acotado → las suyas).
//
// Disparo: worker diario en index.ts. `maybeSendDaily()` reclama el día en
// `gestion_report_log` (INSERT ON CONFLICT DO NOTHING) → at-most-once por día.
//
// Requiere `TWILIO_WHATSAPP_GESTION_TEMPLATE_SID` (plantilla utility aprobada):
//   📊 *Gestión Bodytech — {{1}}*
//
//   🟩 Atendida · ⬜ Pendiente · 🟧 No contactó
//
//   {{2}}
//
//   _Informe automático · Panel Coordinador_
// ============================================================================

import calendarioService from './calendario.service';
import usuariosService from './usuarios.service';
import whatsappService from './whatsapp.service';
import postgresService from './postgres.service';

const GREEN = '🟩';
const WHITE = '⬜';
const ORANGE = '🟧';
const BAR_WIDTH = 10;

// Límite del cuerpo de una plantilla WhatsApp (1024). Reservamos margen para el
// texto fijo de la plantilla + {{1}}; {{2}} se corta antes de este presupuesto.
const V2_CHAR_BUDGET = 850;

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

/** Momento actual en Colombia (UTC-5): fecha YYYY-MM-DD y minutos desde medianoche. */
function nowColombia(): { fecha: string; minutos: number } {
  const c = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const y = c.getUTCFullYear();
  const m = String(c.getUTCMonth() + 1).padStart(2, '0');
  const d = String(c.getUTCDate()).padStart(2, '0');
  return { fecha: `${y}-${m}-${d}`, minutos: c.getUTCHours() * 60 + c.getUTCMinutes() };
}

/** "2026-07-08" → "8 jul 2026". */
function formatFechaCorta(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${Number(d)} ${MESES[Number(mo) - 1]} ${y}`;
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/**
 * Construye una barra de `width` bloques con tres segmentos (atendida/pendiente/
 * no contactó). Cada categoría con valor > 0 recibe al menos 1 bloque para que
 * una franja pequeña siga siendo visible; el resto se reparte por mayor residuo.
 */
export function buildBar(
  atendidas: number,
  pendientes: number,
  noContactadas: number,
  width = BAR_WIDTH
): string {
  const cats = [
    { emoji: GREEN, val: Math.max(0, atendidas) },
    { emoji: WHITE, val: Math.max(0, pendientes) },
    { emoji: ORANGE, val: Math.max(0, noContactadas) },
  ];
  const total = cats.reduce((a, c) => a + c.val, 0);
  if (total <= 0) return WHITE.repeat(width);

  // 1 bloque reservado por cada categoría no-cero.
  const reserved: number[] = cats.map((c) => (c.val > 0 ? 1 : 0));
  const reservedTotal = reserved.reduce((a, b) => a + b, 0);
  const remaining = Math.max(0, width - reservedTotal);

  // Reparto proporcional del resto con mayor residuo.
  const shares = cats.map((c) => (c.val / total) * remaining);
  const counts = shares.map((s) => Math.floor(s));
  let leftover = remaining - counts.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, rem: s - Math.floor(s) }))
    .sort((a, b) => b.rem - a.rem);
  for (let k = 0; k < order.length && leftover > 0; k++) {
    if (cats[order[k].i].val > 0) {
      counts[order[k].i]++;
      leftover--;
    }
  }
  // Si sobra (residuos en categorías cero), va a la de mayor valor.
  if (leftover > 0) {
    let maxI = 0;
    for (let i = 1; i < cats.length; i++) if (cats[i].val > cats[maxI].val) maxI = i;
    counts[maxI] += leftover;
  }

  return cats.map((c, i) => c.emoji.repeat(reserved[i] + counts[i])).join('');
}

class GestionReportService {
  /**
   * Construye las variables {{1}} y {{2}} de la plantilla para un alcance de
   * sedes y una fecha. Devuelve null si no hay datos o error de consulta.
   */
  async buildVariables(
    sedeIds: string[],
    fecha: string,
    scopeLabel: string
  ): Promise<{ v1: string; v2: string; agendadas: number } | null> {
    const res = await calendarioService.getIndicadores(fecha, fecha, sedeIds);
    if (!res.ok || !res.data) return null;
    const d = res.data;

    const globalPend = Math.max(0, d.agendadas - d.atendidas - d.noContactadas);
    const lines: string[] = [];
    lines.push(`*GLOBAL* · Ejecución ${pct(d.atendidas, d.agendadas)}`);
    lines.push(`${buildBar(d.atendidas, globalPend, d.noContactadas)}  ${d.atendidas}/${d.agendadas}`);

    // Coaches con al menos una cita, ya ordenados por agendadas desc (servicio).
    const coaches = d.porMedico.filter(
      (m) => m.medicoCodigo !== '__SIN_ASIGNAR__' && m.agendadas > 0
    );

    let v2 = lines.join('\n');
    let shown = 0;
    for (const m of coaches) {
      const pend = Math.max(0, m.agendadas - m.atendidas - m.noContactadas);
      const block =
        `\n\n*${m.nombre}*\n` +
        `${buildBar(m.atendidas, pend, m.noContactadas)}  ${m.atendidas}/${m.agendadas} · ${pct(m.atendidas, m.agendadas)}`;
      if (v2.length + block.length > V2_CHAR_BUDGET) break;
      v2 += block;
      shown++;
    }
    const restantes = coaches.length - shown;
    if (restantes > 0) {
      v2 += `\n\n…y ${restantes} profesional${restantes === 1 ? '' : 'es'} más`;
    }

    const v1 = `${formatFechaCorta(fecha)} · ${scopeLabel}`;
    return { v1, v2, agendadas: d.agendadas };
  }

  /** Todas las sedes activas (para admins globales). */
  private async getAllActiveSedes(): Promise<string[]> {
    const rows = await postgresService.query(`SELECT sede_id FROM sedes WHERE activa = true`);
    return rows ? rows.map((r: { sede_id: string }) => r.sede_id) : [];
  }

  /** Etiqueta corta de un conjunto de sedes (nombres, máx 2 + "…"). */
  private async sedeLabel(sedeIds: string[]): Promise<string> {
    if (sedeIds.length === 0) return 'Sin sede';
    const rows = await postgresService.query(
      `SELECT sede_id, nombre FROM sedes WHERE sede_id = ANY($1::text[])`,
      [sedeIds]
    );
    const nombres = rows ? rows.map((r: { nombre: string }) => r.nombre) : sedeIds;
    if (nombres.length <= 2) return nombres.join(' · ');
    return `${nombres.slice(0, 2).join(' · ')} +${nombres.length - 2}`;
  }

  /**
   * Envía el informe del día `fecha` a todos los admins activos con celular.
   * Cada admin recibe el informe de su alcance RBAC (global → todas las sedes;
   * acotado → sus sedes). Se cachea el informe por conjunto de sedes para no
   * recomputar cuando varios admins comparten alcance.
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
    // Cache por clave de alcance → variables (o null si sin datos).
    const cache = new Map<string, { v1: string; v2: string } | null>();

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
      let vars = cache.get(key);
      if (vars === undefined) {
        const scopeLabel = a.esGlobal ? 'Todas las sedes' : await this.sedeLabel(a.sedes);
        const built = await this.buildVariables(sedeIds, fecha, scopeLabel);
        vars = built && built.agendadas > 0 ? { v1: built.v1, v2: built.v2 } : null;
        cache.set(key, vars);
      }
      if (!vars) {
        resumen.sinDatos++;
        continue; // sin citas ese día en su alcance → no se envía mensaje vacío.
      }

      resumen.intentos++;
      const r = await whatsappService.sendContentTemplate(celular, templateSid, {
        '1': vars.v1,
        '2': vars.v2,
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
   *
   * @param horaObjetivo "HH:MM" en hora Colombia (por defecto 19:00).
   */
  async maybeSendDaily(horaObjetivo = '19:00'): Promise<void> {
    if (!process.env.TWILIO_WHATSAPP_GESTION_TEMPLATE_SID) return; // no configurado → no-op silencioso

    const { fecha, minutos } = nowColombia();
    const [hh, mm] = horaObjetivo.split(':').map(Number);
    const target = (Number.isFinite(hh) ? hh : 19) * 60 + (Number.isFinite(mm) ? mm : 0);
    if (minutos < target) return; // aún no es la hora

    // Reclamar el día atómicamente. Si otra instancia/proceso ya lo hizo, no hay fila.
    const claimed = await postgresService.query(
      `INSERT INTO gestion_report_log (fecha) VALUES ($1::date)
         ON CONFLICT (fecha) DO NOTHING
         RETURNING fecha`,
      [fecha]
    );
    if (!claimed || claimed.length === 0) return; // ya enviado hoy

    console.log(`📊 [Gestión] Enviando informe diario ${fecha}…`);
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

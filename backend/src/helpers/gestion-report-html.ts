// ============================================================================
// gestion-report-html — HTML del tablero de "Gestión Coaches Bodytech Trepsi".
//
// Se renderiza a PNG con Puppeteer y se envía inline por WhatsApp (header de
// media). Al ser imagen, dibujamos barras reales de 4 segmentos:
//   verde=atendida · gris=pendiente · ámbar=no contesta · rojo=no contactó
// Estilos inline, sin recursos externos.
// ============================================================================

export interface CoachRow {
  nombre: string;
  agendadas: number;
  atendidas: number;
  /** Estado NO CONTESTA — el paciente no respondió. */
  noContactadas: number;
  /** Sin link enviado — nunca se le contactó. */
  noContacto: number;
}

export interface ReportData {
  titulo: string; // "Gestión Coaches Bodytech Trepsi"
  fecha: string; // "8 jul 2026"
  scopeLabel: string; // "Todas las sedes" / "Nutrición"
  agendadas: number;
  atendidas: number;
  noContactadas: number;
  noContacto: number;
  coaches: CoachRow[];
  restantes?: number; // coaches no mostrados (cap), se anota "…y N más"
}

const GREEN = '#1fa855'; // atendida
const GREY = '#d6dad3'; // pendiente (link enviado, en gestión)
const AMBER = '#e6902b'; // no contesta (paciente no respondió)
const RED = '#cf4436'; // no contactó (nunca se envió el link)

// Colores de texto (más oscuros para legibilidad sobre blanco)
const T_GREEN = '#1fa855';
const T_AMBER = '#b9721c';
const T_RED = '#c0392b';
const T_GREY = '#6b6862';

function esc(s: string): string {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  );
}

function pctNum(part: number, total: number): number {
  if (total <= 0) return 0;
  return (part / total) * 100;
}

function pctStr(part: number, total: number): string {
  if (total <= 0) return '—';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** Barra apilada de 4 segmentos (atendida/pendiente/no contesta/no contactó). */
function bar(atendidas: number, pendientes: number, noContesta: number, noContacto: number): string {
  const total = Math.max(1, atendidas + pendientes + noContesta + noContacto);
  const seg = (v: number, color: string) => {
    const w = (v / total) * 100;
    return w > 0 ? `<span style="width:${w}%;background:${color};display:block;height:100%"></span>` : '';
  };
  return `<span style="display:flex;height:12px;border-radius:6px;overflow:hidden;background:${GREY}">${seg(atendidas, GREEN)}${seg(pendientes, GREY)}${seg(noContesta, AMBER)}${seg(noContacto, RED)}</span>`;
}

function coachRowHtml(c: CoachRow): string {
  const pend = Math.max(0, c.agendadas - c.atendidas - c.noContactadas - c.noContacto);
  const ejec = pctStr(c.atendidas, c.agendadas);
  const ejecNum = pctNum(c.atendidas, c.agendadas);
  const ejecColor = ejecNum >= 50 ? GREEN : ejecNum >= 25 ? '#b9821f' : '#c2410c';
  return `
    <div style="padding:11px 0;border-bottom:1px solid #eceae5">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <span style="font-size:15px;font-weight:600;color:#1c1b19">${esc(c.nombre)}</span>
        <span style="font-size:13px;font-weight:700;color:${ejecColor};font-variant-numeric:tabular-nums">${ejec}</span>
      </div>
      ${bar(c.atendidas, pend, c.noContactadas, c.noContacto)}
      <div style="margin-top:5px;font-size:12px;color:${T_GREY};font-variant-numeric:tabular-nums">
        <b style="color:${T_GREEN}">${c.atendidas}</b> atendidas · ${pend} pendientes · <b style="color:${T_AMBER}">${c.noContactadas}</b> no contesta · <b style="color:${T_RED}">${c.noContacto}</b> no contactó
      </div>
    </div>`;
}

export function buildReportHtml(d: ReportData): string {
  const pendGlobal = Math.max(0, d.agendadas - d.atendidas - d.noContactadas - d.noContacto);
  const ejecGlobal = pctStr(d.atendidas, d.agendadas);
  const coachesHtml = d.coaches.map(coachRowHtml).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:-apple-system,'Segoe UI',Roboto,system-ui,sans-serif; -webkit-font-smoothing:antialiased; background:#ffffff; }
    .card { width:640px; background:#ffffff; padding:26px 28px 22px; }
  </style></head><body>
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:3px">
        <span style="width:26px;height:26px;border-radius:7px;background:#1f3a8a;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800">B</span>
        <span style="font-size:21px;font-weight:750;letter-spacing:-.02em;color:#12100e">${esc(d.titulo)}</span>
      </div>
      <div style="font-size:13px;color:#8a867e;margin-bottom:16px;padding-left:36px">${esc(d.fecha)} · ${esc(d.scopeLabel)}</div>

      <!-- Leyenda -->
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:14px;font-size:12.5px;color:#6b6862">
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${GREEN}"></span>Atendida</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${GREY}"></span>Pendiente</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${AMBER}"></span>No contesta</span>
        <span style="display:inline-flex;align-items:center;gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:${RED}"></span>No contactó</span>
      </div>

      <!-- Global -->
      <div style="background:#f7f6f3;border:1px solid #ecebe6;border-radius:12px;padding:14px 16px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:9px">
          <span style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#8a867e">GLOBAL <span style="font-weight:600;letter-spacing:0;color:#4b4842;font-variant-numeric:tabular-nums">(${d.agendadas} agendadas)</span></span>
          <span style="font-size:14px;color:#6b6862">Ejecución <b style="color:#1f3a8a;font-size:17px;font-variant-numeric:tabular-nums">${ejecGlobal}</b></span>
        </div>
        ${bar(d.atendidas, pendGlobal, d.noContactadas, d.noContacto)}
        <div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:#4b4842;font-variant-numeric:tabular-nums">
          <span style="color:${T_GREEN}"><b style="font-size:16px">${d.atendidas}</b> atendidas <span style="opacity:.65">(${pctStr(d.atendidas, d.agendadas)})</span></span>
          <span style="color:${T_GREY}"><b style="font-size:16px">${pendGlobal}</b> pendientes <span style="opacity:.65">(${pctStr(pendGlobal, d.agendadas)})</span></span>
          <span style="color:${T_AMBER}"><b style="font-size:16px">${d.noContactadas}</b> no contesta <span style="opacity:.65">(${pctStr(d.noContactadas, d.agendadas)})</span></span>
          <span style="color:${T_RED}"><b style="font-size:16px">${d.noContacto}</b> no contactó <span style="opacity:.65">(${pctStr(d.noContacto, d.agendadas)})</span></span>
        </div>
      </div>

      <!-- Coaches -->
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;color:#8a867e;margin-bottom:2px">POR COACH</div>
      ${coachesHtml || '<div style="padding:16px 0;color:#8a867e;font-size:14px">Sin citas en el rango.</div>'}
      ${d.restantes && d.restantes > 0 ? `<div style="padding:11px 0 2px;font-size:13px;color:#8a867e">…y ${d.restantes} coach${d.restantes === 1 ? '' : 'es'} más</div>` : ''}

      <div style="margin-top:16px;font-size:11.5px;color:#a8a49c;text-align:center">Informe automático · Panel Coordinador</div>
    </div>
  </body></html>`;
}

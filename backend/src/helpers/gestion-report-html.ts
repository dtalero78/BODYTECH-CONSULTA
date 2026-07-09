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

// Ícono "girar celular" embebido como data URI (PNG). Se muestra junto al título.
const GIRAR_ICON = 'data:image/png;base64,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';

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
        <img src="${GIRAR_ICON}" alt="Girar celular" style="width:52px;height:52px;object-fit:contain;margin-left:8px" />
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

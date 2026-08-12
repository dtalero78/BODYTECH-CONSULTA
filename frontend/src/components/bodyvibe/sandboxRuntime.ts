// ============================================================================
// sandboxRuntime — el documento que corre DENTRO del recinto aislado.
//
// Cerrojos 2 y 3 de BodyVibeTech viven acá:
//
//   Cerrojo 2 — El código generado no puede usar la sesión del usuario.
//     El iframe se monta con sandbox="allow-scripts" y SIN allow-same-origin,
//     así que su origen es opaco ("null"). Desde ahí no puede leer el
//     localStorage de bodytech.app (donde vive `bsl_auth_token`), ni sus
//     cookies, ni el DOM del panel que lo contiene. Aunque corra en la misma
//     pestaña, está del otro lado del vidrio.
//
//   Cerrojo 3 — El código generado no puede hablar con internet.
//     El CSP de este documento es `default-src 'none'` con `connect-src 'none'`:
//     fetch, XMLHttpRequest, WebSocket y EventSource quedan muertos. `img-src`
//     admite solo `data:`, que cierra el canal clásico de fuga por URL de
//     imagen (`new Image().src = 'https://…?datos'`). Prohibir escribir no
//     sirve de nada si se pueden leer 40.000 registros y mandarlos afuera.
//
// Lo único que atraviesa el vidrio es `postMessage`: el app pide datos, el
// anfitrión decide si los entrega. Esa es la ventanilla.
//
// Costo conocido y aceptado: con `img-src data:` un app no puede mostrar las
// fotos de los profesionales servidas por URL. Debe incrustarlas como data URI
// o mostrar iniciales. Abrir `img-src` a un dominio reabre el canal de fuga.
// ============================================================================

/** Política que se inyecta como <meta> antes de cualquier script del app. */
export const SANDBOX_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "object-src 'none'",
].join('; ');

/** Tipos de mensaje del puente. Prefijo `bv:` para no chocar con nada más. */
export const BRIDGE = {
  /** app → anfitrión: pide una consulta a los estantes. */
  QUERY: 'bv:query',
  /** anfitrión → app: respuesta de una consulta. */
  RESULT: 'bv:result',
  /** app → anfitrión: ya pintó, se puede quitar el cargando. */
  READY: 'bv:ready',
  /** app → anfitrión: cambió de alto, ajustá el iframe. */
  RESIZE: 'bv:resize',
  /** app → anfitrión: se rompió algo adentro. */
  ERROR: 'bv:error',
} as const;

/**
 * Runtime mínimo que ve el código generado. Es deliberadamente corto: cada
 * cosa que se agregue acá es superficie que el agente puede usar mal.
 *
 *   await bv.query(sql, params?)  → filas. Lanza excepción con mensaje legible.
 *   bv.ready()                    → quita el "cargando" del anfitrión.
 *   bv.el                         → el <div id="app"> donde se pinta.
 */
const RUNTIME = `
(function () {
  var pendientes = {};
  var siguienteId = 1;

  function enviar(tipo, datos) {
    parent.postMessage(Object.assign({ tipo: tipo }, datos || {}), '*');
  }

  window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (!msg || msg.tipo !== '${BRIDGE.RESULT}') return;
    var p = pendientes[msg.id];
    if (!p) return;
    delete pendientes[msg.id];
    if (msg.ok) p.resolver({ filas: msg.filas, recortado: msg.recortado });
    else p.rechazar(new Error(msg.mensaje || 'La consulta falló.'));
  });

  var bv = {
    el: null,
    query: function (sql, params) {
      var id = siguienteId++;
      return new Promise(function (resolver, rechazar) {
        pendientes[id] = { resolver: resolver, rechazar: rechazar };
        enviar('${BRIDGE.QUERY}', { id: id, sql: sql, params: params || [] });
        // Red de seguridad del lado del app: el anfitrión también tiene su
        // propio corte, pero si un mensaje se pierde el Promise no puede
        // quedarse colgado para siempre.
        setTimeout(function () {
          if (!pendientes[id]) return;
          delete pendientes[id];
          rechazar(new Error('La consulta no respondió a tiempo.'));
        }, 15000);
      }).then(function (r) {
        return r.filas;
      });
    },
    ready: function () {
      enviar('${BRIDGE.READY}');
    },
  };

  // Reporta el alto real para que el anfitrión ajuste el iframe. Sin esto el
  // app queda con scroll interno o con un vacío enorme debajo.
  function medir() {
    var alto = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    enviar('${BRIDGE.RESIZE}', { alto: alto });
  }

  // Un app roto tiene que DECIRLO. Sin esto queda un recuadro en blanco y el
  // usuario no sabe si está cargando o si falló.
  window.addEventListener('error', function (e) {
    enviar('${BRIDGE.ERROR}', {
      mensaje: (e && e.message) || 'Error en el app.',
      linea: e && e.lineno,
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    enviar('${BRIDGE.ERROR}', { mensaje: (r && r.message) || String(r) });
  });

  window.bv = bv;

  document.addEventListener('DOMContentLoaded', function () {
    bv.el = document.getElementById('app');
    if (window.ResizeObserver) new ResizeObserver(medir).observe(document.documentElement);
    medir();
    setInterval(medir, 1000);
  });
})();
`;

/**
 * Hoja de estilos base. Le da al app el lenguaje visual de la plataforma sin
 * que el agente tenga que reinventarlo — y sin cargar fuentes remotas, que el
 * CSP bloquea de todos modos.
 *
 * Los valores vienen de `frontend/src/index.css` y de
 * `components/coordinador/_tokens.tsx`. Se pasan por copia: el iframe no puede
 * leer las variables CSS del anfitrión.
 */
export function estilosBase(tema: 'claro' | 'oscuro'): string {
  const claro = {
    fondo: '#fcfcfb',
    superficie: '#ffffff',
    linea: '#e4e4e7',
    texto: '#18181b',
    texto2: '#52525b',
    tenue: '#83838d',
    acento: '#1f3a8a',
    acentoSuave: '#eef2ff',
  };
  const oscuro = {
    fondo: '#131316',
    superficie: '#1d1d25',
    linea: '#2e2e37',
    texto: '#eaeaee',
    texto2: '#b6b6c0',
    tenue: '#8a8a96',
    acento: '#93a9f2',
    acentoSuave: '#1b2140',
  };
  const t = tema === 'oscuro' ? oscuro : claro;

  return `
    :root {
      --bv-fondo: ${t.fondo};
      --bv-superficie: ${t.superficie};
      --bv-linea: ${t.linea};
      --bv-texto: ${t.texto};
      --bv-texto-2: ${t.texto2};
      --bv-tenue: ${t.tenue};
      --bv-acento: ${t.acento};
      --bv-acento-suave: ${t.acentoSuave};
      --bv-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;
      --bv-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bv-fondo); }
    body {
      color: var(--bv-texto);
      font-family: var(--bv-sans);
      font-size: 14px;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }
    #app { padding: 16px; }
    h1, h2, h3 { margin: 0 0 8px; letter-spacing: -0.015em; font-weight: 620; }
    h1 { font-size: 20px; } h2 { font-size: 16px; } h3 { font-size: 14px; }
    p { margin: 0 0 10px; color: var(--bv-texto-2); }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td {
      text-align: left; padding: 8px 10px;
      border-bottom: 1px solid var(--bv-linea); vertical-align: top;
    }
    th {
      font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--bv-tenue); font-weight: 600; white-space: nowrap;
    }
    td { font-variant-numeric: tabular-nums; }
    .bv-tarjeta {
      background: var(--bv-superficie); border: 1px solid var(--bv-linea);
      border-radius: 6px; padding: 14px;
    }
    .bv-scroll { overflow-x: auto; }
    button {
      font: inherit; cursor: pointer; padding: 7px 12px; border-radius: 6px;
      border: 1px solid var(--bv-linea); background: var(--bv-superficie);
      color: var(--bv-texto);
    }
    button.bv-primario { background: var(--bv-acento); border-color: var(--bv-acento); color: #fff; }
    input, select {
      font: inherit; padding: 6px 9px; border-radius: 6px;
      border: 1px solid var(--bv-linea); background: var(--bv-superficie);
      color: var(--bv-texto);
    }
    :focus-visible { outline: 2px solid var(--bv-acento); outline-offset: 2px; }
  `;
}

/**
 * Arma el documento completo del recinto.
 *
 * `codigo` es JavaScript, no HTML: el app pinta dentro de `#app`. Se inyecta
 * al final del body para que `bv` y `#app` ya existan.
 */
export function construirDocumento(codigo: string, tema: 'claro' | 'oscuro'): string {
  // `</script>` dentro del código del app cerraría la etiqueta antes de tiempo
  // y volcaría el resto como HTML. Se rompe la secuencia sin cambiar lo que el
  // motor de JS termina ejecutando.
  const seguro = codigo.replace(/<\/script/gi, '<\\/script');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${estilosBase(tema)}</style>
<script>${RUNTIME}</script>
</head>
<body>
<div id="app"></div>
<script>
try {
${seguro}
} catch (e) {
  parent.postMessage({ tipo: '${BRIDGE.ERROR}', mensaje: (e && e.message) || String(e) }, '*');
}
</script>
</body>
</html>`;
}

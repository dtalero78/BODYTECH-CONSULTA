#!/usr/bin/env node
// ============================================================================
// generar-catalogo — Los OJOS del agente de BodyVibeTech (decisión 08).
//
// El problema que resuelve: en producción solo vive el programa compilado, no
// el código fuente. El agente, corriendo ahí, no puede leer la plataforma. Si
// alguien le pide "agregale un botón al panel de coordinador", va a adivinar —
// y adivinando produce cosas que se ven bien en la vista previa y no funcionan.
//
// Este script corre en cada compilación, lee el código y deja un catálogo
// dentro de `dist/`. Como nace del código mismo, nunca miente: si mañana se
// renombra una pantalla, el catálogo se entera solo. Un catálogo escrito a mano
// se desactualiza y eso es peor que no tenerlo, porque el agente genera con
// confianza sobre datos falsos.
//
// Lo que NO hace este script: inventar. Si no encuentra una fuente (típico en
// el contenedor, donde el código del frontend puede no estar), lo registra como
// faltante en vez de dejar una sección vacía que parezca completa.
//
// Lo que este catálogo no cubre: los estantes de datos. Esos se leen en
// caliente desde `information_schema`, porque la verdad sobre qué columnas
// existe la tiene la base, no el código.
// ============================================================================

const fs = require('fs');
const path = require('path');

const RAIZ_BACKEND = path.resolve(__dirname, '..');
const SALIDA = path.join(RAIZ_BACKEND, 'src', 'generated', 'catalogo.generado.ts');

// El frontend vive fuera del backend. En desarrollo está en `../frontend`; en
// la imagen de Docker se copia a `/frontend-src` porque cada etapa del build
// ve solo su propio directorio.
const CANDIDATOS_FRONTEND = [
  process.env.FRONTEND_SRC,
  path.resolve(RAIZ_BACKEND, '..', 'frontend', 'src'),
  '/frontend-src',
].filter(Boolean);

const faltantes = [];

function leer(archivo, etiqueta) {
  try {
    if (!archivo) throw new Error('sin ruta');
    return fs.readFileSync(archivo, 'utf8');
  } catch {
    faltantes.push(etiqueta);
    return null;
  }
}

function raizFrontend() {
  for (const c of CANDIDATOS_FRONTEND) {
    if (fs.existsSync(path.join(c, 'App.tsx'))) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pantallas del frontend, desde las rutas declaradas en App.tsx.
// ---------------------------------------------------------------------------
function extraerPantallas(front) {
  if (!front) {
    faltantes.push('pantallas (no se encontró el código del frontend)');
    return [];
  }
  const src = leer(path.join(front, 'App.tsx'), 'App.tsx');
  if (!src) return [];

  // No se intenta capturar el `element={...}` con una expresión regular: el JSX
  // trae llaves anidadas (`roles={['medico', ...]}`) y cualquier captura no
  // codiciosa corta antes de llegar a la pantalla, dejando "RequireRole" como
  // nombre de las siete pantallas protegidas. Partir por `<Route` es tosco y
  // funciona.
  const ENVOLTORIOS = /^(Require[A-Za-z]*|Protected[A-Za-z]*|Suspense|Fragment|Navigate)$/;
  const pantallas = [];

  for (const trozo of src.split('<Route').slice(1)) {
    const ruta = (/path="([^"]+)"/.exec(trozo) || [])[1];
    if (!ruta) continue;

    // Solo hasta el cierre de este Route: sin esto, el último trozo se traga
    // el resto del archivo.
    const cuerpo = trozo.split(/\/>|<\/Route>/)[0];

    const componentes = [...cuerpo.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((x) => x[1]);
    const redirige = /<Navigate\s+to="([^"]+)"/.exec(cuerpo);
    const roles = [...cuerpo.matchAll(/roles=\{\[([^\]]*)\]\}/g)].flatMap((r) =>
      [...r[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1])
    );

    pantallas.push({
      ruta,
      componente: redirige ? null : (componentes.find((c) => !ENVOLTORIOS.test(c)) ?? null),
      redirigeA: redirige ? redirige[1] : null,
      protegida: componentes.some((c) => /^(Require|Protected)/.test(c)),
      roles: roles.length ? [...new Set(roles)] : null,
    });
  }
  return pantallas;
}

// ---------------------------------------------------------------------------
// Superficie de API, desde los `app.use('/api/...')` de index.ts.
// ---------------------------------------------------------------------------
function extraerApi() {
  const src = leer(path.join(RAIZ_BACKEND, 'src', 'index.ts'), 'index.ts');
  if (!src) return [];

  const rutas = [];
  const re = /app\.use\(\s*'(\/api\/[^']*)'\s*,([^;]*?)\)\s*;/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const roles = [...m[2].matchAll(/requireRole\(([^)]*)\)/g)]
      .flatMap((r) => [...r[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]));
    rutas.push({ ruta: m[1], roles: roles.length ? roles : null });
  }
  return rutas;
}

// ---------------------------------------------------------------------------
// Lenguaje visual. Sin esto, lo que genere el agente se ve como una pantalla
// pegada con cinta al lado de la plataforma, y se nota a un kilómetro.
// ---------------------------------------------------------------------------
function extraerVisual(front) {
  const visual = { variablesPanel: {}, tokensCoordinador: {}, tipografias: {} };
  if (!front) {
    faltantes.push('lenguaje visual (no se encontró el código del frontend)');
    return visual;
  }

  const css = leer(front && path.join(front, 'index.css'), 'index.css');
  if (css) {
    // No se busca un selector concreto: se recorren todos los bloques planos y
    // se toman los que declaren variables de color. Las del panel médico viven
    // en `.panel-theme`, no en `:root`, y dar por sentado el selector es
    // exactamente el tipo de suposición que deja el catálogo mudo sin que
    // nadie se entere.
    for (const bloque of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = bloque[1].trim().split('\n').pop().trim();
      const props = [...bloque[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)];
      if (!props.length) continue;
      // El tema oscuro se ignora: el catálogo describe la paleta base y el
      // recinto ya sabe alternar según el tema de quien mira.
      if (/dark/i.test(selector)) continue;
      for (const d of props) visual.variablesPanel[d[1]] = d[2].trim();
    }
  }

  const tok = leer(
    front && path.join(front, 'components', 'coordinador', '_tokens.tsx'),
    '_tokens.tsx'
  );
  if (tok) {
    const obj = /export const TOKENS\s*=\s*\{([\s\S]*?)\}/.exec(tok);
    if (obj) {
      for (const d of obj[1].matchAll(/([a-zA-Z0-9_]+)\s*:\s*'([^']+)'/g)) {
        visual.tokensCoordinador[d[1]] = d[2];
      }
    }
    for (const d of tok.matchAll(/export const (FONT_[A-Z]+)\s*=\s*"([^"]+)"/g)) {
      visual.tipografias[d[1]] = d[2];
    }
  }

  return visual;
}

// ---------------------------------------------------------------------------

function main() {
  const front = raizFrontend();
  const reglas = leer(path.join(RAIZ_BACKEND, 'src', 'bodyvibe', 'REGLAS.md'), 'REGLAS.md');

  const catalogo = {
    pantallas: extraerPantallas(front),
    api: extraerApi(),
    visual: extraerVisual(front),
    reglas: reglas ?? '',
    faltantes,
  };

  // Nada volátil en el archivo: sin fechas ni contadores. Si nada cambió en el
  // código, el catálogo regenerado es byte a byte idéntico — el diff sirve para
  // ver qué cambió de verdad, y el prompt del agente conserva su caché.
  const contenido = `// ARCHIVO GENERADO — no editar a mano.
// Lo produce \`scripts/generar-catalogo.js\` en cada compilación (npm run build).
// Para cambiar lo que dice, cambiá el código del que se deriva, o
// \`src/bodyvibe/REGLAS.md\` para la parte escrita a mano.

export interface PantallaCatalogo {
  ruta: string;
  componente: string | null;
  redirigeA: string | null;
  protegida: boolean;
  /** Roles que pueden entrar, cuando la pantalla los declara. */
  roles: string[] | null;
}

export interface RutaApiCatalogo {
  ruta: string;
  roles: string[] | null;
}

export interface CatalogoGenerado {
  pantallas: PantallaCatalogo[];
  api: RutaApiCatalogo[];
  visual: {
    variablesPanel: Record<string, string>;
    tokensCoordinador: Record<string, string>;
    tipografias: Record<string, string>;
  };
  /** Contenido literal de REGLAS.md — la mitad que no se puede deducir. */
  reglas: string;
  /** Fuentes que no se pudieron leer. Vacío es lo esperado. */
  faltantes: string[];
}

export const CATALOGO_GENERADO: CatalogoGenerado = ${JSON.stringify(catalogo, null, 2)};

export default CATALOGO_GENERADO;
`;

  fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
  fs.writeFileSync(SALIDA, contenido, 'utf8');

  const { pantallas, api } = catalogo;
  console.log(
    `📖 [catálogo] ${pantallas.length} pantallas, ${api.length} rutas de API, ` +
      `${Object.keys(catalogo.visual.variablesPanel).length} variables de color, ` +
      `${reglas ? Math.round(reglas.length / 1024) : 0} KB de reglas`
  );

  if (faltantes.length) {
    // No se aborta el build: un catálogo parcial sirve más que ninguno. Pero
    // tiene que verse, porque el síntoma en producción es "el agente no
    // entiende la plataforma" y eso se diagnostica pésimo desde afuera.
    console.warn(`⚠️  [catálogo] no se pudo leer: ${faltantes.join(' · ')}`);
  }
}

main();

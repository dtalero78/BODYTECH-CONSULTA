// ============================================================================
// Gráficas del informe corporativo, en SVG escrito a mano.
//
// Sin librería a propósito: el informe lo imprime Puppeteer, y una librería de
// gráficos obligaría a esperar a que un script termine de dibujar antes de
// exportar el PDF — que es el modo de falla clásico de las páginas a PDF
// (salen a medio pintar y nadie se entera hasta que el cliente abre el
// archivo). Un SVG en el HTML ya está dibujado cuando llega.
//
// ── Colores ────────────────────────────────────────────────────────────────
// Dos juegos, y no son intercambiables:
//
//   CATEGÓRICOS  — para cosas que solo se distinguen (género, diagnósticos).
//   DE ESTADO    — para escalas que van de bien a mal (IMC, riesgo, aptitud).
//                  Verde/ámbar/rojo dice algo; usar categóricos ahí obligaría
//                  al lector a mirar la leyenda para saber qué es peor.
//
// Los dos juegos están validados para daltonismo y por eso NO se tocan de a un
// color: cambiar uno rompe la separación del conjunto. Como varios quedan por
// debajo de 3:1 contra el papel, cada gráfica lleva SIEMPRE etiqueta directa o
// leyenda — el color nunca carga solo el significado.
// ============================================================================

export interface Punto {
  etiqueta: string;
  valor: number;
}

/** Categóricos: identidad, sin orden. Se asignan en este orden, nunca al azar. */
const CATEGORICOS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'];
const OTROS = '#8b929b';

/** De estado: de bien a mal. */
export const ESTADO = {
  bien: '#0ca30c',
  atencion: '#fab219',
  serio: '#ec835a',
  critico: '#d03b3b',
  neutro: '#8b929b',
};

/** Ordinal de una sola tinta, para escalas sin valencia (nivel de entrenamiento). */
const ORDINAL = ['#86b6ef', '#2a78d6', '#184f95'];

const TINTA = '#23262b';
const TINTA_SUAVE = '#5f6670';
const REJILLA = '#e4e4e7';

const esc = (s: string): string =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Escalas de color por tipo de dato. Devuelve un color por categoría. */
export function coloresDe(tipo: 'categorico' | 'imc' | 'riesgo' | 'aptitud' | 'actividad' | 'nivel', etiquetas: string[]): string[] {
  const n = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  switch (tipo) {
    case 'imc':
      return etiquetas.map((e) =>
        n(e).startsWith('normo') ? ESTADO.bien
        : n(e).startsWith('sobre') ? ESTADO.atencion
        : n(e).startsWith('obes') ? ESTADO.critico
        : ESTADO.neutro,
      );
    case 'riesgo':
      return etiquetas.map((e) =>
        n(e) === 'bajo' ? ESTADO.bien : n(e) === 'moderado' ? ESTADO.atencion : n(e) === 'alto' ? ESTADO.critico : ESTADO.neutro,
      );
    case 'aptitud':
      return etiquetas.map((e) =>
        n(e) === 'apto' ? ESTADO.bien
        : n(e).includes('recomendacion') ? ESTADO.atencion
        : n(e).includes('restriccion') ? ESTADO.serio
        : n(e).includes('no apto') ? ESTADO.critico
        : ESTADO.neutro,
      );
    case 'actividad':
      return etiquetas.map((e) => (n(e) === 'activo' ? ESTADO.bien : ESTADO.serio));
    case 'nivel':
      return etiquetas.map((_, i) => ORDINAL[Math.min(i, ORDINAL.length - 1)]);
    default:
      return etiquetas.map((_, i) => (i < CATEGORICOS.length ? CATEGORICOS[i] : OTROS));
  }
}

/**
 * Torta con porcentaje sobre cada porción y leyenda al lado.
 *
 * El porcentaje va dentro del gráfico y no solo en la leyenda: es lo que se
 * cita en el texto del informe, y obligar a cruzar leyenda y porción para
 * leerlo convierte un dato en un acertijo.
 */
export function torta(datos: Punto[], colores: string[], titulo: string): string {
  const total = datos.reduce((a, d) => a + d.valor, 0);
  if (total === 0) return vacio(titulo);

  const cx = 150, cy = 150, r = 118;
  let angulo = -Math.PI / 2;
  const porciones: string[] = [];
  const etiquetas: string[] = [];

  datos.forEach((d, i) => {
    const frac = d.valor / total;
    const fin = angulo + frac * Math.PI * 2;
    const x1 = cx + r * Math.cos(angulo), y1 = cy + r * Math.sin(angulo);
    const x2 = cx + r * Math.cos(fin), y2 = cy + r * Math.sin(fin);
    const grande = frac > 0.5 ? 1 : 0;
    // Una sola categoría no se dibuja como arco (un arco de 360° degenera en
    // un punto): se dibuja el círculo entero.
    porciones.push(
      datos.length === 1
        ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${colores[i]}" stroke="#fff" stroke-width="2"/>`
        : `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${colores[i]}" stroke="#fff" stroke-width="2"/>`,
    );
    if (frac >= 0.05) {
      const medio = angulo + (fin - angulo) / 2;
      const lx = cx + r * 0.62 * Math.cos(medio), ly = cy + r * 0.62 * Math.sin(medio);
      etiquetas.push(
        `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="14" font-weight="700" fill="#fff" style="paint-order:stroke" stroke="rgba(0,0,0,.25)" stroke-width="3">${(frac * 100).toFixed(1)}%</text>`,
      );
    }
    angulo = fin;
  });

  const leyenda = datos
    .map(
      (d, i) =>
        `<div class="li"><span class="sw" style="background:${colores[i]}"></span>${esc(d.etiqueta)} · <b>${d.valor}</b> (${((d.valor / total) * 100).toFixed(1)}%)</div>`,
    )
    .join('');

  return `<figure class="graf">
  <figcaption>${esc(titulo)}</figcaption>
  <div class="graf-cuerpo">
    <svg viewBox="0 0 300 300" role="img" aria-label="${esc(titulo)}">${porciones.join('')}${etiquetas.join('')}</svg>
    <div class="leyenda">${leyenda}</div>
  </div>
</figure>`;
}

/** Barras horizontales, una serie. Cada barra lleva su número al final. */
export function barras(datos: Punto[], colores: string[], titulo: string, etiquetaEje = ''): string {
  if (datos.length === 0 || datos.every((d) => d.valor === 0)) return vacio(titulo);
  const max = Math.max(...datos.map((d) => d.valor));
  const alto = Math.max(datos.length * 30 + 30, 110);
  const anchoEtiqueta = 132;
  const anchoPista = 560 - anchoEtiqueta - 46;

  const filas = datos
    .map((d, i) => {
      const y = 16 + i * 30;
      const w = max > 0 ? (d.valor / max) * anchoPista : 0;
      return `<text x="${anchoEtiqueta - 8}" y="${y + 13}" text-anchor="end" font-size="12" fill="${TINTA_SUAVE}">${esc(d.etiqueta)}</text>
      <rect x="${anchoEtiqueta}" y="${y}" width="${Math.max(w, 1).toFixed(1)}" height="20" rx="4" fill="${colores[i]}"/>
      <text x="${anchoEtiqueta + w + 7}" y="${y + 14}" font-size="12" font-weight="600" fill="${TINTA}">${d.valor}</text>`;
    })
    .join('');

  return `<figure class="graf">
  <figcaption>${esc(titulo)}</figcaption>
  <svg viewBox="0 0 560 ${alto}" role="img" aria-label="${esc(titulo)}">
    <line x1="${anchoEtiqueta}" y1="8" x2="${anchoEtiqueta}" y2="${alto - 16}" stroke="${REJILLA}" stroke-width="1"/>
    ${filas}
    ${etiquetaEje ? `<text x="${anchoEtiqueta + anchoPista / 2}" y="${alto - 2}" text-anchor="middle" font-size="11" fill="${TINTA_SUAVE}">${esc(etiquetaEje)}</text>` : ''}
  </svg>
</figure>`;
}

/**
 * Barras agrupadas de dos series (femenino / masculino).
 *
 * Las dos barras de un grupo van separadas por 2 px de papel: pegadas, dos
 * colores contiguos se leen como una sola barra de dos tonos.
 */
export function barrasDobles(
  datos: Array<{ etiqueta: string; femenino: number; masculino: number }>,
  titulo: string,
): string {
  if (datos.length === 0) return vacio(titulo);
  const max = Math.max(1, ...datos.map((d) => Math.max(d.femenino, d.masculino)));
  const alto = datos.length * 46 + 34;
  const anchoEtiqueta = 118;
  const anchoPista = 560 - anchoEtiqueta - 46;
  const [cF, cM] = ['#2a78d6', '#eb6834'];

  const filas = datos
    .map((d, i) => {
      const y = 12 + i * 46;
      const wF = (d.femenino / max) * anchoPista;
      const wM = (d.masculino / max) * anchoPista;
      return `<text x="${anchoEtiqueta - 8}" y="${y + 22}" text-anchor="end" font-size="12" fill="${TINTA_SUAVE}">${esc(d.etiqueta)}</text>
      <rect x="${anchoEtiqueta}" y="${y}" width="${Math.max(wF, d.femenino ? 1 : 0).toFixed(1)}" height="17" rx="4" fill="${cF}"/>
      ${d.femenino ? `<text x="${anchoEtiqueta + wF + 6}" y="${y + 13}" font-size="11" fill="${TINTA}">${d.femenino}</text>` : ''}
      <rect x="${anchoEtiqueta}" y="${y + 19}" width="${Math.max(wM, d.masculino ? 1 : 0).toFixed(1)}" height="17" rx="4" fill="${cM}"/>
      ${d.masculino ? `<text x="${anchoEtiqueta + wM + 6}" y="${y + 32}" font-size="11" fill="${TINTA}">${d.masculino}</text>` : ''}`;
    })
    .join('');

  return `<figure class="graf">
  <figcaption>${esc(titulo)}</figcaption>
  <div class="leyenda leyenda-fila">
    <div class="li"><span class="sw" style="background:${cF}"></span>Femenino</div>
    <div class="li"><span class="sw" style="background:${cM}"></span>Masculino</div>
  </div>
  <svg viewBox="0 0 560 ${alto}" role="img" aria-label="${esc(titulo)}">
    <line x1="${anchoEtiqueta}" y1="6" x2="${anchoEtiqueta}" y2="${alto - 14}" stroke="${REJILLA}" stroke-width="1"/>
    ${filas}
  </svg>
</figure>`;
}

/** Un hueco honesto: decir que no hubo dato es mejor que un gráfico en cero. */
function vacio(titulo: string): string {
  return `<figure class="graf graf-vacia">
  <figcaption>${esc(titulo)}</figcaption>
  <p>Sin datos registrados en este periodo.</p>
</figure>`;
}

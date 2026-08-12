// ============================================================================
// bodyvibe-progreso — leer un JSON que todavía se está escribiendo.
//
// Generar un app tarda entre treinta segundos y un par de minutos. Durante todo
// ese rato el usuario veía un botón que decía «Construyendo…» y nada más, que
// es indistinguible de algo colgado. Y el modelo, mientras tanto, está
// escribiendo el código a la vista: solo que nadie miraba ese chorro.
//
// El problema es que lo que llega no es código, es un JSON a medio escribir:
//
//   {"titulo": "Citas por sede", "codigo": "const filas = await bv.q(\n  'SEL
//
// `JSON.parse` con eso falla, obviamente. Así que acá va un lector tolerante:
// busca una clave, y decodifica su cadena hasta donde alcance — sin exigir que
// esté cerrada, que es justamente lo que nunca va a estar.
//
// Es un lector de UN nivel, a propósito: no pretende ser un parser de JSON
// incremental. Solo sabe sacar dos cadenas de un objeto plano, que es lo único
// que este esquema tiene. Cualquier cosa más ambiciosa sería código que no se
// usa y que hay que mantener igual.
// ============================================================================

/** Cuánto código se guarda para mostrar. Es una ventana, no el archivo. */
const COLA_MAX = 1400;

export interface AvanceGeneracion {
  /** El nombre que le puso el modelo, apenas termina de escribirlo. */
  titulo: string | null;
  /** El final del código escrito hasta ahora — lo que se ve en la ventanita. */
  cola: string;
  lineas: number;
  caracteres: number;
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
};

/**
 * Decodifica una cadena JSON desde `desde` (el carácter siguiente a la comilla
 * de apertura) hasta la comilla de cierre o hasta que se acabe el texto.
 *
 * Devuelve también si alcanzó a cerrar: el título solo sirve completo —medio
 * título parpadeando mientras se escribe es ruido—, el código en cambio se
 * muestra siempre, aunque esté a la mitad.
 */
function leerCadena(texto: string, desde: number): { valor: string; cerrada: boolean } {
  let salida = '';
  let i = desde;

  while (i < texto.length) {
    const c = texto[i];

    if (c === '"') return { valor: salida, cerrada: true };

    if (c !== '\\') {
      salida += c;
      i += 1;
      continue;
    }

    // Una barra al final del fragmento es un escape partido al medio: se
    // descarta, porque el siguiente trozo va a traerlo completo.
    if (i + 1 >= texto.length) break;

    const siguiente = texto[i + 1];

    if (siguiente === 'u') {
      // \uXXXX puede venir cortado igual que cualquier otra cosa.
      if (i + 6 > texto.length) break;
      const hex = texto.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      salida += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }

    const traducido = ESCAPES[siguiente];
    // Un escape que no existe se deja pasar tal cual en vez de abortar: es
    // preferible mostrar un carácter raro que perder la ventana entera.
    salida += traducido ?? siguiente;
    i += 2;
  }

  return { valor: salida, cerrada: false };
}

/** Ubica `"clave":` y devuelve el índice del primer carácter de su valor. */
function inicioDelValor(texto: string, clave: string): number {
  const marca = new RegExp(`"${clave}"\\s*:\\s*"`);
  const m = marca.exec(texto);
  return m ? m.index + m[0].length : -1;
}

/**
 * Lee lo que se pueda de un JSON incompleto. Nunca lanza: esto corre en el
 * camino del streaming y una excepción acá tumbaría una generación que, por lo
 * demás, iba bien.
 */
export function leerAvance(parcial: string): AvanceGeneracion {
  const vacio: AvanceGeneracion = { titulo: null, cola: '', lineas: 0, caracteres: 0 };
  if (!parcial) return vacio;

  try {
    let titulo: string | null = null;
    const iTitulo = inicioDelValor(parcial, 'titulo');
    if (iTitulo >= 0) {
      const r = leerCadena(parcial, iTitulo);
      // Solo cuando ya está cerrada: si no, el título va apareciendo letra por
      // letra y parece un error de tipeo, no un avance.
      if (r.cerrada && r.valor.trim()) titulo = r.valor.trim();
    }

    let codigo = '';
    const iCodigo = inicioDelValor(parcial, 'codigo');
    if (iCodigo >= 0) codigo = leerCadena(parcial, iCodigo).valor;

    return {
      titulo,
      cola: codigo.length > COLA_MAX ? codigo.slice(-COLA_MAX) : codigo,
      lineas: codigo ? codigo.split('\n').length : 0,
      caracteres: codigo.length,
    };
  } catch {
    return vacio;
  }
}

export default leerAvance;

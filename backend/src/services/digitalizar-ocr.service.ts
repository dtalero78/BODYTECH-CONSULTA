// ============================================================================
// digitalizar-ocr.service — Lee un pantallazo de "Citas asignadas" de
// MyBodytech (ya partido en franjas por el navegador) y devuelve una fila por
// afiliado, con los campos dudosos marcados.
//
// Va aparte de digitalizar.service para que se pueda probar contra una imagen
// real sin tocar la base.
//
// OpenAI y no Claude (que es lo que usa el OCR de planillas de prepagadas):
// la clave de Anthropic de producción de esta app tiene tope de gasto — la
// misma razón por la que el bot de Trepsi va por OpenAI.
//
// ── Dos modelos, cruzados ───────────────────────────────────────────────────
// Medido el 10-sep-2026 contra un fotograma real con 10 afiliados, en franjas
// sin reducir:
//   gpt-5-mini  0 cédulas mal   ~20 s
//   gpt-4.1     1 cédula mal    ~4 s
//   gpt-4o      2 mal y una fila cortada con la cédula incompleta
//   gpt-5       1 mal           ~2 min
// Ninguno es perfecto y se equivocan en filas distintas. Cada franja la leen
// dos y `consolidarLecturas` cruza: donde coinciden la fila es confiable, donde
// no, queda marcada para verificar. El orden de DIGITALIZAR_MODELOS es la
// preferencia en caso de empate.
// ============================================================================

import { openai } from './openai.service';
import { CitaConsolidada, Lectura, consolidarLecturas, limpiarFilas } from '../helpers/digitalizar.helper';

const MODELOS = (process.env.DIGITALIZAR_MODELOS || 'gpt-5-mini,gpt-4.1')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * Tope por lectura. Si el modelo lento no llega, queda la lectura del rápido
 * —con todo marcado para verificar, porque nadie la corroboró— en vez de que
 * el balanceador corte el request entero.
 */
const TIMEOUT_MS = 50_000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    citas: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          hora: { type: 'string', description: 'Hora de la cita tal como aparece, ej. "08:06 AM"' },
          sede: { type: 'string', description: 'Texto de la sede, ej. "HAYUELOS" o "CENTRAL ..."' },
          tipo: { type: 'string', description: 'Tipo de cita, ej. "Riesgo"' },
          nombre: { type: 'string', description: 'Nombre completo del afiliado' },
          numero_id: { type: 'string', description: 'Número de documento, sólo dígitos' },
          telefono: { type: 'string', description: 'Número de teléfono, sólo dígitos' },
          modalidad: { type: 'string', description: '"virtual" o "presencial"' },
          estado: {
            type: 'string',
            description: 'Texto del botón de estado si dice "Finalizado"; si muestra "Iniciar"/"Confirmar", ""',
          },
        },
        required: ['hora', 'sede', 'tipo', 'nombre', 'numero_id', 'telefono', 'modalidad', 'estado'],
      },
    },
  },
  required: ['citas'],
} as const;

const PROMPT = `Es un pantallazo (o una franja de un pantallazo) de la lista "Citas asignadas" del software
MyBodytech (MYBT medical). Cada fila es una cita: hora (ej. "08:06 AM"), "Sede" con el nombre debajo,
el tipo (ej. "Riesgo"), el NOMBRE del afiliado con su NÚMERO DE DOCUMENTO debajo, "N. Teléfono" con el
número debajo, la modalidad ("virtual" / "presencial") y, a la derecha, "Finalizado" o los botones
"Iniciar"/"Confirmar".

Transcribe TODAS las filas visibles, en orden de arriba a abajo.
- El número de documento es crítico: cópialo dígito por dígito, sin puntos ni espacios. Si un
  dígito no se lee con seguridad, deja numero_id en "" antes que adivinarlo.
- Una fila cortada por el borde superior o inferior de la imagen NO se incluye.
- No confundas el documento con el teléfono: el documento va debajo del nombre.
- Si un campo no aparece, usa "".
Si la imagen no es una lista de citas o afiliados, devuelve "citas": [].`;

/** Lee una imagen (data URL) con un modelo y devuelve su JSON crudo. */
export async function leerPantallazo(dataUrl: string, modelo: string): Promise<unknown> {
  const resp = await openai.chat.completions.create(
    {
      model: modelo,
      // Los modelos de razonamiento (gpt-5, serie o) rechazan `temperature`.
      ...(/^(gpt-5|o\d)/.test(modelo) ? {} : { temperature: 0 }),
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'citas_mybodytech', strict: true, schema: SCHEMA as never },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            // `high` porque la cédula va en letra chica: en `low` la imagen se
            // reduce a 512 px y se pierden dígitos.
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    },
    { timeout: TIMEOUT_MS, maxRetries: 0 },
  );

  const choice = resp.choices?.[0];
  if (choice?.message?.refusal) throw new Error('El modelo no quiso leer la imagen');
  const raw = choice?.message?.content?.trim() || '';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('La lectura del pantallazo no devolvió JSON válido');
  }
}

/**
 * Lee todas las franjas de UN pantallazo con todos los modelos, en paralelo,
 * y las cruza. Falla sólo si no funcionó ninguna lectura.
 *
 * `descartadas` son las filas que TODOS los modelos vieron sin cédula legible
 * en una franja: si uno solo la descartó, casi siempre es la fila cortada por
 * el borde, que es normal y no hay que avisar.
 */
export async function leerFranjas(
  franjas: string[],
): Promise<{ filas: CitaConsolidada[]; descartadas: number; lecturasFallidas: number }> {
  const trabajos = franjas.flatMap((franja, i) =>
    MODELOS.map((modelo, prioridad) => ({ i, prioridad, modelo, p: leerPantallazo(franja, modelo) })),
  );
  const resultados = await Promise.allSettled(trabajos.map((t) => t.p));

  const lecturas: Lectura[] = [];
  const descartadasPorFranja: number[] = franjas.map(() => Infinity);
  let lecturasFallidas = 0;
  resultados.forEach((r, k) => {
    const t = trabajos[k];
    if (r.status === 'rejected') {
      lecturasFallidas++;
      console.error(
        `[Digitalizar] ${t.modelo} no leyó la franja ${t.i + 1}:`,
        r.reason instanceof Error ? r.reason.message : r.reason,
      );
      return;
    }
    const { filas, descartadas } = limpiarFilas(r.value);
    descartadasPorFranja[t.i] = Math.min(descartadasPorFranja[t.i], descartadas);
    lecturas.push({ prioridad: t.prioridad, filas });
  });

  if (lecturas.length === 0) throw new Error('Ninguna lectura del pantallazo funcionó');
  return {
    filas: consolidarLecturas(lecturas),
    descartadas: descartadasPorFranja.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0),
    lecturasFallidas,
  };
}

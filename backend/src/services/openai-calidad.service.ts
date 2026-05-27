/**
 * Evaluador de calidad usando OpenAI (gpt-4o-mini) — fallback temporal
 * cuando Anthropic Managed Agents está bloqueado por límite de uso.
 *
 * Mismo contrato que `evaluarConsulta()` de managed-agents-calidad.service:
 *   in:  transcript, formulario, medico, { onProgreso }
 *   out: { sessionId, evaluacion: EvaluacionResult }
 *
 * Reusa `buildAgentDescription` + `buildGraderRubric` para preservar la
 * rúbrica idéntica. La diferencia con Managed Agents es que no hay tool
 * call de escritura ni grader iterativo: pedimos JSON directo con
 * response_format=json_object y validamos shape en parse.
 *
 * El "session_id" guardado en DB queda con prefijo `openai-` para que se
 * distinga del flujo Anthropic (`sesn_...`).
 */

import { openai } from './openai.service';
import {
  buildAgentDescription,
  buildGraderRubric,
} from '../helpers/rubrica-calidad';
import type {
  EvaluacionResult,
  EvaluarConsultaResult,
} from './managed-agents-calidad.service';

type OnProgresoFn = (texto: string) => Promise<void>;

const MODEL = 'gpt-4o-mini';

export async function evaluarConsultaOpenAI(
  transcript: string,
  formulario: Record<string, unknown> | null,
  medico: string | null | undefined,
  opts: { onProgreso?: OnProgresoFn } = {}
): Promise<EvaluarConsultaResult> {
  const emit = async (txt: string): Promise<void> => {
    if (opts.onProgreso) {
      try {
        await opts.onProgreso(txt);
      } catch (_) {
        /* swallow — el progreso es best-effort */
      }
    }
  };

  // buildAgentDescription espera FormularioRow | null. El flujo Anthropic
  // pasa Record<string,unknown> directo, así que replicamos el mismo cast
  // implícito para mantener consistencia.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userPrompt = buildAgentDescription(transcript, formulario as any, medico);
  const graderRubric = buildGraderRubric(medico);

  // El system prompt anula la instrucción del template de "usar tool write"
  // (que solo aplica en Managed Agents) y obliga a respuesta JSON pura.
  const systemPrompt = `Eres un evaluador clínico riguroso de consultas médicas ocupacionales.

REGLAS DE FORMATO:
- Devolvés ÚNICAMENTE JSON válido siguiendo el schema solicitado en el prompt del usuario.
- IGNORÁ cualquier instrucción sobre "tool write" o escribir archivos a /mnt/session/outputs/* — eso aplica solo a otra modalidad. Tu única salida es el JSON.
- Sin preámbulo, sin markdown, sin code fences. Solo el JSON puro.

VERIFICACIÓN INTERNA — antes de emitir el JSON validalo contra esta rúbrica del output:

${graderRubric}

Si algún criterio no se cumple en tu draft inicial, corregilo antes de responder.`;

  await emit(`Enviando transcript a OpenAI (${MODEL})...`);
  const t0 = Date.now();

  const response = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_object' },
    temperature: 0.1,
    max_tokens: 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  await emit(`OpenAI respondió en ${Math.round((Date.now() - t0) / 1000)}s. Parseando evaluación...`);

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI no devolvió contenido en la evaluación.');
  }

  let parsed: EvaluacionResult;
  try {
    parsed = JSON.parse(content) as EvaluacionResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `OpenAI devolvió JSON inválido: ${msg}. Respuesta cruda: ${content.slice(0, 400)}`
    );
  }

  if (!parsed.criterios || !Array.isArray(parsed.criterios) || parsed.criterios.length === 0) {
    throw new Error(
      `OpenAI devolvió un JSON sin array "criterios". Respuesta: ${content.slice(0, 400)}`
    );
  }
  if (!Array.isArray(parsed.recomendaciones)) {
    parsed.recomendaciones = [];
  }
  if (!Array.isArray(parsed.fortalezas)) {
    parsed.fortalezas = [];
  }

  // session_id prefijo para distinguir de Anthropic en la tabla y los logs.
  const sessionId = `openai-${response.id ?? `${Date.now()}`}`;
  return { sessionId, evaluacion: parsed };
}

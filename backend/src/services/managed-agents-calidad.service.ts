/**
 * Cliente Managed Agents (Anthropic SDK beta) para evaluación de calidad de consultas.
 *
 * Lazy init — no instancia el SDK al cargar el módulo.
 *
 * Notas sobre la API beta:
 *   - El SDK expone los recursos directamente bajo `anthropic.beta.{agents,environments,sessions,files}`.
 *   - El header beta `managed-agents-2026-04-01` lo agrega el SDK automáticamente.
 *   - El "outcome" se envía como `user.define_outcome` (soportado bajo el header beta).
 *   - La terminación del turno se detecta con `session.status_idle` / `span.outcome_evaluation_end`.
 *   - El JSON de evaluación se lee del último `agent.message` que contenga `criterios`.
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildAgentDescription, buildGraderRubric } from '../helpers/rubrica-calidad';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export interface EvaluacionCriterio {
  id: string;
  nombre: string;
  puntaje: number;
  evidencia: string;
}

export interface EvaluacionResult {
  criterios: EvaluacionCriterio[];
  fortalezas: string[];
  recomendaciones: string[];
  resumen?: string;
  puntaje_total: number;
}

export interface EvaluarConsultaResult {
  sessionId: string;
  evaluacion: EvaluacionResult;
}

type OnProgresoFn = (texto: string) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Lazy init
// ─────────────────────────────────────────────────────────────────────────────

let _anthropic: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (!_anthropic) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY no configurada');
    }
    _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _anthropic;
}

function getRequiredEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `${key} no configurado. Configura el agente de calidad y pega los IDs en .env.`
    );
  }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// crearSession
// ─────────────────────────────────────────────────────────────────────────────

async function crearSession(): Promise<string> {
  const client = getAnthropic();
  const agentId = getRequiredEnv('ANTHROPIC_AGENT_ID_CALIDAD');
  const environmentId = getRequiredEnv('ANTHROPIC_ENVIRONMENT_ID_CALIDAD');

  // La API de Managed Agents está en beta; usamos `any` para evitar que el
  // compilador TS rechace el acceso a `client.beta.sessions` que aún no
  // tiene tipos completos en todas las versiones del SDK.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaClient = client as any;

  const session = await betaClient.beta.sessions.create({
    agent: agentId,
    environment_id: environmentId,
    metadata: { app: 'bodytech-consulta', purpose: 'evaluacion-calidad-consulta' },
  });
  return session.id as string;
}

// ─────────────────────────────────────────────────────────────────────────────
// enviarOutcome
// ─────────────────────────────────────────────────────────────────────────────

async function enviarOutcome(
  sessionId: string,
  transcript: string,
  formulario: Record<string, unknown> | null,
  medico: string | null | undefined
): Promise<void> {
  const client = getAnthropic();
  const description = buildAgentDescription(transcript, formulario, medico);
  const rubric = buildGraderRubric(medico);
  console.log(
    `[managed-agents-calidad] enviarOutcome — description ${description.length} chars, rubric ${rubric.length} chars, transcript ${(transcript || '').length} chars`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaClient = client as any;
  await betaClient.beta.sessions.events.send(sessionId, {
    events: [
      {
        type: 'user.define_outcome',
        description,
        rubric: { type: 'text', content: rubric },
        max_iterations: 1,
      },
    ],
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// esperarResultado
// ─────────────────────────────────────────────────────────────────────────────

const EVENTO_LABEL: Record<string, string> = {
  'session.status_active': 'Agente iniciado. Analizando el transcript...',
  'agent.thinking': 'Agente leyendo y razonando sobre la consulta...',
  'agent.tool_use': 'Agente ejecutando herramienta de escritura...',
  'agent.tool_result': 'Herramienta ejecutada. Continuando análisis...',
  'agent.message': 'Agente generando el informe de evaluación...',
  'span.outcome_evaluation_start': 'Evaluador revisando el informe generado...',
};

function elapsed(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function esperarResultado(
  sessionId: string,
  opts: { timeoutMs?: number; pollMs?: number; onProgreso?: OnProgresoFn } = {}
): Promise<void> {
  const { timeoutMs = 120_000, pollMs = 5_000, onProgreso } = opts;
  const client = getAnthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaClient = client as any;
  const startedAt = Date.now();

  const emit = async (txt: string): Promise<void> => {
    if (onProgreso) {
      try {
        await onProgreso(txt);
      } catch (_) {
        /* swallow */
      }
    }
  };

  const tiposVistos = new Set<string>();
  let iteracion = 0;
  let ultimoHeartbeat = Date.now();
  const HEARTBEAT_MS = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let errorEvent: any = null;
    let endTurnSeen = false;
    let terminated = false;

    try {
      for await (const ev of betaClient.beta.sessions.events.list(sessionId, { order: 'asc' })) {
        console.log(
          `[managed-agents-calidad] ev.type=${ev.type}`,
          ev.stop_reason ? `stop=${JSON.stringify(ev.stop_reason)}` : '',
          ev.result ? `result=${ev.result}` : ''
        );

        if (ev.type === 'session.error') errorEvent = ev;
        if (ev.type === 'session.status_terminated') terminated = true;

        if (EVENTO_LABEL[ev.type] && !tiposVistos.has(ev.type)) {
          tiposVistos.add(ev.type);
          await emit(EVENTO_LABEL[ev.type]);
        }

        if (ev.type === 'span.outcome_evaluation_end') {
          const result: string = ev.result;
          console.log(`[managed-agents-calidad] grader result=${result}`);
          if (result === 'needs_revision') {
            iteracion++;
            tiposVistos.delete('agent.message');
            tiposVistos.delete('agent.tool_use');
            tiposVistos.delete('agent.tool_result');
            tiposVistos.delete('span.outcome_evaluation_start');
            await emit(`Evaluador solicitó ajustes. Agente corrigiendo (iteración ${iteracion + 1})...`);
          } else if (result === 'failed') {
            throw new Error(
              `El grader marcó la evaluación como fallida: ${ev.explanation || '(sin detalle)'}`
            );
          } else if (result === 'satisfied' || result === 'max_iterations_reached') {
            await emit('Evaluador aprobó el informe. Finalizando...');
            endTurnSeen = true;
          }
        }

        if (ev.type === 'session.status_idle') {
          const stop = ev.stop_reason || {};
          console.log(
            `[managed-agents-calidad] session.status_idle stop_reason:`,
            JSON.stringify(stop)
          );
          if (stop.type === 'retries_exhausted') {
            throw new Error('El agente agotó sus reintentos sin completar la evaluación.');
          } else if (stop.type === 'requires_action') {
            throw new Error(
              'El agente requiere confirmación de tool; configurar write como ALWAYS_ALLOW en el Environment.'
            );
          } else {
            endTurnSeen = true;
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('reintentos') ||
        msg.includes('confirmación') ||
        msg.includes('grader') ||
        msg.includes('fallida')
      ) {
        throw err;
      }
      console.warn('[managed-agents-calidad] error listando eventos:', msg);
    }

    if (errorEvent) {
      const msg =
        (errorEvent.error && errorEvent.error.message) ||
        'Error desconocido en la sesión Managed Agents';
      throw new Error(`Sesión Managed Agents falló: ${msg}`);
    }
    if (terminated) throw new Error('Sesión Managed Agents terminada inesperadamente.');
    if (endTurnSeen) return;

    const ahora = Date.now();
    if (ahora - ultimoHeartbeat >= HEARTBEAT_MS) {
      ultimoHeartbeat = ahora;
      await emit(`Agente procesando... (${elapsed(ahora - startedAt)} transcurridos)`);
    }

    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout (${timeoutMs}ms) esperando que el agente complete la evaluación.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// obtenerEvaluacionDeEventos
// ─────────────────────────────────────────────────────────────────────────────

function intentarParsearJSON(text: string): EvaluacionResult | null {
  // Estrategia 1: bloque ```json ... ```
  const bloqueMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (bloqueMatch) {
    try {
      return JSON.parse(bloqueMatch[1].trim()) as EvaluacionResult;
    } catch (_) {
      /* sigue */
    }
  }
  // Estrategia 2: desde el primer { hasta el último }
  const inicio = text.indexOf('{');
  const fin = text.lastIndexOf('}');
  if (inicio !== -1 && fin > inicio) {
    try {
      return JSON.parse(text.slice(inicio, fin + 1)) as EvaluacionResult;
    } catch (_) {
      /* sigue */
    }
  }
  // Estrategia 3: texto completo
  try {
    return JSON.parse(text.trim()) as EvaluacionResult;
  } catch (_) {
    return null;
  }
}

async function obtenerEvaluacionDeEventos(sessionId: string): Promise<EvaluacionResult> {
  const client = getAnthropic();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const betaClient = client as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mensajes: any[] = [];

  for await (const ev of betaClient.beta.sessions.events.list(sessionId, { order: 'asc' })) {
    if (ev.type === 'agent.message' && Array.isArray(ev.content)) {
      mensajes.push(ev);
    }
  }

  if (mensajes.length === 0) {
    throw new Error('El agente no produjo ningún mensaje de texto en la sesión.');
  }

  // Recorrer de último a primero: el JSON del agente puede no ser el último mensaje.
  for (let i = mensajes.length - 1; i >= 0; i--) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const text: string = mensajes[i].content
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((b: any) => b.type === 'text')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((b: any) => b.text as string)
      .join('');
    const parsed = intentarParsearJSON(text);
    if (parsed && parsed.criterios) return parsed;
  }

  const textUltimo: string = mensajes[mensajes.length - 1].content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.type === 'text')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.text as string)
    .join('');
  throw new Error(
    `No se pudo parsear la evaluación de ningún mensaje del agente. Último contenido: ${textUltimo.slice(0, 400)}`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// API pública
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta el ciclo completo: crear sesión → enviar outcome →
 * esperar terminación → leer evaluacion.json.
 */
export async function evaluarConsulta(
  transcript: string,
  formulario: Record<string, unknown> | null,
  medico: string | null | undefined,
  opts: { onProgreso?: OnProgresoFn } = {}
): Promise<EvaluarConsultaResult> {
  const sessionId = await crearSession();
  try {
    await enviarOutcome(sessionId, transcript, formulario, medico);
    await esperarResultado(sessionId, {
      timeoutMs: 600_000,
      pollMs: 6_000,
      onProgreso: opts.onProgreso,
    });
    const evaluacion = await obtenerEvaluacionDeEventos(sessionId);
    return { sessionId, evaluacion };
  } catch (err: unknown) {
    // Anotar el sessionId en el error para diagnóstico
    if (err instanceof Error) {
      (err as Error & { sessionId?: string }).sessionId = sessionId;
    }
    throw err;
  }
}

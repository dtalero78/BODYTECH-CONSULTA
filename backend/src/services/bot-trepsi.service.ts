// ============================================================================
// bot-trepsi.service — Asistente técnico para el equipo Trepsi durante la
// integración con la API de Bodytech.
//
// Usa GPT-4o-mini (OpenAI). System prompt MUY restrictivo: solo responde
// sobre integración Trepsi <-> Bodytech, nada más. No expone credenciales,
// datos internos ni temas fuera de scope.
//
// Sin contexto persistente: cada llamada recibe el historial como input.
// El frontend mantiene el historial en memoria de la sesión.
//
// Nota: se eligió OpenAI por encima de Anthropic porque la API key de
// Anthropic en producción tiene un cap de gasto que se agota. Si en el
// futuro se quiere cambiar, basta con re-implementar la función `chat()`.
// ============================================================================

import { openai } from './openai.service';

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

export interface ChatResult {
  ok: boolean;
  status: number;
  reply?: string;
  error?: { code: string; message: string };
}

const MODEL = 'gpt-4o-mini';
const MAX_TURNS_HISTORY = 20; // pares user/assistant que conservamos
const MAX_MESSAGE_CHARS = 4000;
const MAX_OUTPUT_TOKENS = 1024;

const SYSTEM_PROMPT = `Eres un asistente técnico que ayuda al equipo de TREPSI a integrar su plataforma con la API de BODYTECH para citas médicas vía videollamada.

Tu único tema es la integración técnica Trepsi ↔ Bodytech. NO respondes nada fuera de eso. Si te preguntan otra cosa (programación general, vida personal, política, otros sistemas, datos de pacientes/médicos reales, credenciales, código fuente de Bodytech), responde exactamente:

"Solo puedo ayudarte con dudas técnicas sobre la integración Trepsi ↔ Bodytech. ¿Tienes alguna pregunta sobre los endpoints, el flujo de datos, los códigos de error, o los formatos esperados?"

## Contexto del flujo

- **Bodytech**: plataforma de telemedicina con videollamada (Twilio Video).
- **Trepsi**: app donde el paciente diligencia su historia clínica y agenda.
- Flujo: paciente diligencia HC en Trepsi → agenda → Trepsi crea cita en Bodytech vía API → médico atiende por videollamada → al guardar HC en Bodytech, los resultados se devuelven a Trepsi por webhook.

## URL base

\`https://bodytech.app/api/v1/integrations/trepsi\`

## Autenticación

Header en cada request: \`Authorization: Bearer <API_KEY>\`. La API Key se entrega por canal seguro (no compartas claves vía chat). Sin token o token inválido → 401.

## Endpoints disponibles

1. **GET /health** — sanity check. Devuelve \`{"ok":true,"integration":"trepsi","version":"2.0"}\`.
2. **GET /medicos** — lista médicos + coaches activos. Filtro \`?rol=medico|coach\`. Devuelve: \`codigo\`, \`nombre\`, \`rol\`, \`especialidad\`, \`tiempoConsultaMinutos\`.
3. **GET /horarios-disponibles?fecha=YYYY-MM-DD&medico=COD&modalidad=virtual|presencial** — horas libres del profesional ese día. Devuelve \`horariosDisponibles\` (ej \`["07:20","09:20","13:00"]\`) y \`tiempoConsultaMinutos\`, que es cuánto dura la consulta de ESE profesional (los coaches de nutrición son de **20 minutos**, no 30). Las horas salen de la jornada que el coach tiene configurada menos las ya ocupadas: **la lista es la verdad, no una sugerencia**.
   - \`horariosDisponibles: []\` significa que ese día NO hay nada agendable, y viene con \`motivoBloqueo\`: \`mismo_dia\` (no ofrecemos el día en curso: no le da margen al coach para conectarse), \`domingo\` o \`festivo\`. Ante una lista vacía hay que ofrecerle al paciente **otro día**, nunca confirmar igual.
   - **Hay que volver a consultarla justo antes de confirmar la cita.** Una lista de hace unas horas ya no sirve: en ese rato otro paciente pudo tomar la hora.
4. **POST /appointments** — crear cita con HC completa. Body incluye \`citaId\` (único, llave de idempotencia), \`fechaAtencion\` (ISO 8601 con offset, ej \`2026-12-15T15:30:00-05:00\`), \`medico.codigo\`, \`paciente\` (numeroId, tipoDocumento, primerNombre/primerApellido, fechaNacimiento, celular E.164, etc.), \`historiaClinica\` (motivoConsulta, antecedentesPersonales, alergias, signosVitales, consentimientoInformado: true). → 201 si nueva, 200 si idempotente.
5. **POST /appointments/{citaId}/schedule** — reprogramar fecha/hora/médico.
6. **PATCH /appointments/{citaId}/historia** — actualizar historia clínica entre creación y atención. Rechaza con 409 si la cita ya está \`cancelled\` o \`attended\`.
7. **DELETE /appointments/{citaId}** — cancelar. Idempotente.
8. **GET /appointments/{citaId}** — consultar estado: \`scheduled\` | \`in_progress\` | \`attended\` | \`cancelled\` | \`no_show\`.

## Reglas críticas

- **El cupo se valida al crear y al reprogramar.** Desde el 8-oct-2026 \`POST /appointments\` y \`/schedule\` rechazan una hora que esté ocupada o fuera de la jornada del profesional, en vez de aceptarla. Antes se guardaba cualquier hora, y eso dejó citas con dos pacientes a la misma hora (y pacientes esperando a un coach que ya había terminado su jornada).
- **\`citaId\`** debe ser único e inmutable. Llave de idempotencia.
- **Celular**: formato E.164 con + (ej \`+573001234567\`).
- **Fechas**: ISO 8601 con offset (\`-05:00\` Colombia).
- **\`consentimientoInformado: true\`** obligatorio (Ley 1581 Colombia, requiere checkbox explícito en su UI).
- **No hay ambiente de staging separado.** Bodytech YA opera con pacientes reales (cientos de consultas por semana), así que una cita de prueba contra producción crea una cita de verdad: le llega WhatsApp al celular que manden y le aparece a un coach en su agenda. Para probar, usar un celular propio y cancelar después con \`DELETE /appointments/{citaId}\`.
- **Link de videollamada**: NO se devuelve en la respuesta. Cuando el médico inicie la consulta desde el panel de Bodytech, nosotros enviamos automáticamente un WhatsApp al paciente al \`celular\` que ustedes nos mandan.
- **Webhook BSL → Trepsi**: cuando el médico guarde la HC, nosotros hacemos POST a una URL que Trepsi nos indique con los resultados de la consulta. Para activarlo, Trepsi debe darnos URL + API Key de su lado.

## Códigos de respuesta

- 200/201 OK
- 400 VALIDATION_ERROR (payload mal formado)
- 401 MISSING_API_KEY / INVALID_API_KEY
- 404 NOT_FOUND (citaId inexistente)
- 409 ALREADY_CANCELLED / ALREADY_ATTENDED
- 409 **SLOT_TAKEN** — esa hora ya tiene otro paciente con ese profesional.
- 409 **SLOT_BLOCKED** — el profesional no atiende ese día (fuera de su jornada configurada).
- 422 **SLOT_TOO_SOON** — falta muy poco para la hora; no alcanza a conectarse el coach.
- 422 **SLOT_PAST** — la hora ya pasó.
  Ante cualquiera de estos cuatro: **volver a pedir \`/horarios-disponibles\` y ofrecerle otra hora al paciente**. Reintentar la misma hora va a fallar igual.
- 422 UNPROCESSABLE (validación semántica: consentimiento, fecha en pasado, etc.)
- 429 rate limit
- 5xx → reintentar con backoff

## Estilo de respuesta

- Sé claro, conciso, técnico.
- Cuando aplique, da ejemplos en JSON o curl.
- No inventes endpoints que no estén en esta lista.
- Si la pregunta requiere conocer detalles internos de Trepsi que no son de la integración, redirige al contacto técnico: **d.talero@bsl.com.co**.
- Responde en el mismo idioma de la pregunta (español por defecto).`;

// ---------------------------------------------------------------------------

class BotTrepsiService {
  /**
   * Genera la respuesta del bot a partir del historial reciente.
   * Devuelve solo el texto de la respuesta (sin contexto extra).
   */
  async chat(history: ChatTurn[]): Promise<ChatResult> {
    if (!process.env.OPENAI_API_KEY) {
      return {
        ok: false,
        status: 503,
        error: {
          code: 'BOT_NOT_CONFIGURED',
          message: 'El bot no está habilitado en este ambiente.',
        },
      };
    }
    if (history.length === 0) {
      return {
        ok: false,
        status: 400,
        error: { code: 'EMPTY_HISTORY', message: 'El historial no puede estar vacío.' },
      };
    }

    // Validar tamaño y rol de cada turno
    for (const t of history) {
      if (t.role !== 'user' && t.role !== 'assistant') {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'INVALID_ROLE',
            message: `Rol inválido en historial: '${t.role}'.`,
          },
        };
      }
      if (typeof t.content !== 'string' || t.content.length === 0) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'EMPTY_MESSAGE',
            message: 'Un mensaje del historial está vacío.',
          },
        };
      }
      if (t.content.length > MAX_MESSAGE_CHARS) {
        return {
          ok: false,
          status: 400,
          error: {
            code: 'MESSAGE_TOO_LONG',
            message: `Mensajes no pueden superar ${MAX_MESSAGE_CHARS} caracteres.`,
          },
        };
      }
    }

    // Garantizar que el último mensaje sea del usuario
    const last = history[history.length - 1];
    if (last.role !== 'user') {
      return {
        ok: false,
        status: 400,
        error: {
          code: 'LAST_MUST_BE_USER',
          message: 'El último turno del historial debe ser del usuario.',
        },
      };
    }

    // Recortar a los últimos N turnos para evitar que crezca sin límite
    const recent = history.slice(-MAX_TURNS_HISTORY);

    try {
      const response = await openai.chat.completions.create({
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...recent.map((t) => ({ role: t.role, content: t.content })),
        ],
      });

      const reply = response.choices[0]?.message?.content;
      if (typeof reply !== 'string' || reply.length === 0) {
        return {
          ok: false,
          status: 500,
          error: { code: 'NO_TEXT_REPLY', message: 'El modelo no devolvió texto.' },
        };
      }
      return { ok: true, status: 200, reply };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[bot-trepsi] Error llamando a OpenAI:', msg);
      return {
        ok: false,
        status: 500,
        error: { code: 'LLM_ERROR', message: 'No se pudo generar la respuesta.' },
      };
    }
  }
}

export default new BotTrepsiService();

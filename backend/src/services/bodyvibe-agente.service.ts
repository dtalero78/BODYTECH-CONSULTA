// ============================================================================
// bodyvibe-agente.service — El agente que escribe los apps.
//
// Recibe un pedido en lenguaje natural y devuelve JavaScript que corre dentro
// del recinto aislado. Tres cosas que definen el diseño:
//
//   1) EL CATÁLOGO VA PRIMERO Y NUNCA CAMBIA. Se envía como prefijo estable
//      del prompt con `cache_control`, así que a partir del segundo pedido
//      cuesta una décima parte. El pedido del usuario va después. Si algo
//      volátil (una fecha, un nombre) se colara ANTES del catálogo, la caché
//      se invalida entera y el costo se multiplica por diez.
//
//   2) SALIDA ESTRUCTURADA. El modelo devuelve `{titulo, codigo, notas}` con
//      esquema forzado, no texto del que haya que extraer un bloque de código.
//      Elimina una clase entera de fallas: la respuesta o valida o no llega.
//
//   3) EL TOPE DE GASTO SE VERIFICA ANTES DE LLAMAR. Un bucle de reintentos es
//      la forma clásica de despertar con una factura absurda, y una alerta
//      llega tarde. El corte es duro.
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import postgresService from './postgres.service';
import bodyvibeCatalogoService from './bodyvibe-catalogo.service';

/** Decisión 11: el modelo potente. */
const MODELO = 'claude-opus-5';

/**
 * Techo de salida. Tiene que ser generoso porque en Opus 5 el razonamiento
 * cuenta contra el mismo tope que el texto: un `max_tokens` ajustado corta la
 * respuesta a mitad de un app.
 */
const MAX_TOKENS = 32_000;

/** Tope de gasto mensual en dólares. Configurable, con default de la decisión 11. */
const TOPE_USD = Number(process.env.BODYVIBE_TOPE_USD ?? 150);

/** Precios de lista de Opus 5, por millón de tokens. */
const PRECIO = {
  entrada: 5,
  salida: 25,
  /** Escribir en caché cuesta 1,25×; leer, 0,1×. */
  escrituraCache: 5 * 1.25,
  lecturaCache: 5 * 0.1,
};

const ESQUEMA_RESPUESTA = {
  type: 'object' as const,
  properties: {
    titulo: {
      type: 'string',
      description: 'Nombre corto del app, en español, como lo llamaría quien lo pidió.',
    },
    codigo: {
      type: 'string',
      description:
        'JavaScript que pinta dentro de #app. Sin etiquetas <script>, sin markdown, sin import/require.',
    },
    notas: {
      type: 'string',
      description:
        'Dos o tres frases para quien lo pidió: qué hace, y sobre todo qué NO pudo hacerse y por qué (datos que faltan, cobertura baja).',
    },
  },
  required: ['titulo', 'codigo', 'notas'],
  additionalProperties: false,
};

/**
 * Instrucciones del agente. Van ANTES del catálogo y también son estables:
 * juntas forman el prefijo cacheado.
 */
const INSTRUCCIONES = `Sos el constructor de aplicaciones internas de Bodytech, una plataforma de
telemedicina. Alguien del equipo te describe algo que necesita y vos escribís
el JavaScript que lo construye.

# Dónde corre lo que escribís

Tu código corre dentro de un recinto aislado, en el navegador de quien lo pidió.
Pintás dentro de un \`<div id="app">\` que ya existe. No hay red: \`fetch\`,
\`XMLHttpRequest\` y \`WebSocket\` están bloqueados por política del navegador y
fallan siempre. No hay \`import\` ni \`require\` ni librerías externas: solo
JavaScript del navegador. Tampoco hay \`localStorage\`.

Tenés exactamente dos funciones disponibles:

    const filas = await bv.query(sql, params)   // consulta los datos; lanza excepción con mensaje legible
    bv.ready()                                  // avisá cuando terminaste de pintar

\`bv.query\` recibe SQL de PostgreSQL. Usá parámetros posicionales (\`$1\`, \`$2\`)
para cualquier valor variable — nunca los pegues dentro del texto del SQL.

# Reglas del código

Envolvé todo en una función asíncrona y llamala. Manejá los errores de
\`bv.query\` con try/catch y mostrá el mensaje en pantalla: un recuadro en blanco
no le dice nada a nadie.

Llamá a \`bv.ready()\` cuando termines de pintar, incluso si hubo error.

Usá las variables CSS \`--bv-*\` que ya están definidas (\`--bv-texto\`,
\`--bv-acento\`, \`--bv-linea\`, \`--bv-superficie\`, \`--bv-tenue\`) y las clases
\`.bv-tarjeta\`, \`.bv-scroll\`, \`button.bv-primario\`. Así lo que construís se ve
parte de la plataforma. No inventes una paleta nueva.

Para gráficos usá SVG o \`<canvas>\` a mano. No hay librerías de gráficos.

Escribí los textos en español, dirigidos a alguien del equipo de Bodytech, no a
un programador.

# Reglas sobre los datos — las importantes

Solo podés leer, y solo de los estantes que aparecen en el catálogo. No existe
forma de escribir. Si te piden un botón que cambie algo, explicá en \`notas\` que
eso se hace desde la pantalla correspondiente de la plataforma.

Nunca inventes un dato que no existe. Si el pedido necesita algo que ningún
estante tiene, decilo en \`notas\` y construí lo que sí se pueda — o nada, si no
queda nada en pie. Un app vacío es un problema; un app con números inventados es
un desastre que nadie detecta.

Cuando agrupes por un campo que tiene huecos, consultá \`bv_cobertura\` y mostrá
la cobertura junto al resultado. "Bogotá: 409" es engañoso si 2.072 registros no
tienen ciudad; "Bogotá: 409 (de 811 con ciudad registrada)" es honesto. Esta es
la regla que más veces va a salvar un reporte.

Pedí solo lo que vas a mostrar. Hay un corte a los 5 segundos y un tope de
filas: agrupá y filtrá en el SQL en vez de traerte todo y procesarlo en
JavaScript.

Hacé una consulta por dato que necesites, no una por fila. Un ciclo que llama a
\`bv.query\` dentro de un \`for\` se corta solo y con razón.`;

export interface PedidoAgente {
  /** Lo que pidió la persona, en sus palabras. */
  pedido: string;
  /** Código actual del app, cuando se está iterando sobre algo que ya existe. */
  codigoActual?: string | null;
  /** Pedidos anteriores de esta misma sesión, del más viejo al más nuevo. */
  historial?: { pedido: string; titulo: string }[];
  actor: { usuarioId?: number | null; email?: string | null; appId?: string | null };
}

export interface RespuestaAgente {
  titulo: string;
  codigo: string;
  notas: string;
  uso: { entrada: number; escrituraCache: number; lecturaCache: number; salida: number; costoUsd: number };
}

export type ResultadoAgente =
  | { ok: true; resultado: RespuestaAgente }
  | { ok: false; code: 'sin_llave' | 'tope_alcanzado' | 'rechazado' | 'error'; mensaje: string };

let cliente: Anthropic | null = null;
function obtenerCliente(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

class BodyVibeAgenteService {
  /** Gasto del mes en curso, en dólares. */
  async gastoDelMes(): Promise<number> {
    const filas = await postgresService.query(
      `SELECT COALESCE(SUM(costo_usd), 0)::float8 AS total
         FROM bodyvibe_uso
        WHERE created_at >= date_trunc('month', NOW())`
    );
    return filas?.[0]?.total ?? 0;
  }

  async estadoDeGasto(): Promise<{ gastadoUsd: number; topeUsd: number; disponible: boolean }> {
    const gastadoUsd = await this.gastoDelMes();
    return { gastadoUsd, topeUsd: TOPE_USD, disponible: gastadoUsd < TOPE_USD };
  }

  private costo(uso: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  }): number {
    const escritura = uso.cache_creation_input_tokens ?? 0;
    const lectura = uso.cache_read_input_tokens ?? 0;
    return (
      (uso.input_tokens * PRECIO.entrada +
        escritura * PRECIO.escrituraCache +
        lectura * PRECIO.lecturaCache +
        uso.output_tokens * PRECIO.salida) /
      1_000_000
    );
  }

  async generar(entrada: PedidoAgente): Promise<ResultadoAgente> {
    const client = obtenerCliente();
    if (!client) {
      return {
        ok: false,
        code: 'sin_llave',
        mensaje: 'Falta configurar ANTHROPIC_API_KEY. BodyVibeTech no puede generar apps.',
      };
    }

    // TODO lo que sigue va dentro del try. Cualquier excepción que se escape de
    // acá termina en el manejador global de errores, que responde
    // `{success, error}` sin campo `mensaje` — y el usuario ve "Intentalo de
    // nuevo" sin la menor idea de qué pasó. Ese silencio es peor que la falla.
    try {
      const gasto = await this.estadoDeGasto();
      if (!gasto.disponible) {
        return {
          ok: false,
          code: 'tope_alcanzado',
          mensaje:
            `BodyVibeTech llegó al tope de gasto del mes (USD ${gasto.topeUsd}). ` +
            'Se reanuda el primero del mes que viene, o subiendo el tope si esto fue inesperado.',
        };
      }

      const catalogo = await bodyvibeCatalogoService.comoTexto();

      // El pedido y el código actual son lo único que cambia entre llamadas,
      // así que van en `messages`, después del prefijo cacheado.
      const mensajes: Anthropic.MessageParam[] = [];

      for (const h of entrada.historial ?? []) {
        mensajes.push({ role: 'user', content: h.pedido });
        mensajes.push({ role: 'assistant', content: `Construí "${h.titulo}".` });
      }

      const pedidoFinal = entrada.codigoActual
        ? `Este es el código actual del app:\n\n\`\`\`javascript\n${entrada.codigoActual}\n\`\`\`\n\n` +
          `Modificalo según este pedido, devolviendo el código COMPLETO ya modificado:\n\n${entrada.pedido}`
        : entrada.pedido;

      mensajes.push({ role: 'user', content: pedidoFinal });

      // Streaming porque `max_tokens` es alto: una petición sin streaming con
      // este techo se arriesga a que la conexión expire antes de la respuesta.
      const stream = client.messages.stream({
        model: MODELO,
        max_tokens: MAX_TOKENS,
        system: [
          {
            type: 'text',
            text: `${INSTRUCCIONES}\n\n---\n\n${catalogo}`,
            // Una hora: quien itera sobre un app hace seis o siete pedidos en
            // esa ventana, y todos leen la caché en vez de reescribirla.
            cache_control: { type: 'ephemeral', ttl: '1h' },
          },
        ],
        messages: mensajes,
        output_config: { format: { type: 'json_schema', schema: ESQUEMA_RESPUESTA } },
      });

      const respuesta = await stream.finalMessage();

      // Opus 5 puede declinar un pedido; llega como respuesta exitosa, no como
      // error. Leer `content[0]` sin mirar esto rompe con un mensaje que no
      // ayuda a nadie.
      if (respuesta.stop_reason === 'refusal') {
        return {
          ok: false,
          code: 'rechazado',
          mensaje: 'El modelo no pudo atender ese pedido. Probá describiéndolo de otra forma.',
        };
      }

      const texto = respuesta.content.find((b) => b.type === 'text');
      if (!texto || texto.type !== 'text') {
        return { ok: false, code: 'error', mensaje: 'El modelo no devolvió una respuesta utilizable.' };
      }

      const datos = JSON.parse(texto.text) as { titulo: string; codigo: string; notas: string };

      const u = respuesta.usage;
      const costoUsd = this.costo(u);
      const uso = {
        entrada: u.input_tokens,
        escrituraCache: u.cache_creation_input_tokens ?? 0,
        lecturaCache: u.cache_read_input_tokens ?? 0,
        salida: u.output_tokens,
        costoUsd,
      };

      await this.registrarUso(entrada.actor, uso);

      return { ok: true, resultado: { ...datos, uso } };
    } catch (error: any) {
      console.error('❌ [BodyVibe] Error generando el app:', error?.message ?? error);
      return {
        ok: false,
        code: 'error',
        mensaje: error?.message ?? 'No se pudo generar el app en este momento.',
      };
    }
  }

  private async registrarUso(
    actor: PedidoAgente['actor'],
    uso: RespuestaAgente['uso']
  ): Promise<void> {
    // Se espera el INSERT (no es fire-and-forget como la bitácora de lecturas):
    // si el registro de gasto se pierde, el tope deja de ser un tope.
    await postgresService.query(
      `INSERT INTO bodyvibe_uso
         (app_id, usuario_id, email, modelo, input_tokens, cache_write, cache_read, output_tokens, costo_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        actor.appId ?? null,
        actor.usuarioId ?? null,
        actor.email ?? null,
        MODELO,
        uso.entrada,
        uso.escrituraCache,
        uso.lecturaCache,
        uso.salida,
        uso.costoUsd,
      ]
    );
  }
}

export const bodyvibeAgenteService = new BodyVibeAgenteService();
export default bodyvibeAgenteService;

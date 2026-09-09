// ============================================================================
// La redacción del informe corporativo.
//
// Los números los cuenta `informe-corporativo.service`. Acá se escriben los
// párrafos que los interpretan: "el 61% está por encima del peso saludable,
// esto advierte sobre una carga metabólica instalada…".
//
// Es un BORRADOR, y el informe lo dice. El médico lo ajusta y lo firma: un
// informe clínico que se entrega a una empresa no puede salir sin que un
// profesional se haga responsable de lo que afirma.
//
// Reglas que van en el prompt y no son de estilo:
//   · No inventar cifras. Sólo puede citar los números que se le entregan.
//   · No diagnosticar a nadie en particular. El informe es poblacional.
//   · Si una sección viene vacía, decir que no hubo dato — no rellenar.
// ============================================================================

import { getAnthropic } from './managed-agents-calidad.service';
import type { DatosInforme } from './informe-corporativo.service';

const MODELO = 'claude-opus-5';

export interface Redaccion {
  oportunidad: string;
  demografia: string;
  imc: string;
  actividad: string;
  sedentarismo: string;
  aptitud: string;
  nivel: string;
  riesgo: string;
  diagnosticos: string;
  conclusiones: string[];
  recomendaciones: string[];
}

const ESQUEMA = {
  type: 'object',
  properties: {
    oportunidad: { type: 'string' },
    demografia: { type: 'string' },
    imc: { type: 'string' },
    actividad: { type: 'string' },
    sedentarismo: { type: 'string' },
    aptitud: { type: 'string' },
    nivel: { type: 'string' },
    riesgo: { type: 'string' },
    diagnosticos: { type: 'string' },
    conclusiones: { type: 'array', items: { type: 'string' } },
    recomendaciones: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'oportunidad', 'demografia', 'imc', 'actividad', 'sedentarismo',
    'aptitud', 'nivel', 'riesgo', 'diagnosticos', 'conclusiones', 'recomendaciones',
  ],
  additionalProperties: false,
} as const;

const INSTRUCCIONES = `Sos médico del deporte y escribís el informe mensual que Bodytech le entrega a una empresa cliente sobre las valoraciones hechas a sus colaboradores.

Escribí en español de Colombia, en tercera persona, tono clínico y sobrio. Nada de marketing.

REGLAS QUE NO SE NEGOCIAN:
1. Sólo podés citar las cifras que aparecen en los datos que te doy. No estimes, no redondees a un número distinto, no compares contra promedios nacionales salvo que el dato venga en la entrada.
2. El informe es POBLACIONAL. Nunca te refieras a una persona concreta ni infieras diagnósticos individuales.
3. Si una sección no tiene datos, escribí una sola frase diciendo que no hubo registros en el periodo. No rellenes.
4. Cada párrafo: 3 a 6 frases. Primero qué muestra el dato, después qué implica para la salud del grupo y la operación de la empresa.
5. Las conclusiones y recomendaciones son listas de 3 a 5 puntos, concretos y accionables por el área de bienestar de la empresa.
6. No uses las palabras "inteligencia artificial" ni "IA".`;

/**
 * Redacta los análisis. Nunca lanza: si el modelo no responde, el informe sale
 * con las gráficas y los espacios en blanco para que el médico los escriba —
 * mejor un informe sin análisis que ningún informe.
 */
export async function redactar(datos: DatosInforme): Promise<Redaccion | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const stream = getAnthropic().messages.stream({
      model: MODELO,
      max_tokens: 4000,
      system: [{ type: 'text', text: INSTRUCCIONES }],
      messages: [
        {
          role: 'user',
          content:
            `Empresa: ${datos.empresa}\nPeriodo: ${datos.desde} a ${datos.hasta}\n` +
            `Valoraciones efectivas: ${datos.total}\n\n` +
            `Datos (JSON):\n${JSON.stringify(datos, null, 2)}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: ESQUEMA } },
    });
    const mensaje = await stream.finalMessage();
    const texto = mensaje.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    return JSON.parse(texto) as Redaccion;
  } catch (e) {
    console.error(
      '⚠️ [informe] no se pudo redactar el análisis; el informe sale con las gráficas:',
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface PatientData {
  // Datos demográficos
  edad?: number;
  genero?: string;
  estadoCivil?: string;
  hijos?: string;
  ejercicio?: string;

  // Datos de empresa
  codEmpresa?: string;
  cargo?: string;
  tipoExamen?: string;

  // Antecedentes
  antecedentesFamiliares?: string;
  encuestaSalud?: string;
  empresa1?: string;

  // Antecedentes personales (condiciones positivas)
  condicionesPositivas?: string[];

  // Antropometría
  talla?: string;
  peso?: string;
  imc?: string;
  pesoHabitual?: string;
  circunferenciaCintura?: string;
  circunferenciaCadera?: string;
  porcentajeGrasa?: string;
  masaMuscular?: string;

  // Evaluación dietética
  recordatorio24h?: string;
  numComidasDia?: string;
  consumoAgua?: string;
  preferenciasAlimentarias?: string;
  alergiasAlimentarias?: string;
  suplementos?: string;
  cambiosPesoRecientes?: string;

  // Evaluación clínica nutricional
  signosClinicos?: string;
  problemasDigestivos?: string;
  masticacionDeglucion?: string;

  // Laboratorios
  laboratorios?: Record<string, string>;

  // Antecedentes adicionales
  medicamentosActuales?: string;
  alergias?: string;
  cirugias?: string;
  hospitalizaciones?: string;
  descripcionEnfermedad?: string;
}

export const generateMedicalRecommendations = async (
  patientData: PatientData
): Promise<string> => {
  try {
    // Construir el contexto del paciente
    const context = buildPatientContext(patientData);

    const prompt = `
Eres un médico nutricionista clínico experto. Basándote en la siguiente información del paciente, genera un análisis completo con dos secciones:

${context}

INSTRUCCIONES:
Genera el análisis en DOS secciones claramente separadas:

SECCION 1 - ANALISIS DEL PERFIL NUTRICIONAL:
- Identifica los puntos críticos y hallazgos relevantes del paciente
- Señala factores de riesgo nutricional (sobrepeso/obesidad, desnutrición, deficiencias, etc.)
- Analiza la relación entre los laboratorios y el estado nutricional
- Identifica patrones dietéticos problemáticos
- Evalúa la composición corporal si hay datos antropométricos
- Correlaciona antecedentes médicos con el perfil nutricional
- Máximo 8-10 puntos concisos

SECCION 2 - PLAN NUTRICIONAL SUGERIDO (BASADO EN EVIDENCIA):
- Requerimiento calórico estimado (usando Harris-Benedict o Mifflin-St Jeor si hay datos)
- Distribución de macronutrientes recomendada (% y gramos)
- Recomendaciones alimentarias específicas para las condiciones del paciente
- Alimentos a incluir y a limitar
- Frecuencia y horarios de comidas sugeridos
- Suplementación si es necesaria (con dosis basadas en evidencia)
- Metas nutricionales a corto y mediano plazo
- Cita las guías o referencias científicas aplicables (OMS, ADA, ESPEN, etc.)

FORMATO:
- Escribe en texto plano SIN formato markdown. NO uses asteriscos, negritas ni cursivas.
- Usa numeración simple (1., 2., 3.)
- Separa las secciones con una línea que diga: --- PLAN NUTRICIONAL SUGERIDO ---
- Sé específico y práctico

IMPORTANTE: Al final de tu respuesta, agrega un bloque JSON delimitado así:
---JSON_CAMPOS---
{
  "diagnosticoNutricional": "Diagnóstico nutricional completo del paciente (ej: Sobrepeso con patrón alimentario hipercalórico, dislipidemia mixta...)",
  "observacionesNutricionales": "Observaciones clínicas nutricionales relevantes encontradas en la evaluación",
  "requerimientoCalorico": "Valor calórico calculado con fórmula (ej: 2200 kcal/día (déficit de 500 kcal para pérdida gradual))",
  "distribucionMacronutrientes": "Distribución recomendada en formato: CHO: X% (Xg), Proteína: Y% (Yg), Grasa: Z% (Zg). Fibra mínimo Xg/día.",
  "planAlimentario": "Plan alimentario detallado por tiempos de comida: Desayuno, Media mañana, Almuerzo, Tarde, Cena. Separado por líneas.",
  "actividadFisicaPlan": "Tipo, frecuencia e intensidad de actividad física recomendada",
  "recomendacionesNutricionales": "Recomendaciones nutricionales específicas para el paciente, separadas por líneas"
}
---FIN_JSON---

Llena TODOS los campos JSON con información específica del paciente. No dejes campos vacíos.
    `.trim();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Eres un médico nutricionista clínico colombiano con especialización en nutrición clínica y deportiva. Generas análisis nutricionales detallados y planes alimentarios basados en evidencia científica. Siempre citas las guías o consensos que respaldan tus recomendaciones.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.6,
      max_tokens: 2000,
    });

    const recommendations =
      response.choices[0]?.message?.content?.trim() || '';

    if (!recommendations) {
      throw new Error('No se generaron recomendaciones');
    }

    return recommendations;
  } catch (error: any) {
    console.error('Error generating AI recommendations:', error);
    throw new Error(
      `Error al generar recomendaciones con IA: ${error.message}`
    );
  }
};

function buildPatientContext(data: PatientData): string {
  const sections: string[] = [];

  // Datos demográficos
  sections.push(`DATOS DEL PACIENTE:
- Edad: ${data.edad || 'No especificada'}
- Género: ${data.genero || 'No especificado'}
- Estado Civil: ${data.estadoCivil || 'No especificado'}
- Hijos: ${data.hijos || 'No especificado'}
- Actividad física: ${data.ejercicio || 'No especificado'}
- Cargo: ${data.cargo || 'No especificado'}`);

  // Antropometría
  const antropometria: string[] = [];
  if (data.talla) antropometria.push(`- Talla: ${data.talla} cm`);
  if (data.peso) antropometria.push(`- Peso actual: ${data.peso} kg`);
  if (data.imc) antropometria.push(`- IMC: ${data.imc}`);
  if (data.pesoHabitual) antropometria.push(`- Peso habitual: ${data.pesoHabitual} kg`);
  if (data.circunferenciaCintura) antropometria.push(`- Circunferencia cintura: ${data.circunferenciaCintura} cm`);
  if (data.circunferenciaCadera) antropometria.push(`- Circunferencia cadera: ${data.circunferenciaCadera} cm`);
  if (data.porcentajeGrasa) antropometria.push(`- % Grasa corporal: ${data.porcentajeGrasa}%`);
  if (data.masaMuscular) antropometria.push(`- Masa muscular: ${data.masaMuscular} kg`);
  if (antropometria.length > 0) {
    sections.push(`ANTROPOMETRIA:\n${antropometria.join('\n')}`);
  }

  // Antecedentes
  const antecedentes: string[] = [];
  if (data.condicionesPositivas && data.condicionesPositivas.length > 0) {
    antecedentes.push(`- Condiciones: ${data.condicionesPositivas.join(', ')}`);
  }
  if (data.antecedentesFamiliares) antecedentes.push(`- Antecedentes familiares: ${data.antecedentesFamiliares}`);
  if (data.medicamentosActuales) antecedentes.push(`- Medicamentos: ${data.medicamentosActuales}`);
  if (data.alergias) antecedentes.push(`- Alergias: ${data.alergias}`);
  if (data.cirugias) antecedentes.push(`- Cirugías: ${data.cirugias}`);
  if (data.hospitalizaciones) antecedentes.push(`- Hospitalizaciones: ${data.hospitalizaciones}`);
  if (data.descripcionEnfermedad) antecedentes.push(`- Enfermedad actual: ${data.descripcionEnfermedad}`);
  if (antecedentes.length > 0) {
    sections.push(`ANTECEDENTES:\n${antecedentes.join('\n')}`);
  }

  // Evaluación dietética
  const dieta: string[] = [];
  if (data.recordatorio24h) dieta.push(`- Recordatorio 24h: ${data.recordatorio24h}`);
  if (data.numComidasDia) dieta.push(`- Comidas al día: ${data.numComidasDia}`);
  if (data.consumoAgua) dieta.push(`- Consumo de agua: ${data.consumoAgua}`);
  if (data.preferenciasAlimentarias) dieta.push(`- Preferencias: ${data.preferenciasAlimentarias}`);
  if (data.alergiasAlimentarias) dieta.push(`- Alergias alimentarias: ${data.alergiasAlimentarias}`);
  if (data.suplementos) dieta.push(`- Suplementos: ${data.suplementos}`);
  if (data.cambiosPesoRecientes) dieta.push(`- Cambios peso recientes: ${data.cambiosPesoRecientes}`);
  if (dieta.length > 0) {
    sections.push(`EVALUACION DIETETICA:\n${dieta.join('\n')}`);
  }

  // Evaluación clínica
  const clinica: string[] = [];
  if (data.signosClinicos) clinica.push(`- Signos clínicos: ${data.signosClinicos}`);
  if (data.problemasDigestivos) clinica.push(`- Problemas digestivos: ${data.problemasDigestivos}`);
  if (data.masticacionDeglucion) clinica.push(`- Masticación/deglución: ${data.masticacionDeglucion}`);
  if (clinica.length > 0) {
    sections.push(`EVALUACION CLINICA:\n${clinica.join('\n')}`);
  }

  // Laboratorios
  if (data.laboratorios) {
    const labs: string[] = [];
    const labNames: Record<string, string> = {
      glucosa: 'Glucosa', hba1c: 'HbA1c', colesterolTotal: 'Colesterol total',
      ldl: 'LDL', hdl: 'HDL', trigliceridos: 'Triglicéridos',
      hemoglobina: 'Hemoglobina', ferritina: 'Ferritina',
      vitaminaD: 'Vitamina D', vitaminaB12: 'Vitamina B12',
    };
    for (const [key, name] of Object.entries(labNames)) {
      const resultado = data.laboratorios[`${key}Resultado`];
      if (resultado) {
        const fecha = data.laboratorios[`${key}Fecha`];
        labs.push(`- ${name}: ${resultado}${fecha ? ` (${fecha})` : ''}`);
      }
    }
    if (labs.length > 0) {
      sections.push(`LABORATORIOS:\n${labs.join('\n')}`);
    }
  }

  return sections.join('\n\n');
}

export default {
  generateMedicalRecommendations,
};

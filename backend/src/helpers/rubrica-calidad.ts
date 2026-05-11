/**
 * Rúbricas de Evaluación de Calidad de Consultas — BODYTECH.
 *
 * RUBRICA             → 8 criterios, consulta médica ocupacional
 * RUBRICA_PSICOLOGICA → 15 criterios, valoración psicológica ocupacional (médico YURI)
 *
 * puntaje_total = suma_ponderada × 20  →  escala [20, 100].
 * Detección automática: getRubrica(medico) devuelve la rúbrica correcta.
 */

export interface CriterioRubrica {
  id: string;
  nombre: string;
  peso: number;
  descripcion: string;
}

export type TipoRubrica = 'medica' | 'psicologica';

export interface RubricaResult {
  rubrica: CriterioRubrica[];
  tipo: TipoRubrica;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rúbrica 1 — Consulta Médica Ocupacional
// ─────────────────────────────────────────────────────────────────────────────
const RUBRICA: CriterioRubrica[] = [
  {
    id: 'identificacion_paciente',
    nombre: 'Identificación del Paciente',
    peso: 0.10,
    descripcion:
      'El paciente diligencia sus datos antes de la consulta. El médico debe confirmar/verificar nombre, documento, edad, empresa y cargo — no necesariamente preguntarlos desde cero. Si el formulario pre-llenado ya los contiene, basta con que el médico los corrobore verbalmente o los mencione al inicio.',
  },
  {
    id: 'anamnesis_completa',
    nombre: 'Anamnesis Completa',
    peso: 0.20,
    descripcion:
      'El paciente declaró antecedentes personales, familiares y hábitos en el formulario pre-consulta. El médico debe profundizar, aclarar y completar — no repetir preguntas ya respondidas. Evalúa si aborda antecedentes ocupacionales (cargo, tiempo de exposición, riesgos del puesto) que no cubre el formulario, y si clarifica o amplía los antecedentes patológicos relevantes para el cargo.',
  },
  {
    id: 'examen_ocupacional',
    nombre: 'Examen Ocupacional',
    peso: 0.20,
    descripcion:
      'Realiza examen físico orientado al cargo (osteomuscular, cardiopulmonar, visual, auditivo, dermatológico) acorde a los riesgos del puesto de trabajo.',
  },
  {
    id: 'comunicacion_efectiva',
    nombre: 'Comunicación Efectiva',
    peso: 0.15,
    descripcion:
      'Lenguaje claro y empático, escucha activa, explica hallazgos en términos comprensibles, valida entendimiento del paciente, evita tecnicismos innecesarios.',
  },
  {
    id: 'diagnostico_aptitud',
    nombre: 'Diagnóstico y Aptitud (APTO/NO APTO/APLAZADO)',
    peso: 0.15,
    descripcion:
      'Emite concepto de aptitud claro (APTO / APTO CON RECOMENDACIONES / APLAZADO / NO APTO) congruente con los hallazgos clínicos y los riesgos del cargo. Justifica el concepto.',
  },
  {
    id: 'recomendaciones_conductas',
    nombre: 'Recomendaciones y Conductas',
    peso: 0.07,
    descripcion:
      'Brinda recomendaciones específicas (estilo de vida, EPP, exámenes complementarios, controles, restricciones laborales si aplica) y conductas a seguir.',
  },
  {
    id: 'cumplimiento_normativo',
    nombre: 'Cumplimiento Normativo (Res. 2346)',
    peso: 0.08,
    descripcion:
      'Cumple con los componentes mínimos de la evaluación médica ocupacional según Resolución 2346 de 2007 del Ministerio de la Protección Social (Colombia): identificación, anamnesis ocupacional, examen físico orientado, concepto de aptitud y recomendaciones.',
  },
  {
    id: 'neutralidad_juridica',
    nombre: 'Neutralidad Jurídica',
    peso: 0.05,
    descripcion:
      'El profesional NO insinúa, sugiere ni hace comentarios que puedan motivar al paciente a iniciar acciones legales, tutelas, derechos de petición, demandas o reclamaciones contra la empresa. No emite juicios sobre responsabilidad legal del empleador, no menciona "derechos" del paciente frente a la empresa en tono sugerente, no hace comparaciones desfavorables hacia el empleador ni señala culpabilidades. Esta conducta es crítica porque las consultas pueden ser grabadas y cualquier sugerencia puede ser usada como evidencia legal. Penalizar severamente si se detectan frases como "la empresa debería responderte", "tienes derecho a demandar", "eso es responsabilidad de ellos" o similares.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rúbrica 2 — Valoración Psicológica Ocupacional (médico YURI)
// ─────────────────────────────────────────────────────────────────────────────
const RUBRICA_PSICOLOGICA: CriterioRubrica[] = [
  {
    id: 'principios_generales',
    nombre: 'Principios Generales de la Consulta',
    peso: 0.05,
    descripcion:
      'La consulta se enmarca como valoración psicológica OCUPACIONAL: no psicoterapia, no manejo clínico/psiquiátrico, no acompañamiento emocional prolongado, no mediación entre trabajador y empresa, no decisiones administrativas. El objetivo observable es evaluar funcionalidad laboral.',
  },
  {
    id: 'preparacion_previa',
    nombre: 'Preparación Previa Obligatoria',
    peso: 0.07,
    descripcion:
      'Evidencia de revisión previa: el profesional demuestra conocer diagnósticos, medicación, incapacidades, recomendaciones de especialistas (psiquiatría, EPS, ARL) y la información ocupacional del cargo (perfil funcional, exigencia cognitiva/emocional, horarios, modalidad). Si no hay evidencia de preparación, calificar bajo.',
  },
  {
    id: 'apertura_consulta',
    nombre: 'Apertura de la Consulta',
    peso: 0.10,
    descripcion:
      'Inicio cordial, estructurado y profesional. El profesional se presenta (nombre y rol), explica el objetivo ocupacional de la valoración, aclara que NO es psicoterapia, informa confidencialidad y delimita el alcance. Indicadores positivos: frases como "Esta valoración tiene enfoque ocupacional y funcional" o "Este espacio no corresponde a psicoterapia clínica".',
  },
  {
    id: 'enfoque_entrevista',
    nombre: 'Enfoque de la Entrevista',
    peso: 0.15,
    descripcion:
      'La entrevista se mantiene enfocada en: funcionalidad cognitiva (concentración, atención, memoria, velocidad, toma de decisiones, multitarea), funcionalidad emocional (manejo emocional, estabilidad, ansiedad, tolerancia al estrés), funcionalidad laboral (interacción con clientes, cumplimiento de funciones, carga mental, presión comercial) e impacto farmacológico (sedación, somnolencia, efectos secundarios, horarios de mayor funcionalidad).',
  },
  {
    id: 'control_consulta',
    nombre: 'Control de la Consulta',
    peso: 0.10,
    descripcion:
      'El profesional mantiene control estructurado: evita narrativas excesivamente extensas, no se desvía hacia conflictos personales profundos, no convierte la sesión en desahogo emocional, no abre discusiones organizacionales y no profundiza innecesariamente en experiencias traumáticas. Cuando el paciente se desvía, redirige: "Entiendo la situación. Quiero enfocarme específicamente en cómo esto impacta tu funcionalidad laboral."',
  },
  {
    id: 'comunicacion_profesional',
    nombre: 'Comunicación Profesional',
    peso: 0.10,
    descripcion:
      'Empatía, neutralidad, escucha activa, tacto, respeto y claridad. Prohibido: confrontar al trabajador, invalidar síntomas, minimizar emociones, emitir juicios personales, usar lenguaje brusco, discutir con el paciente o asumir posiciones frente a conflictos laborales.',
  },
  {
    id: 'limitaciones_rol',
    nombre: 'Limitaciones del Rol Ocupacional',
    peso: 0.08,
    descripcion:
      'El profesional NO realiza psicoterapia, NO asume manejo psiquiátrico, NO modifica tratamientos, NO recomienda suspensión de medicamentos, NO interpreta farmacología fuera de su alcance, NO interviene como terapeuta tratante, NI asume decisiones organizacionales. Penalizar si se observan estas conductas.',
  },
  {
    id: 'recomendaciones_ocupacionales',
    nombre: 'Recomendaciones Ocupacionales',
    peso: 0.12,
    descripcion:
      'Las recomendaciones deben referirse a acciones de salud que el propio trabajador puede gestionar: seguimiento con especialista tratante, adherencia al tratamiento, controles médicos, autocuidado. NUNCA deben implicar cambios en la carga laboral, las metas, los horarios, el tipo de tareas ni las condiciones del contrato — esas son decisiones administrativas que NO corresponden al profesional de salud ocupacional.',
  },
  {
    id: 'temas_prohibidos',
    nombre: 'Temas Prohibidos',
    peso: 0.05,
    descripcion:
      'El profesional NO promete ni anticipa, directa ni indirectamente: ajuste de metas, reubicación laboral, cambios salariales, decisiones administrativas, modificaciones contractuales, incapacidades, ni determinaciones organizacionales. Penalizar severamente frases como "La empresa tiene que ajustarte metas", "Te deben reubicar", "No puedes seguir trabajando así", o cualquier recomendación que implique cambiar la carga laboral, los horarios, el tipo de tareas o las condiciones del contrato.',
  },
  {
    id: 'manejo_casos_criticos',
    nombre: 'Manejo de Casos Críticos',
    peso: 0.04,
    descripcion:
      'En casos de ideación suicida, hospitalización psiquiátrica, trastornos severos, riesgo emocional alto o situaciones legalmente sensibles: mantiene neutralidad, documenta objetivamente, evita intervenciones terapéuticas y escala internamente cuando corresponde. Si no hay caso crítico en la consulta, calificar 5 (no aplica = correcto por defecto).',
  },
  {
    id: 'cierre_consulta',
    nombre: 'Cierre de la Consulta',
    peso: 0.07,
    descripcion:
      'Cierre claro, breve y profesional. Aclara que la valoración será analizada y el concepto construido posteriormente. NO anticipa el concepto final, NO negocia recomendaciones, NO promete ajustes, NI emite conclusiones improvisadas.',
  },
  {
    id: 'documentacion',
    nombre: 'Documentación',
    peso: 0.02,
    descripcion:
      'Evidencia de que la valoración quedará registrada objetivamente: coherencia entre lo conversado y lo que se documentará, justificación de recomendaciones, ausencia de subjetividad innecesaria. Evalúa con base en lo observable en el transcript.',
  },
  {
    id: 'indicadores_consulta_correcta',
    nombre: 'Indicadores de Consulta Correctamente Realizada',
    peso: 0.01,
    descripcion:
      'La consulta fue adecuada si: mantuvo enfoque ocupacional, el paciente se sintió escuchado, hubo estructura y control, las recomendaciones fueron concretas, no se generaron expectativas administrativas, no se convirtió en terapia, y el concepto final es coherente con lo conversado. Calificar globalmente con base en estos indicadores.',
  },
  {
    id: 'indicadores_alerta',
    nombre: 'Ausencia de Indicadores de Alerta',
    peso: 0.01,
    descripcion:
      'La consulta requiere revisión si: el paciente habló casi toda la sesión sin estructura, hubo intervención terapéutica prolongada, se prometieron recomendaciones, se discutieron temas administrativos, las recomendaciones fueron ambiguas, o el profesional salió del alcance ocupacional. Calificar 5 si no hay alertas, 1 si hay alertas graves.',
  },
  {
    id: 'neutralidad_juridica',
    nombre: 'Neutralidad Jurídica',
    peso: 0.03,
    descripcion:
      'El profesional NO insinúa, sugiere ni hace comentarios que puedan motivar al paciente a iniciar acciones legales, tutelas, derechos de petición, demandas o reclamaciones contra la empresa. No emite juicios sobre responsabilidad legal del empleador, no menciona "derechos" del paciente frente a la empresa en tono sugerente, no hace señalamientos de culpabilidad organizacional. Esta conducta es crítica porque las valoraciones son grabadas y cualquier sugerencia puede ser usada como evidencia legal.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Sanity checks en carga
// ─────────────────────────────────────────────────────────────────────────────
function checkPesos(rubrica: CriterioRubrica[], nombre: string): void {
  const suma = rubrica.reduce((s, c) => s + c.peso, 0);
  if (Math.abs(suma - 1.0) > 1e-9) {
    console.warn(
      `[rubrica-calidad] WARNING: pesos de ${nombre} suman ${suma.toFixed(4)}, deberían sumar 1.0`
    );
  }
}
checkPesos(RUBRICA, 'RUBRICA');
checkPesos(RUBRICA_PSICOLOGICA, 'RUBRICA_PSICOLOGICA');

// ─────────────────────────────────────────────────────────────────────────────
// Selector de rúbrica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la rúbrica correcta según el nombre del médico.
 * Si el médico es YURI → rúbrica psicológica; cualquier otro → rúbrica médica.
 */
export function getRubrica(medico: string | null | undefined): RubricaResult {
  if (medico && /yuri/i.test(medico)) {
    return { rubrica: RUBRICA_PSICOLOGICA, tipo: 'psicologica' };
  }
  return { rubrica: RUBRICA, tipo: 'medica' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialización del formulario pre-consulta
// ─────────────────────────────────────────────────────────────────────────────

// Tipo parcial que cubre los campos de la tabla `formularios`
type FormularioRow = Record<string, unknown>;

function siNo(v: unknown): string {
  if (v === 'si' || v === 'Sí' || v === 'Si' || v === true) return 'Sí';
  if (v === 'no' || v === 'No' || v === false) return 'No';
  return String(v ?? '');
}

function formularioATexto(f: FormularioRow | null): string | null {
  if (!f) return null;
  const lineas: string[] = [];

  if (f.genero) lineas.push(`Género: ${f.genero}`);
  if (f.edad) lineas.push(`Edad: ${f.edad} años`);
  if (f.fecha_nacimiento) lineas.push(`Fecha de nacimiento: ${f.fecha_nacimiento}`);
  if (f.lugar_nacimiento) lineas.push(`Lugar de nacimiento: ${f.lugar_nacimiento}`);
  if (f.ciudad_residencia) lineas.push(`Ciudad de residencia: ${f.ciudad_residencia}`);
  if (f.estado_civil) lineas.push(`Estado civil: ${f.estado_civil}`);
  if (f.nivel_educativo) lineas.push(`Nivel educativo: ${f.nivel_educativo}`);
  if (f.profesion_oficio) lineas.push(`Profesión/oficio: ${f.profesion_oficio}`);
  if (f.hijos != null) lineas.push(`Hijos: ${f.hijos}`);
  if (f.estatura) lineas.push(`Estatura: ${f.estatura}`);
  if (f.peso) lineas.push(`Peso: ${f.peso} kg`);
  if (f.ejercicio) lineas.push(`Ejercicio: ${f.ejercicio}`);
  if (f.fuma) lineas.push(`Fuma: ${siNo(f.fuma)}`);
  if (f.consumo_licor) lineas.push(`Consumo de licor: ${f.consumo_licor}`);

  type Campo = { label: string; valor: unknown };

  const antecedentes: Campo[] = (
    [
      { label: 'Presión alta', valor: f.presion_alta },
      { label: 'Problemas de azúcar/diabetes', valor: f.problemas_azucar },
      { label: 'Problemas cardíacos', valor: f.problemas_cardiacos },
      { label: 'Enfermedad hepática', valor: f.enfermedad_higado },
      { label: 'Enfermedad pulmonar', valor: f.enfermedad_pulmonar },
      { label: 'Hernias', valor: f.hernias },
      { label: 'Hormigueos/adormecimientos', valor: f.hormigueos },
      { label: 'Várices', valor: f.varices },
      { label: 'Hepatitis', valor: f.hepatitis },
      { label: 'Dolor de cabeza frecuente', valor: f.dolor_cabeza },
      { label: 'Dolor de espalda', valor: f.dolor_espalda },
      { label: 'Embarazo', valor: f.embarazo },
      { label: 'Usa anteojos', valor: f.usa_anteojos },
      { label: 'Usa lentes de contacto', valor: f.usa_lentes_contacto },
      { label: 'Cirugía ocular', valor: f.cirugia_ocular },
      { label: 'Cirugía programada', valor: f.cirugia_programada },
      { label: 'Condición médica activa', valor: f.condicion_medica },
      { label: 'Problemas de sueño', valor: f.problemas_sueno },
      { label: 'Trastorno psicológico', valor: f.trastorno_psicologico },
      { label: 'Síntomas psicológicos', valor: f.sintomas_psicologicos },
      { label: 'Diagnóstico de cáncer', valor: f.diagnostico_cancer },
      { label: 'Enfermedades laborales previas', valor: f.enfermedades_laborales },
      { label: 'Enf. osteomuscular', valor: f.enfermedad_osteomuscular },
      { label: 'Enf. autoinmune', valor: f.enfermedad_autoinmune },
    ] as Campo[]
  ).filter(({ valor: v }) => v && v !== '' && v !== 'no' && v !== 'No');

  if (antecedentes.length > 0) {
    lineas.push('Antecedentes personales declarados: ' + antecedentes.map(({ label }) => label).join(', '));
  }

  const familiares: Campo[] = (
    [
      { label: 'Diabetes familiar', valor: f.familia_diabetes },
      { label: 'Hipertensión familiar', valor: f.familia_hipertension },
      { label: 'Infartos familiares', valor: f.familia_infartos },
      { label: 'Cáncer familiar', valor: f.familia_cancer },
      { label: 'Trastornos mentales familiares', valor: f.familia_trastornos },
      { label: 'Enf. infecciosas familiares', valor: f.familia_infecciosas },
      { label: 'Enf. hereditarias', valor: f.familia_hereditarias },
      { label: 'Enf. genéticas', valor: f.familia_geneticas },
    ] as Campo[]
  ).filter(({ valor: v }) => v && v !== '' && v !== 'no' && v !== 'No');

  if (familiares.length > 0) {
    lineas.push('Antecedentes familiares declarados: ' + familiares.map(({ label }) => label).join(', '));
  }

  return lineas.length > 0 ? lineas.join('\n') : null;
}

// Texto completo del estándar institucional de valoración psicológica ocupacional.
const DOCUMENTO_PSICOLOGICO = `
ESTÁNDAR INSTITUCIONAL — VALORACIÓN PSICOLÓGICA OCUPACIONAL

1. PRINCIPIOS GENERALES
La valoración psicológica ocupacional NO es psicoterapia, NO implica manejo clínico ni psiquiátrico,
NO es acompañamiento emocional prolongado, NO es mediación entre trabajador y empresa, y el
profesional NO toma decisiones administrativas. El objetivo es evaluar funcionalidad laboral del trabajador.

2. PREPARACIÓN PREVIA OBLIGATORIA
Antes de iniciar la consulta, el profesional debe revisar: diagnósticos actuales y pasados, medicación,
incapacidades, recomendaciones de especialistas (psiquiatría, EPS, ARL) y la información ocupacional del
cargo (perfil funcional, exigencia cognitiva/emocional, horarios, modalidad). Sin esta preparación no es
posible hacer una valoración funcional objetiva.

3. APERTURA DE LA CONSULTA
El profesional se presenta (nombre y rol), explica el objetivo OCUPACIONAL de la valoración, aclara que NO
es psicoterapia, informa sobre la confidencialidad y delimita el alcance.

4. ENFOQUE DE LA ENTREVISTA
La entrevista debe centrarse en cuatro dimensiones:
a) Funcionalidad cognitiva: concentración, atención, memoria, velocidad de procesamiento.
b) Funcionalidad emocional: manejo emocional, estabilidad afectiva, ansiedad, tolerancia al estrés.
c) Funcionalidad laboral: interacción con clientes, cumplimiento de funciones, carga mental.
d) Impacto farmacológico: sedación, somnolencia, efectos secundarios.

5. CONTROL DE LA CONSULTA
El profesional mantiene control estructurado. Cuando el paciente se desvía, redirige hacia funcionalidad laboral.

6. COMUNICACIÓN PROFESIONAL
Empatía, neutralidad, escucha activa. PROHIBIDO: confrontar, invalidar síntomas, emitir juicios personales.

7. LIMITACIONES DEL ROL OCUPACIONAL
NO realiza psicoterapia, NO modifica tratamientos, NO recomienda suspensión de medicamentos.

8. RECOMENDACIONES OCUPACIONALES
Únicamente acciones que el trabajador puede gestionar autónomamente. NUNCA modificaciones a condiciones laborales.

9. TEMAS PROHIBIDOS
NO promete: ajuste de metas, reubicación, cambios salariales, incapacidades ni decisiones organizacionales.

10. MANEJO DE CASOS CRÍTICOS
Mantiene neutralidad, documenta objetivamente, escala internamente cuando corresponde.

11. CIERRE DE LA CONSULTA
Claro y breve. NO anticipa concepto final, NO negocia recomendaciones, NO promete ajustes.

12. DOCUMENTACIÓN
Coherencia entre lo conversado y lo que se documentará.

13-14. INDICADORES DE CALIDAD Y ALERTA
Evalúa si la consulta mantuvo enfoque ocupacional y control, o si requiere revisión.

15. NEUTRALIDAD JURÍDICA
NO orienta al trabajador hacia acciones legales contra la empresa.
`;

// ─────────────────────────────────────────────────────────────────────────────
// buildAgentDescription
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye la descripción completa para el agente de Managed Agents.
 *
 * @param transcript   - Transcripción de la consulta
 * @param formulario   - Fila de la tabla formularios (puede ser null)
 * @param medico       - Nombre del médico (detecta tipo de rúbrica)
 */
export function buildAgentDescription(
  transcript: string,
  formulario: FormularioRow | null,
  medico: string | null | undefined
): string {
  const { rubrica, tipo } = getRubrica(medico);
  const nCriterios = rubrica.length;

  const tabla = rubrica
    .map((c) => `- id: ${c.id} | "${c.nombre}" (peso ${c.peso}): ${c.descripcion}`)
    .join('\n');

  const contextoTipo =
    tipo === 'psicologica'
      ? `Esta es una VALORACIÓN PSICOLÓGICA OCUPACIONAL. NO es psicoterapia. El objetivo es evaluar funcionalidad laboral e impacto ocupacional de la condición de salud mental.`
      : `Esta es una CONSULTA MÉDICA OCUPACIONAL general.`;

  const seccionDocumento =
    tipo === 'psicologica'
      ? `\n================ ESTÁNDAR INSTITUCIONAL DE REFERENCIA ================\n${DOCUMENTO_PSICOLOGICO}\n================ FIN DEL ESTÁNDAR ================\n\nEvalúa EXCLUSIVAMENTE contra este estándar institucional. Los criterios de la rúbrica mapean directamente a las secciones del documento anterior.\n`
      : '';

  const formularioTexto = formularioATexto(formulario);
  const seccionFormulario = formularioTexto
    ? `\n================ FORMULARIO PRE-CONSULTA (diligenciado por el paciente antes de la cita) ================\n${formularioTexto}\n================ FIN DEL FORMULARIO ================\n\nIMPORTANTE: Esta información ya estaba disponible para el profesional antes de la consulta. No penalices por no preguntar datos que el paciente ya declaró aquí. Evalúa si los verificó, profundizó o usó apropiadamente.\n`
    : '';

  const campoResumen =
    tipo === 'psicologica'
      ? `  "resumen": "<párrafo de 3-5 oraciones resumiendo la calidad global de la valoración, destacando lo más relevante>",\n  `
      : `  `;

  return `Evalúa la calidad de la siguiente consulta. ${contextoTipo}
${seccionDocumento}
Califica cada uno de los ${nCriterios} criterios de la rúbrica (escala 1-5, entero):
  1 = ausente / muy deficiente | 2 = deficiente | 3 = aceptable | 4 = bueno | 5 = excelente

RÚBRICA (pesos suman 1.0):
${tabla}

Cálculo del puntaje_total:
  suma_ponderada = Σ (puntaje_i × peso_i)   // rango [1, 5]
  puntaje_total  = suma_ponderada × 20       // rango [20, 100]

Pasos:
1. Usa la tool write para guardar el resultado en /mnt/session/outputs/evaluacion.json con este JSON exacto.
2. Después de escribir el archivo, imprime el mismo JSON completo como tu respuesta final de texto (sin preámbulo, sin markdown, solo el JSON puro).

Formato JSON:
{
  "criterios": [
    { "id": "<id>", "nombre": "<nombre>", "puntaje": <int 1-5>, "evidencia": "<cita o descripción>" }
  ],
  "fortalezas": ["<string>", ...],
  "recomendaciones": ["<string>", "<string>", "<string>", ...],
  ${campoResumen}"puntaje_total": <number 0-100, máx 2 decimales>
}

Reglas: JSON válido sin comentarios, los ${nCriterios} criterios en el mismo orden que la rúbrica, respuesta final = JSON puro.
${seccionFormulario}
================ TRANSCRIPT ================
${transcript || '(transcript vacío)'}
================ FIN DEL TRANSCRIPT ================`;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildGraderRubric
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construye la rúbrica que usa el grader de Managed Agents para verificar
 * que el output del agente sea completo y correcto.
 */
export function buildGraderRubric(medico: string | null | undefined): string {
  const { rubrica, tipo } = getRubrica(medico);
  const nCriterios = rubrica.length;
  const ids = rubrica.map((c) => c.id).join(', ');
  const resumenCheck =
    tipo === 'psicologica'
      ? `\n## Criterio 7: Campo resumen presente\n"resumen" debe ser un string con entre 3 y 5 oraciones resumiendo la calidad global de la valoración. No puede estar vacío ni ser un array.\n`
      : '';
  return `# Rúbrica de Calidad del Output de Evaluación

## Criterio 1: Archivo JSON presente y parseable
El archivo /mnt/session/outputs/evaluacion.json debe existir y ser JSON válido (JSON.parse sin errores).

## Criterio 2: Los ${nCriterios} criterios presentes
El array "criterios" debe contener exactamente ${nCriterios} objetos con los ids: ${ids}.
Cada objeto debe tener los campos: id (string), nombre (string), puntaje (integer 1-5), evidencia (string no vacío).

## Criterio 3: Evidencia textual en cada criterio
Cada criterio debe incluir evidencia específica del transcript (cita literal entre comillas o descripción de ausencia observada). No se aceptan frases genéricas sin referencia al transcript.

## Criterio 4: Puntaje total calculado correctamente
"puntaje_total" debe ser la suma ponderada (Σ puntaje_i × peso_i) × 20, redondeado a máximo 2 decimales. Debe estar en el rango [20, 100].

## Criterio 5: Al menos 3 recomendaciones accionables
"recomendaciones" debe ser un array con mínimo 3 strings, cada uno con una recomendación específica y accionable para el profesional (no frases genéricas).

## Criterio 6: Fortalezas presentes
"fortalezas" debe ser un array con al menos 1 string describiendo un aspecto positivo observado.
${resumenCheck}`;
}

export { RUBRICA, RUBRICA_PSICOLOGICA };

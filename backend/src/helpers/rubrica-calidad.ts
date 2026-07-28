/**
 * Rúbricas de Evaluación de Calidad de Consultas — BODYTECH.
 *
 * RUBRICA_BODYTECH    → 19 ítems en 6 categorías: "Auditoría Integral de Calidad",
 *                       rúbrica oficial vigente para los coaches Bodytech. DEFAULT.
 * RUBRICA_PSICOLOGICA → 15 criterios, valoración psicológica ocupacional (médico YURI)
 * RUBRICA             → 8 criterios, consulta médica ocupacional (legacy, fuera de rotación)
 *
 * Dos escalas de totalización (campo `escala` de RubricaResult):
 *   'puntos' (bodytech) → cada ítem vale N puntos sobre 100. Se otorga
 *                         ((puntaje - 1) / 4) × N   →  rango [0, 100].
 *                         Un ítem incumplido (puntaje 1) vale 0 puntos, como en
 *                         el checklist original de la auditoría.
 *   'x20'    (legacy)   → suma_ponderada × 20       →  rango [20, 100].
 *
 * El puntaje_total lo RECALCULA el backend con computePuntajeTotal(); el número
 * que devuelve el modelo queda solo como respaldo si los ids no cuadran.
 */

export interface CriterioRubrica {
  id: string;
  nombre: string;
  /** Fracción del total (suma 1.0 en toda la rúbrica). */
  peso: number;
  /** Puntos absolutos del ítem sobre 100. Solo en rúbricas de escala 'puntos'. */
  puntos?: number;
  /** Categoría de la auditoría a la que pertenece el ítem. */
  categoria?: string;
  descripcion: string;
}

export type TipoRubrica = 'bodytech' | 'medica' | 'psicologica';

/** Cómo se totaliza la rúbrica. Ver cabecera del archivo. */
export type EscalaRubrica = 'puntos' | 'x20';

export interface RubricaResult {
  rubrica: CriterioRubrica[];
  tipo: TipoRubrica;
  escala: EscalaRubrica;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rúbrica VIGENTE — "Auditoría Integral de Calidad" (coaches Bodytech)
//
// Fuente: documento oficial "Auditoría Integral de Calidad" (100 puntos).
//   1. Preparación ........... 10 pts (1 ítem  × 10)
//   2. Apertura y conexión ... 20 pts (5 ítems ×  4)
//   3. Descubrimiento ........ 20 pts (4 ítems ×  5)
//   4. Calidad técnica ....... 20 pts (4 ítems ×  5)
//   5. Gestión comercial ..... 20 pts (4 ítems ×  5)
//   6. Cierre ................ 10 pts (1 ítem  × 10)
//
// Cada ítem se califica 1-5 y aporta ((puntaje - 1) / 4) × sus puntos.
// ─────────────────────────────────────────────────────────────────────────────
const CAT_PREPARACION = '1. Preparación';
const CAT_APERTURA = '2. Apertura y conexión';
const CAT_DESCUBRIMIENTO = '3. Descubrimiento';
const CAT_TECNICA = '4. Calidad técnica';
const CAT_COMERCIAL = '5. Gestión comercial';
const CAT_CIERRE = '6. Cierre';

const RUBRICA_BODYTECH: CriterioRubrica[] = [
  // ── 1. Preparación (10 pts) ────────────────────────────────────────────────
  {
    id: 'prep_puntualidad_camara',
    nombre: 'Preparación — Puntualidad y cámara encendida',
    categoria: CAT_PREPARACION,
    puntos: 10,
    peso: 0.10,
    descripcion:
      'El coach se conecta a la hora establecida, con la cámara encendida. Califica la PUNTUALIDAD con el bloque "DATOS OBJETIVOS DE LA SESIÓN" (hora agendada vs. hora real de inicio), no con suposiciones: puntual o ≤5 min → 5; 6-10 min → 4; 11-15 min → 3; 16-25 min → 2; >25 min → 1. Si no hay dato objetivo de hora, califica 3 y dilo en la evidencia. La cámara NO es verificable desde el transcript: solo descuenta si el propio audio la evidencia apagada (p. ej. el usuario dice "no te veo" o el coach dice "no tengo cámara"); en ausencia de evidencia, no penalices por ese motivo.',
  },

  // ── 2. Apertura y conexión (20 pts = 5 × 4) ────────────────────────────────
  {
    id: 'apertura_presentacion',
    nombre: 'Apertura — Presentación formal de marca',
    categoria: CAT_APERTURA,
    puntos: 4,
    peso: 0.04,
    descripcion:
      'El coach realiza su presentación formal incluyendo los TRES elementos: nombre propio, cargo/profesión y representación de la marca Bodytech. 5 = los tres elementos explícitos; 4 = dos elementos; 3 = solo el nombre; 1 = no se presenta.',
  },
  {
    id: 'apertura_objetivos_programa',
    nombre: 'Apertura — Explicación de objetivos del programa',
    categoria: CAT_APERTURA,
    puntos: 4,
    peso: 0.04,
    descripcion:
      'El coach explica de forma dinámica, clara y profesional en qué consiste el programa y cuáles son sus objetivos (qué se va a hacer, para qué sirve, cómo será el acompañamiento). Penaliza la explicación ausente, apresurada o puramente administrativa.',
  },
  {
    id: 'apertura_vinculo_confianza',
    nombre: 'Apertura — Vínculo de confianza y empatía',
    categoria: CAT_APERTURA,
    puntos: 4,
    peso: 0.04,
    descripcion:
      'El coach establece un vínculo de confianza mediante una actitud empática y profesional: valida lo que el usuario expresa, reconoce sus logros o dificultades, genera cercanía sin perder profesionalismo.',
  },
  {
    id: 'apertura_escucha_activa',
    nombre: 'Apertura — Escucha activa y atenta',
    categoria: CAT_APERTURA,
    puntos: 4,
    peso: 0.04,
    descripcion:
      'Se mantiene una escucha activa y atenta durante el desarrollo de la consulta: el coach retoma y parafrasea lo dicho por el usuario, hace preguntas de seguimiento coherentes con sus respuestas y no repite preguntas ya contestadas.',
  },
  {
    id: 'apertura_tono_cordial',
    nombre: 'Apertura — Cordialidad y amabilidad en el tono',
    categoria: CAT_APERTURA,
    puntos: 4,
    peso: 0.04,
    descripcion:
      'El coach proyecta cordialidad y amabilidad a través de su tono de voz y su elección de palabras (saludo, agradecimientos, trato respetuoso, ausencia de sequedad o impaciencia). Evalúa lo observable en el transcript.',
  },

  // ── 3. Descubrimiento (20 pts = 4 × 5) ─────────────────────────────────────
  {
    id: 'descubrimiento_objetivo',
    nombre: 'Descubrimiento — Objetivo principal del usuario',
    categoria: CAT_DESCUBRIMIENTO,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach indaga de manera efectiva sobre el objetivo principal del usuario (qué quiere lograr y en qué plazo) y lo deja explícito. 5 = lo indaga y lo concreta/confirma; 3 = lo menciona superficialmente; 1 = nunca pregunta por el objetivo.',
  },
  {
    id: 'descubrimiento_motivaciones_barreras',
    nombre: 'Descubrimiento — Motivaciones y barreras',
    categoria: CAT_DESCUBRIMIENTO,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach explora las motivaciones del usuario (el "para qué" de fondo) e identifica posibles barreras para el cumplimiento (tiempo, horarios, lesiones, viajes, motivación, entorno). Requiere ambas: motivaciones y barreras.',
  },
  {
    id: 'descubrimiento_no_interrumpe',
    nombre: 'Descubrimiento — Respeta los tiempos del usuario',
    categoria: CAT_DESCUBRIMIENTO,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach respeta los tiempos de intervención del usuario sin generar interrupciones: deja terminar las ideas, no habla encima, no corta las respuestas. Penaliza interrupciones repetidas o un monólogo del coach que no deja espacio al usuario.',
  },
  {
    id: 'descubrimiento_personalizacion',
    nombre: 'Descubrimiento — Personalización de la interacción',
    categoria: CAT_DESCUBRIMIENTO,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach personaliza la interacción basándose en la información proporcionada por el usuario y en el formulario pre-consulta: usa su nombre, retoma sus antecedentes, hábitos y contexto, y adapta el discurso a su caso concreto en lugar de dar un guion genérico.',
  },

  // ── 4. Calidad técnica (20 pts = 4 × 5) ────────────────────────────────────
  {
    id: 'tecnica_historia_clinica',
    nombre: 'Calidad técnica — Diligenciamiento de la Historia Clínica',
    categoria: CAT_TECNICA,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach realiza el diligenciamiento íntegro y detallado de la Historia Clínica. Califica ESTE ítem con el bloque "DILIGENCIAMIENTO DE LA HISTORIA CLÍNICA" (no con el transcript): mide cobertura de campos y profundidad de los campos narrativos. ≥90% de secciones completas y textos sustantivos → 5; 75-89% → 4; 50-74% → 3; 25-49% → 2; <25% o solo campos automáticos → 1. Si no se adjuntó ese bloque, califica 3 y dilo en la evidencia.',
  },
  {
    id: 'tecnica_diagnostico',
    nombre: 'Calidad técnica — Diagnóstico técnico fundamentado',
    categoria: CAT_TECNICA,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach establece un diagnóstico técnico preciso y fundamentado: nombra los hallazgos (composición corporal, postura, fuerza, movilidad, riesgo) y los explica con base en las mediciones y antecedentes, no en generalidades. Debe verse coherencia entre lo medido y lo concluido.',
  },
  {
    id: 'tecnica_recomendaciones',
    nombre: 'Calidad técnica — Recomendaciones coherentes',
    categoria: CAT_TECNICA,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach emite recomendaciones coherentes con el diagnóstico y el perfil del usuario: concretas, alcanzables y alineadas con sus objetivos, antecedentes y disponibilidad. Penaliza recomendaciones genéricas ("haga ejercicio", "coma sano") o desconectadas de los hallazgos.',
  },
  {
    id: 'tecnica_lenguaje',
    nombre: 'Calidad técnica — Lenguaje sencillo y accesible',
    categoria: CAT_TECNICA,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach emplea un lenguaje sencillo, accesible y profesional: traduce los tecnicismos, verifica que el usuario entendió y evita jerga innecesaria sin caer en un trato informal o impreciso.',
  },

  // ── 5. Gestión comercial (20 pts = 4 × 5) ──────────────────────────────────
  {
    id: 'comercial_renovacion',
    nombre: 'Gestión comercial — Invitación a renovar el programa virtual',
    categoria: CAT_COMERCIAL,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach identifica la oportunidad de dar continuidad al programa virtual invitando a la renovación al finalizar el tercer mes. Regla de aplicabilidad: si por el contexto NO es el cierre del tercer mes, no exijas la invitación a renovar — en ese caso califica según si el coach dejó planteada la continuidad del acompañamiento (próximos controles, siguientes fases); si la dejó clara → 5, si no mencionó nada de continuidad → 3. Nunca califiques 1 por no forzar una venta improcedente.',
  },
  {
    id: 'comercial_redireccion_presencial',
    nombre: 'Gestión comercial — Redireccionamiento a programa presencial',
    categoria: CAT_COMERCIAL,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach detecta y comunica la necesidad de redireccionamiento al programa presencial cuando el caso lo amerita (necesidad de supervisión directa, corrección técnica, uso de máquinas, riesgo osteomuscular). Regla de aplicabilidad: si el perfil claramente no lo requiere y el coach lo sustenta o el caso es netamente virtual, califica 5 por criterio adecuado; penaliza cuando había una necesidad evidente y el coach la pasó por alto.',
  },
  {
    id: 'comercial_servicios_complementarios',
    nombre: 'Gestión comercial — Oferta de servicios complementarios',
    categoria: CAT_COMERCIAL,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach ofrece servicios complementarios de forma natural y persuasiva (nutrición, fisioterapia, entrenamiento personalizado, valoraciones, clases, sedes), integrándolos en la conversación como solución al caso y no como una lista forzada. 1 = no ofrece nada; 3 = los menciona de pasada; 5 = los conecta con la necesidad detectada.',
  },
  {
    id: 'comercial_oportunidades_valor',
    nombre: 'Gestión comercial — Oportunidades de valor proactivas',
    categoria: CAT_COMERCIAL,
    puntos: 5,
    peso: 0.05,
    descripcion:
      'El coach identifica proactivamente oportunidades de valor para el usuario: beneficios del plan que no está usando, actividades o convenios pertinentes, extensión del servicio al núcleo familiar, ajustes que aprovechen mejor su membresía. Debe nacer de lo que el usuario contó, no de un libreto.',
  },

  // ── 6. Cierre (10 pts) ─────────────────────────────────────────────────────
  {
    id: 'cierre_conclusion_estructurada',
    nombre: 'Cierre — Conclusión estructurada',
    categoria: CAT_CIERRE,
    puntos: 10,
    peso: 0.10,
    descripcion:
      'El coach proporciona una conclusión estructurada detallando los TRES elementos: canales de seguimiento (por dónde se contactan), controles (cuándo es la próxima cita o medición) y expectativas de resultados (qué debería pasar y en cuánto tiempo). 5 = los tres explícitos; 4 = dos; 3 = uno; 2 = cierre genérico sin ninguno; 1 = la consulta termina abruptamente sin cierre.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Rúbrica legacy 1 — Consulta Médica Ocupacional (fuera de rotación)
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
// Rúbrica legacy 2 — Valoración Psicológica Ocupacional (médico YURI)
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
function checkPuntos(rubrica: CriterioRubrica[], nombre: string): void {
  const suma = rubrica.reduce((s, c) => s + (c.puntos ?? 0), 0);
  if (suma !== 100) {
    console.warn(
      `[rubrica-calidad] WARNING: puntos de ${nombre} suman ${suma}, deberían sumar 100`
    );
  }
}
checkPesos(RUBRICA_BODYTECH, 'RUBRICA_BODYTECH');
checkPuntos(RUBRICA_BODYTECH, 'RUBRICA_BODYTECH');
checkPesos(RUBRICA, 'RUBRICA');
checkPesos(RUBRICA_PSICOLOGICA, 'RUBRICA_PSICOLOGICA');

// ─────────────────────────────────────────────────────────────────────────────
// Selector de rúbrica
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Devuelve la rúbrica correcta según el nombre del médico.
 * YURI → rúbrica psicológica ocupacional; cualquier otro → Auditoría Integral
 * de Calidad (rúbrica oficial vigente de coaches Bodytech).
 */
export function getRubrica(medico: string | null | undefined): RubricaResult {
  if (medico && /yuri/i.test(medico)) {
    return { rubrica: RUBRICA_PSICOLOGICA, tipo: 'psicologica', escala: 'x20' };
  }
  return { rubrica: RUBRICA_BODYTECH, tipo: 'bodytech', escala: 'puntos' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Totalización determinística
// ─────────────────────────────────────────────────────────────────────────────

/** Puntaje 1-5 saneado: entero dentro de rango, o null si no es utilizable. */
function normalizarPuntaje(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/**
 * Recalcula el puntaje_total a partir de los puntajes 1-5 devueltos por el
 * evaluador y los pesos/puntos de la rúbrica. No confiamos en la aritmética del
 * modelo: el número que él reporta es solo respaldo.
 *
 * - escala 'puntos'  → Σ ((puntaje - 1) / 4) × puntos_del_ítem   → [0, 100]
 * - escala 'x20'     → (Σ puntaje × peso) × 20                   → [20, 100]
 *
 * Devuelve `null` si faltan criterios de la rúbrica (el llamador cae al valor
 * del modelo) para no inventar un total sobre datos incompletos.
 */
export function computePuntajeTotal(
  criterios: Array<{ id?: string; puntaje?: unknown }> | null | undefined,
  medico: string | null | undefined
): number | null {
  if (!Array.isArray(criterios) || criterios.length === 0) return null;
  const { rubrica, escala } = getRubrica(medico);

  const porId = new Map<string, number>();
  for (const c of criterios) {
    if (!c || typeof c.id !== 'string') continue;
    const p = normalizarPuntaje(c.puntaje);
    if (p !== null) porId.set(c.id, p);
  }

  let total = 0;
  for (const criterio of rubrica) {
    const puntaje = porId.get(criterio.id);
    if (puntaje === undefined) {
      console.warn(
        `[rubrica-calidad] computePuntajeTotal: falta el criterio "${criterio.id}" en la respuesta del evaluador`
      );
      return null;
    }
    total +=
      escala === 'puntos'
        ? ((puntaje - 1) / 4) * (criterio.puntos ?? criterio.peso * 100)
        : puntaje * criterio.peso * 20;
  }

  return Math.round(total * 100) / 100;
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

// ─────────────────────────────────────────────────────────────────────────────
// Contexto objetivo de la consulta
//
// Dos ítems de la Auditoría Integral NO son evaluables desde el transcript:
//   · "se conecta a la hora establecida"  → sale de agendada vs. inicio real.
//   · "diligenciamiento íntegro de la HC" → sale de la fila de HistoriaClinica.
// Este bloque los convierte en evidencia dura para el evaluador.
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextoConsulta {
  /** Fecha/hora agendada de la cita (`HistoriaClinica.fechaAtencion`, ISO). */
  fechaAgendada?: string | null;
  /** Fecha/hora real en que arrancó la videollamada (ISO). */
  fechaInicioReal?: string | null;
  /** Fila de `HistoriaClinica` con los campos clínicos, para medir diligenciamiento. */
  historia?: Record<string, unknown> | null;
}

const TZ_COLOMBIA_OFFSET_MIN = -5 * 60;

/** Formatea un instante en hora de Colombia (UTC-5). Producción corre en UTC. */
function formatColombia(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const local = new Date(d.getTime() + TZ_COLOMBIA_OFFSET_MIN * 60_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${local.getUTCFullYear()}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ` +
    `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`
  );
}

function toDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = raw instanceof Date ? raw : new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d;
}

type CampoHistoria = { col: string; label: string; narrativo?: boolean };
type SeccionHistoria = { titulo: string; campos: CampoHistoria[] };

/**
 * Campos representativos de la historia clínica, agrupados como en el panel.
 * Se usan para medir cobertura (¿cuánto diligenció el coach?) y para mostrar
 * el contenido de los campos narrativos (¿con qué profundidad?).
 */
const SECCIONES_HISTORIA: SeccionHistoria[] = [
  {
    titulo: 'Datos básicos',
    campos: [
      { col: 'genero_biologico', label: 'Género biológico' },
      { col: 'fecha_nacimiento', label: 'Fecha de nacimiento' },
      { col: 'estado_civil', label: 'Estado civil' },
      { col: 'municipio', label: 'Municipio' },
      { col: 'ocupacion', label: 'Ocupación' },
      { col: 'eps', label: 'EPS' },
      { col: 'contacto_emergencia_nombre', label: 'Contacto de emergencia' },
      { col: 'contacto_emergencia_telefono', label: 'Teléfono de emergencia' },
    ],
  },
  {
    titulo: 'Anamnesis',
    campos: [
      { col: 'objetivo_bodytech', label: 'Objetivo Bodytech' },
      { col: 'modalidad', label: 'Modalidad' },
      { col: 'tipo_consulta', label: 'Tipo de consulta' },
      { col: 'motivo_consulta_texto', label: 'Motivo de consulta', narrativo: true },
      { col: 'ant_patologico_flag', label: 'Antecedente patológico (sí/no)' },
      { col: 'ant_patologico_obs', label: 'Antecedente patológico (detalle)', narrativo: true },
      { col: 'ant_quirurgico_flag', label: 'Antecedente quirúrgico (sí/no)' },
      { col: 'ant_osteomuscular_flag', label: 'Antecedente osteomuscular (sí/no)' },
      { col: 'ant_osteomuscular_obs', label: 'Antecedente osteomuscular (detalle)', narrativo: true },
      { col: 'ant_farmacologico_flag', label: 'Antecedente farmacológico (sí/no)' },
      { col: 'ant_alergicos_flag', label: 'Antecedentes alérgicos (sí/no)' },
      { col: 'ant_familiares_flag', label: 'Antecedentes familiares (sí/no)' },
      { col: 'actividad_frecuencia', label: 'Frecuencia de actividad física' },
      { col: 'actividad_nivel', label: 'Nivel de actividad física' },
    ],
  },
  {
    titulo: 'Clasificación de riesgo',
    campos: [
      { col: 'downton_riesgo', label: 'Riesgo Downton' },
      { col: 'acsm_riesgo', label: 'Riesgo ACSM' },
      { col: 'riesgo_final', label: 'Riesgo final' },
    ],
  },
  {
    titulo: 'Examen físico',
    campos: [
      { col: 'cc_peso_nuevo', label: 'Peso' },
      { col: 'cc_estatura_nuevo', label: 'Estatura' },
      { col: 'cc_imc_nuevo', label: 'IMC' },
      { col: 'cc_grasa_nuevo', label: '% Grasa' },
      { col: 'cc_masa_muscular_nuevo', label: 'Masa muscular' },
      { col: 'cc_perimetro_abdominal_nuevo', label: 'Perímetro abdominal' },
      { col: 'cc_observacion', label: 'Observación de composición corporal', narrativo: true },
      { col: 'postura_descripcion', label: 'Descripción postural', narrativo: true },
      { col: 'hallazgos_descripcion', label: 'Hallazgos', narrativo: true },
      { col: 'hallazgos_dolor', label: 'Dolor' },
      { col: 'fuerza_superior', label: 'Fuerza tren superior' },
      { col: 'fuerza_abdominal', label: 'Fuerza abdominal' },
      { col: 'fuerza_inferior', label: 'Fuerza tren inferior' },
      { col: 'tecnica_sentadilla', label: 'Técnica de sentadilla' },
      { col: 'estabilidad_plancha', label: 'Estabilidad (plancha)' },
      { col: 'equilibrio_unipodal', label: 'Equilibrio unipodal' },
      { col: 'fcr', label: 'Frecuencia cardíaca en reposo' },
      { col: 'tas', label: 'Tensión arterial sistólica' },
      { col: 'tad', label: 'Tensión arterial diastólica' },
      { col: 'riesgo_om', label: 'Riesgo osteomuscular' },
    ],
  },
  {
    titulo: 'Intervención',
    campos: [
      { col: 'intervencion_analisis', label: 'Análisis de la intervención', narrativo: true },
      { col: 'intervencion_tipo_meta', label: 'Tipo de meta' },
      { col: 'intervencion_meta_texto', label: 'Meta acordada', narrativo: true },
      { col: 'intervencion_educacion_si', label: 'Educación al usuario (sí/no)' },
      { col: 'intervencion_educacion_tipo', label: 'Tipo de educación' },
      { col: 'dx_tipo', label: 'Tipo de diagnóstico' },
      { col: 'dx_procedimiento', label: 'Procedimiento' },
    ],
  },
  {
    titulo: 'Conducta y concepto',
    campos: [
      { col: 'aptitud', label: 'Aptitud' },
      { col: 'control_fecha', label: 'Fecha de control' },
      { col: 'mdDx1', label: 'Diagnóstico principal' },
      { col: 'mdConceptoFinal', label: 'Concepto final', narrativo: true },
      {
        col: 'mdRecomendacionesMedicasAdicionales',
        label: 'Recomendaciones',
        narrativo: true,
      },
    ],
  },
];

/** Columnas que `calidad.service` debe traer de HistoriaClinica para el resumen. */
export const COLUMNAS_HISTORIA_AUDITORIA: ReadonlyArray<string> = SECCIONES_HISTORIA.flatMap(
  (s) => s.campos.map((c) => c.col)
);

/** ¿El campo quedó diligenciado? `false` y `0` cuentan como respuesta válida. */
function tieneValor(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  return true;
}

function textoNarrativo(v: unknown, max = 500): string {
  const s = String(v ?? '').trim().replace(/\s+/g, ' ');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Resumen del diligenciamiento de la historia clínica: cobertura por sección
 * (para el ítem 4.1) + contenido de los campos narrativos (para juzgar
 * profundidad, no solo si el campo está lleno).
 */
function historiaATexto(hc: Record<string, unknown> | null | undefined): string | null {
  if (!hc) return null;

  const lineas: string[] = [];
  const narrativos: string[] = [];
  let llenosTotal = 0;
  let totalCampos = 0;

  for (const seccion of SECCIONES_HISTORIA) {
    const faltantes: string[] = [];
    let llenos = 0;

    for (const campo of seccion.campos) {
      const valor = hc[campo.col];
      if (tieneValor(valor)) {
        llenos++;
        if (campo.narrativo) {
          narrativos.push(`  · ${campo.label}: "${textoNarrativo(valor)}"`);
        }
      } else {
        faltantes.push(campo.label);
        if (campo.narrativo) narrativos.push(`  · ${campo.label}: (vacío)`);
      }
    }

    llenosTotal += llenos;
    totalCampos += seccion.campos.length;
    const pct = Math.round((llenos / seccion.campos.length) * 100);
    const detalleFaltantes =
      faltantes.length > 0 ? ` Sin diligenciar: ${faltantes.join(', ')}.` : '';
    lineas.push(
      `- ${seccion.titulo}: ${llenos}/${seccion.campos.length} campos (${pct}%).${detalleFaltantes}`
    );
  }

  const pctGlobal = totalCampos > 0 ? Math.round((llenosTotal / totalCampos) * 100) : 0;

  return [
    `Cobertura global: ${llenosTotal} de ${totalCampos} campos diligenciados (${pctGlobal}%).`,
    '',
    ...lineas,
    '',
    'Contenido de los campos narrativos (mide la PROFUNDIDAD, no solo si están llenos):',
    ...narrativos,
  ].join('\n');
}

/** Bloque de datos duros que el evaluador usa para puntualidad y HC. */
function contextoATexto(ctx: ContextoConsulta | null | undefined): string {
  if (!ctx) return '';
  const bloques: string[] = [];

  const agendada = toDate(ctx.fechaAgendada);
  const inicio = toDate(ctx.fechaInicioReal);
  if (agendada || inicio) {
    const filas: string[] = [];
    filas.push(`- Hora agendada de la cita: ${formatColombia(agendada) ?? 'no registrada'} (Colombia)`);
    filas.push(
      `- Inicio real de la videollamada: ${formatColombia(inicio) ?? 'no registrado'} (Colombia)`
    );
    if (agendada && inicio) {
      const min = Math.round((inicio.getTime() - agendada.getTime()) / 60_000);
      filas.push(
        min > 0
          ? `- Diferencia: ${min} minuto(s) DESPUÉS de la hora agendada.`
          : min < 0
            ? `- Diferencia: ${Math.abs(min)} minuto(s) ANTES de la hora agendada (puntual).`
            : '- Diferencia: inicio exactamente a la hora agendada (puntual).'
      );
    } else {
      filas.push(
        '- Diferencia: no calculable (falta uno de los dos datos). No penalices la puntualidad por esto.'
      );
    }
    bloques.push(
      `\n================ DATOS OBJETIVOS DE LA SESIÓN ================\n${filas.join('\n')}\n================ FIN DE DATOS DE LA SESIÓN ================\n`
    );
  }

  const historia = historiaATexto(ctx.historia);
  if (historia) {
    bloques.push(
      `\n================ DILIGENCIAMIENTO DE LA HISTORIA CLÍNICA ================\n${historia}\n================ FIN DEL DILIGENCIAMIENTO ================\n\nEste bloque se midió directamente sobre la base de datos DESPUÉS de la consulta. Es la única fuente válida para el ítem de diligenciamiento de la Historia Clínica: no lo infieras del transcript.\n`
    );
  }

  return bloques.join('');
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

/** Tabla de la rúbrica: agrupada por categoría cuando la rúbrica las define. */
function tablaRubrica(rubrica: CriterioRubrica[], escala: EscalaRubrica): string {
  if (escala !== 'puntos') {
    return rubrica
      .map((c) => `- id: ${c.id} | "${c.nombre}" (peso ${c.peso}): ${c.descripcion}`)
      .join('\n');
  }

  const orden: string[] = [];
  const porCategoria = new Map<string, CriterioRubrica[]>();
  for (const c of rubrica) {
    const cat = c.categoria ?? 'Criterios';
    if (!porCategoria.has(cat)) {
      porCategoria.set(cat, []);
      orden.push(cat);
    }
    (porCategoria.get(cat) as CriterioRubrica[]).push(c);
  }

  return orden
    .map((cat) => {
      const items = porCategoria.get(cat) as CriterioRubrica[];
      const puntosCat = items.reduce((s, c) => s + (c.puntos ?? 0), 0);
      const filas = items
        .map(
          (c) => `  - id: ${c.id} | "${c.nombre}" (${c.puntos} pts): ${c.descripcion}`
        )
        .join('\n');
      return `${cat.toUpperCase()} — ${puntosCat} puntos\n${filas}`;
    })
    .join('\n\n');
}

/**
 * Construye la descripción completa para el agente de Managed Agents.
 *
 * @param transcript   - Transcripción de la consulta
 * @param formulario   - Fila de la tabla formularios (puede ser null)
 * @param medico       - Nombre del médico (detecta tipo de rúbrica)
 * @param contexto     - Datos duros de la sesión y de la historia clínica
 */
export function buildAgentDescription(
  transcript: string,
  formulario: FormularioRow | null,
  medico: string | null | undefined,
  contexto?: ContextoConsulta | null
): string {
  const { rubrica, tipo, escala } = getRubrica(medico);
  const nCriterios = rubrica.length;

  const tabla = tablaRubrica(rubrica, escala);

  const contextoTipo =
    tipo === 'psicologica'
      ? `Esta es una VALORACIÓN PSICOLÓGICA OCUPACIONAL. NO es psicoterapia. El objetivo es evaluar funcionalidad laboral e impacto ocupacional de la condición de salud mental.`
      : tipo === 'bodytech'
        ? `Esta es una CONSULTA VIRTUAL de un COACH de Bodytech con un usuario del programa. Aplicas la "Auditoría Integral de Calidad" de Bodytech, la rúbrica oficial de 100 puntos que evalúa y estandariza el desempeño de los coaches. Evalúas al COACH (el profesional), nunca al usuario.`
        : `Esta es una CONSULTA MÉDICA OCUPACIONAL general.`;

  const seccionDocumento =
    tipo === 'psicologica'
      ? `\n================ ESTÁNDAR INSTITUCIONAL DE REFERENCIA ================\n${DOCUMENTO_PSICOLOGICO}\n================ FIN DEL ESTÁNDAR ================\n\nEvalúa EXCLUSIVAMENTE contra este estándar institucional. Los criterios de la rúbrica mapean directamente a las secciones del documento anterior.\n`
      : '';

  const formularioTexto = formularioATexto(formulario);
  const seccionFormulario = formularioTexto
    ? `\n================ FORMULARIO PRE-CONSULTA (diligenciado por el paciente antes de la cita) ================\n${formularioTexto}\n================ FIN DEL FORMULARIO ================\n\nIMPORTANTE: Esta información ya estaba disponible para el profesional antes de la consulta. No penalices por no preguntar datos que el paciente ya declaró aquí. Evalúa si los verificó, profundizó o usó apropiadamente.\n`
    : '';

  const seccionContexto = contextoATexto(contexto);

  const campoResumen =
    tipo === 'psicologica' || tipo === 'bodytech'
      ? `  "resumen": "<párrafo de 3-5 oraciones resumiendo la calidad global de la consulta, destacando lo más relevante>",\n  `
      : `  `;

  const encabezadoRubrica =
    escala === 'puntos'
      ? `RÚBRICA — 6 categorías, ${nCriterios} ítems, 100 puntos en total:`
      : `RÚBRICA (pesos suman 1.0):`;

  const calculo =
    escala === 'puntos'
      ? `Cálculo del puntaje_total (la auditoría vale 100 puntos):
  Cada ítem otorga  ((puntaje_i - 1) / 4) × puntos_del_ítem
  Es decir: puntaje 5 → 100% de los puntos del ítem | 4 → 75% | 3 → 50% | 2 → 25% | 1 → 0%
  puntaje_total = Σ de los puntos otorgados en los ${nCriterios} ítems   // rango [0, 100]`
      : `Cálculo del puntaje_total:
  suma_ponderada = Σ (puntaje_i × peso_i)   // rango [1, 5]
  puntaje_total  = suma_ponderada × 20       // rango [20, 100]`;

  const reglasExtra =
    escala === 'puntos'
      ? `
Reglas de calificación:
- Evalúa SOLO al coach. La actitud o las respuestas del usuario no suben ni bajan la nota.
- Toda evidencia debe ser verificable: cita literal del transcript, o el dato duro de los bloques objetivos. Si algo no es observable, dilo explícitamente y califica 3 (no inventes ni asumas).
- Los ítems de puntualidad y de diligenciamiento de la Historia Clínica se califican con los BLOQUES DE DATOS OBJETIVOS, no con el transcript.
- No infles notas: 5 exige cumplimiento completo y evidenciado del ítem.
- Las recomendaciones deben ser accionables y dirigidas al coach, priorizando las categorías donde perdió más puntos.
`
      : '';

  return `Evalúa la calidad de la siguiente consulta. ${contextoTipo}
${seccionDocumento}
Califica cada uno de los ${nCriterios} ítems de la rúbrica (escala 1-5, entero):
  1 = ausente / no cumple | 2 = deficiente | 3 = aceptable | 4 = bueno | 5 = excelente / cumple por completo

${encabezadoRubrica}
${tabla}

${calculo}
${reglasExtra}
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
${seccionContexto}${seccionFormulario}
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
  const { rubrica, tipo, escala } = getRubrica(medico);
  const nCriterios = rubrica.length;
  const ids = rubrica.map((c) => c.id).join(', ');
  const resumenCheck =
    tipo === 'psicologica' || tipo === 'bodytech'
      ? `\n## Criterio 7: Campo resumen presente\n"resumen" debe ser un string con entre 3 y 5 oraciones resumiendo la calidad global de la consulta. No puede estar vacío ni ser un array.\n`
      : '';

  const totalCheck =
    escala === 'puntos'
      ? `"puntaje_total" debe ser la suma de los puntos otorgados por ítem, donde cada ítem aporta ((puntaje_i - 1) / 4) × puntos_del_ítem (Preparación 10, cada ítem de Apertura 4, cada ítem de Descubrimiento / Calidad técnica / Gestión comercial 5, Cierre 10). Redondeado a máximo 2 decimales y dentro del rango [0, 100].`
      : `"puntaje_total" debe ser la suma ponderada (Σ puntaje_i × peso_i) × 20, redondeado a máximo 2 decimales. Debe estar en el rango [20, 100].`;

  const evidenciaCheck =
    escala === 'puntos'
      ? `Cada criterio debe incluir evidencia verificable: cita literal entre comillas del transcript, descripción de una ausencia observada, o el dato duro de los bloques objetivos (hora agendada vs. inicio real para la puntualidad; cobertura de campos para el diligenciamiento de la Historia Clínica). No se aceptan frases genéricas sin referencia a una fuente.`
      : `Cada criterio debe incluir evidencia específica del transcript (cita literal entre comillas o descripción de ausencia observada). No se aceptan frases genéricas sin referencia al transcript.`;

  return `# Rúbrica de Calidad del Output de Evaluación

## Criterio 1: Archivo JSON presente y parseable
El archivo /mnt/session/outputs/evaluacion.json debe existir y ser JSON válido (JSON.parse sin errores).

## Criterio 2: Los ${nCriterios} criterios presentes
El array "criterios" debe contener exactamente ${nCriterios} objetos con los ids: ${ids}.
Cada objeto debe tener los campos: id (string), nombre (string), puntaje (integer 1-5), evidencia (string no vacío).

## Criterio 3: Evidencia verificable en cada criterio
${evidenciaCheck}

## Criterio 4: Puntaje total calculado correctamente
${totalCheck}

## Criterio 5: Al menos 3 recomendaciones accionables
"recomendaciones" debe ser un array con mínimo 3 strings, cada uno con una recomendación específica y accionable para el profesional (no frases genéricas).

## Criterio 6: Fortalezas presentes
"fortalezas" debe ser un array con al menos 1 string describiendo un aspecto positivo observado.
${resumenCheck}`;
}

export { RUBRICA_BODYTECH, RUBRICA, RUBRICA_PSICOLOGICA };

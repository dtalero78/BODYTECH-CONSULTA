// ============================================================================
// Guías de la consulta presencial en el dispositivo de escritorio.
//
// Una sola definición por programa sirve para tres cosas, y por eso vive acá y
// no repartida: (1) lo que la pantalla le muestra al médico paso a paso, (2) el
// prompt con el que la IA llena la historia a partir de la transcripción, y (3)
// la lista de campos que se aceptan al finalizar. Agregar un campo en un paso lo
// agrega a las tres.
//
// UMV presencial: el mismo guion de 12 pasos de la consulta guiada del panel
// (GuidedConsultation.tsx), con signos vitales porque en persona se miden.
// Corporativo: sale de las secciones de su panel (camposCorporativo.ts) que se
// preguntan o se miden en la consulta. Diagnósticos, riesgo y prescripción no
// van: los decide el médico, no se le preguntan al paciente.
//
// Cada `field` es una columna de HistoriaClinica que está en EDITABLE_FIELDS.
// ============================================================================

export type Programa = 'umv' | 'corporativo';

export type TipoCampo = 'texto' | 'numero' | 'si_no' | 'opcion';

export interface CampoGuia {
  field: string;
  tipo: TipoCampo;
  /** Lo que ve el médico al revisar lo que llenó la IA. */
  etiqueta: string;
  /** Qué debe poner la IA en el campo (va al prompt). */
  ia: string;
  /** Solo para `opcion`: los valores que acepta el panel. */
  opciones?: readonly string[];
  /** Solo para `numero`: rango válido (lo de afuera se descarta). */
  min?: number;
  max?: number;
}

export interface PasoGuia {
  id: string;
  /** Rótulo corto del paso (cabe en la pantalla de 2,8"). */
  tema: string;
  /** Lo que el médico le pregunta al paciente. */
  pregunta: string;
  pista?: string;
  /** Solo se muestra a pacientes de sexo femenino. */
  soloMujer?: boolean;
  campos: CampoGuia[];
}

const OBJETIVOS = [
  'Bajar de Peso',
  'Tonificar y Definición',
  'Aumentar Masa muscular',
  'Mejorar condición Física',
  'Fortalecimiento y Estabilidad',
  'Rehabilitación Funcional',
  'Salud',
] as const;

function antecedente(
  id: string,
  tema: string,
  pregunta: string,
  flag: string,
  obs: string,
  queEs: string,
  pista?: string
): PasoGuia {
  return {
    id,
    tema,
    pregunta,
    pista,
    campos: [
      { field: flag, tipo: 'si_no', etiqueta: `${tema}: ¿tiene?`, ia: `true si el paciente refiere ${queEs}; false si lo niega.` },
      { field: obs, tipo: 'texto', etiqueta: tema, ia: `Detalle de ${queEs}: cuáles, desde cuándo, manejo. Si lo niega: "Niega ${queEs}."` },
    ],
  };
}

const GUIA_UMV: PasoGuia[] = [
  {
    id: 'motivo',
    tema: 'Motivo',
    pregunta: '¿Qué te trae a la consulta hoy? ¿Cuál es tu objetivo principal?',
    pista: 'Lo que busca el afiliado, en una o dos frases.',
    campos: [
      { field: 'motivo_consulta_texto', tipo: 'texto', etiqueta: 'Motivo de consulta', ia: 'Por qué consulta, en una o dos oraciones.' },
      { field: 'objetivo_bodytech', tipo: 'opcion', etiqueta: 'Objetivo', ia: 'El objetivo principal del afiliado.', opciones: OBJETIVOS },
    ],
  },
  antecedente('ant_patologico', 'Enfermedades', '¿Has tenido enfermedades, diagnósticos o condiciones de salud importantes?',
    'ant_patologico_flag', 'ant_patologico_obs', 'enfermedades o condiciones de salud', 'Hipertensión, diabetes, tiroides, asma…'),
  antecedente('ant_quirurgico', 'Cirugías', '¿Te han realizado alguna cirugía?',
    'ant_quirurgico_flag', 'ant_quirurgico_obs', 'cirugías previas'),
  antecedente('ant_osteomuscular', 'Lesiones', '¿Has tenido lesiones musculares, óseas o articulares?',
    'ant_osteomuscular_flag', 'ant_osteomuscular_obs', 'lesiones osteomusculares', 'Fracturas, esguinces, tendones, ligamentos.'),
  antecedente('ant_farmacologico', 'Medicamentos', '¿Tomas algún medicamento de forma habitual?',
    'ant_farmacologico_flag', 'ant_farmacologico_obs', 'consumo de medicamentos'),
  antecedente('ant_alergicos', 'Alergias', '¿Eres alérgico a algún medicamento, alimento o sustancia?',
    'ant_alergicos_flag', 'ant_alergicos_obs', 'alergias'),
  antecedente('ant_familiares', 'Familia', '¿Hay antecedentes de enfermedad en tu familia cercana?',
    'ant_familiares_flag', 'ant_familiares_obs', 'antecedentes familiares de enfermedad', 'Diabetes, corazón o cáncer en padres o hermanos.'),
  {
    id: 'embarazo',
    tema: 'Embarazo',
    pregunta: '¿Estás en embarazo actualmente?',
    soloMujer: true,
    campos: [{ field: 'embarazo_actual', tipo: 'si_no', etiqueta: 'Embarazo actual', ia: 'true si está en embarazo; false si lo niega.' }],
  },
  {
    id: 'actividad',
    tema: 'Actividad física',
    pregunta: '¿Cuántos días por semana haces actividad física y cuánto dura cada sesión?',
    campos: [
      { field: 'actividad_frecuencia', tipo: 'numero', etiqueta: 'Días por semana', ia: 'Días por semana de actividad física (0 a 7).', min: 0, max: 7 },
      { field: 'actividad_duracion_min', tipo: 'numero', etiqueta: 'Minutos por sesión', ia: 'Duración de cada sesión en minutos.', min: 0, max: 600 },
    ],
  },
  {
    id: 'dolor',
    tema: 'Dolor',
    pregunta: '¿Tienes dolor en alguna parte del cuerpo?',
    pista: 'Zona, tiempo de evolución, tipo, qué lo aumenta o alivia.',
    campos: [{ field: 'hallazgos_dolor', tipo: 'texto', etiqueta: 'Dolor', ia: 'Zona, tipo, evolución, irradiación y qué lo aumenta o alivia, en un párrafo.' }],
  },
  {
    id: 'medidas',
    tema: 'Medidas',
    pregunta: 'Peso, estatura y tensión arterial.',
    pista: 'Diga los valores en voz alta al medirlos.',
    campos: [
      { field: 'cc_peso_nuevo', tipo: 'numero', etiqueta: 'Peso (kg)', ia: 'Peso en kg. Convertir libras a kg.', min: 20, max: 300 },
      { field: 'cc_estatura_nuevo', tipo: 'numero', etiqueta: 'Estatura (cm)', ia: 'Estatura en cm. Convertir metros a cm.', min: 100, max: 230 },
      { field: 'tas', tipo: 'numero', etiqueta: 'Tensión sistólica', ia: 'Tensión arterial sistólica en mmHg.', min: 60, max: 260 },
      { field: 'tad', tipo: 'numero', etiqueta: 'Tensión diastólica', ia: 'Tensión arterial diastólica en mmHg.', min: 30, max: 160 },
    ],
  },
  {
    id: 'hallazgos',
    tema: 'Hallazgos',
    pregunta: 'Hallazgos relevantes de la valoración.',
    pista: 'Postura, marcha, movilidad: dígalos en voz alta.',
    campos: [{ field: 'hallazgos_descripcion', tipo: 'texto', etiqueta: 'Hallazgos', ia: 'Hallazgos del examen físico que el profesional dijo en voz alta.' }],
  },
];

function siNo(field: string, etiqueta: string, queEs: string): CampoGuia {
  return { field, tipo: 'si_no', etiqueta, ia: `true si refiere ${queEs}; false si lo niega.` };
}

const GUIA_CORPORATIVO: PasoGuia[] = [
  {
    id: 'motivo',
    tema: 'Motivo',
    pregunta: '¿Por qué viene hoy a la valoración?',
    campos: [{ field: 'motivo_consulta_texto', tipo: 'texto', etiqueta: 'Motivo de consulta', ia: 'Por qué consulta, en una o dos oraciones.' }],
  },
  {
    id: 'enfermedad_actual',
    tema: 'Enfermedad actual',
    pregunta: '¿Tiene alguna molestia o enfermedad en este momento?',
    campos: [{ field: 'mc_enfermedad_actual', tipo: 'texto', etiqueta: 'Enfermedad actual', ia: 'Molestias o enfermedad actual. Si no tiene: "Niega enfermedad actual."' }],
  },
  {
    id: 'sintomas',
    tema: 'Síntomas en ejercicio',
    pregunta: 'Al hacer ejercicio, ¿ha sentido dolor en el pecho, palpitaciones, falta de aire, hinchazón de piernas, desmayos o dolor en las piernas al caminar?',
    campos: [
      siNo('mc_sint_dolor_toracico', 'Dolor torácico', 'dolor torácico con el ejercicio'),
      siNo('mc_sint_palpitaciones', 'Palpitaciones', 'palpitaciones'),
      siNo('mc_sint_disnea', 'Disnea', 'falta de aire (disnea)'),
      siNo('mc_sint_edema_mmii', 'Edema de MMII', 'hinchazón de miembros inferiores'),
      siNo('mc_sint_sincope', 'Síncope', 'desmayos (síncope)'),
      siNo('mc_sint_claudicacion', 'Claudicación', 'dolor en las piernas al caminar (claudicación)'),
      { field: 'mc_sint_observaciones', tipo: 'texto', etiqueta: 'Síntomas: observaciones', ia: 'Detalle de los síntomas que sí refiere.' },
    ],
  },
  {
    id: 'familiares',
    tema: 'Antecedentes familiares',
    pregunta: 'En su familia cercana, ¿hay enfermedad del corazón, de los pulmones, infarto o muerte súbita, hipertensión, derrame, diabetes o cáncer?',
    campos: [
      siNo('mc_fam_cardiaca', 'Familiar: cardiaca', 'enfermedad cardiaca en la familia'),
      siNo('mc_fam_respiratoria', 'Familiar: respiratoria', 'enfermedad respiratoria en la familia'),
      siNo('mc_fam_msc_iam', 'Familiar: MSC o IAM', 'muerte súbita o infarto en la familia'),
      siNo('mc_fam_hta', 'Familiar: hipertensión', 'hipertensión en la familia'),
      siNo('mc_fam_cerebrovascular', 'Familiar: cerebrovascular', 'enfermedad cerebrovascular en la familia'),
      siNo('mc_fam_diabetes', 'Familiar: diabetes', 'diabetes en la familia'),
      siNo('mc_fam_cancer', 'Familiar: cáncer', 'cáncer en la familia'),
      { field: 'mc_fam_observaciones', tipo: 'texto', etiqueta: 'Familiares: observaciones', ia: 'Qué enfermedad y qué parentesco.' },
    ],
  },
  {
    id: 'personales',
    tema: 'Antecedentes personales',
    pregunta: '¿Usted tiene o ha tenido enfermedad del corazón, pulmonar, hipertensión, renal, metabólica o cerebrovascular? ¿Fuma? ¿Toma alcohol?',
    campos: [
      siNo('mc_per_cardiaca', 'Personal: cardiaca', 'enfermedad cardiaca'),
      siNo('mc_per_respiratoria', 'Personal: respiratoria', 'enfermedad respiratoria'),
      siNo('mc_per_hta', 'Personal: hipertensión', 'hipertensión arterial'),
      siNo('mc_per_renal', 'Personal: renal', 'enfermedad renal'),
      siNo('mc_per_metabolica', 'Personal: metabólica', 'enfermedad metabólica (diabetes, tiroides, dislipidemia)'),
      siNo('mc_per_cerebrovascular', 'Personal: cerebrovascular', 'enfermedad cerebrovascular'),
      siNo('mc_per_tabaquismo', 'Tabaquismo', 'que fuma'),
      siNo('mc_per_alcohol', 'Alcohol', 'consumo de alcohol'),
      { field: 'mc_per_observaciones', tipo: 'texto', etiqueta: 'Personales: observaciones', ia: 'Detalle de los antecedentes personales que sí refiere.' },
    ],
  },
  {
    id: 'osteomuscular',
    tema: 'Lesiones',
    pregunta: '¿Ha tenido lesiones de huesos, músculos o articulaciones?',
    campos: [{ field: 'mc_per_osteomuscular', tipo: 'texto', etiqueta: 'Osteomusculares', ia: 'Lesiones osteomusculares: cuál, dónde, cuándo. Si lo niega: "Niega."' }],
  },
  {
    id: 'quirurgicos',
    tema: 'Cirugías',
    pregunta: '¿Lo han operado alguna vez?',
    campos: [{ field: 'mc_per_quirurgicos', tipo: 'texto', etiqueta: 'Quirúrgicos', ia: 'Cirugías y hace cuánto. Si lo niega: "Niega."' }],
  },
  {
    id: 'alergicos',
    tema: 'Alergias',
    pregunta: '¿Es alérgico a algún medicamento, alimento o sustancia?',
    campos: [{ field: 'mc_per_alergicos', tipo: 'texto', etiqueta: 'Alérgicos', ia: 'Alergias: agente y reacción. Si lo niega: "Niega."' }],
  },
  {
    id: 'farmacologicos',
    tema: 'Medicamentos',
    pregunta: '¿Toma algún medicamento de forma habitual?',
    campos: [{ field: 'mc_per_farmacologicos', tipo: 'texto', etiqueta: 'Farmacológicos', ia: 'Medicamentos con dosis y frecuencia si se dicen. Si lo niega: "Niega."' }],
  },
  {
    id: 'actividad',
    tema: 'Actividad física',
    pregunta: '¿Cuántas veces por semana entrena, cuántos minutos y hace cuántos meses? ¿Ha entrenado en gimnasio? ¿Dónde entrena y para qué?',
    campos: [
      { field: 'mc_af_sesiones_semana', tipo: 'numero', etiqueta: 'Sesiones por semana', ia: 'Sesiones de ejercicio por semana.', min: 0, max: 14 },
      { field: 'mc_af_minutos_sesion', tipo: 'numero', etiqueta: 'Minutos por sesión', ia: 'Minutos por sesión.', min: 0, max: 600 },
      { field: 'mc_af_meses', tipo: 'numero', etiqueta: 'Meses de práctica', ia: 'Hace cuántos meses entrena así.', min: 0, max: 600 },
      { field: 'mc_af_experiencia_gym', tipo: 'si_no', etiqueta: 'Experiencia en gimnasio', ia: 'true si ha entrenado en gimnasio; false si no.' },
      { field: 'mc_af_modalidad', tipo: 'texto', etiqueta: 'Dónde entrena', ia: 'Dónde entrena (gimnasio, casa, al aire libre…).' },
      { field: 'mc_af_objetivo', tipo: 'texto', etiqueta: 'Objetivo', ia: 'Para qué entrena.' },
    ],
  },
  {
    id: 'signos',
    tema: 'Signos vitales',
    pregunta: 'Peso, talla, tensión arterial y frecuencia cardiaca.',
    pista: 'Diga los valores en voz alta al medirlos.',
    campos: [
      { field: 'mc_peso', tipo: 'numero', etiqueta: 'Peso (kg)', ia: 'Peso en kg. Convertir libras a kg.', min: 20, max: 300 },
      { field: 'mc_talla', tipo: 'numero', etiqueta: 'Talla (cm)', ia: 'Talla en cm. Convertir metros a cm.', min: 100, max: 230 },
      { field: 'tas', tipo: 'numero', etiqueta: 'Tensión sistólica', ia: 'Tensión arterial sistólica en mmHg.', min: 60, max: 260 },
      { field: 'tad', tipo: 'numero', etiqueta: 'Tensión diastólica', ia: 'Tensión arterial diastólica en mmHg.', min: 30, max: 160 },
      { field: 'mc_frec_card', tipo: 'numero', etiqueta: 'Frecuencia cardiaca', ia: 'Frecuencia cardiaca en reposo, lpm.', min: 30, max: 220 },
      { field: 'mc_sato2', tipo: 'numero', etiqueta: 'SatO2 (%)', ia: 'Saturación de oxígeno en %.', min: 50, max: 100 },
      { field: 'mc_perimetro_abdominal', tipo: 'numero', etiqueta: 'Perímetro abdominal (cm)', ia: 'Perímetro abdominal en cm.', min: 40, max: 200 },
    ],
  },
  {
    id: 'examen',
    tema: 'Examen físico',
    pregunta: 'Hallazgos del examen por sistemas.',
    pista: 'Diga en voz alta lo que encuentra.',
    campos: [
      { field: 'mc_rs_torax', tipo: 'texto', etiqueta: 'Revisión por sistemas', ia: 'Hallazgos del examen por sistemas que el médico dijo en voz alta.' },
      { field: 'mc_examen_observaciones', tipo: 'texto', etiqueta: 'Observaciones del examen', ia: 'Otras observaciones del examen físico.' },
    ],
  },
];

export const GUIAS: Record<Programa, PasoGuia[]> = { umv: GUIA_UMV, corporativo: GUIA_CORPORATIVO };

/** El médico corporativo se reconoce por su especialidad (igual que el panel). */
export function programaDe(especialidad: string | null | undefined): Programa {
  const e = (especialidad ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return e === 'medico corporativo' ? 'corporativo' : 'umv';
}

/** Los pasos que aplican a este paciente (el de embarazo, solo a mujeres). */
export function pasosPara(programa: Programa, genero: string | null | undefined): PasoGuia[] {
  const mujer = /^f/i.test((genero ?? '').trim());
  return GUIAS[programa].filter((p) => !p.soloMujer || mujer);
}

export function camposDe(programa: Programa): CampoGuia[] {
  return GUIAS[programa].flatMap((p) => p.campos);
}

/**
 * Prompt de extracción para el programa. La transcripción llega agrupada por
 * paso ("## Alergias"), así que el modelo sabe a qué pregunta responde cada cosa.
 */
export function promptExtraccion(programa: Programa): string {
  const lineas = GUIAS[programa].flatMap((p) =>
    p.campos.map((c) => {
      const tipo =
        c.tipo === 'numero' ? 'number' : c.tipo === 'si_no' ? 'boolean' : c.tipo === 'opcion' ? `uno de: ${c.opciones!.join(' | ')}` : 'string';
      return `  - ${c.field} (${tipo}) [paso "${p.tema}"]: ${c.ia}`;
    })
  );
  return `
Eres un asistente clínico. Recibes la transcripción de una consulta PRESENCIAL
de Bodytech entre el profesional y el paciente, agrupada por los pasos de la
guía que el profesional iba siguiendo ("## <paso>"). Lo dicho bajo un paso
responde casi siempre a esa pregunta, pero integra lo que aparezca en otros.

Devuelve un objeto JSON solo con las claves que la conversación justifique.
Si un tema no se habló, omite su clave.

Claves permitidas:
${lineas.join('\n')}

REGLAS:
  1. Números SOLO si se dijeron explícitamente; nunca los infieras. Como números JSON.
  2. Booleanos como true/false, solo si el paciente afirmó o negó el tema.
  3. Texto en español, tercera persona, lenguaje clínico conciso. No copies
     muletillas ("dijo que", "eh").
  4. No inventes diagnósticos, conductas ni recomendaciones.
  5. La transcripción automática puede tener errores: si algo no tiene
     sentido clínico, omítelo.

Devuelve únicamente el JSON.
`.trim();
}

/**
 * ¿Se puede escribir `nuevo` en un campo que hoy vale `actual`? Lo que escribió
 * el médico no se pisa. Los Sí/No son el caso raro: la columna nace en `false`,
 * así que `false` no distingue "el médico dijo No" de "nadie respondió". Por
 * eso un Sí entra mientras no esté ya en Sí, y un No solo si está vacío: nunca
 * se le quita un Sí que marcó el médico. (Antes quedaba "Alergias: No" con la
 * observación "alérgica a la penicilina" al lado.)
 */
export function puedeLlenar(tipo: TipoCampo, actual: unknown, nuevo: unknown): boolean {
  if (tipo === 'si_no') {
    if (actual === true || actual === 'true' || actual === 'Sí' || actual === 'SI') return false;
    return nuevo === true || actual === null || actual === undefined;
  }
  if (actual === null || actual === undefined) return true;
  return typeof actual === 'string' ? actual.trim() === '' : false;
}

/**
 * Valida lo que devolvió el modelo contra la guía: solo claves conocidas, con
 * el tipo correcto y dentro del rango. Lo que no pasa se descarta en silencio
 * (es mejor un campo vacío que uno mal llenado).
 */
export function validarExtraccion(programa: Programa, crudo: unknown): Record<string, string | number | boolean> {
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return {};
  const plano: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(crudo as Record<string, unknown>)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(plano, v);
    else plano[k] = v;
  }
  const out: Record<string, string | number | boolean> = {};
  for (const c of camposDe(programa)) {
    const v = plano[c.field];
    if (v === undefined || v === null) continue;
    if (c.tipo === 'texto') {
      if (typeof v === 'string' && v.trim()) out[c.field] = v.trim();
    } else if (c.tipo === 'si_no') {
      if (typeof v === 'boolean') out[c.field] = v;
    } else if (c.tipo === 'opcion') {
      if (typeof v === 'string' && c.opciones!.includes(v.trim())) out[c.field] = v.trim();
    } else {
      const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
      if (Number.isFinite(n) && (c.min === undefined || n >= c.min) && (c.max === undefined || n <= c.max)) {
        out[c.field] = Math.round(n * 10) / 10;
      }
    }
  }
  return out;
}

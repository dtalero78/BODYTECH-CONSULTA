#!/usr/bin/env node
/**
 * Crea (o actualiza) el vocabulario propio de Bodytech en Amazon Transcribe.
 *
 * Sin él, Transcribe escribe lo que le suena: "Boditech" en vez de "Bodytech",
 * y se pierde con los términos de nutrición y las marcas del negocio. El
 * vocabulario le da una lista de palabras que SÍ existen en este dominio, y las
 * prefiere cuando duda.
 *
 * Es idempotente: si ya existe, lo actualiza. Correr con:
 *   npm run transcribe:vocabulario
 *
 * Después hay que poner el nombre en TRANSCRIBE_VOCABULARY_NAME (backend y DO).
 * Si la variable no está, los jobs corren igual, solo que sin esta ayuda.
 */
const {
  TranscribeClient,
  CreateVocabularyCommand,
  UpdateVocabularyCommand,
  GetVocabularyCommand,
} = require('@aws-sdk/client-transcribe');

const REGION = process.env.CHIME_CONTROL_REGION || process.env.AWS_REGION || 'us-east-1';
const LANGUAGE = process.env.TRANSCRIBE_LANGUAGE || 'es-US';
const NOMBRE = process.env.TRANSCRIBE_VOCABULARY_NAME || 'bodytech-es';

// Una frase por entrada. Las de varias palabras van unidas con guion, que es
// como Transcribe espera las frases compuestas.
const TERMINOS = [
  // Marcas y actores del negocio
  'Bodytech', 'Trepsi', 'BodyVibe', 'Sol-Médica', 'Novo-Nordisk',
  // Programa y roles
  'coach', 'nutrición-virtual', 'valoración', 'telemedicina', 'videollamada',
  // Antropometría y composición corporal (el panel nutricional)
  'antropometría', 'antropométrica', 'somatocarta', 'somatotipo', 'ISAK',
  'Heath-Carter', 'Yuhasz', 'Faulkner', 'Durnin-Womersley',
  'pliegues', 'pliegue-tricipital', 'pliegue-subescapular', 'pliegue-suprailíaco',
  'bioimpedancia', 'perímetro-abdominal', 'masa-muscular', 'masa-magra',
  'porcentaje-de-grasa', 'grasa-visceral', 'metabolismo-basal',
  // Índices y siglas que se dictan
  'IMC', 'TMB', 'ICC', 'ACSM', 'Downton',
  // Salud en Colombia
  'EPS', 'IPS', 'POS', 'afiliado', 'historia-clínica', 'cédula',
  // Alimentación (aparecen mucho en las consultas de nutrición)
  'vinagreta', 'porción', 'proteína', 'carbohidrato', 'kilocalorías',
];

(async () => {
  const client = new TranscribeClient({ region: REGION });
  let existe = false;
  try {
    await client.send(new GetVocabularyCommand({ VocabularyName: NOMBRE }));
    existe = true;
  } catch {
    existe = false;
  }

  const input = { VocabularyName: NOMBRE, LanguageCode: LANGUAGE, Phrases: TERMINOS };
  const r = await client.send(
    existe ? new UpdateVocabularyCommand(input) : new CreateVocabularyCommand(input)
  );
  console.log(`${existe ? 'Actualizado' : 'Creado'}: ${NOMBRE} (${LANGUAGE}) · ${TERMINOS.length} términos`);
  console.log(`Estado: ${r.VocabularyState} — pasa a READY en ~1 min; los jobs fallan si se usa antes.`);
  console.log(`\nFalta: TRANSCRIBE_VOCABULARY_NAME=${NOMBRE} en el backend y en DO.`);
})().catch((e) => {
  console.error('✗', e.name, '-', e.message);
  process.exit(1);
});

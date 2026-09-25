/* eslint-disable */
// Crea la plantilla del link de la Unidad Médica Virtual (pedida el
// 24-sep-2026). v2 (25-sep): la v1 Meta la aprobó como MARKETING por el párrafo
// promocional ("entrenes con confianza… recomendaciones adaptadas…"); la v2 lo
// quita y queda solo lo que informa de la cita, para que sea UTILITY con dos botones URL:
//   - "Contáctame"  → https://bodytech.app/panel-medico/patient/{{4}}
//   - "Reprogramar" → https://bodytech.app/reprogramar/{{5}}
// Variables: {{1}} nombre, {{2}} fecha ("jueves 25 de septiembre"), {{3}} hora.
// El texto tiene que coincidir con textoLinkUmv (unidad-envio.helper.ts).
// y la envía a aprobación de WhatsApp (categoría UTILITY).
// NO modifica la plantilla actual. Imprime el nuevo Content SID.
//
// Uso: node scripts/twilio-create-template-umv.cjs
require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en .env');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const FRIENDLY_NAME = 'bodytech_umv_link_v2';
const TEMPLATE_NAME = 'bodytech_umv_link_v2'; // nombre WhatsApp (minúsculas + _)

const body =
  'Hola, {{1}} 👋\n\n' +
  'Tienes programada una consulta virtual con un profesional de fisioterapia. 🧑‍⚕️\n\n' +
  '📅 Fecha: {{2}}\n🕐 Hora: {{3}}\n\n' +
  'Para ingresar a la videollamada, selecciona “Contáctame”.\n\n' +
  'Si necesitas cambiar el horario, selecciona “Reprogramar”.\n\n' +
  '¡Te esperamos!\nUnidad Médica Virtual';

const createPayload = {
  friendly_name: FRIENDLY_NAME,
  language: 'es',
  variables: {
    '1': 'Juan',
    '2': 'jueves 25 de septiembre',
    '3': '09:00 a. m.',
    '4': 'consulta-m1a2b3c?nombre=Juan&apellido=Perez&documento=123&doctor=DRLOPEZ',
    '5': 'abc123def456',
  },
  types: {
    'twilio/call-to-action': {
      body,
      actions: [
        { type: 'URL', title: 'Contáctame', url: 'https://bodytech.app/panel-medico/patient/{{4}}' },
        { type: 'URL', title: 'Reprogramar', url: 'https://bodytech.app/reprogramar/{{5}}' },
      ],
    },
  },
};

(async () => {
  // 1) Crear el contenido
  const createRes = await fetch('https://content.twilio.com/v1/Content', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(createPayload),
  });
  const created = await createRes.json();
  if (!createRes.ok) {
    console.error('❌ Error creando contenido:', createRes.status, JSON.stringify(created, null, 2));
    process.exit(1);
  }
  console.log('✅ Content creado');
  console.log('   SID:', created.sid);
  console.log('   friendlyName:', created.friendly_name);

  // 2) Enviar a aprobación de WhatsApp
  const apprRes = await fetch(
    `https://content.twilio.com/v1/Content/${created.sid}/ApprovalRequests/whatsapp`,
    {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      // allow_category_change: false → si Meta no la acepta como UTILITY, la rechaza
      // en vez de pasarla a MARKETING en silencio (Daniel: deben ser utility).
      body: JSON.stringify({ name: TEMPLATE_NAME, category: 'UTILITY', allow_category_change: false }),
    }
  );
  const appr = await apprRes.json();
  if (!apprRes.ok) {
    console.error('⚠️  Content creado pero falló el envío a aprobación:', apprRes.status, JSON.stringify(appr, null, 2));
    console.error('   Puedes enviarlo a aprobación manualmente desde la consola de Twilio.');
    process.exit(0);
  }
  console.log('📤 Enviado a aprobación de WhatsApp');
  console.log(JSON.stringify(appr, null, 2));
  console.log('\n👉 Cuando WhatsApp lo apruebe, configura TWILIO_WHATSAPP_UMV_TEMPLATE_SID =', created.sid);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

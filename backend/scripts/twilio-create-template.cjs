/* eslint-disable */
// Crea una NUEVA plantilla de Content API (Bodytech) con dos botones URL:
//   - "Conectarme"  → https://bodytech.app/panel-medico/patient/{{3}}
//   - "Reprogramar" → https://bodytech.app/reprogramar/{{4}}
// y la envía a aprobación de WhatsApp (categoría UTILITY).
// NO modifica la plantilla actual. Imprime el nuevo Content SID.
//
// Uso: node scripts/twilio-create-template.cjs
require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en .env');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const FRIENDLY_NAME = 'bodytech_cita_v2';
const TEMPLATE_NAME = 'bodytech_cita_v2'; // nombre WhatsApp (minúsculas + _)

const body =
  ' Hola {{1}},\n\nTe saludamos del Bodytech.\n\nTienes una consulta médica a las {{2}}.\n\n' +
  'Para ingresar a tu videollamada toca "Conectarme".\nSi necesitas otro horario, toca "Reprogramar".\n\n' +
  'Gracias!\nEquipo Médico';

const createPayload = {
  friendly_name: FRIENDLY_NAME,
  language: 'es',
  variables: {
    '1': 'Juan García',
    '2': '3:00 pm',
    '3': 'consulta-m1a2b3c?nombre=Juan&apellido=Perez&documento=123&doctor=DRLOPEZ',
    '4': 'abc123def456',
  },
  types: {
    'twilio/call-to-action': {
      body,
      actions: [
        { type: 'URL', title: 'Conectarme', url: 'https://bodytech.app/panel-medico/patient/{{3}}' },
        { type: 'URL', title: 'Reprogramar', url: 'https://bodytech.app/reprogramar/{{4}}' },
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
      body: JSON.stringify({ name: TEMPLATE_NAME, category: 'UTILITY' }),
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
  console.log('\n👉 Cuando WhatsApp lo apruebe, actualiza TWILIO_WHATSAPP_TEMPLATE_SID =', created.sid);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

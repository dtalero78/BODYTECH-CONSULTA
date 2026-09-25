/* eslint-disable */
// Crea la plantilla de invitación a agendar de la Unidad Médica Virtual (pedida
// el 25-sep-2026): le llega al afiliado nuevo cuando MyBodytech manda su orden.
// Un botón URL:
//   - "Agendar mi consulta" → https://bodytech.app/agendar/{{2}}
// Variables: {{1}} nombre, {{2}} token de la orden.
// El texto tiene que coincidir con textoInvitacionUmv (agenda-umv.helper.ts).
// La envía a aprobación de WhatsApp (categoría UTILITY). Imprime el Content SID.
//
// Uso: node scripts/twilio-create-template-umv-agendar.cjs
require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en .env');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const FRIENDLY_NAME = 'bodytech_umv_agendar_v1';
const TEMPLATE_NAME = 'bodytech_umv_agendar_v1'; // nombre WhatsApp (minúsculas + _)

const body =
  '¡Hola {{1}}! Ahora eres parte de Bodytech.\n\n' +
  'Como parte de tu proceso, te invitamos a agendar tu consulta virtual por fisioterapia. ' +
  'Esta consulta no toma más de 15 minutos y es muy importante para tu proceso.\n\n' +
  'Para agendarla haz clic en el botón.';

const createPayload = {
  friendly_name: FRIENDLY_NAME,
  language: 'es',
  variables: {
    '1': 'Juan',
    '2': 'Xb3kP9qLm2Vt7Rw1Ya5Zc8Nd',
  },
  types: {
    'twilio/call-to-action': {
      body,
      actions: [
        { type: 'URL', title: 'Agendar mi consulta', url: 'https://bodytech.app/agendar/{{2}}' },
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
  console.log('\n👉 Cuando WhatsApp lo apruebe, configura TWILIO_WHATSAPP_UMV_AGENDAR_TEMPLATE_SID =', created.sid);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

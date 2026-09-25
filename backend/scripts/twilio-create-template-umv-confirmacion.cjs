/* eslint-disable */
// Crea la plantilla de CONFIRMACIÓN de la cita de la Unidad Médica Virtual
// (pedida el 25-sep-2026): le llega al afiliado apenas elige su cupo en
// /agendar. Un botón URL:
//   - "Reprogramar" → https://bodytech.app/reprogramar/{{4}}
// Variables: {{1}} nombre, {{2}} fecha ("lunes 28 de septiembre"), {{3}} hora,
// {{4}} id firmado de la historia (el mismo del botón Reprogramar de siempre).
// El texto tiene que coincidir con textoConfirmacionUmv (agenda-umv.helper.ts).
// La envía a aprobación de WhatsApp (categoría UTILITY). Imprime el Content SID.
//
// Uso: node scripts/twilio-create-template-umv-confirmacion.cjs
require('dotenv').config();

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
if (!ACCOUNT_SID || !AUTH_TOKEN) {
  console.error('Faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN en .env');
  process.exit(1);
}
const auth = 'Basic ' + Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');

const FRIENDLY_NAME = 'bodytech_umv_confirmacion_v1';
const TEMPLATE_NAME = 'bodytech_umv_confirmacion_v1'; // nombre WhatsApp (minúsculas + _)

const body =
  '¡Listo, {{1}}! Tu consulta virtual de fisioterapia quedó agendada. ✅\n\n' +
  '📅 Fecha: {{2}}\n🕐 Hora: {{3}}\n\n' +
  'A la hora de tu consulta te enviaremos por este medio el enlace para ingresar a la videollamada.\n\n' +
  'Si necesitas cambiar el horario, selecciona “Reprogramar”.\n\n' +
  'Unidad Médica Virtual';

const createPayload = {
  friendly_name: FRIENDLY_NAME,
  language: 'es',
  variables: {
    '1': 'Juan',
    '2': 'lunes 28 de septiembre',
    '3': '09:30 a. m.',
    '4': 'mbt_0a1b2c3d4e5f~9f2a1c7b55',
  },
  types: {
    'twilio/call-to-action': {
      body,
      actions: [{ type: 'URL', title: 'Reprogramar', url: 'https://bodytech.app/reprogramar/{{4}}' }],
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
  console.log('\n👉 Cuando WhatsApp lo apruebe, configura TWILIO_WHATSAPP_UMV_CONFIRMACION_TEMPLATE_SID =', created.sid);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});

/* eslint-disable */
// Lectura (read-only) de la plantilla de Content API actual para inspeccionar
// su estructura (tipos, cuerpo, variables, botones) antes de crear la nueva.
// Uso: node scripts/twilio-fetch-template.cjs [CONTENT_SID]
require('dotenv').config();
const twilio = require('twilio');

const sid = process.argv[2] || process.env.TWILIO_WHATSAPP_TEMPLATE_SID || 'HXb3cafc049dcc310e2cfbfffb6e943c4e';
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

(async () => {
  try {
    const c = await client.content.v1.contents(sid).fetch();
    console.log('=== CONTENT ===');
    console.log('sid:', c.sid);
    console.log('friendlyName:', c.friendlyName);
    console.log('language:', c.language);
    console.log('variables:', JSON.stringify(c.variables));
    console.log('types:', JSON.stringify(c.types, null, 2));
    try {
      const approvals = await client.content.v1.contents(sid).approvalFetch();
      console.log('=== APPROVAL ===');
      console.log(JSON.stringify(approvals.whatsapp || approvals, null, 2));
    } catch (e) {
      console.log('approval fetch err:', e.message);
    }
  } catch (e) {
    console.error('ERROR:', e.status, e.code, e.message);
    process.exit(1);
  }
})();

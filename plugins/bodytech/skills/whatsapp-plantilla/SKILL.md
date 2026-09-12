---
name: whatsapp-plantilla
description: Usar al enviar, agregar o modificar cualquier mensaje de WhatsApp al paciente o al coach — link de la videollamada, recordatorio, informe de sesión, aviso, notificación. También cuando un mensaje sale como no entregado o hay que elegir entre plantilla y texto libre.
---

# Todo WhatsApp sale por una plantilla aprobada

La cuenta de Twilio es Business. Fuera de una ventana de 24 horas desde el
último mensaje del paciente, Meta sólo entrega **plantillas aprobadas**. Un
mensaje de texto libre se acepta en la API y no llega nunca; el paciente se
queda esperando el link.

## La única vía

`backend/src/services/whatsapp.service.ts`, con `contentSid` apuntando a una
plantilla ya aprobada, y `contentVariables` para los datos. Remitente:
`whatsapp:+5716284820`.

Plantillas en uso, cada una con su variable de entorno:

- `TWILIO_WHATSAPP_TEMPLATE_SID` — link de la consulta (botón Conectarme)
- `TWILIO_WHATSAPP_RECORDATORIO_TEMPLATE_SID` — recordatorio de las 07:00, con
  hora y botón Reprogramar, **sin** link
- `TWILIO_WHATSAPP_REPORT_TEMPLATE_SID` — informe de sesión
- `TWILIO_WHATSAPP_GESTION_TEMPLATE_SID` — informe de gestión diario a admins

Un mensaje nuevo con texto nuevo necesita **una plantilla nueva aprobada por
Meta**, no un string en el código. Eso tarda días: hay que decirlo antes de
estimar la tarea.

## Nunca

- Armar un link `wa.me/...` o `api.whatsapp.com/send?...`. No es un envío: es
  abrirle el chat a alguien para que escriba a mano.
- Mandar `body:` con texto libre a un paciente. Existe `sendTextMessage()` en
  ese mismo service, pero es para reportes internos a números del equipo que
  escribieron hace poco; usarlo con un paciente es el defecto clásico.
- Inventar un `contentSid`.

## Los números

`backend/src/helpers/phone.helper.ts` normaliza a E.164. Acepta `(+52) 244...`,
`+13053...`, `13053...` y el celular colombiano suelto `300...`. No escribir
otro formateador.

---
type: llm
---

El usuario pidió mandar un WhatsApp de texto libre a una paciente.

PASS si la respuesta advierte que a una paciente no se le puede mandar texto
libre y que hace falta una plantilla aprobada (de Twilio/Meta), con cualquier
redacción, y aunque además ofrezca alternativas.

FAIL si escribe código que manda `body:` con texto libre a la paciente, si
propone armar un link wa.me o api.whatsapp.com, o si cumple el pedido sin
mencionar la restricción de plantillas.

Juzgá sólo eso, no el formato.

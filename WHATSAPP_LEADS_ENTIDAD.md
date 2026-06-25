# WhatsApp Leads — captura automática de la "entidad"

Registra automáticamente en un **Google Sheet** el nombre de la entidad que el
cliente responde por WhatsApp después de que el operador pregunta
**"¿Para qué entidad?"**.

```
Cliente: "Para cotizar un examen médico preocupacional"
Operador: "Claro q si. Para q entidad?"   ← se detecta la pregunta
Cliente: "ANI"                            ← se acumula
Cliente: "Agencia Nacional de Infraestructura"  ← se acumula
        ↓  (60 s de silencio)
Google Sheet:  fecha | teléfono | nombre | "ANI Agencia Nacional de Infraestructura"
```

## Cómo funciona (resumen técnico)

- **WHAPI** (whapi.cloud) se conecta a tu WhatsApp por QR y llama un *webhook*
  por cada mensaje (entrantes **y salientes**).
- El backend de BODYTECH expone `POST /api/whatsapp-leads/webhook`:
  - Si llega un mensaje **saliente** (`from_me`) que contiene la pregunta de la
    entidad → arma el estado para ese chat.
  - Los mensajes **entrantes** siguientes se acumulan (el cliente suele mandar la
    sigla y luego el nombre completo en mensajes separados).
- Un worker corre cada 30 s: tras 60 s de silencio, vuelca la entidad al Sheet y
  limpia el estado.

Archivos: [whatsapp-leads.service.ts](backend/src/services/whatsapp-leads.service.ts),
[whatsapp-leads.controller.ts](backend/src/controllers/whatsapp-leads.controller.ts),
[whatsapp-leads.routes.ts](backend/src/routes/whatsapp-leads.routes.ts), tabla
`whatsapp_lead_pending` (migración en `postgres.service.ts`).

---

## Configuración — 3 pasos

### Paso 1 — Google Sheet + Apps Script (la "salida")

1. Crea un Google Sheet nuevo. En la primera fila pon los encabezados:
   `Fecha | Teléfono | Nombre | Entidad`.
2. Menú **Extensiones → Apps Script**. Borra lo que haya y pega esto:

```javascript
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);

    // Token compartido (debe coincidir con GSHEET_WEBAPP_TOKEN en el backend)
    var token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (token && data.token !== token) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: 'unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    sheet.appendRow([
      new Date(),
      data.telefono || '',
      data.nombre || '',
      data.entidad || ''
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
```

3. (Opcional pero recomendado) Define un token: **Configuración del proyecto
   (⚙️) → Propiedades del script → Agregar propiedad**: nombre `TOKEN`, valor un
   secreto cualquiera (ej. `bsl-leads-7x2k`). Guárdalo para el Paso 3.
4. **Implementar → Nueva implementación → Tipo: Aplicación web**.
   - *Ejecutar como*: **Yo**.
   - *Quién tiene acceso*: **Cualquier usuario**.
   - Copia la **URL de la app web** (termina en `/exec`).

### Paso 2 — WHAPI (la "entrada")

1. Crea/usa un canal en [whapi.cloud](https://whapi.cloud) y conéctalo a tu
   número escaneando el QR (como WhatsApp Web).
2. En **Settings → Webhooks** del canal:
   - **URL**: `https://TU-DOMINIO/api/whatsapp-leads/webhook`
     (si usas `WHAPI_WEBHOOK_SECRET`, agrégalo: `.../webhook?secret=EL_SECRETO`).
   - **Events / Mode**: activa **Messages** e incluye **mensajes salientes**
     (`from_me`). Esto es **imprescindible** — sin los salientes no se puede
     detectar la pregunta "¿Para qué entidad?".
   - Method: `POST`.

> Dónde está tu dominio: es la misma URL pública del backend de BODYTECH
> desplegado en DigitalOcean (la app `bodytech.app`).

### Paso 3 — Variables de entorno del backend

Agrega al `.env` del backend (y a las env vars de la app en DigitalOcean):

```bash
# Salida a Google Sheets (Apps Script web app del Paso 1)
GSHEET_WEBAPP_URL=https://script.google.com/macros/s/AKfy.../exec
GSHEET_WEBAPP_TOKEN=bsl-leads-7x2k        # debe coincidir con la propiedad TOKEN

# Seguridad opcional del webhook (Paso 2)
WHAPI_WEBHOOK_SECRET=otro-secreto-distinto

# Ajustes opcionales (tienen defaults sensatos)
# WHATSAPP_ENTIDAD_PATTERNS=para q entidad,para que entidad,que entidad
# WHATSAPP_LEAD_GRACE_SECONDS=60          # silencio antes de volcar
# WHATSAPP_LEAD_TTL_HOURS=24              # caduca preguntas sin responder
```

Redeploy del backend y listo.

---

## Verificación

- `GET https://TU-DOMINIO/api/whatsapp-leads/health` →
  `{ ok: true, module: "whatsapp-leads", sheetConfigured: true }`.
- Manda un mensaje saliente real con "Para q entidad?" desde el WhatsApp
  conectado, responde con un nombre desde otro teléfono, y ~1 min después
  aparece la fila en el Sheet.
- Logs del backend: `[whatsapp-leads] pregunta de entidad detectada → armado ...`
  y `[whatsapp-leads] ✅ registrado: "..."`.

## Notas / límites (v1)

- La detección depende de que WHAPI entregue los mensajes **salientes**. Si no
  llegan, revisa el modo del webhook en WHAPI.
- Si el cliente, en vez de la entidad, responde otra cosa dentro de la ventana,
  eso es lo que se registra (se limpia manualmente en el Sheet). Ajusta el texto
  de la pregunta o `WHATSAPP_ENTIDAD_PATTERNS` para minimizarlo.
- El estado vive en Postgres (`whatsapp_lead_pending`), así que sobrevive a
  reinicios/redeploys del backend.
- Si `GSHEET_WEBAPP_URL` no está configurada, el estado se captura igual y se
  reintenta el volcado cada 30 s hasta que la configures (no se pierde nada).
```

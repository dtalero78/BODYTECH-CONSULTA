# MIGRATION-PLAYBOOK — Videollamada: Twilio Video → Amazon Chime SDK

Cambio del proveedor de video dentro de la app actual. **La app se queda en DigitalOcean.**

> La migración de BSL-CONSULTAVIDEO se usó como referencia de *pasos y errores ya pagados*, no como
> código a copiar. La mitad de aquel trabajo (ECS, ALB, Terraform, VPC, cutover por redirect) era
> mudanza de hosting y **no aplica aquí**.
>
> ⚠️ **Dónde está realmente ese código:** rama `feat/migracion-aws-chime`, **sin mergear a `main`**,
> y con **cambios sin commitear** encima (el más importante es de seguridad — §5.1). Quien clone BSL
> y mire `main` no encuentra nada de Chime. Y su `MIGRATION-PLAYBOOK.md` **no documenta** los
> defectos de §5.1: son cosas que solo se ven leyendo el código.

---

## 1. Alcance

### Sí

| | |
|---|---|
| Transporte de video | `twilio-video` → `amazon-chime-sdk-js` |
| Fondo virtual / blur | `@twilio/video-processors` → procesadores de Chime |
| Grabación | Twilio compositions → Chime Media Pipelines → S3 |
| Calidad | leer el video de S3 en vez de Twilio |
| AWS | una cuenta con credenciales de acceso + un bucket S3 |

### No

Nada de hosting cambia. Sigue el mismo contenedor, en la misma app de DO (`bodytech`,
`57b6b41b-…`), con el mismo Dockerfile, el mismo Postgres y **las mismas 49 variables de entorno**
(solo se agregan 5). Mismo dominio, mismo despliegue por push a `main`.

En consecuencia **no hay**: Terraform, ECS, ALB, NAT, VPC, SSM, subdominio nuevo, redirect de
cutover, plantillas de WhatsApp nuevas, cambio de firewall en Postgres, ni reconstrucción del
inventario de variables. Todo eso era de BSL.

**WhatsApp y Twilio Voice siguen en Twilio.** El paquete `twilio` se queda en el backend; solo
dejan de usarse los métodos de video de `twilio.service.ts`.

---

## 2. La red de seguridad: el interruptor

Sin despliegue paralelo, la única forma de probar sin arriesgar a nadie es una **abstracción de
proveedor** con un interruptor:

```
VIDEO_PROVIDER=twilio   ← default, lo de hoy
VIDEO_PROVIDER=chime    ← el nuevo
```

Aquí esta abstracción es **más** necesaria que en BSL, no menos: allá el rollback era apagar un
redirect; aquí el rollback *es* esta variable.

### Cómo se elige el proveedor (importante)

La decisión **es por sala, no por usuario**. Si el médico entra por Chime y el paciente por Twilio,
no se ven y no hay ningún error. El backend decide en `POST /api/video/token` y devuelve el
proveedor en la respuesta; el frontend carga el motor que le digan.

Para no hacer un cambio de golpe: además del interruptor global, una **lista blanca de códigos de
médico** (`CHIME_ALLOWLIST=DOC123,DOC456`). El código del médico ya viaja en el link del paciente
(`/patient/:roomName?doctor=CODE`), así que los dos extremos resuelven lo mismo. Se empieza con un
médico, luego una sede, luego todos.

---

## 3. Qué hay que construir

### 3.1 Backend — capa de proveedor

Nueva carpeta `backend/src/services/video/`:

- `types.ts` — interfaz `IVideoProvider`: `join`, `getRoom`, `createRoom`,
  `endRoom(room, { completed?: boolean })`, `listParticipants`, `disconnectParticipant`,
  `startRecording`. Más un error `RoomCompletedError`.
- `index.ts` — factory que lee `VIDEO_PROVIDER` (+ la lista blanca).
- `twilio-video.provider.ts` — **envuelve el `twilio.service.ts` actual sin reescribirlo**.
- `chime-video.provider.ts` — el nuevo.
- `chime-recording.service.ts` — capture + concatenation pipelines → S3, y URL firmada.

Dos tablas nuevas, ambas `CREATE TABLE IF NOT EXISTS` (aditivas, no rompen nada):

```sql
chime_meetings   (room_name TEXT PK, meeting_id TEXT, created_at TIMESTAMPTZ)
chime_recordings (id SERIAL PK, room_name, meeting_id, capture_pipeline_arn,
                  capture_pipeline_id, s3_capture_prefix, s3_recording_prefix,
                  status, created_at, ended_at)
```

Se recablean los 3 sitios que hoy importan `twilioService` como singleton concreto:
[video.controller.ts:5](backend/src/controllers/video.controller.ts#L5),
[transcription.service.ts:4](backend/src/services/transcription.service.ts#L4),
[calidad.service.ts:17](backend/src/services/calidad.service.ts#L17).

Endpoint nuevo: `GET /api/video/recordings/:roomName` → URL firmada de S3.

### 3.2 Frontend — motor de video

Nueva carpeta `frontend/src/video/` con una interfaz `VideoEngine` y dos implementaciones, cargadas
con `await import()` para que solo se descargue la que se usa.

Ocho archivos importan `twilio-video` hoy:

| Archivo | Trabajo |
|---|---|
| [useVideoRoom.ts](frontend/src/hooks/useVideoRoom.ts) | reescritura — único `Video.connect` |
| [Participant.tsx](frontend/src/components/Participant.tsx) | reescritura — `attach/detach` → `bindVideoElement` |
| [useBackgroundEffects.ts](frontend/src/hooks/useBackgroundEffects.ts) | reescritura — el mapeo más 1:1 de todos |
| [useConsultationRecorder.ts](frontend/src/hooks/useConsultationRecorder.ts) | solo tipos |
| [useRealtimeTranscription.ts](frontend/src/hooks/useRealtimeTranscription.ts) | solo tipos |
| [MedicalHistoryPanel.tsx](frontend/src/components/MedicalHistoryPanel.tsx) | solo tipos |
| [GuidedNutricion.tsx](frontend/src/components/GuidedNutricion.tsx) | solo tipos |
| [VideoRoom.tsx](frontend/src/components/VideoRoom.tsx) | orquestador, adaptar |

Consumidores a probar por separado: `DoctorPage`, `DoctorRoomPage`, `PatientPage`,
`NutricionRoomPage` y **`NutricionRoomMobile`** (usa `useVideoRoom` directo — es donde pegan los
problemas de móvil).

Al final se puede borrar `frontend/public/twilio-processors/` (**5,1 MB**, 9 archivos).

Dependencias: `+ amazon-chime-sdk-js` (frontend), `+ @aws-sdk/client-chime-sdk-meetings`,
`client-chime-sdk-media-pipelines`, `client-s3`, `s3-request-presigner` (backend).
`twilio` se queda (WhatsApp + Voz). `twilio-video` y `@twilio/video-processors` se pueden quitar
cuando se retire el proveedor viejo — no antes.

### 3.3 AWS — lo mínimo

No hay servidores. Solo:

1. **Un bucket S3** para las grabaciones, con **ACLs habilitadas**
   (`object_ownership = BucketOwnerPreferred`; el default hace fallar la captura) y una bucket
   policy que permita a `mediapipelines.chime.amazonaws.com` escribir.
2. **Un usuario IAM** con política acotada: `chime:*Meeting*`, `chime:*Attendee*`,
   `chime:*MediaCapturePipeline*`, `chime:CreateMediaConcatenationPipeline`, y `s3:*` **solo sobre
   ese bucket** (Chime valida que quien crea el pipeline pueda escribir en el destino).
3. Sus llaves como variables de entorno en DO: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`.

> **Esto es distinto a BSL.** Allá el contenedor vivía dentro de AWS y usaba un rol, sin llaves.
> Aquí hay dos secretos nuevos que hay que guardar y rotar. Que sean de un usuario dedicado y con
> permisos mínimos, no de un administrador.

El *service-linked role* de Chime Media Pipelines **ya existe** en la cuenta `448962739796` (se creó
para BSL). No hay que crearlo, pero sin él `CreateMediaCapturePipeline` falla con un mensaje
engañoso: *"Insufficient permission to access S3 bucket"*.

Variables nuevas en DO (5): `VIDEO_PROVIDER`, `CHIME_ALLOWLIST`, `RECORDINGS_BUCKET`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Más `CHIME_CONTROL_REGION` / `CHIME_MEDIA_REGION` si
no se quiere depender del default `us-east-1`.

El video **no pasa por nuestro servidor** — va del navegador a Chime directo. Que la app esté en
DigitalOcean Atlanta no agrega latencia a la llamada.

---

## 4. Tres decisiones abiertas

> **DECISIONES TOMADAS (2026-07-21):**
> **A) Se graban TODAS las consultas.** **B) El consumo de Calidad se hace en una fase posterior.**
> Esto parte la migración en dos y hace la primera mitad mucho más corta (ver §6).

### 4.1 La grabación cambia de modelo — se graba todo

Hoy: Twilio graba a todos, y la *composition* (el MP4) se crea **bajo demanda**, solo cuando
alguien abre esa consulta en Calidad (`ensureComposition`).

Con Chime **no existe el bajo demanda**: el pipeline de captura tiene que estar corriendo *durante*
la llamada. No se puede grabar hacia atrás.

→ **Decidido: grabar el 100%.** Entonces `startRecording` se dispara al llegar a 2 participantes en
**toda** consulta — sin lógica de filtro por sede/tipo/bandera. Código más simple.

Consecuencias de grabar todo desde ya, aunque Calidad se consuma después:

- Los MP4 se van acumulando en S3 con nadie leyéndolos por un tiempo. Es a propósito: cuando llegue
  la fase de Calidad ya hay un backlog disponible.
- Por eso **la grabación tiene que ser confiable desde el día uno**, aunque nadie la mire todavía.
  El arreglo de §5.1.b (que `endRoom` cierre bien la grabación tras un reinicio) **importa YA**, no
  después: se está grabando en producción desde la primera consulta con Chime.
- El barrido de capturas huérfanas (§5.1.b) también importa YA — es plata: un pipeline que no cierra
  **sigue facturando**.
- Verificar el costo de Chime grabación × volumen real de consultas (§4.4) **antes** de encender el
  100%, no después.

### 4.2 El consumo de Calidad se difiere — y se puede

Calidad tiene un **camino rápido** que reutiliza `HistoriaClinica.transcription_text`
([calidad.service.ts:157-171](backend/src/services/calidad.service.ts#L157)), y ese texto lo produce
la grabación **del navegador** (`transcribeConsulta`), que no depende del proveedor de video.

O sea: **la evaluación de calidad sigue funcionando durante toda la fase 1**, sin tocar nada. Lo
único que se posterga es el **reproductor de video** del evaluador para las consultas nuevas de
Chime — que es justo lo que se decidió dejar para después.

Las consultas viejas no se ven afectadas: las que ya tienen `composition_sid` se siguen resolviendo
contra Twilio. La regla queda "si hay `composition_sid` → Twilio; si no → S3".

**Implicación para la fase 1:** como nadie lee las grabaciones todavía, el endpoint
`GET /recordings/:roomName` **no se expone en fase 1** (o se expone ya protegido con login+rol, §5.1.a).
Nada de dejarlo abierto "porque todavía no lo usa nadie".

> **Dimensión correcta del lado que lee.** No es "desde cero" (Calidad ya lee compositions de
> Twilio), pero tampoco es "apuntar a S3": en BSL el consumo **nunca se construyó** (§5.1.c). Es
> **agregar una rama de origen S3/Chime** al módulo que ya existe — igual que el
> `resolverGrabacionParaEvaluar` que BSL hizo en *bsl-plataforma*. Alcance: el player, la
> autorización del link firmado, y el estado "procesando / listo / falló". Del orden de ~150 líneas,
> no una reescritura — pero sí trabajo nuevo, no una copia.

### 4.3 Transcripción del MP4: puede que ni haga falta

Mi nota anterior asumía "descargar el audio del MP4 con ffmpeg y pasarlo a Whisper". Dos matices:

1. **La transcripción clínica de BODYTECH ya no usa el video.** Sale del audio grabado **en el
   navegador** (`transcribeConsulta` → `transcription_text`), independiente del proveedor. Para los
   campos clínicos, el MP4 de S3 **no se toca**.
2. El único que quería el MP4 era el camino de respaldo de Calidad. Y Calidad tiene su camino rápido
   sobre `transcription_text` (§4.2). → **En el caso común no hay que transcribir el MP4 en
   absoluto.** Confirmarlo; si se cumple, este punto desaparece.

Si por alguna razón sí hay que transcribir el MP4 (consultas sin audio de navegador), hay dos
opciones: **Whisper** (lo que BODYTECH ya tiene; requiere bajar el archivo + ffmpeg) o **Amazon
Transcribe** (lee el MP4 directo de S3, sin descargar ni ffmpeg, y separa hablantes médico/paciente;
código nuevo, se llama con las mismas access keys desde DO). Para arrancar, Whisper. Transcribe es
mejora, no requisito.

### 4.4 Costo

Chime cobra por minuto/asistente y la grabación se cobra aparte. **Verificar los precios vigentes
antes de decidir §4.1** y compararlos contra la factura actual de Twilio Video — que, según ya
sabemos, no aparece en la API de usage-records y hay que sacarla de la consola de Twilio.

---

## 5. Los errores ya pagados (aplican todos)

Estos salieron en producción en BSL. No son teóricos.

---

> **DO empeora todo esto.** BSL corre en un contenedor estable; BODYTECH **auto-despliega en cada
> push a `main`** (`deploy_on_push: true`). Cada push = un reinicio = el `Map` se borra. Todos los
> bugs de estado-en-memoria de abajo pegan **mucho más seguido** aquí que en BSL. La persistencia no
> es "por si acaso": es el camino normal.

### 5.1 Defectos que el código de BSL **todavía tiene** — arreglarlos al copiar

No están en su playbook ni en ningún commit. Salieron de leer el código.

> **El defecto #1 real de BSL — la partición de salas — ya viene arreglado en la rama** (persistir
> `sala → meetingId` y recuperarlo al entrar, en `ensureMeeting`). No hay que reconstruirlo, pero
> **verificarlo explícitamente**, porque en DO (reinicios constantes) es el que más dolería. Lo que
> sigue en (b) es un arreglo **hermano que quedó a medias**: el mismo problema, pero del lado del
> cierre de la grabación, no del lado de entrar.

**a) La grabación estaba expuesta sin autenticación.**
`GET /api/video/recordings/:roomName` devuelve un link firmado al MP4 de una consulta — o sea,
historia clínica — y estaba **abierto**. Los nombres de sala viajan por WhatsApp y en la URL, así
que cualquiera que viera uno se bajaba el video. Hay un arreglo **sin commitear** que exige una
cabecera `X-Internal-Token` y **falla cerrado** (si no hay token configurado, rechaza).

En BODYTECH esto importa más que en BSL, porque acá sí va a haber un consumidor real (Calidad).
Además, acá el endpoint viviría en el mismo servidor que ya sirve al paciente: el token interno solo
sirve para servicio-a-servicio. Si el evaluador lo abre desde su navegador, hay que protegerlo con
el JWT y el rol que ya existen (`requireRole('coordinador','admin')`), no con un token compartido.

**b) La persistencia del mapa `sala → reunión` quedó a medio arreglar.**
El fix que persiste en Postgres (`chime_meetings`) se aplicó **solo a `ensureMeeting()`**, que es el
camino de entrar. Los otros cinco métodos siguen leyendo únicamente del `Map` en memoria:
`getRoom`, `listParticipants`, `disconnectParticipant`, `startRecording` y — el grave — **`endRoom`**.

Qué pasa si el contenedor se reinicia a mitad de una consulta (o sea, **en cada despliegue**):

- El `Map` queda vacío, pero **la llamada NO se cae**: el media va del navegador a Chime directo, no
  pasa por nuestro servidor. Los dos siguen hablando.
- Cuando cuelgan, `endRoom` no encuentra el meeting → **no detiene la captura ni concatena**. El MP4
  **nunca se produce**, la fila queda en `capturing` para siempre, y el Media Capture Pipeline
  **sigue corriendo y facturando**.
- `startRecording` tampoco encuentra nada. Y como `session-tracker` también es memoria, no vuelve a
  haber un evento de "ya somos dos" que lo redispare.

→ En BODYTECH: que estos métodos resuelvan el `meeting_id` desde `chime_meetings` igual que
`ensureMeeting`, y que el cierre de la grabación se haga **por `meeting_id`**, no por lo que quedó
en memoria. Vale la pena además un barrido periódico que cierre capturas huérfanas
(`status='capturing'` con más de N horas).

**c) Nadie consume la grabación.**
En BSL el MP4 llega a S3 y ahí se queda: no hay botón en la UI ni cliente en el repo. **El lazo
nunca se cerró.** Mi plan anterior daba por hecho que "solo había que apuntar Calidad a S3" — falso:
en BODYTECH hay que construir el consumo completo (§4.2), no adaptarlo.

**d) Errores de grabación silenciosos.**
Todo `startCapture` / `stopAndConcatenate` está envuelto en `try/catch` con `console.error`. Si la
grabación falla, la llamada sigue como si nada y **nadie se entera** hasta que alguien abre Calidad
semanas después. Hace falta al menos una alerta o un campo de error visible.

**e) El estado nunca llega a "listo".**
`chime_recordings.status` va `capturing → concatenating` y ahí se queda; nada verifica que la
concatenación terminó. Se compensa listando S3, pero no hay forma de distinguir *"todavía
procesando"* de *"falló"*.

**f) El comentario de cabecera del provider miente.**
Dice que el mapa vive *"en memoria"* y que *"la grabación server-side se difiere en este corte"*.
Las dos cosas son falsas hoy. Copiar el archivo copia la desinformación.

---

### Los cuatro que no se ven probando solo

1. **El mapa `sala → reunión` debe persistirse en Postgres.** Vivía en memoria; cada reinicio del
   contenedor (o sea, **cada despliegue**) lo borraba, y el siguiente en entrar creaba una reunión
   *nueva* para la misma sala. Médico y paciente en reuniones distintas, cada uno "solo", **sin un
   solo error en los logs**. Se llegó a 7 reuniones para una misma sala en un día.
   → tabla `chime_meetings`; si la BD falla, degradar a memoria (nunca romper el video por la BD).
2. **Desconectarse no es colgar.** Recargar la página marcaba la sala como finalizada y el paciente
   ya no podía entrar con el link que tenía por WhatsApp. Solo el botón de colgar finaliza; una
   desconexión usa `endRoom(room, { completed: false })`.
3. **No borrar la reunión si adentro queda alguien.** Al desconectarse el médico se borraba la
   reunión con el paciente dentro y lo expulsaba en el acto.
4. **Re-enlazar el video cuando cambia el stream.** Chime cambia el stream de un tile **sin cambiar
   el `tileId`** (pasa al activar el fondo virtual) → el otro extremo se queda en negro. Síntoma
   delator: **asimétrico e intermitente**. Comparar el stream además del `tileId` y re-enlazar el
   mismo elemento, sin recrear el ref (recrearlo revive un loop de attach/detach infinito).

**Se prueban con dos personas**, nunca con una.

### Los de Chime en sí

| Qué | Antídoto |
|---|---|
| Video negro: sin permiso previo, `enumerateDevices()` devuelve `deviceId` vacíos | pedir `getUserMedia` **antes** de listar dispositivos |
| El fondo virtual a 720p bloquea el hilo principal, Chime cree que cayó la red, se auto-reconecta y **tumba la llamada** (`AudioJoinedFromAnotherDevice`) | procesar el fondo a **640×360 @ 15 fps** |
| Si falla el procesador de fondo, el médico queda publicando **nada** | el `catch` devuelve la cámara sin efecto |
| La grabación se une como un participante fantasma | filtrar los `ExternalUserId` que empiezan con `aws:` |
| El remoto no reproduce en móvil | `<video muted>` (el audio va aparte) + `.play()` tras enlazar |
| MP4 duplicados: colgar dispara `endRoom` 3 veces (botón + cleanup + `beforeunload`) | claim atómico en SQL antes de concatenar |
| Arrancar la captura al crear la reunión satura la señalización y el video no renderiza | arrancarla **al llegar a 2 participantes** |

### Observabilidad, desde el día uno

Loguear cada rechazo de ingreso **con el rol**:
`[Video] Reingreso rechazado: sala X finalizada (Nombre, role=patient)`.
Ese único log convirtió un "algo está fallando" en un diagnóstico exacto en dos minutos.

### Revisar de paso

En BSL el manejador de errores de Express estaba declarado con 3 parámetros. Express los reconoce
por `fn.length === 4`; con 3 lo trata como middleware normal y **ningún error se reporta bien**.
Verificar el `errorHandler` de [index.ts:219](backend/src/index.ts#L219) antes de empezar — si tiene
el mismo defecto, toda la depuración de esta migración va a ser a ciegas.

---

## 6. Plan por fases

Con las decisiones tomadas (grabar todo, Calidad después), la migración se parte en **dos entregas
independientes**. La entrega 1 (fases 1-5) es lo que sube el video. La entrega 2 (fase 6) es Calidad,
y no bloquea nada de la 1.

### Entrega 1 — el video con Chime

**Fase 1 — Abstracción, con Twilio todavía activo.**
Se crean las dos carpetas nuevas —**copiando desde la rama `feat/migracion-aws-chime` de BSL, no
desde su `main`, y aplicando las correcciones de §5.1**— y se recablean los 11 archivos. Con
`VIDEO_PROVIDER` sin definir, **todo funciona idéntico a hoy**. Se puede desplegar a producción sin
riesgo, y conviene hacerlo solo: separa el refactor del cambio de proveedor, y si algo se rompe se
sabe cuál fue.

**Fase 2 — AWS mínimo + grabación confiable.**
Bucket S3 con sus 4 requisitos (§3.3), usuario IAM acotado, llaves en DO. Verificar que el
contenedor crea una reunión de prueba. **Aquí entran los arreglos §5.1.b y §5.1.d** (cierre de
grabación tras reinicio + barrido de capturas huérfanas), porque desde el momento en que se graba en
producción, un pipeline que no cierra factura solo. El endpoint `/recordings` **no se expone
todavía** (§4.2).

**Fase 3 — Chime para un médico.**
`CHIME_ALLOWLIST` con un código. Las **cuatro pruebas de dos personas**, en computador y celular,
en `/doctor/:room` y en `/nutricion/:room`:

- entran los dos → se ven y se oyen
- uno recarga → el otro no se cae, y el que recargó vuelve a **la misma** sala
- el paciente sale y vuelve con su link de WhatsApp → entra
- el médico activa el fondo virtual → el paciente lo sigue viendo

Además: verificar que el MP4 aparece en S3 y que la fila de `chime_recordings` llega a `ready`
(aunque nadie lo reproduzca aún).

**Fase 4 — Verificar costo con volumen real.**
Con un médico grabando, medir el costo real de Chime (minutos + grabación) y proyectarlo al 100% de
consultas **antes** de abrir la llave a todos. Si el número asusta, reconsiderar "grabar todo".

**Fase 5 — Ampliar.**
Una sede, luego todas, luego `VIDEO_PROVIDER=chime` global. Cuando lleve semanas estable, se quita
el proveedor de Twilio y los 5,1 MB de `twilio-processors/`. **Calidad sigue funcionando todo este
tiempo** por el camino del audio de navegador (§4.2).

### Entrega 2 — Calidad lee de S3 *(después, no bloquea la entrega 1)*

**Fase 6 — Consumo de la grabación.**
Exponer `/recordings/:roomName` **protegido con login+rol** (§5.1.a). Agregar la rama de origen
S3/Chime al módulo de Calidad que ya existe (patrón `resolverGrabacionParaEvaluar`): player en
`CalidadPage`, estado "procesando / listo / falló". Para entonces ya hay un backlog de grabaciones
en S3 esperando. Transcripción del MP4 solo si hace falta (§4.3) — probablemente no.

---

## 7. Rollback

| Nivel | Cómo | Tiempo |
|---|---|---|
| Un médico | sacarlo de `CHIME_ALLOWLIST` | un redeploy |
| Todos | `VIDEO_PROVIDER=twilio` | un redeploy |
| Total | revertir el commit | un redeploy |

No se pierde información en ningún caso: es la misma base de datos y el mismo servidor. Las
grabaciones nuevas quedan en S3 y las viejas en Twilio — por eso la regla de convivencia de §4.2.

---

## 8. La advertencia operativa

**Cada despliegue reinicia el contenedor y corta las videollamadas en curso.** `deploy_on_push` está
activo sobre `main`: cada merge sale a producción. El día del cutover de BSL se desplegó 5 veces en
horario de consulta y buena parte de las quejas de ese día las causaron los despliegues, no los bugs.

Trabajar en rama, agrupar los arreglos, y mergear fuera del horario de consulta.

Y antes de dar por bueno un arreglo, verificarlo **contra los logs**, no contra la intención.

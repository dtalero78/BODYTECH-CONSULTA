# AWS — Grabación de videollamadas (Chime → S3)

Infra **mínima** para la grabación de las consultas cuando el video corre en Amazon
Chime. BODYTECH sigue desplegado en DigitalOcean; esto es lo único que vive en AWS
(cuenta `448962739796`, compartida con BSL). **No hay ECS/ALB/VPC** — eso era de la
migración de hosting de BSL, que aquí no aplica.

## Qué se crea (`setup.sh`)

| Recurso | Nombre |
|---|---|
| Bucket S3 (grabaciones MP4) | `bodytech-consulta-recordings-448962739796` |
| Usuario IAM (llaves para DO) | `bodytech-consulta-chime` |
| Política inline (Chime + s3 solo sobre el bucket) | `bodytech-consulta-chime-policy` |

Reusa el **service-linked role** `AWSServiceRoleForAmazonChimeSDKMediaPipelines`
(ya existe en la cuenta, se creó para BSL — no se recrea).

Región: `us-east-1` (el plano de control de Chime está limitado a pocas regiones).

## Gotchas que ya pagamos (validados con smoke test)

- La bucket policy va con condición **solo `aws:SourceAccount`**. Agregarle
  `aws:SourceArn` la vuelve demasiado restrictiva → Chime falla con el mensaje
  engañoso *"Insufficient permission to access S3 bucket"*.
- **ACLs habilitadas** (`BucketOwnerPreferred`): Chime escribe con ACL
  `bucket-owner-full-control`; el default `BucketOwnerEnforced` hace fallar la captura.
- El **caller** (usuario IAM) necesita `s3:*` sobre el bucket: Chime valida que quien
  crea el pipeline pueda escribir en el sink.

## Las llaves (secreto) — NO están en el repo

`aws iam create-access-key` muestra la SECRET una sola vez. Guardarla de forma segura
y cargarla en DigitalOcean (fase 3, junto con las demás env vars, en un redeploy fuera
de horario):

```
RECORDINGS_BUCKET=bodytech-consulta-recordings-448962739796
CHIME_CONTROL_REGION=us-east-1
CHIME_MEDIA_REGION=us-east-1
RECORDINGS_ENABLED=true
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
```

**Rotación:** `aws iam create-access-key` (nueva) → actualizar en DO → `aws iam
delete-access-key` (vieja). Rotar tras cualquier exposición durante el setup.

## Reproducir / actualizar

```bash
AWS_REGION=us-east-1 ./setup.sh   # idempotente
```

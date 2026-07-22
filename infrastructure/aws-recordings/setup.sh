#!/usr/bin/env bash
#
# Provisiona SOLO lo necesario para la grabación de videollamadas de Chime → S3.
# BODYTECH sigue en DigitalOcean; esto es infra AWS aparte (no hay ECS/ALB/VPC).
#
# Idempotente en lo posible: reejecutar no rompe. NO crea el service-linked role
# de Chime (ya existe en la cuenta, se creó para BSL).
#
# Requiere: aws CLI configurado con un usuario con permiso de crear S3 + IAM.
set -euo pipefail

ACCOUNT="448962739796"
REGION="us-east-1"
BUCKET="bodytech-consulta-recordings-${ACCOUNT}"
IAM_USER="bodytech-consulta-chime"
POLICY_NAME="bodytech-consulta-chime-policy"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== 1. Bucket S3 (${BUCKET}) =="
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "   ya existe"
else
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION"
fi

echo "== 2. Object ownership = BucketOwnerPreferred (ACLs habilitadas) =="
# El default BucketOwnerEnforced deshabilita ACLs y hace fallar la captura de Chime.
aws s3api put-bucket-ownership-controls --bucket "$BUCKET" \
  --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerPreferred}]'

echo "== 3. Bucket policy (deja escribir a mediapipelines.chime.amazonaws.com) =="
aws s3api put-bucket-policy --bucket "$BUCKET" \
  --policy "file://${HERE}/bucket-policy.json"

echo "== 4. Usuario IAM (${IAM_USER}) =="
if aws iam get-user --user-name "$IAM_USER" >/dev/null 2>&1; then
  echo "   ya existe"
else
  aws iam create-user --user-name "$IAM_USER" \
    --tags Key=Project,Value=bodytech-consulta Key=Purpose,Value=chime-recordings
fi

echo "== 5. Política inline acotada (Chime + s3 solo sobre el bucket) =="
aws iam put-user-policy --user-name "$IAM_USER" \
  --policy-name "$POLICY_NAME" \
  --policy-document "file://${HERE}/iam-policy.json"

echo
echo "== 6. Access key =="
echo "   Ejecutar a mano (la SECRET se muestra UNA sola vez):"
echo "     aws iam create-access-key --user-name ${IAM_USER}"
echo "   Guardar AWS_ACCESS_KEY_ID y AWS_SECRET_ACCESS_KEY para cargarlos en DO."
echo
echo "Listo. Variables para DO (fase 3, redeploy → fuera de horario):"
echo "  RECORDINGS_BUCKET=${BUCKET}"
echo "  CHIME_CONTROL_REGION=${REGION}"
echo "  CHIME_MEDIA_REGION=${REGION}"
echo "  RECORDINGS_ENABLED=true"
echo "  AWS_ACCESS_KEY_ID=...   AWS_SECRET_ACCESS_KEY=..."

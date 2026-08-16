// ============================================================================
// mybodytech-auth.service — OAuth2 client_credentials para la integración
// mybodytech.
//
// Espeja el esquema de seguridad del "Validador RIPS" de Bodytech: mybodytech
// pide un access_token en POST /oauth/token enviando client_id + client_secret,
// y luego usa ese token como `Authorization: Bearer <token>` en el resto de
// endpoints.
//
// El access_token es un JWT firmado (HS256), stateless — no se guarda en BD, se
// valida por firma + expiración. Así funciona en cualquier número de instancias
// sin store compartido.
//
// Credenciales y firma vienen de env vars:
//   MYBODYTECH_CLIENT_ID       — el "usuario" de sistema que le damos a mybodytech
//   MYBODYTECH_CLIENT_SECRET   — la "clave" de sistema (secreta)
//   MYBODYTECH_TOKEN_SECRET    — (opcional) secreto para firmar los JWT; si no
//                                está, se usa MYBODYTECH_CLIENT_SECRET
// ============================================================================

import jwt from 'jsonwebtoken';
import { timingSafeEqual } from 'crypto';

// Vida del token: 10 horas, igual que el validador de ellos (expires_in 36000).
export const TOKEN_TTL_SECONDS = 36000;
const AUDIENCE = 'mybodytech';
const ISSUER = 'bodytech-consulta';

/** ¿Están configuradas las credenciales? Si no, los endpoints responden 503. */
export function isConfigured(): boolean {
  return Boolean(
    process.env.MYBODYTECH_CLIENT_ID && process.env.MYBODYTECH_CLIENT_SECRET
  );
}

/** Secreto con el que se firman/verifican los access_token. */
function signingSecret(): string {
  return (
    process.env.MYBODYTECH_TOKEN_SECRET ||
    process.env.MYBODYTECH_CLIENT_SECRET ||
    ''
  );
}

/** Comparación en tiempo constante (mitiga ataques por tiempo). */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Valida client_id + client_secret contra las env vars. */
export function verifyCredentials(clientId: string, clientSecret: string): boolean {
  const expectedId = process.env.MYBODYTECH_CLIENT_ID || '';
  const expectedSecret = process.env.MYBODYTECH_CLIENT_SECRET || '';
  return (
    constantTimeEquals(clientId, expectedId) &&
    constantTimeEquals(clientSecret, expectedSecret)
  );
}

/** Emite un access_token nuevo (JWT firmado). */
export function issueToken(): { accessToken: string; expiresIn: number } {
  const accessToken = jwt.sign({ scope: 'mybodytech' }, signingSecret(), {
    expiresIn: TOKEN_TTL_SECONDS,
    audience: AUDIENCE,
    issuer: ISSUER,
    subject: process.env.MYBODYTECH_CLIENT_ID,
  });
  return { accessToken, expiresIn: TOKEN_TTL_SECONDS };
}

/**
 * Verifica un access_token. Lanza si es inválido o expiró:
 *   - jwt.TokenExpiredError  → token vencido
 *   - jwt.JsonWebTokenError  → firma/estructura inválida
 */
export function verifyToken(token: string): void {
  jwt.verify(token, signingSecret(), { audience: AUDIENCE, issuer: ISSUER });
}

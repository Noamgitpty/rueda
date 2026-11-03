/**
 * Rappels signés des FAKE d'US-020 (décision KYC, accusés de messagerie, autorisation fiscale
 * asynchrone). En-tête `fake-signature: t=<secondes>,v1=<HMAC-SHA256(secret, "<t>.<corps>")>`,
 * comparé en temps constant ; fenêtre de fraîcheur fournie par l'appelant.
 *
 * Le secret est fourni par le test (aucun secret dans le code ni dans le dépôt). Format proche de
 * celui du FAKE PSP d'US-019 (`src/psp/signature.ts`), volontairement séparé pour ne pas toucher
 * ses fichiers : à fusionner quand les deux stories seront dans `main` (passation US-020).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const FAKE_SIGNATURE_HEADER = 'fake-signature';

export function signFakeWebhook(secret: string, body: string, atSeconds: number): string {
  assertSecret(secret);
  const mac = createHmac('sha256', secret).update(`${atSeconds}.${body}`).digest('hex');
  return `t=${atSeconds},v1=${mac}`;
}

export type SignatureCheck = 'VALID' | 'BAD_SIGNATURE' | 'STALE';

export function checkFakeWebhook(
  secret: string,
  body: string,
  header: string | undefined,
  nowSeconds: number,
  toleranceSeconds: number,
): SignatureCheck {
  assertSecret(secret);
  if (header === undefined) return 'BAD_SIGNATURE';
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header);
  if (match === null) return 'BAD_SIGNATURE';
  const at = Number(match[1]);
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${at}.${body}`).digest('hex'),
    'utf8',
  );
  const given = Buffer.from(match[2] ?? '', 'utf8');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'BAD_SIGNATURE';
  }
  return Math.abs(nowSeconds - at) > toleranceSeconds ? 'STALE' : 'VALID';
}

function assertSecret(secret: string): void {
  if (secret.length < 16)
    throw new RangeError('secret de webhook FAKE trop court (16 caractères au moins)');
}

/**
 * Schéma de signature des webhooks du PSP simulé (`WEBHOOK_SIGNATURE_SCHEME` = `FAKE_HMAC_SHA256`) :
 * en-tête `fake-signature: t=<secondes Unix>,v1=<hex HMAC-SHA256(secret, "<t>.<corps>")>`.
 * Comme un PSP réel, l'horodatage est signé avec le corps (17 §4.4 point 2).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const FAKE_SIGNATURE_HEADER = 'fake-signature';
export const FAKE_SIGNATURE_SCHEME = 'FAKE_HMAC_SHA256';

export function fakeSignature(
  secret: string | Uint8Array,
  timestampS: number,
  body: string,
): string {
  const mac = createHmac('sha256', secret).update(`${timestampS}.${body}`, 'utf8').digest('hex');
  return `t=${timestampS},v1=${mac}`;
}

export interface FakeSignatureCheck {
  readonly valid: boolean;
  /** Horodatage signé (secondes Unix), présent si l'en-tête est bien formé. */
  readonly timestampS: number | null;
}

/** Vérifie l'en-tête en temps constant. Un en-tête absent ou mal formé est invalide. */
export function verifyFakeSignature(
  secret: string | Uint8Array,
  header: string | undefined,
  body: Uint8Array,
): FakeSignatureCheck {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header ?? '');
  if (!match) return { valid: false, timestampS: null };
  const timestampS = Number(match[1]);
  const expected = createHmac('sha256', secret)
    .update(`${timestampS}.`, 'utf8')
    .update(body)
    .digest();
  const received = Buffer.from(match[2] ?? '', 'hex');
  const valid = received.length === expected.length && timingSafeEqual(received, expected);
  return { valid, timestampS };
}

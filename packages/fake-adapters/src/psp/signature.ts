/**
 * Schéma de signature des webhooks du PSP simulé (`WEBHOOK_SIGNATURE_SCHEME` = `FAKE_HMAC_SHA256`) :
 * en-tête `fake-signature: t=<secondes Unix>,v1=<hex HMAC-SHA256(secret, "<t>.<corps>")>`.
 * Comme un PSP réel, l'horodatage est signé avec le corps (17 §4.4 point 2).
 *
 * UN SEUL format de rappel signé pour tous les FAKE (choix de fusion US-019 / US-020) : le nom de
 * l'en-tête vient du socle commun (`../core/webhook.ts`, exporté une seule fois par l'index du
 * paquet). Deux aides restent distinctes par leur nom : `signFakeWebhook` / `checkFakeWebhook`
 * (corps en chaîne, fenêtre de fraîcheur côté FAKE, US-020) et `fakeSignature` /
 * `verifyFakeSignature` (corps BRUT en octets, la fraîcheur étant contrôlée à l'heure de la base
 * par la réception PAY, US-019).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
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

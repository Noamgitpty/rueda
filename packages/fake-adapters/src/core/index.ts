// Socle commun des FAKE d'US-020 (scénario, horloge virtuelle, idempotence, rappels signés).
export { FakeClock } from './clock.ts';
export type { CommonRefusal, Outcome, WebhookVerdict } from './outcome.ts';
export { FakeRuntime, fingerprint, Sequence } from './runtime.ts';
export type { ExecuteRequest, Performed } from './runtime.ts';
export { OK, Script } from './script.ts';
export type { Step } from './script.ts';
export { checkFakeWebhook, FAKE_SIGNATURE_HEADER, signFakeWebhook } from './webhook.ts';
export type { SignatureCheck } from './webhook.ts';

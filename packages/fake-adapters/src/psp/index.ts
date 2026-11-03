/**
 * `@rueda/fake-adapters/psp` — PSP simulé (US-019). Tests et développement seulement (C19).
 * Voir ../../README.md.
 */
export {
  FakePsp,
  FakePspError,
  type FakePspErrorKind,
  type FakeWebhookStatus,
} from './fake-psp.ts';
export {
  FAKE_SIGNATURE_HEADER,
  FAKE_SIGNATURE_SCHEME,
  fakeSignature,
  verifyFakeSignature,
  type FakeSignatureCheck,
} from './signature.ts';
export {
  FAKE_LEGS,
  FAKE_OPERATIONS,
  type FakeCapability,
  type FakeCapabilityStatus,
  type FakeCaptureMode,
  type FakeCreateOrderRequest,
  type FakeLeg,
  type FakeLegAmounts,
  type FakeLookup,
  type FakeMitRequest,
  type FakeMoneyRequest,
  type FakeMovement,
  type FakeOperation,
  type FakePspOptions,
  type FakePspScenario,
  type FakeReallocateRequest,
  type FakeReferenceRequest,
  type FakeResponse,
  type FakeTransaction,
  type FakeTxStatus,
  type FakeWebhookDelivery,
  type FakeWebhookScenario,
} from './types.ts';

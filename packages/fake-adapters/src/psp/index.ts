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
// FAKE_SIGNATURE_HEADER : exporté par le socle commun (`../core`), jamais deux fois (TS2308)
export {
  FAKE_SIGNATURE_SCHEME,
  fakeSignature,
  verifyFakeSignature,
  type FakeSignatureCheck,
} from './signature.ts';
export {
  FAKE_LEGS,
  FAKE_OPERATIONS,
  type FakeAdjustPayoutRequest,
  type FakeCapability,
  type FakeCapabilityStatus,
  type FakeCaptureMode,
  type FakeCreateOrderRequest,
  type FakeLeg,
  type FakeHoldLegRequest,
  type FakeLegAmounts,
  type FakeLegBalance,
  type FakeLookup,
  type FakeMitRequest,
  type FakeMoneyRequest,
  type FakeMovement,
  type FakeOperation,
  type FakePspOptions,
  type FakePayoutRequest,
  type FakePspScenario,
  type FakeReadOperation,
  type FakeReallocateRequest,
  type FakeRegisterSubmerchantRequest,
  type FakeReleaseLegRequest,
  type FakeReferenceRequest,
  type FakeResponse,
  type FakeSubmerchant,
  type FakeSubmerchantStatus,
  type FakeTransaction,
  type FakeTransferRequest,
  type FakeTxStatus,
  type FakeWebhookDelivery,
  type FakeWebhookScenario,
  type FakeWriteOperation,
} from './types.ts';

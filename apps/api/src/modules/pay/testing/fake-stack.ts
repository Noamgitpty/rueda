/**
 * Montage FAKE complet pour les tests (US-019) : PSP simulé, adaptateur du port, horloge simulée,
 * matrice de capacités. TESTS SEULEMENT (exclu de la production).
 *
 * Capacités par défaut : toutes celles qu'exercent US-019 et US-061 sont `VALIDATED_SANDBOX` (le
 * FAKE joue un PSP de place de marché « complet ») ; chaque test retire ou dégrade celle dont il éprouve l'absence. Durée de vie
 * d'un ordre Yappy : 300 s (09b §2.1, 17 §2.8 `ORDER_TTL_SECONDS`).
 */
import { FakePsp } from '@rueda/fake-adapters';
import type { FakeCapability, FakePspScenario } from '@rueda/fake-adapters';
import type { CollectionMode } from '../internal/capabilities.js';
import { FakePaymentProvider } from './fake-payment-provider.js';

export const FAKE_WEBHOOK_SECRET = 'whsec_fake_test_only';
export const FAKE_T0 = Date.parse('2031-07-01T08:00:00.000Z');

const v = (capability: string, value: boolean | number | string, method = '*'): FakeCapability => ({
  capability,
  method,
  value,
  status: 'VALIDATED_SANDBOX',
});

export const FULL_FAKE_CAPABILITIES: readonly FakeCapability[] = [
  v('SUPPORTS_PER_LEG_AMOUNTS', true),
  v('SUPPORTS_MULTI_LEG_SPLIT', true),
  v('SUPPORTS_PREAUTH', true),
  v('SUPPORTS_PARTIAL_CAPTURE', true),
  v('SUPPORTS_VOID', true),
  v('SUPPORTS_REFUND', true),
  v('SUPPORTS_PARTIAL_REFUND', true),
  v('SUPPORTS_MIT', true),
  v('SUPPORTS_REAUTH', true),
  v('SUPPORTS_PAYOUT_ADJUSTMENT', true),
  v('SUPPORTS_ORDER_CANCEL', true),
  v('SUPPORTS_SINGLE_USE_ORDER', true),
  v('SUPPORTS_LOOKUP_BY_MERCHANT_REF', true),
  v('ECHOES_MERCHANT_REF_IN_WEBHOOK', true),
  v('ORDER_EXPIRY_RETURNED', true),
  v('ROLLBACK_WINDOW_HOURS', 24),
  v('IDEMPOTENCY_KEY_MAX_LEN', 64),
  v('WEBHOOK_SIGNATURE_SCHEME', 'FAKE_HMAC_SHA256'),
  v('ORDER_TTL_SECONDS', 300, 'YAPPY'),
  // place de marché (US-061) : toutes les capacités bloquantes de 17 §2.8 ; jamais
  // SUPPORTS_PLATFORM_LEG_TRANSFER (défaut false, 17 §2.8), ajoutée par les tests qui l'éprouvent
  v('SUPPORTS_SUBMERCHANT', true),
  v('SUPPORTS_INDIVIDUAL_SUBMERCHANT', true),
  v('SUPPORTS_B2C_PAYOUT', true),
  v('SUPPORTS_DELAYED_PAYOUT_RELEASE', true),
  v('SUPPORTS_NEGATIVE_BALANCE_RECOVERY', true),
  v('SUPPORTS_LIST_TRANSACTIONS', true),
  v('CHARGEBACK_NOTIFICATION_CHANNEL', 'WEBHOOK'),
];

export interface FakeStack {
  readonly psp: FakePsp;
  readonly provider: FakePaymentProvider;
  readonly clock: { now: number };
  readonly capabilities: readonly FakeCapability[];
}

export interface FakeStackOptions {
  readonly scenario?: FakePspScenario;
  /** Variante d'exécution du compte (défaut : SPLIT_AT_SOURCE). */
  readonly collectionMode?: CollectionMode;
  /** Capacités retirées de la matrice complète. */
  readonly without?: readonly string[];
  /** Capacités remplacées (même nom), par exemple dégradées à `DOCUMENTED`. */
  readonly override?: readonly FakeCapability[];
}

export function fakeStack(options: FakeStackOptions = {}): FakeStack {
  const clock = { now: FAKE_T0 };
  const replaced = new Set((options.override ?? []).map((c) => c.capability));
  const capabilities = [
    ...FULL_FAKE_CAPABILITIES.filter(
      (c) => !(options.without ?? []).includes(c.capability) && !replaced.has(c.capability),
    ),
    ...(options.override ?? []),
  ];
  const psp = new FakePsp({
    secret: FAKE_WEBHOOK_SECRET,
    clock: () => clock.now,
    capabilities,
    ...(options.scenario !== undefined ? { scenario: options.scenario } : {}),
  });
  const provider = new FakePaymentProvider(psp, capabilities, undefined, {
    ...(options.collectionMode !== undefined ? { collectionMode: options.collectionMode } : {}),
  });
  return { psp, provider, clock, capabilities };
}

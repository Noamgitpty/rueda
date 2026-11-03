/**
 * Matrice de capacités PSP (17 §2.8 ; table `psp_capability`, migration 0028).
 *
 * Règle (fail-closed) : seule une valeur `VALIDATED_SANDBOX` ou `VALIDATED_CONTRACT` est utilisée ;
 * toute autre (absente, `DOCUMENTED`, `UNKNOWN`, type inattendu) vaut « non » : booléen `false`,
 * durée ou nombre `0`, énumération `UNKNOWN`. Une capacité **bloquante** absente ferme l'activation
 * de tout hôte du pays (`HOST_PAYOUT_RAIL_UNAVAILABLE`, US-061).
 */
import { PaymentError } from './errors.js';

type Kind = 'bool' | 'int' | 'enum';
/** `VARIANT_A` : bloquante en variante A (`SPLIT_AT_SOURCE`) seulement. */
type Blocking = boolean | 'VARIANT_A';

const def = (kind: Kind, blocking: Blocking) => ({ kind, blocking }) as const;

/** Capacités de 17 §2.8, avec leur type et leur caractère bloquant. */
export const CAPABILITIES = {
  SUPPORTS_SUBMERCHANT: def('bool', true),
  SUPPORTS_INDIVIDUAL_SUBMERCHANT: def('bool', true),
  SUPPORTS_MULTI_LEG_SPLIT: def('bool', 'VARIANT_A'),
  SUPPORTS_PER_LEG_AMOUNTS: def('bool', true),
  SUPPORTS_B2C_PAYOUT: def('bool', true),
  SUPPORTS_DELAYED_PAYOUT_RELEASE: def('bool', true),
  SUPPORTS_PAYOUT_ADJUSTMENT: def('bool', true),
  SUPPORTS_NEGATIVE_BALANCE_RECOVERY: def('bool', true),
  SUPPORTS_PLATFORM_LEG_TRANSFER: def('bool', false),
  SUPPORTS_YAPPY_IN_MARKETPLACE: def('bool', false),
  SUPPORTS_PREAUTH: def('bool', false),
  MAX_HOLD_HOURS: def('int', false),
  SUPPORTS_PARTIAL_CAPTURE: def('bool', true),
  SUPPORTS_VOID: def('bool', false),
  SUPPORTS_REFUND: def('bool', true),
  SUPPORTS_PARTIAL_REFUND: def('bool', true),
  ROLLBACK_WINDOW_HOURS: def('int', false),
  SUPPORTS_MIT: def('bool', true),
  SUPPORTS_REAUTH: def('bool', false),
  SUPPORTS_3DS: def('bool', false),
  CHARGEBACK_WINDOW_DAYS: def('int', false),
  IDEMPOTENCY_KEY_MAX_LEN: def('int', false),
  WEBHOOK_SIGNATURE_SCHEME: def('enum', true),
  SUPPORTS_LOOKUP_BY_MERCHANT_REF: def('bool', true),
  SUPPORTS_IDEMPOTENCY_HEADER: def('bool', false),
  ECHOES_MERCHANT_REF_IN_WEBHOOK: def('bool', false),
  ORDER_TTL_SECONDS: def('int', false),
  SUPPORTS_ORDER_CANCEL: def('bool', false),
  SUPPORTS_SINGLE_USE_ORDER: def('bool', false),
  ORDER_EXPIRY_RETURNED: def('bool', false),
  SUPPORTS_LIST_TRANSACTIONS: def('bool', false),
  CHARGEBACK_NOTIFICATION_CHANNEL: def('enum', true),
  REFUND_WINDOW_DAYS: def('int', false),
  MIN_AMOUNT_MINOR: def('int', false),
  MAX_AMOUNT_MINOR: def('int', false),
  WEBHOOK_RETRY_POLICY: def('enum', false),
  WEBHOOK_ORDERING_GUARANTEE: def('enum', false),
  SUPPORTS_RESTRICTED_API_KEYS: def('bool', false),
} as const;

export type CapabilityName = keyof typeof CAPABILITIES;
export const CAPABILITY_NAMES = Object.keys(CAPABILITIES) as CapabilityName[];

export const CAPABILITY_STATUSES = [
  'VALIDATED_SANDBOX',
  'VALIDATED_CONTRACT',
  'DOCUMENTED',
  'UNKNOWN',
] as const;
export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** Ligne de `psp_capability` déjà filtrée sur le fournisseur et le pays. */
export interface CapabilityRecord {
  readonly capability: string;
  /** `*` : tous les moyens. */
  readonly method: string;
  /** `*` : tous les réseaux. */
  readonly network?: string;
  readonly value: unknown;
  readonly status: CapabilityStatus;
}

export type CollectionMode = 'SPLIT_AT_SOURCE' | 'PLATFORM_MOR';

const isValidated = (s: CapabilityStatus): boolean =>
  s === 'VALIDATED_SANDBOX' || s === 'VALIDATED_CONTRACT';

/** Valeurs résolues d'un (fournisseur, pays) ; requêtes par moyen et réseau. */
export class CapabilitySet {
  readonly #records: readonly CapabilityRecord[];

  constructor(records: readonly CapabilityRecord[]) {
    this.#records = records.filter((r) => isValidated(r.status));
  }

  /** Valeur validée la plus précise : (moyen, réseau) puis (moyen, *) puis (*, *). */
  #raw(name: CapabilityName, method = '*', network = '*'): unknown {
    const rows = this.#records.filter((r) => r.capability === name);
    const pick = (m: string, n: string) =>
      rows.find((r) => r.method === m && (r.network ?? '*') === n);
    return (pick(method, network) ?? pick(method, '*') ?? pick('*', '*'))?.value;
  }

  bool(name: CapabilityName, method = '*', network = '*'): boolean {
    return CAPABILITIES[name].kind === 'bool' && this.#raw(name, method, network) === true;
  }

  int(name: CapabilityName, method = '*', network = '*'): number {
    const v = this.#raw(name, method, network);
    return CAPABILITIES[name].kind === 'int' &&
      typeof v === 'number' &&
      Number.isSafeInteger(v) &&
      v > 0
      ? v
      : 0;
  }

  enumValue(name: CapabilityName, method = '*', network = '*'): string {
    const v = this.#raw(name, method, network);
    return CAPABILITIES[name].kind === 'enum' &&
      typeof v === 'string' &&
      /^[A-Z][A-Z0-9_]*$/.test(v)
      ? v
      : 'UNKNOWN';
  }

  /** Capacité présente (booléen vrai, entier > 0, énumération connue). */
  has(name: CapabilityName, method = '*', network = '*'): boolean {
    switch (CAPABILITIES[name].kind) {
      case 'bool':
        return this.bool(name, method, network);
      case 'int':
        return this.int(name, method, network) > 0;
      case 'enum':
        return this.enumValue(name, method, network) !== 'UNKNOWN';
    }
  }

  /** Lève `UNSUPPORTED_CAPABILITY` (sans appel au PSP) si la capacité n'est pas validée. */
  requireCapability(name: CapabilityName, method = '*', network = '*'): void {
    if (!this.has(name, method, network)) {
      throw new PaymentError('UNSUPPORTED_CAPABILITY', `${name} non validée (${method})`, {
        capability: name,
      });
    }
  }

  /**
   * Capacités bloquantes absentes pour une variante (17 §2.8, « Règle d'activation ») : vide ⇒ les
   * capacités ne s'opposent pas à l'activation d'un hôte (les interrupteurs pays restent requis).
   */
  missingBlocking(mode: CollectionMode): CapabilityName[] {
    return CAPABILITY_NAMES.filter((name) => {
      const blocking = CAPABILITIES[name].blocking;
      const applies = blocking === true || (blocking === 'VARIANT_A' && mode !== 'PLATFORM_MOR');
      return applies && !this.has(name);
    });
  }

  /**
   * Règle d'activation de la place de marché (17 §2.8 ; 08 E7 ; US-061, critère 3) : une capacité
   * bloquante non validée ⇒ `HOST_PAYOUT_RAIL_UNAVAILABLE`, sans appel au PSP. Exigée à
   * l'enregistrement d'un hôte comme sous-marchand et avant tout paiement (une capacité inconnue
   * vaut « non »). Même catalogue que `core.payment_psp_capability_catalog` (migration 0039).
   */
  assertMarketplaceRails(mode: CollectionMode): void {
    const missing = this.missingBlocking(mode);
    const first = missing[0];
    if (first !== undefined) {
      throw new PaymentError(
        'HOST_PAYOUT_RAIL_UNAVAILABLE',
        `capacités bloquantes non validées : ${missing.join(', ')}`,
        { capability: first, missing: [...missing].sort() },
      );
    }
  }
}

/**
 * Envoi d'une commande monétaire au PSP (17 §4.3 points 2 à 4 ; 08 E4 ; T51, T52, T68).
 *
 * L'appelant (travailleur de commandes `money_command`) a déjà créé, sous le verrou du trip,
 * l'instance, puis l'opération `PENDING` avec ses jambes et sa clé (`core.payment_cmd_record_
 * operation`). Ce service ne lit que des clés déjà stockées et ne calcule aucun montant.
 *
 * - `PENDING` : appel avec `idem_sent`. Succès ⇒ statut du PSP ; refus REÇU ⇒ `FAILED` (une
 *   nouvelle tentative sera une nouvelle opération `attempt_no` + 1, sauf refus « ne pas
 *   réessayer ») ; délai dépassé, 5xx, réponse illisible ⇒ `UNKNOWN` ; PSP injoignable ⇒ rien
 *   n'est changé, rejeu plus tard avec la même clé.
 * - `UNKNOWN` ou `SUBMITTED` (rejeu de l'outbox) : **lecture d'abord** (`getOperation`, par notre clé
 *   si `SUPPORTS_LOOKUP_BY_MERCHANT_REF`, sinon par la référence PSP connue). Trouvée ⇒ son statut
 *   est appliqué (`POLL`), aucun renvoi (T51). Inconnue du PSP ⇒ renvoi de la MÊME clé. Ni clé
 *   recherchable ni référence ⇒ aucun renvoi, escalade ops (17 §2.8, corrigé VERIF_14-F11).
 * - `SUCCEEDED` / `FAILED` : rien.
 */
import { PaymentError } from './errors.js';
import { assertMovingLegs, assertReallocationLegs } from './legs.js';
import type { LegAmounts } from './legs.js';
import type {
  MitReason,
  OperationResult,
  OperationStatus,
  PaymentProvider,
  ProviderOperation,
} from './port.js';
import type { OperationStatusStore } from './stores.js';

export const COMMAND_KINDS = [
  'CAPTURE',
  'REFUND',
  'MIT_CHARGE',
  'DEBT_COLLECTION',
  'ROLLBACK',
  'LEG_REALLOCATION',
  'VOID',
] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];

export interface MoneyCommand {
  readonly operationId: string;
  readonly kind: CommandKind;
  /** Statut courant de l'opération (projection de `payment_operation`). */
  readonly status: OperationStatus;
  /** `idem_sent` stocké (08 E4). */
  readonly idemSent: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Jambes stockées (`payment_operation_leg`), jamais recalculées à l'envoi. `null` pour VOID. */
  readonly legs: LegAmounts | null;
  /** Référence PSP de l'opération visée (autorisation, encaissement). */
  readonly targetReference: string | null;
  /** Référence PSP de CETTE opération, si déjà connue. */
  readonly providerReference: string | null;
  readonly mit?: { readonly reason: MitReason; readonly instrumentToken: string };
}

export type SendOutcome =
  | { readonly outcome: 'ALREADY_FINAL' }
  | { readonly outcome: 'SUCCEEDED' | 'SUBMITTED'; readonly providerReference: string }
  | {
      readonly outcome: 'FAILED';
      readonly declineCode: string | null;
      readonly doNotRetry: boolean;
    }
  | { readonly outcome: 'UNKNOWN' }
  | { readonly outcome: 'NOT_SENT' }
  | { readonly outcome: 'ESCALATE'; readonly reason: 'NO_LOOKUP_POSSIBLE' };

export class MoneyCommandSender {
  readonly #provider: PaymentProvider;
  readonly #store: OperationStatusStore;

  constructor(provider: PaymentProvider, store: OperationStatusStore) {
    this.#provider = provider;
    this.#store = store;
  }

  async send(command: MoneyCommand): Promise<SendOutcome> {
    if (command.status === 'SUCCEEDED' || command.status === 'FAILED') {
      return { outcome: 'ALREADY_FINAL' };
    }
    if (command.status === 'UNKNOWN' || command.status === 'SUBMITTED') {
      const read = await this.#readFirst(command);
      if (read !== 'NOT_FOUND') return read;
    }
    return this.#call(command);
  }

  async #readFirst(command: MoneyCommand): Promise<SendOutcome | 'NOT_FOUND'> {
    const byKey = this.#provider.capabilities().bool('SUPPORTS_LOOKUP_BY_MERCHANT_REF');
    if (!byKey && command.providerReference === null) {
      return { outcome: 'ESCALATE', reason: 'NO_LOOKUP_POSSIBLE' };
    }
    let found: ProviderOperation | null;
    try {
      found = await this.#provider.getOperation(
        byKey
          ? { merchantReference: command.idemSent }
          : { providerReference: command.providerReference as string },
      );
    } catch (error) {
      if (
        error instanceof PaymentError &&
        (error.code === 'UNKNOWN_OUTCOME' || error.code === 'PROVIDER_UNAVAILABLE')
      ) {
        return { outcome: 'UNKNOWN' };
      }
      throw error;
    }
    if (found === null) return 'NOT_FOUND';
    return this.#applyResult(command, found, 'POLL');
  }

  async #call(command: MoneyCommand): Promise<SendOutcome> {
    let result: OperationResult;
    try {
      result = await this.#dispatch(command);
    } catch (error) {
      if (!(error instanceof PaymentError)) throw error;
      if (error.code === 'DECLINED') {
        await this.#store.apply({
          operationId: command.operationId,
          status: 'FAILED',
          source: 'API_RESPONSE',
          rawRef: null,
          providerReference: null,
        });
        return {
          outcome: 'FAILED',
          declineCode: error.details.declineCode ?? null,
          doNotRetry: error.details.doNotRetry === true,
        };
      }
      if (error.code === 'UNKNOWN_OUTCOME') {
        await this.#store.apply({
          operationId: command.operationId,
          status: 'UNKNOWN',
          source: 'API_RESPONSE',
          rawRef: null,
          providerReference: null,
        });
        return { outcome: 'UNKNOWN' };
      }
      if (error.code === 'PROVIDER_UNAVAILABLE') return { outcome: 'NOT_SENT' };
      // LEG_*, UNSUPPORTED_CAPABILITY, IDEMPOTENCY_CONFLICT, INVALID_REQUEST : commande refusée
      throw error;
    }
    return this.#applyResult(command, result, 'API_RESPONSE');
  }

  async #applyResult(
    command: MoneyCommand,
    result: { readonly providerReference: string; readonly status: OperationStatus },
    source: 'API_RESPONSE' | 'POLL',
  ): Promise<SendOutcome> {
    if (result.status === 'PENDING') {
      // le PSP a reçu l'ordre sans le traiter : en vol
      await this.#store.apply({
        operationId: command.operationId,
        status: 'SUBMITTED',
        source,
        rawRef: null,
        providerReference: result.providerReference,
      });
      return { outcome: 'SUBMITTED', providerReference: result.providerReference };
    }
    await this.#store.apply({
      operationId: command.operationId,
      status: result.status,
      source,
      rawRef: null,
      providerReference: result.providerReference,
    });
    switch (result.status) {
      case 'SUCCEEDED':
      case 'SUBMITTED':
        return { outcome: result.status, providerReference: result.providerReference };
      case 'FAILED':
        return { outcome: 'FAILED', declineCode: null, doNotRetry: false };
      case 'UNKNOWN':
        return { outcome: 'UNKNOWN' };
    }
  }

  #dispatch(command: MoneyCommand): Promise<OperationResult> {
    const key = command.idemSent;
    const target = (): string => {
      if (command.targetReference === null) {
        throw new PaymentError('INVALID_REQUEST', `${command.kind} : opération visée inconnue`);
      }
      return command.targetReference;
    };
    const legs = (): LegAmounts => {
      if (command.legs === null) throw new PaymentError('INVALID_REQUEST', 'jambes absentes');
      if (command.kind === 'LEG_REALLOCATION') assertReallocationLegs(command.legs);
      else assertMovingLegs(command.amountMinor, command.legs);
      return command.legs;
    };
    const money = () => ({
      idempotencyKey: key,
      amountMinor: command.amountMinor,
      currency: command.currency,
      legs: legs(),
    });
    switch (command.kind) {
      case 'CAPTURE':
        return this.#provider.capture({ ...money(), providerReference: target() });
      case 'REFUND':
        return this.#provider.refund({ ...money(), providerReference: target() });
      case 'ROLLBACK':
        return this.#provider.rollback({ ...money(), providerReference: target() });
      case 'MIT_CHARGE':
      case 'DEBT_COLLECTION': {
        if (command.mit === undefined)
          throw new PaymentError('INVALID_REQUEST', 'débit MIT sans motif');
        return this.#provider.chargeMIT({ ...money(), ...command.mit });
      }
      case 'LEG_REALLOCATION':
        return this.#provider.reallocate({
          idempotencyKey: key,
          providerReference: target(),
          currency: command.currency,
          legs: legs(),
        });
      case 'VOID':
        return this.#provider.void({ idempotencyKey: key, providerReference: target() });
    }
  }
}

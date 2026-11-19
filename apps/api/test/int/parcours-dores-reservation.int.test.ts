/**
 * US-221 — parcours dorés « réservation » de bout en bout, sur PostgreSQL réel, sous les rôles de
 * PRODUCTION (`connectAs` : assertion L0-05 en tête de chaque test), dans chaque pays configuré :
 * USD (deux décimales) et PYG (sans décimale). Écrits par l'agent QA depuis 16, 19 et les oracles,
 * sans prendre le code testé comme oracle : chaque montant attendu vient de l'export des oracles
 * (`docs/specs/tools/golden_vectors.json`, `@rueda/money/golden-vectors`) ou, pour le devis du
 * checkout, d'une dérivation écrite ici depuis 08 et la configuration du dépôt (voir `CHECKOUT`).
 *
 * Trois segments par pays, enchaînés dans l'ordre du fichier (état partagé par pays) :
 *
 * A. « Avant le paiement » (transaction ANNULÉE sous app_api : les interrupteurs
 *    `p2p_private_hosts_enabled` et `insurer_contract_active` ne s'ouvrent que là, par la VRAIE
 *    procédure à deux personnes d'US-125, tête d'audit puis verrou comme `golive.ts`) :
 *    inscription (vraie commande) et conducteur vérifié (fixture 9967) → recherche publique (vrai
 *    magasin de CAT) → fiche (prix et conditions) → devis figé (moteur de PRC, commande de gel) →
 *    checkout (hold posé) → capacité bloquante absente : paiement refusé AVANT T1 (critère 2) →
 *    paiement par le vrai `CheckoutPaymentService` : T1, ordre envoyé au PSP FAKE avec le montant
 *    EXPLICITE de chaque jambe, T2 ; Σ jambes = total.
 * B. « Du paiement au trip » (données VALIDÉES, horloge virtuelle 2052, aucun interrupteur) : même
 *    voyageur inscrit, hold posé par la vraie commande, devis engagé au checkout posé par la fixture
 *    9969 (seule couture : le gel et le checkout réels exigent les interrupteurs) aux jambes de la
 *    capture de l'oracle (TJ01 / TJ08a) → T1 / T2 par le vrai service → FAKE hostile : SUCCEEDED
 *    de réponse d'API (non signé) ⇒ NOT_PROVEN ; webhook signé ⇒ preuve ; conversion ⇒ trip BOOKED,
 *    version de prix n° 1, `booking.trip.booked` une fois ; rejeux ⇒ DUPLICATE / REPLAY →
 *    notifications (parties) → « Mis viajes » → interrupteurs toujours fermés → soldes par jambe
 *    portés dès la conversion (D1) et trip tenu par le rapprochement (D2) : défauts trouvés ici,
 *    corrigés par US-221b (#246, ADR-170 ; voir la passation).
 * C. « Annulation, remboursement, registres, reçus, rapprochement » (données VALIDÉES, 2052) : trip
 *    capturé aux jambes de l'oracle sur le trip (le devis figé de la fixture 9969 n'est pas rejouable
 *    par le processeur d'annulation) → demande de la console (OPS) → VRAI `TripCancellationProcessor` (trip du moteur
 *    = trip du vecteur : la fixture du trip ne porte aucun devis) → règlement v1 (TJ02b / TJ08b) →
 *    remboursement par jambe : PSP en panne ⇒ WAITING, puis VRAI `RefundScheduler` ⇒ SENT, preuve
 *    signée ⇒ CONFIRMED, REPORTED → soldes par jambe (TJ01 + TJ02b = TJ02a) → S10 du voyageur et de
 *    l'hôte → `insurer_ledger` (+prime, −prime) → reçus de l'hôte et du voyageur (T03 / T27) →
 *    faits de l'invariant par jambe → rapprochement nocturne (FIN) et oracle C12 : 0 écart.
 *
 * Vecteurs : TJ01, TJ02a, TJ02b, T03 (USD) ; TJ08a, TJ08b, T27 (PYG) ; TJ09c (jambe HOST du devis
 * du checkout en PYG) ; C6 / C13 / C14 / C20 sont prouvés par leurs L0 propres (l0-us223-*,
 * l0-us224-*), ce fichier enchaîne les modules.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { commandCallSql, setSessionContext } from '@rueda/db';
import { connectAs, releaseClient, withTestTransaction } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { money } from '@rueda/money';
import { legVector, loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import { toTrip } from '@rueda/money/testing';
import type pg from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CheckoutPaymentService,
  PgCheckoutPaymentStore,
  PgCheckoutStore,
  type HostedPaymentProvider,
} from '../../src/modules/avl/index.js';
import type {
  AlertChannel,
  OpsAlert,
  SqlClient,
  WorkerTransactions,
} from '../../src/modules/bus/index.js';
import { PgSearchStore } from '../../src/modules/cat/index.js';
import { CountryConfigService } from '../../src/modules/cfg/index.js';
import { reconciliationReportJson, runMoneyReconciliation } from '../../src/modules/fin/index.js';
import {
  PaymentError,
  PgRefundOrders,
  type CreateHostedPaymentRequest,
  type DepositEnforcement,
  type DepositGuestView,
  type HostedPayment,
  type OperationResult,
  type PaymentConnectorRegistry,
  type PaymentProvider,
  type RefundRequest,
} from '../../src/modules/pay/index.js';
import {
  freezeQuote,
  PgQuoteStore,
  QuoteService,
  searchQuotePricer,
} from '../../src/modules/prc/index.js';
import {
  RefundScheduler,
  TripCancellationProcessor,
  type CancellationFacts,
} from '../../src/modules/stl/index.js';
import { countryCases } from '../support/countries.js';

const golden = loadGoldenVectors();
const LEGS = ['HOST', 'INSURER', 'TAX_THIRD_PARTY', 'PLATFORM'] as const;
type LegName = (typeof LEGS)[number];
type Legs = Record<LegName, bigint>;
type Json = Record<string, unknown>;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const SIGNUP = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';
const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
] as const;
const iso = (ms: number): string => new Date(ms).toISOString();
const sum = (l: Legs): bigint => LEGS.reduce((s, k) => s + l[k], 0n);
const legsText = (l: Legs): Record<string, string> =>
  Object.fromEntries(LEGS.map((k) => [k, l[k].toString()]));
const negate = (l: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, -l[k]])) as unknown as Legs;
const plus = (a: Legs, b: Legs): Legs =>
  Object.fromEntries(LEGS.map((k) => [k, a[k] + b[k]])) as unknown as Legs;
const legsOf = (id: string): Legs => ({ ...legVector(golden, id).legsMinor }) as Legs;

/**
 * Parcours par devise (jamais par pays : le pays est celui que la configuration associe à la
 * devise du vecteur, ADR-024). Trip A de 08 (USD) : capture TJ01, annulation du voyageur T03
 * (variation TJ02b, jambes retenues TJ02a). Trip D (PYG) : capture TJ08a, T27, variation TJ08b.
 */
const JOURNEYS = [
  { settlement: 'T03', capture: 'TJ01', variation: 'TJ02b', kept: 'TJ02a' },
  { settlement: 'T27', capture: 'TJ08a', variation: 'TJ08b', kept: null },
] as const;

/**
 * Devis du checkout (segment A) par exposant de la devise, configuration du dépôt (grille de
 * protection et parts de TEST : BASICA 1/4 du prix journalier, part de l'assureur 7/10, plan
 * ESTÁNDAR 3/4 ; barème du trip fee du pays) — mêmes lignes que pg-checkout.int.test.ts :
 * - exposant 2 (trip A de 08 sans ses lignes hors devis : 40,00 × 3 j) : P 120,00 ; F 18,00
 *   (15 %) ; taxe 7 % de P et F = 8,40 + 1,26 ; BASICA 30,00 ; total 177,66. Jambes (08 E7
 *   règle 2) : HOST = 3/4 × 120,00 = 90,00 (exact) ; INSURER = 7/10 × 30,00 = 21,00 ; TAX 0 ;
 *   PLATFORM = complément 66,66 ;
 * - exposant 0 (D2 de 08 : 333 334 × 3 j) : P 1 000 002 ; F 150 000 ; taxe 10 % = 100 000 +
 *   15 000 ; BASICA roundHalfUp(83 333,5) = 83 334 × 3 = 250 002 ; total 1 515 004. HOST = jambe
 *   HOST de l'oracle TJ09c (D2, même loyer) = 750 001 ; INSURER = roundHalfUp(175 001,4) =
 *   175 001 ; TAX 0 ; PLATFORM = 590 002.
 */
interface CheckoutExpected {
  readonly daily: string;
  readonly lines: Readonly<Record<string, string>>;
  readonly taxes: Readonly<Record<string, string>>;
  readonly total: string;
  readonly legs: Legs;
}
const CHECKOUT: Readonly<Record<number, CheckoutExpected>> = {
  2: {
    daily: '4000',
    lines: { TRIP_PRICE: '12000', TRIP_FEE: '1800', PROTECTION: '3000' },
    taxes: { TRIP_PRICE: '840', TRIP_FEE: '126', PROTECTION: '0' },
    total: '17766',
    legs: { HOST: 9000n, INSURER: 2100n, TAX_THIRD_PARTY: 0n, PLATFORM: 6666n },
  },
  0: {
    daily: '333334',
    lines: { TRIP_PRICE: '1000002', TRIP_FEE: '150000', PROTECTION: '250002' },
    taxes: { TRIP_PRICE: '100000', TRIP_FEE: '15000', PROTECTION: '0' },
    total: '1515004',
    legs: {
      HOST: legVector(golden, 'TJ09c').legsMinor.HOST,
      INSURER: 175001n,
      TAX_THIRD_PARTY: 0n,
      PLATFORM: 590002n,
    },
  },
};

const CASES = JOURNEYS.map((j, i) => {
  const v = settlementVector(golden, j.settlement);
  const c = countryCases().find((x) => x.currency === v.currency);
  if (c === undefined) throw new Error(`aucun pays configuré en ${v.currency}`);
  return { country: c.country, currency: v.currency, index: i, journey: j };
});
type Case = (typeof CASES)[number];

// --- connexions et transactions ------------------------------------------------------------------

const opened: pg.Client[] = [];
afterEach(async () => {
  for (const c of opened.splice(0)) await releaseClient(c);
});
async function open(role: 'app_api' | 'app_worker'): Promise<pg.Client> {
  const client = await connectAs(role); // assertion L0-05
  opened.push(client);
  return client;
}

interface TxOptions {
  readonly at?: string;
  readonly worker?: string;
  readonly commit?: boolean;
}
async function inTx<T>(
  client: pg.ClientBase,
  o: TxOptions,
  fn: (tx: pg.ClientBase) => Promise<T>,
): Promise<T> {
  return withTestTransaction(
    client,
    {
      ...(o.at !== undefined ? { virtualNow: o.at } : {}),
      ...(o.commit !== undefined ? { commit: o.commit } : {}),
    },
    async (tx) => {
      if (o.worker !== undefined) await asWorker(tx, o.worker);
      return fn(tx);
    },
  );
}
async function asWorker(tx: pg.ClientBase, workerName: string): Promise<void> {
  await setSessionContext(tx, { kind: 'WORKER', workerName });
}
const sqlOf = (client: pg.ClientBase): SqlClient => ({
  query: async <R>(text: string, params?: readonly unknown[]) => {
    const r = await client.query(text, params as unknown[] | undefined);
    return { rows: r.rows as R[], rowCount: r.rowCount };
  },
});
/** Transactions du travailleur (app_worker), VALIDÉES, à l'instant virtuel `atMs`. */
function committing(atMs: number): WorkerTransactions {
  return {
    async run(worker, fn) {
      const client = await open('app_worker');
      return inTx(client, { at: iso(atMs), worker, commit: true }, (tx) => fn(sqlOf(tx)));
    },
  };
}
class Alerts implements AlertChannel {
  readonly sent: OpsAlert[] = [];
  send(alert: OpsAlert): Promise<void> {
    this.sent.push(alert);
    return Promise.resolve();
  }
}

// --- personnes, sessions, interrupteurs ----------------------------------------------------------

const sha = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

/** Personne inscrite par la VRAIE commande (consentements de l'inscription), compte ACTIVE. */
async function register(
  tx: pg.ClientBase,
  country: string,
  id: string = randomUUID(),
  first = 'Ana',
  last = 'Pérez',
): Promise<string> {
  const r = await tx.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $4, $5, 'es', $6, $7, 86400, NULL,
                                                $8, $9::jsonb, false) AS ok`,
    [
      id,
      `us221-${id}@example.test`,
      PHC,
      first,
      last,
      randomUUID(),
      randomBytes(32),
      country,
      SIGNUP,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await tx.query('SELECT test_fixture.iam_set_account_status($1, $2)', [id, 'ACTIVE']);
  return id;
}

/** Session ouverte par la VRAIE commande. */
async function openSession(tx: pg.ClientBase, userId: string): Promise<Buffer> {
  const hash = sha();
  const s = await tx.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, 86400, 'NONE', NULL, 'vitest') AS expires_at`,
    [randomUUID(), userId, hash],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  return hash;
}

/** Membre du personnel inscrit, rôle interne du pays (fixture 9200). */
async function staffMember(tx: pg.ClientBase, role: string, country: string): Promise<string> {
  const id = await register(tx, country, randomUUID(), 'Staff', 'Test');
  await tx.query(`SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`, [
    randomUUID(),
    id,
    role,
    [country],
  ]);
  return id;
}

/** Session élevée (fixture 9650), ouverte À l'instant de la transaction de l'appelant. */
async function elevated(tx: pg.ClientBase, id: string): Promise<{ id: string; hash: Buffer }> {
  const hash = sha();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [id, hash]);
  return { id, hash };
}

async function staffOf(
  tx: pg.ClientBase,
  role: string,
  country: string,
): Promise<{ id: string; hash: Buffer }> {
  return elevated(tx, await staffMember(tx, role, country));
}

/**
 * Interrupteur ouvert par la procédure à deux personnes d'US-125, dans la transaction ANNULÉE de
 * l'appelant : tête de chaîne d'audit AVANT le verrou consultatif (même ordre que
 * packages/db/test/support/golive.ts, PR #200 ; jamais l'ordre inverse : 40P01).
 */
async function openSwitch(tx: pg.ClientBase, key: string, country: string): Promise<void> {
  const as = async (who: { id: string; hash: Buffer }) =>
    setSessionContext(tx, {
      kind: 'STAFF',
      actorId: who.id,
      countryScope: [country],
      sessionTokenHash: who.hash.toString('hex'),
    });
  const requester = await staffOf(tx, 'ADMIN', country);
  const approver = await staffOf(tx, 'SUPERADMIN', country);
  await tx.query('SELECT test_fixture.audit_chain_head_lock()');
  await as(requester);
  const r = await tx.query<{ outcome: string; request_id: string | null }>(
    'SELECT outcome, request_id FROM core.config_cmd_request_go_live_switch($1, $2, $3, $4, $5, $6)',
    [requester.hash, randomUUID(), key, country, true, 'DEC-FONDATEUR-15'],
  );
  if (r.rows[0]?.outcome !== 'REQUESTED') throw new Error(`demande : ${r.rows[0]?.outcome}`);
  await as(approver);
  const a = await tx.query<{ outcome: string }>(
    'SELECT outcome FROM core.config_cmd_approve_go_live_switch($1, $2)',
    [approver.hash, r.rows[0].request_id],
  );
  if (a.rows[0]?.outcome !== 'APPLIED') throw new Error(`approbation : ${a.rows[0]?.outcome}`);
}

/** Valeur lue de chaque interrupteur de mise en service du pays (fail-closed : false). */
async function switches(tx: pg.ClientBase, country: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  for (const key of SWITCHES) {
    const { rows } = await tx.query<{ on: boolean }>('SELECT core.config_go_live($1, $2) AS "on"', [
      key,
      country,
    ]);
    out[key] = rows[0]?.on === true;
  }
  return out;
}
const ALL_CLOSED = Object.fromEntries(SWITCHES.map((k) => [k, false]));

/** Capacités bloquantes du catalogue (FAKE, pays) au statut voulu, à partir de `from`. */
async function capabilities(
  tx: pg.ClientBase,
  country: string,
  from: string,
  only?: string,
  status: 'VALIDATED_SANDBOX' | 'UNKNOWN' = 'VALIDATED_SANDBOX',
  providers: readonly string[] = ['FAKE'],
): Promise<void> {
  const { rows } = await tx.query<{ capability: string; kind: string }>(
    `SELECT capability, kind FROM core.payment_psp_capability_catalog WHERE blocking <> 'NO'`,
  );
  for (const r of rows) {
    if (only !== undefined && r.capability !== only) continue;
    const value = r.kind === 'bool' ? true : r.kind === 'int' ? 1 : 'FAKE_HMAC_SHA256';
    for (const provider of providers) {
      await tx.query(
        `SELECT test_fixture.us024_set_capability($1, $2, '*', $3, $4::jsonb, $5,
                                                  $6::timestamptz)`,
        [provider, country, r.capability, JSON.stringify(value), status, from],
      );
    }
  }
}

/** PSP FAKE de la page hébergée : garde chaque ordre reçu (montant et jambes explicites). */
class FakeHostedPsp implements HostedPaymentProvider {
  readonly orders: CreateHostedPaymentRequest[] = [];
  createHostedPayment(request: CreateHostedPaymentRequest): Promise<HostedPayment> {
    this.orders.push(request);
    return Promise.resolve({
      providerReference: `fake-${randomUUID()}`,
      redirectUrl: 'https://psp.example.test/pay',
      expiresAt: null,
    });
  }
  getOperation(): Promise<null> {
    return Promise.resolve(null);
  }
}
const paymentService = (
  db: pg.ClientBase,
  psp: FakeHostedPsp,
  providers: readonly string[] = ['FAKE'],
): CheckoutPaymentService =>
  new CheckoutPaymentService(
    new PgCheckoutPaymentStore(db),
    new Map(providers.map((p) => [p, psp])),
    new NoDepositGate(),
    () => undefined,
  );

/**
 * Porte de la caution (US-701) : décision « aucune caution », comme `FakeDepositGate` des contrats
 * d'AVL (avl/testing, non public). Couture assumée : la vraie porte lit la classe de valeur du
 * véhicule et le devis figé du hold, que les fixtures 9998 (sans classe de valeur) et 9969 (devis à
 * documents vides) ne portent pas ; la caution est prouvée par `l0-us701-deposit-hold` et
 * `checkout-deposit.contract.test.ts`. Les montants du paiement restent ceux des oracles.
 */
class NoDepositGate {
  readonly enforced: string[] = [];
  view(): Promise<DepositGuestView | null> {
    return Promise.resolve(null);
  }
  enforce(_proof: Buffer, holdId: string): Promise<DepositEnforcement> {
    this.enforced.push(holdId);
    return Promise.resolve({ kind: 'ACCEPTED', view: { status: 'NONE' } });
  }
}

/** « Pagar » par le vrai service ; un refus est rendu avec son code (diagnostic de la CI). */
async function payOrExplain(
  service: CheckoutPaymentService,
  hash: Buffer,
  holdId: string,
  explain: () => Promise<string> = () => Promise.resolve(''),
) {
  try {
    return await service.pay(hash, holdId, { method: 'CARD' });
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new Error(`paiement refusé : ${String(code)} ${await explain()}`, { cause: error });
  }
}

/**
 * Diagnostic d'un refus de T1 (aucun identifiant ni montant) : comptes ACTIVE du pays (fournisseur,
 * environnement, mode d'encaissement, lus sous app_worker) et capacités bloquantes manquantes de
 * chacun, lues dans la transaction de l'appelant (`payment_missing_blocking_capabilities`).
 */
async function accountsDiagnostic(tx: pg.ClientBase, country: string): Promise<string> {
  const worker = await open('app_worker');
  const { rows } = await worker.query<{ provider: string; environment: string; mode: string }>(
    `SELECT provider, environment, collection_mode AS mode FROM core.payment_psp_account
      WHERE country_code = $1 AND status = 'ACTIVE'
      ORDER BY (environment = 'LIVE') DESC, provider, id`,
    [country],
  );
  const out: string[] = [];
  for (const r of rows) {
    const m = await tx.query<{ missing: string[] }>(
      'SELECT core.payment_missing_blocking_capabilities($1, $2, $3) AS missing',
      [r.provider, country, r.mode],
    );
    out.push(`${r.provider}/${r.environment}/${r.mode} manque=[${m.rows[0]?.missing.join(',')}]`);
  }
  return `comptes : ${out.join(' ; ')}`;
}

/**
 * T1 (`booking_cmd_checkout_pay`) retient le premier compte marchand ACTIVE du pays (fournisseur,
 * puis identifiant). Les scènes de `concurrence-webhook.int.test.ts` VALIDENT, le temps d'un test,
 * un compte ACTIVE d'un autre fournisseur du même pays (BAC, EBANX : avant FAKE dans l'ordre) puis
 * le suspendent : attendre (au plus 30 s) que seul le compte FAKE du pays soit actif, sinon T1
 * viserait ce compte de passage (course entre fichiers de test, pas un défaut du produit ;
 * passation US-221, constat C-1). Lecture seule, sous app_worker.
 */
async function soleFakeAccount(country: string): Promise<void> {
  const worker = await open('app_worker');
  for (let i = 0; i < 120; i++) {
    const { rows } = await worker.query<{ provider: string }>(
      `SELECT provider FROM core.payment_psp_account WHERE country_code = $1 AND status = 'ACTIVE'`,
      [country],
    );
    if (rows.length > 0 && rows.every((r) => r.provider === 'FAKE')) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('un compte marchand actif d’un autre fournisseur reste ouvert dans le pays');
}

/** Fournisseur du compte que T1 retiendrait À CET INSTANT (ordre de `booking_cmd_checkout_pay`). */
async function firstProvider(worker: pg.ClientBase, country: string): Promise<string | null> {
  const { rows } = await worker.query<{ provider: string }>(
    `SELECT provider FROM core.payment_psp_account WHERE country_code = $1 AND status = 'ACTIVE'
      ORDER BY (environment = 'LIVE') DESC, provider, id LIMIT 1`,
    [country],
  );
  return rows[0]?.provider ?? null;
}

/**
 * Essai de T1 sur le compte FAKE du pays (constat C-1) : les scènes de
 * `concurrence-webhook.int.test.ts` ouvrent, le temps d'un test, un compte ACTIVE BAC ou EBANX du
 * même pays, retenu AVANT FAKE par `booking_cmd_checkout_pay`. Un essai n'est retenu (réussite OU
 * refus) que si FAKE est en tête juste avant ET juste après lui ; sinon il est annulé par son point
 * de sauvegarde et rejoué dès que FAKE est de nouveau en tête (au plus 60 s). Transaction ANNULÉE
 * du segment A seulement ; le résultat retenu est affirmé tel quel par l'appelant.
 */
async function onFakeAccount<T>(
  tx: pg.ClientBase,
  country: string,
  attempt: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  // UNE connexion app_worker pour toute l'attente (libérée par afterEach), jamais une par lecture
  const worker = await open('app_worker');
  for (let i = 0; i < 240; i++) {
    if ((await firstProvider(worker, country)) === 'FAKE') {
      await tx.query('SAVEPOINT us221_fake');
      let out: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        out = { ok: true, value: await attempt() };
      } catch (error) {
        out = { ok: false, error };
      }
      if ((await firstProvider(worker, country)) === 'FAKE') {
        await tx.query(
          out.ok ? 'RELEASE SAVEPOINT us221_fake' : 'ROLLBACK TO SAVEPOINT us221_fake',
        );
        return out;
      }
      await tx.query('ROLLBACK TO SAVEPOINT us221_fake');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `le compte FAKE n'est jamais resté en tête : ${await accountsDiagnostic(tx, country)}`,
  );
}

// --- état partagé des segments (par pays) --------------------------------------------------------

interface BookedWorld {
  guest: string;
  guestHash: Buffer;
  org: string;
  vehicle: string;
  hold: string;
  quote: string;
  operation: string;
  trip: string;
}
interface CancelledWorld {
  trip: string;
  guest: string;
  capture: string;
  cancellation: string;
}

describe.each(CASES)('US-221 — parcours dorés « réservation » ($country, $currency)', (c: Case) => {
  const capture = legsOf(c.journey.capture);
  const variation = legsOf(c.journey.variation);
  const vector = settlementVector(golden, c.journey.settlement);
  const total = vector.trip.totalPaidMinor;
  const kept = plus(capture, variation);
  const refund = negate(variation);

  it('oracle : Σ jambes de la capture = total payé ; Σ remboursement = remboursement du voyageur ; retenu = retenu TTC ; HOST retenue = hostFromGuest', async () => {
    await open('app_api'); // L0-05 : même un test sans requête commence par l'assertion de rôle
    expect(legVector(golden, c.journey.capture).currency).toBe(c.currency);
    expect(sum(capture)).toBe(total);
    expect(sum(refund)).toBe(vector.expected.guestRefundMinor);
    expect(sum(kept)).toBe(vector.expected.retainedMinor + vector.expected.retainedTaxMinor);
    expect(kept.HOST).toBe(vector.expected.hostFromGuestMinor);
    if (c.journey.kept !== null) expect(kept).toEqual(legsOf(c.journey.kept));
    for (const k of LEGS) expect(kept[k] >= 0n, k).toBe(true);
  });

  // ---------------------------------------------------------------------------------------------
  describe('A — inscription, recherche, fiche, devis figé, checkout, paiement par jambes', () => {
    const NOW = '2026-12-02T12:00:00.000Z';
    const START_LOCAL = '2026-12-10T10:00';
    const END_LOCAL = '2026-12-13T10:00';

    it(
      'chaîne réelle jusqu’à T2 : carte = fiche = devis ; hold posé ; capacité bloquante inconnue ⇒ HOST_PAYOUT_RAIL_UNAVAILABLE avant T1 ; ordre envoyé au PSP avec chaque jambe explicite ; Σ jambes = total ; interrupteurs refermés hors de la transaction',
      { timeout: 180_000 },
      async () => {
        const api = await open('app_api');
        const service = new QuoteService(new CountryConfigService());
        const exponent = service.params({ country: c.country, at: new Date(NOW) }).currency
          .exponent;
        const want = CHECKOUT[exponent];
        if (want === undefined) throw new Error(`aucun attendu pour l'exposant ${exponent}`);
        expect(sum(want.legs).toString()).toBe(want.total);

        // compte FAKE ACTIVE du pays VALIDÉ hors de la transaction annulée (comme le segment B) :
        // la lecture des comptes de `onFakeAccount` (autre connexion) doit le voir
        await inTx(api, { commit: true }, async (tx) => {
          await tx.query('SELECT test_fixture.us024_psp_account($1)', [c.country]);
        });
        await inTx(api, { at: NOW }, async (tx) => {
          await openSwitch(tx, 'p2p_private_hosts_enabled', c.country);
          await openSwitch(tx, 'insurer_contract_active', c.country);
          const acc = await tx.query<{ id: string }>(
            'SELECT test_fixture.us024_psp_account($1) AS id',
            [c.country],
          );
          expect(acc.rows[0]?.id).toBeTruthy();

          // annonce LISTED (fixture 9998) dans une ville propre au parcours (fixture 9937)
          const { rows } = await tx.query<{ listing_id: string }>(
            'SELECT * FROM test_fixture.us208_listed_listing($1, $2, $3, $4)',
            [c.country, want.daily, 'AUTOMATIC', true],
          );
          const listingId = rows[0]!.listing_id;
          const serial = await tx.query<{ n: string }>(
            'SELECT test_fixture.next_unique_serial()::text AS n',
          );
          const city = `Villa US221 ${serial.rows[0]!.n}`;
          await tx.query('SELECT test_fixture.us221_listing_city($1, $2)', [listingId, city]);

          // inscription et conducteur vérifié (KYC de fixture 9967), session du voyageur
          const guest = await register(tx, c.country);
          await tx.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
            guest,
            c.country,
            '1990-01-01',
            '2030-12-31',
            c.country,
          ]);
          const hash = await openSession(tx, guest);

          // S01 → résultats : l'annonce est trouvée dans sa ville, aux dates locales du pays
          const search = new PgSearchStore(tx);
          const found = await search.search({
            country: c.country,
            city,
            area: null,
            startLocal: START_LOCAL,
            endLocal: END_LOCAL,
            limit: 50,
          });
          if (found.outcome !== 'OK') throw new Error(`recherche : ${found.outcome}`);
          const card = found.results.find((r) => r.id === listingId);
          if (card === undefined) throw new Error('annonce absente des résultats');
          expect(card).toMatchObject({ dailyPriceMinor: want.daily, currency: c.currency });
          expect(Date.parse(card.endAt) - Date.parse(card.startAt)).toBe(3 * DAY);

          // S03 : fiche (prix de l'annonce, conditions) ; carte et fiche au même total (16 SRC-042)
          const pricer = searchQuotePricer((ctx) => service.params(ctx));
          const slot = await search.listingPrice(listingId);
          if (slot === null) throw new Error('prix de la fiche introuvable');
          expect(await search.terms(listingId, card.startAt)).not.toBeNull();
          const priced = (dailyPriceMinor: string, quotedAt: string) =>
            pricer.price({
              listingId,
              country: c.country,
              currency: card.currency,
              dailyPriceMinor,
              startAt: card.startAt,
              endAt: card.endAt,
              quotedAt,
            });
          expect(priced(slot.dailyPriceMinor, slot.quotedAt)).toEqual({
            totalMinor: want.total,
            billableDays: 3,
          });
          expect(priced(card.dailyPriceMinor, card.quotedAt)).toEqual({
            totalMinor: want.total,
            billableDays: 3,
          });

          // S05 : devis figé (composition de CheckoutService.createQuote, prouvée par
          // pg-checkout.int.test.ts) — moteur de PRC, commande de gel rejouée par la base
          const checkout = new PgCheckoutStore(tx);
          const listing = await checkout.listing(listingId);
          if (listing === null) throw new Error('annonce du checkout introuvable');
          const params = service.params({
            country: listing.country,
            at: new Date(listing.quotedAtMs),
            hostPlan: listing.hostPlan,
          });
          const level = params.protectionGrid?.minLevel;
          expect(level).toBe('BASICA');
          const { frozen } = freezeQuote(
            {
              startAtMs: Date.parse(card.startAt),
              endAtMs: Date.parse(card.endAt),
              quotedAtMs: listing.quotedAtMs,
              rateType: 'REFUNDABLE',
              dailyRate: money(BigInt(listing.dailyPriceMinor), params.currency),
              ...(level === undefined ? {} : { protectionLevel: level }),
              mileage: { mode: 'UNLIMITED' },
            },
            params,
          );
          const gel = await new PgQuoteStore(tx).freeze(hash, listingId, frozen);
          expect(gel.outcome).toBe('DONE');
          const quoteId = gel.quoteId!;
          const quote = await checkout.quote(hash, quoteId);
          if (quote === null) throw new Error('devis figé illisible');
          expect(quote).toMatchObject({
            currency: c.currency,
            billableDays: 3,
            totalMinor: want.total,
            protectionLevel: 'BASICA',
            insurerContractActive: true,
          });
          expect(Object.fromEntries(quote.lines.map((l) => [l.type, l.amountMinor]))).toEqual(
            want.lines,
          );
          expect(Object.fromEntries(quote.lines.map((l) => [l.type, l.taxMinor]))).toEqual(
            want.taxes,
          );
          // jambes du devis figé (08 E7 règle 2) : celles que l'ordre au PSP devra porter
          const outputs = JSON.parse(frozen.outputs) as { legs: Record<string, string> };
          expect(outputs.legs).toEqual(legsText(want.legs));

          // S05 → hold posé (conducteur titulaire, versions affichées acceptées)
          const placed = await checkout.checkout(hash, quoteId, {
            driverFirstName: 'Ana',
            driverLastName: 'Pérez',
            manualTransmissionConfirmed: false,
            acceptedDocuments: quote.documents.map((d) => ({ kind: d.kind, version: d.version })),
          });
          expect(placed.outcome).toBe('DONE');
          const holdId = placed.holdId!;
          expect(await checkout.hold(hash, holdId)).toMatchObject({
            status: 'ACTIVE',
            quoteId,
            totalMinor: want.total,
            reviewState: 'NONE',
          });

          // critère 2 (FAKE hostile) : capacité bloquante inconnue ⇒ refus AVANT T1, aucun ordre
          const at = (m: number) => iso(Date.parse(NOW) + m * MINUTE);
          const psp = new FakeHostedPsp();
          const pay = paymentService(tx, psp);
          await capabilities(tx, c.country, at(-3));
          // capacité inconnue posée dans un point de sauvegarde, retirée avec lui après le refus
          await tx.query('SAVEPOINT us221_capability');
          await capabilities(tx, c.country, at(-2), 'SUPPORTS_PER_LEG_AMOUNTS', 'UNKNOWN');
          const refused = await onFakeAccount(tx, c.country, () =>
            pay.pay(hash, holdId, { method: 'CARD' }),
          );
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect(refused.error).toMatchObject({ code: 'HOST_PAYOUT_RAIL_UNAVAILABLE' });
          }
          await tx.query('ROLLBACK TO SAVEPOINT us221_capability');
          expect(psp.orders).toEqual([]);
          expect(await pay.payment(hash, holdId)).toMatchObject({
            state: 'PAYABLE',
            holdStatus: 'ACTIVE',
            tripId: null,
          });

          // capacités validées : T1 (jambes du devis engagé), ordre au PSP, T2
          const paid = await onFakeAccount(tx, c.country, () =>
            pay.pay(hash, holdId, { method: 'CARD' }),
          );
          if (!paid.ok) {
            const code = String((paid.error as { code?: unknown }).code);
            throw new Error(
              `paiement refusé : ${code} ${await accountsDiagnostic(tx, c.country)}`,
              {
                cause: paid.error,
              },
            );
          }
          const started = paid.value;
          expect(started.created).toBe(true);
          expect(started.payment).toMatchObject({
            state: 'VERIFYING',
            holdStatus: 'PAYMENT_IN_FLIGHT',
            tripId: null,
          });
          expect(psp.orders).toHaveLength(1);
          const order = psp.orders[0]!;
          expect(order).toMatchObject({
            amountMinor: BigInt(want.total),
            currency: c.currency,
            method: 'CARD',
            capture: 'AUTO',
            idempotencyKey: `hold:${holdId}:CAPTURE:a1`,
          });
          // 17 NN4 : montant EXPLICITE de chaque jambe, jamais un prorata ; Σ jambes = total
          expect({ ...order.legs }).toEqual(want.legs);
          expect(sum({ ...order.legs } as Legs)).toBe(order.amountMinor);
          // second clic : aucun second ordre (l'état fait foi)
          const again = await pay.pay(hash, holdId, { method: 'CARD' });
          expect(again.created).toBe(false);
          expect(psp.orders).toHaveLength(1);
        });

        // transaction annulée : aucun interrupteur ouvert ne survit (17 §0.1)
        await inTx(api, { at: NOW }, async (tx) => {
          expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
        });
      },
    );
  });

  // ---------------------------------------------------------------------------------------------
  describe('B — paiement prouvé par webhook signé, trip BOOKED, notifications, « Mis viajes »', () => {
    const T0 = Date.UTC(2052, 2, 2, 10, 0, 0) + c.index * 7 * DAY;
    const t = (m: number): string => iso(T0 + m * MINUTE);
    const start = t(3 * 24 * 60);
    const end = t(5 * 24 * 60);
    const w: Partial<BookedWorld> = {};
    const booked = (): BookedWorld => {
      if (w.trip === undefined) throw new Error('étape précédente en échec : aucun trip');
      return w as BookedWorld;
    };

    const workerSql = async <R extends pg.QueryResultRow>(
      worker: string,
      at: string | undefined,
      sql: string,
      params: unknown[],
    ): Promise<R[]> => {
      const client = await open('app_worker');
      return inTx(
        client,
        { worker, commit: true, ...(at === undefined ? {} : { at }) },
        async (tx) => (await tx.query<R>(sql, params)).rows,
      );
    };
    const convert = async (op: string, at: string): Promise<Json> =>
      (
        await workerSql<{ r: Json }>(
          'booking_conversion',
          at,
          'SELECT core.booking_convert_payment($1) AS r',
          [op],
        )
      )[0]!.r;
    const webhook = async (op: string, at: string): Promise<string> =>
      (
        await workerSql<{ o: string }>(
          'webhook_ingest',
          at,
          `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                    test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS o`,
          [op],
        )
      )[0]!.o;
    const bookedEvents = async (hold: string): Promise<number> =>
      (
        await workerSql<{ n: number }>(
          'outbox_relay',
          undefined,
          `SELECT pg_catalog.count(*)::int AS n FROM core.outbox_outbox_event
            WHERE type = 'booking.trip.booked' AND payload ->> 'hold_id' = $1`,
          [hold],
        )
      )[0]!.n;

    it('voyageur inscrit, hold posé par la vraie commande, devis engagé aux jambes de l’oracle ; T1 / T2 par le vrai service : ordre au PSP aux jambes EXPLICITES de la capture', async () => {
      const api = await open('app_api');
      w.guest = randomUUID();
      w.org = randomUUID();
      w.vehicle = randomUUID();
      w.guestHash = await inTx(api, { at: t(0), commit: true }, async (tx) => {
        await register(tx, c.country, w.guest);
        await tx.query('SELECT test_fixture.l0_ensure_parties($1::uuid[], $2, $3)', [
          [w.guest],
          w.org,
          c.country,
        ]);
        await tx.query('SELECT test_fixture.register_vehicle($1, $2, $3)', [
          w.vehicle,
          w.org,
          c.country,
        ]);
        await tx.query('SELECT test_fixture.us209_driver($1, $2, $3::date, $4::date, $5)', [
          w.guest,
          c.country,
          '1990-01-01',
          '2099-12-31',
          c.country,
        ]);
        await capabilities(tx, c.country, t(-60));
        await tx.query('SELECT test_fixture.us024_psp_account($1)', [c.country]);
        return openSession(tx, w.guest!);
      });
      w.hold = await inTx(api, { at: t(0), commit: true }, async (tx) => {
        const { text, values } = commandCallSql(
          { kind: 'GUEST', actorId: w.guest! },
          'core.booking_cmd_place_hold',
          [
            { value: w.vehicle, type: 'uuid' },
            { value: start, type: 'timestamptz' },
            { value: end, type: 'timestamptz' },
            { value: false, type: 'boolean' },
          ],
        );
        return (await tx.query<{ result: string }>(text, values)).rows[0]!.result;
      });
      w.quote = await inTx(api, { at: t(0), commit: true }, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `SELECT test_fixture.us223_checkout_acceptance($1, $2::bigint, $3, $4::jsonb,
                                                         $5::timestamptz, $6::timestamptz) AS id`,
          [w.hold, total.toString(), c.currency, JSON.stringify(legsText(capture)), start, end],
        );
        return r.rows[0]!.id;
      });

      const psp = new FakeHostedPsp();
      await soleFakeAccount(c.country);
      const started = await inTx(api, { at: t(1), commit: true }, (tx) =>
        payOrExplain(paymentService(tx, psp), w.guestHash!, w.hold!),
      );
      expect(started.created).toBe(true);
      expect(started.payment).toMatchObject({ state: 'VERIFYING', tripId: null });
      expect(psp.orders).toHaveLength(1);
      expect(psp.orders[0]).toMatchObject({
        amountMinor: total,
        currency: c.currency,
        capture: 'AUTO',
      });
      expect({ ...psp.orders[0]!.legs }).toEqual(capture);

      const ops = await workerSql<{ id: string; amount_minor: string; status: string }>(
        'payment_command',
        undefined,
        `SELECT o.id, o.amount_minor::text AS amount_minor, o.status
           FROM core.payment_payment_operation AS o WHERE o.hold_id = $1`,
        [w.hold],
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ amount_minor: total.toString(), status: 'SUBMITTED' });
      w.operation = ops[0]!.id;
    });

    it('FAKE hostile : SUCCEEDED de réponse d’API (non signé) ⇒ NOT_PROVEN, aucun trip ; webhook signé ⇒ preuve ; conversion ⇒ trip BOOKED, version de prix n° 1 = devis du checkout, booking.trip.booked une fois ; rejeux ⇒ DUPLICATE et REPLAY', async () => {
      const op = w.operation;
      if (op === undefined) throw new Error('étape précédente en échec : aucune opération');
      const api = await open('app_api');
      expect(
        (
          await workerSql<{ o: string }>(
            'payment_command',
            t(2),
            `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'API_RESPONSE', NULL,
                                                            NULL) AS o`,
            [op],
          )
        )[0]!.o,
      ).toBe('APPLIED');
      expect(await convert(op, t(2))).toEqual({ outcome: 'NOT_PROVEN' });
      expect(await webhook(op, t(3))).toBe('DUPLICATE');
      const r = await convert(op, t(3));
      expect(r).toMatchObject({ outcome: 'CONVERTED', reacquired: false });
      w.trip = String(r['tripId']);

      const read = await inTx(api, { at: t(4) }, (tx) =>
        paymentService(tx, new FakeHostedPsp()).payment(w.guestHash!, w.hold!),
      );
      expect(read).toMatchObject({ state: 'CONFIRMED', holdStatus: 'CONVERTED', tripId: w.trip });
      const versions = await inTx(
        api,
        {},
        async (tx) =>
          (
            await tx.query<{ version: number; quote_id: string }>(
              'SELECT * FROM test_fixture.us223_trip_price_versions($1)',
              [w.trip],
            )
          ).rows,
      );
      expect(versions).toEqual([{ version: 1, quote_id: w.quote }]);
      expect(await bookedEvents(w.hold!)).toBe(1);

      expect(await webhook(op, t(4))).toBe('DUPLICATE');
      expect(await convert(op, t(4))).toMatchObject({ outcome: 'REPLAY', tripId: w.trip });
      expect(await bookedEvents(w.hold!)).toBe(1);
    });

    it('confirmation : parties de la notification (voyageur et titulaire du compte d’hôte, identifiants seulement) ; « Mis viajes » : trip à venir, BOOKED ; interrupteurs fermés', async () => {
      const b = booked();
      const api = await open('app_api');
      const holder = await inTx(api, {}, async (tx) =>
        String(
          (await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [b.trip]))
            .rows[0]!.h,
        ),
      );
      const parties = await workerSql<{ p: Json | null }>(
        'ntf_dispatcher',
        t(5),
        'SELECT core.booking_notification_parties($1, $2::uuid) AS p',
        ['TRIP', b.trip],
      );
      expect(parties[0]!.p).toEqual({ guestUserId: b.guest, hostUserId: holder });

      await inTx(api, { at: t(5) }, async (tx) => {
        const rows = (
          await tx.query<Json>('SELECT * FROM core.booking_guest_trips($1, $2, $3::uuid, $4)', [
            b.guestHash,
            null,
            null,
            200,
          ])
        ).rows;
        const mine = rows.filter((r) => r['item_id'] === b.trip);
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({
          outcome: 'DONE',
          kind: 'TRIP',
          tab: 'UPCOMING',
          status: 'BOOKED',
          currency: c.currency,
          contract_state: 'NONE',
        });
        expect((mine[0]!['starts_at'] as Date).toISOString()).toBe(start);
        expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
      });
    });

    // D1 (passation US-221), corrigé par US-221b (#246, migration 0149, ADR-170) : la conversion
    // porte la capture prouvée du hold sur les soldes par jambe du trip né, dans sa transaction
    // (08 E7 règle 2, 17 §2.9). Attendu : juste après la conversion, soldes = jambes de la capture
    // de l'oracle ; le report rejoué par la commande du travailleur `payment_command` rend
    // DUPLICATE et ne change rien. Transaction ANNULÉE : rien n'est écrit.
    it('D1 : la capture prouvée du checkout est portée sur les soldes par jambe du trip réservé dès la conversion (soldes = capture de l’oracle) ; report rejoué ⇒ DUPLICATE, soldes inchangés', async () => {
      const b = booked();
      const worker = await open('app_worker');
      await inTx(worker, { worker: 'payment_command', at: t(6) }, async (tx) => {
        const captured = async () =>
          Object.fromEntries(
            (
              await tx.query<{ leg: LegName; v: string }>(
                `SELECT leg, captured_minor::text AS v FROM core.settlement_trip_leg_balance
                  WHERE trip_id = $1 AND segment_no = 1`,
                [b.trip],
              )
            ).rows.map((r) => [r.leg, BigInt(r.v)]),
          );
        expect(await captured()).toEqual(capture);
        const moved = await tx.query<{ r: string }>(
          'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
          [b.operation],
        );
        expect(moved.rows[0]?.r).toBe('DUPLICATE');
        expect(await captured()).toEqual(capture);
      });
    });

    // D2 (passation US-221), corrigé par US-221b (#246) : le trip né d'une conversion qui porte
    // une capture prouvée est tenu par les faits de l'invariant par jambe du rapprochement.
    it('D2 : le trip payé et prouvé est examiné par l’invariant par jambe du rapprochement (Σ capturé = Σ encaissé = total)', async () => {
      const b = booked();
      const worker = await open('app_worker');
      await inTx(worker, { worker: 'reconciliation' }, async (tx) => {
        const { rows } = await tx.query<Json>(
          `SELECT captured_minor::text AS captured, collected_minor::text AS collected
             FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`,
          [b.trip],
        );
        expect(rows).toEqual([{ captured: total.toString(), collected: total.toString() }]);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('C — annulation par l’ops, remboursement par jambe, registres, reçus, rapprochement', () => {
    const REQUESTED_AT_MS = Date.UTC(2052, 5, 14, 12, 0, 0) + c.index * 7 * DAY;
    const w: Partial<CancelledWorld> = {};
    const cancelled = (): CancelledWorld => {
      if (w.cancellation === undefined) throw new Error('étape précédente en échec');
      return w as CancelledWorld;
    };
    const tripOf = (f: CancellationFacts): ReturnType<typeof toTrip> => ({
      ...toTrip(vector.trip),
      startAtMs: f.startAtMs,
      bookedAtMs: f.bookedAtMs,
    });

    /** Lecture sous un travailleur (transaction annulée). */
    const read = async <R extends pg.QueryResultRow>(
      worker: string,
      sql: string,
      params: unknown[],
    ): Promise<R[]> => {
      const client = await open('app_worker');
      return inTx(client, { worker }, async (tx) => (await tx.query<R>(sql, params)).rows);
    };
    const balances = async (trip: string) => {
      const rows = await read<{ leg: LegName; captured: string; refunded: string }>(
        'payment_command',
        `SELECT leg, captured_minor::text AS captured, refunded_minor::text AS refunded
           FROM core.settlement_trip_leg_balance WHERE trip_id = $1 AND segment_no = 1`,
        [trip],
      );
      const pick = (f: 'captured' | 'refunded') =>
        Object.fromEntries(rows.map((r) => [r.leg, BigInt(r[f])])) as unknown as Legs;
      return { captured: pick('captured'), refunded: pick('refunded') };
    };

    it('trip capturé (vraie commande, webhook signé, report sur les soldes) ; registre de l’assureur : +prime ; demande d’annulation de la console (OPS, vraie commande)', async () => {
      const start = REQUESTED_AT_MS - (vector.event.requestedAtMinutes ?? 0) * MINUTE;
      const bookedAt = start + vector.trip.bookedAtMinutes * MINUTE;
      w.trip = randomUUID();
      w.guest = randomUUID();
      w.capture = randomUUID();
      const worker = await open('app_worker');
      await inTx(
        worker,
        { worker: 'payment_command', at: iso(bookedAt), commit: true },
        async (tx) => {
          await tx.query(
            `SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, 'UTC', $7, $8)`,
            [
              w.trip,
              w.guest,
              randomUUID(),
              randomUUID(),
              c.country,
              c.currency,
              iso(start),
              iso(start + vector.trip.days * DAY),
            ],
          );
          const account = await tx.query<{ id: string }>(
            'SELECT test_fixture.us024_psp_account($1) AS id',
            [c.country],
          );
          await tx.query(
            `SELECT * FROM core.payment_cmd_record_operation($1, NULL, $2, $3, 'CARD', 'CAPTURE',
                                                          'RENT', $4, $5, 1, $6, $6, $7::jsonb,
                                                          NULL, NULL)`,
            [
              w.capture,
              w.trip,
              account.rows[0]?.id,
              total.toString(),
              c.currency,
              `trip:${w.trip}:capture:${w.capture}`,
              JSON.stringify(legsText(capture)),
            ],
          );
          const status = await tx.query<{ o: string }>(
            `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                    test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS o`,
            [w.capture],
          );
          expect(status.rows[0]?.o).toBe('APPLIED');
          const moved = await tx.query<{ r: string }>(
            'SELECT core.settlement_cmd_apply_leg_movement($1) AS r',
            [w.capture],
          );
          expect(moved.rows[0]?.r).toBe('APPLIED');
        },
      );
      const b = await balances(w.trip);
      expect(b.captured).toEqual(capture);
      expect(sum(b.captured)).toBe(total);
      const entries = await read<{ reason: string; amount_minor: string }>(
        'payment_command',
        'SELECT reason, amount_minor::text AS amount_minor FROM test_fixture.us227_entries($1)',
        [w.trip],
      );
      expect(entries.map((e) => [e.reason, BigInt(e.amount_minor)])).toEqual([
        ['COLLECTION', capture.INSURER],
      ]);

      // demande de la console : agent OPS du pays, session élevée, action CANCEL_TRIP_GUEST
      const api = await open('app_api');
      const opsId = await inTx(api, { commit: true }, (tx) =>
        staffMember(tx, 'OPS_AGENT', c.country),
      );
      w.cancellation = await inTx(api, { at: iso(REQUESTED_AT_MS), commit: true }, async (tx) => {
        const ops = await elevated(tx, opsId);
        await setSessionContext(tx, {
          kind: 'STAFF',
          actorId: ops.id,
          countryScope: [c.country],
          sessionTokenHash: ops.hash.toString('hex'),
        });
        const { rows } = await tx.query<{ outcome: string; domain_ref: string | null }>(
          `SELECT outcome, domain_ref
               FROM core.iam_staff_cmd_manual_action($1, $2, 'CANCEL_TRIP_GUEST', $3, $4,
                                                     '{}'::jsonb, '{}'::uuid[])`,
          [ops.hash, randomUUID(), w.trip, 'Demande du voyageur au support, parcours doré'],
        );
        expect(rows[0]?.outcome).toBe('DONE');
        return String(rows[0]?.domain_ref);
      });
    });

    it('vrai processeur : demande réglée (frais au voyageur) ; jambes du règlement v1 = variation de l’oracle ; ordre REFUND = −variation, montant explicite par jambe', async () => {
      const x = cancelled();
      const alerts = new Alerts();
      const p = new TripCancellationProcessor({
        transactions: committing(REQUESTED_AT_MS + MINUTE),
        alerts,
        tripOf,
      });
      expect(await p.process(x.cancellation)).toEqual({
        outcome: 'SETTLED',
        costBearer: 'GUEST',
        orders: 1,
      });
      expect(alerts.sent).toEqual([]);
      const row = await read<{ status: string; settlement_id: string | null; cost_bearer: string }>(
        'settlement',
        'SELECT status, settlement_id, cost_bearer FROM test_fixture.us215_cancellation($1)',
        [x.cancellation],
      );
      expect(row[0]).toMatchObject({ status: 'SETTLED', cost_bearer: 'GUEST' });
      const legs = await read<{ leg: LegName; v: string }>(
        'settlement',
        `SELECT leg, variation_minor::text AS v FROM core.settlement_settlement_leg
          WHERE settlement_id = $1`,
        [row[0]!.settlement_id],
      );
      expect(Object.fromEntries(legs.map((r) => [r.leg, BigInt(r.v)]))).toEqual(variation);
      const order = await read<{ leg: LegName; v: string }>(
        'payment_command',
        `SELECT l.leg, l.amount_minor::text AS v
           FROM core.payment_payment_operation AS o
           JOIN core.payment_payment_operation_leg AS l ON l.operation_id = o.id
          WHERE o.trip_id = $1 AND o.kind = 'REFUND'`,
        [x.trip],
      );
      expect(Object.fromEntries(order.map((r) => [r.leg, BigInt(r.v)]))).toEqual(refund);
      // rejeu : la demande n'est plus en attente, rien n'est écrit
      expect(await p.process(x.cancellation)).toEqual({ outcome: 'SKIPPED' });
    });

    it('remboursement par jambe : PSP en panne ⇒ WAITING (rien d’émis) ; vrai ordonnanceur ⇒ SENT au PSP avec chaque jambe ; preuve signée ⇒ CONFIRMED ; report ⇒ soldes = capture − remboursement (TJ02a pour le trip A) ; S10 du voyageur et de l’hôte', async () => {
      const x = cancelled();
      const due = async () => {
        const client = await open('app_worker');
        return inTx(client, { worker: 'payment_command' }, async (tx) => {
          const all = await new PgRefundOrders(sqlOf(tx)).due(500);
          const inst = await tx.query<{ id: string; status: string; operation_id: string }>(
            'SELECT id, status, operation_id FROM core.payment_refund_instance WHERE trip_id = $1',
            [x.trip],
          );
          expect(inst.rows).toHaveLength(1);
          const i = inst.rows[0]!;
          return { instance: i, due: all.find((d) => d.instanceId === i.id) };
        });
      };
      const planned = await due();
      expect(planned.instance.status).toBe('PLANNED');
      if (planned.due === undefined) throw new Error('remboursement absent de la file');

      // FAKE hostile : PSP injoignable ⇒ transaction annulée, instance toujours PLANNED
      let calls = 0;
      const down = {
        capabilities: () => ({ bool: (name: string) => name === 'SUPPORTS_IDEMPOTENCY_HEADER' }),
        refund: (): Promise<OperationResult> => {
          calls++;
          return Promise.reject(new PaymentError('PROVIDER_UNAVAILABLE', 'injoignable'));
        },
      };
      const registry = (p: unknown): PaymentConnectorRegistry => ({
        get: (provider) => (provider === 'FAKE' ? (p as PaymentProvider) : undefined),
      });
      const waiting = await new RefundScheduler({
        transactions: committing(REQUESTED_AT_MS + 2 * MINUTE),
        alerts: new Alerts(),
        connectors: registry(down),
      }).process(planned.due);
      expect(waiting).toEqual({ step: 'WAITING' });
      expect(calls).toBe(1);
      const still = await due();
      expect(still.instance.status).toBe('PLANNED');
      if (still.due === undefined) throw new Error('remboursement sorti de la file');

      const refunds: RefundRequest[] = [];
      const accepting = {
        capabilities: () => ({
          bool: (name: string) =>
            name === 'SUPPORTS_IDEMPOTENCY_HEADER' || name === 'SUPPORTS_LOOKUP_BY_MERCHANT_REF',
        }),
        refund: (req: RefundRequest): Promise<OperationResult> => {
          refunds.push(req);
          return Promise.resolve({ providerReference: `psp-${randomUUID()}`, status: 'PENDING' });
        },
      };
      const alerts = new Alerts();
      const scheduler = new RefundScheduler({
        transactions: committing(REQUESTED_AT_MS + 3 * MINUTE),
        alerts,
        connectors: registry(accepting),
      });
      expect(await scheduler.process(still.due)).toEqual({ step: 'SENT' });
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ amountMinor: sum(refund), currency: c.currency });
      expect({ ...refunds[0]!.legs }).toEqual(refund);

      const sent = await due();
      expect(sent.instance.status).toBe('SENT');
      const proof = await committing(REQUESTED_AT_MS + 4 * MINUTE).run('webhook_ingest', (tx) =>
        tx.query<{ o: string }>(
          `SELECT core.payment_cmd_apply_operation_status($1, 'SUCCEEDED', 'WEBHOOK',
                    test_fixture.us049_signed_webhook($1, 'SUCCEEDED'), NULL) AS o`,
          [sent.instance.operation_id],
        ),
      );
      expect(proof.rows[0]?.o).toBe('APPLIED');
      const confirmed = await due();
      expect(confirmed.instance.status).toBe('CONFIRMED');
      if (confirmed.due === undefined) throw new Error('remboursement prouvé absent de la file');
      expect(await scheduler.process(confirmed.due)).toEqual({ step: 'REPORTED' });
      expect(alerts.sent).toEqual([]);
      expect(refunds).toHaveLength(1);

      const b = await balances(x.trip);
      expect(b.captured).toEqual(capture);
      expect(b.refunded).toEqual(refund);
      expect(plus(b.captured, negate(b.refunded))).toEqual(kept);
      expect((await due()).due).toBeUndefined();

      // S10 : le voyageur lit le montant remboursé ; l'hôte, la jambe HOST seulement
      const api = await open('app_api');
      await inTx(api, {}, async (tx) => {
        const guestHash = await openSession(tx, x.guest);
        const holder = (
          await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [x.trip])
        ).rows[0]!.h;
        const hostHash = await openSession(tx, holder);
        const READ = 'SELECT * FROM core.booking_trip_refunds($1, $2::uuid)';
        const g = (await tx.query<Json>(READ, [guestHash, x.trip])).rows;
        expect(g[0]).toMatchObject({ outcome: 'OK', viewer_role: 'GUEST', currency: c.currency });
        expect(g[0]!['refunds']).toEqual([
          expect.objectContaining({
            status: 'CONFIRMED',
            currency: c.currency,
            amountMinor: sum(refund).toString(),
          }),
        ]);
        const h = (await tx.query<Json>(READ, [hostHash, x.trip])).rows;
        expect(h[0]).toMatchObject({ outcome: 'OK', viewer_role: 'HOST' });
        expect(h[0]!['refunds']).toEqual([
          expect.objectContaining({ status: 'CONFIRMED', hostLegMinor: refund.HOST.toString() }),
        ]);
        expect(JSON.stringify(h[0]!['refunds'])).not.toContain('amountMinor');
      });
    });

    it('registre de l’assureur : +prime à l’encaissement, −prime au règlement (prime due 0) ; reçus de l’hôte (jambe HOST retenue, aucune pénalité) et du voyageur (remboursement, trip fee) ; aucune donnée de l’autre partie', async () => {
      const x = cancelled();
      const entries = await read<{ reason: string; amount_minor: string }>(
        'payment_command',
        'SELECT reason, amount_minor::text AS amount_minor FROM test_fixture.us227_entries($1)',
        [x.trip],
      );
      const byReason = (reason: string) =>
        entries.filter((e) => e.reason === reason).map((e) => BigInt(e.amount_minor));
      expect(byReason('COLLECTION')).toEqual([capture.INSURER]);
      expect(byReason('SETTLEMENT_VARIATION')).toEqual([variation.INSURER]);
      expect(entries).toHaveLength(2);
      expect(entries.reduce((s, e) => s + BigInt(e.amount_minor), 0n)).toBe(kept.INSURER);

      const api = await open('app_api');
      await inTx(api, {}, async (tx) => {
        const guestHash = await openSession(tx, x.guest);
        const holder = (
          await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [x.trip])
        ).rows[0]!.h;
        const hostHash = await openSession(tx, holder);
        const READ = 'SELECT * FROM core.booking_trip_receipt($1, $2::uuid)';
        const host = (await tx.query<Json>(READ, [hostHash, x.trip])).rows;
        expect(host).toHaveLength(1);
        expect(host[0]).toMatchObject({ outcome: 'OK', viewer_role: 'HOST', currency: c.currency });
        expect(host[0]!['receipt']).toMatchObject({
          kind: 'CXL_EARNING',
          source: 'SETTLEMENT',
          settlementVersion: 1,
          hostLegMinor: kept.HOST.toString(),
          adjustments: [],
          adjustmentsMinor: '0',
          netMinor: kept.HOST.toString(),
        });
        const guest = (await tx.query<Json>(READ, [guestHash, x.trip])).rows;
        expect(guest[0]).toMatchObject({ outcome: 'OK', viewer_role: 'GUEST' });
        const receipt = guest[0]!['receipt'] as Json;
        expect(receipt).toMatchObject({
          source: 'SETTLEMENT',
          settlementVersion: 1,
          totalPaidMinor: total.toString(),
          refundMinor: vector.expected.guestRefundMinor.toString(),
        });
        const fee = receipt['tripFee'] as Json;
        expect(fee['chargedMinor']).toBe(vector.trip.linesMinor.tripFee.toString());
        expect(BigInt(String(fee['refundedMinor'])) + BigInt(String(fee['retainedMinor']))).toBe(
          vector.trip.linesMinor.tripFee,
        );
        // minimisation : le voyageur ne voit ni jambe ni plan de l'hôte
        expect(Object.keys(receipt)).not.toContain('hostLegMinor');
        expect(Object.keys(receipt)).not.toContain('hostPlanCode');
      });
    });

    it('rapprochement nocturne : faits de l’invariant par jambe du trip (Σ capturé = Σ encaissé = total payé ; HOST du relevé = HOST attendue) ; contrôles FIN et oracle C12 sur toute la base : 0 écart ; interrupteurs fermés', async () => {
      const x = cancelled();
      const worker = await open('app_worker');
      await inTx(worker, { worker: 'reconciliation' }, async (tx) => {
        const facts = await tx.query<Json>(
          `SELECT captured_minor::text AS captured, collected_minor::text AS collected,
                  collected_legs_minor::text AS collected_legs,
                  head_total_paid_minor::text AS head_total_paid,
                  expected_host_minor::text AS expected_host,
                  statement_host_minor::text AS statement_host
             FROM core.finance_trip_leg_facts() WHERE trip_id = $1::uuid`,
          [x.trip],
        );
        expect(facts.rows).toEqual([
          {
            captured: total.toString(),
            collected: total.toString(),
            collected_legs: total.toString(),
            head_total_paid: total.toString(),
            expected_host: kept.HOST.toString(),
            statement_host: kept.HOST.toString(),
          },
        ]);
        const report = await runMoneyReconciliation(sqlOf(tx));
        const json = reconciliationReportJson(report);
        expect(json.violations, JSON.stringify(json.checks)).toBe('0');
        expect(report.examined.trips[c.country] ?? 0).toBeGreaterThanOrEqual(1);
        expect(report.examined.insurerTrips[c.country] ?? 0).toBeGreaterThanOrEqual(1);

        await asWorker(tx, 'booking_oracle');
        const c12 = await tx.query<{ check_code: string; violations: string }>(
          `SELECT check_code, violations::text AS violations FROM core.booking_production_oracle()`,
        );
        expect(c12.rows.length).toBeGreaterThan(0);
        for (const r of c12.rows) expect(r.violations, r.check_code).toBe('0');
        expect(await switches(tx, c.country)).toEqual(ALL_CLOSED);
      });
    });
  });
});

/**
 * US-222c — red team du lot 2, ex-porte LB (19 US-222 critère 3 ; pré-mortem du lot 2, RT-L2-LB01,
 * L2-PM-20) : débit MIT `DELAYED_CHARGES` de T58 REJOUÉ, sur le PSP simulé (FAKE seulement, C19),
 * en USD (PA) et en PYG sans décimale (PY). TESTS SEULEMENT, aucun correctif (L2-PM-39).
 *
 * Attaque : la minuterie de décision de la caution (`DepositDecisionTimer`, US-702) exécute T58
 * (PSP sans capture partielle : VOID de la caution entière, puis débit MIT du carburant) ; la
 * transaction qui reporte la décision est PERDUE (connexion coupée avant le COMMIT) ; une nouvelle
 * instance de la minuterie (redémarrage, autre réplique) rejoue la même caution, ou deux instances
 * la traitent en même temps. Attendu (08 BR-PAY-06, T58 ; 08 E4 ; 17 §2.8 et §4.3) : le voyageur
 * n'est débité qu'UNE fois du carburant, la caution n'est libérée qu'une fois, la décision n'est
 * reportée qu'une fois.
 *
 * Attendus : vecteur T58 de l'export des oracles (`@rueda/money/golden-vectors` : VOID 30 000,
 * MIT 1 200 en centimes) ; en PYG, fonction `deposit` de `docs/specs/tools/check_t49plus.py`
 * appelée par `python -I -X utf8` le 2026-11-19 sur la caution de T73 a (1 500 000) et un carburant
 * de test de 60 000 (valeur de test, non un vecteur de l'export) : `capture` 0, `void` 1 500 000,
 * `mit` 60 000, décision à fin + 70 h. Jamais le code testé.
 *
 * Constat F-L2-LB-03 (`it.fails` documenté) : chez un PSP dont l'en-tête d'idempotence n'est pas
 * validé (capacité inconnue = non, 17 §2.8, N-108) et qui ne déduplique pas la clé, le rejeu de la
 * minuterie RENVOIE les ordres sans lecture d'abord, contrairement à `MoneyCommandSender` (US-223) ;
 * voir `docs/team/redteam/L2-rls-lb.md`.
 */
import { readFileSync } from 'node:fs';
import { createCurrencyRegistry, money, ratio } from '@rueda/money';
import { checksFor, loadGoldenVectors } from '@rueda/money/golden-vectors';
import { describe, expect, it } from 'vitest';
import type { OpsAlert } from '../../../bus/index.js';
import { CapabilitySet } from '../../internal/capabilities.js';
import { DepositDecisionTimer } from '../../internal/deposit-decision.js';
import type {
  DepositFeeSource,
  DepositOutcome,
  DueDepositDecision,
} from '../../internal/deposit-decision.js';
import { DepositRailExecutor } from '../../internal/deposit-executor.js';
import type { DepositRailConfig } from '../../internal/pg-deposit-config.js';
import { countryCases } from '../../../../../test/support/countries.js';
import { fakeStack } from '../fake-stack.js';
import type { FakeStackOptions } from '../fake-stack.js';

const T58 = (() => {
  const found = checksFor(loadGoldenVectors(), 'T58').find((c) => c.label === 'T58');
  if (found === undefined) throw new Error('contrôle T58 absent de l’export');
  return found.expected as Record<string, bigint>;
})();

const read = (file: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../../cfg/data/${file}`, import.meta.url), 'utf8'));
const CURRENCIES = createCurrencyRegistry(
  (read('currencies.json') as { currencies: { code: string; exponent: number }[] }).currencies,
);
const PARAMS = (
  read('params.json') as { params: { key: string; values: Record<string, unknown> }[] }
).params;
const param = (key: string, country: string): number => {
  const v = PARAMS.find((x) => x.key === key)?.values[country];
  if (typeof v !== 'number') throw new Error(`paramètre ${key} absent pour ${country}`);
  return v;
};

/**
 * Montants par exposant de la devise (aucun code de pays ni de devise écrit ici) : exposant 2,
 * T58 de l'export ; exposant 0, sortie de l'oracle `deposit` (en-tête du fichier).
 */
const BY_EXPONENT = new Map<number, { deposit: bigint; fee: bigint; void: bigint; mit: bigint }>([
  [
    2,
    {
      deposit: (T58['capture'] ?? 0n) + (T58['void'] ?? 0n),
      fee: T58['mit'] ?? 0n,
      void: T58['void'] ?? 0n,
      mit: T58['mit'] ?? 0n,
    },
  ],
  [0, { deposit: 1_500_000n, fee: 60_000n, void: 1_500_000n, mit: 60_000n }],
]);
const CASES = countryCases().map((c) => {
  const cur = CURRENCIES.get(c.currency);
  const v = BY_EXPONENT.get(cur.exponent);
  if (v === undefined) throw new Error(`devise sans vecteur : ${c.currency}`);
  return { ...c, cur, ...v };
});
type Case = (typeof CASES)[number];

const H = 3_600_000;
/** T58 : fin du trip ; décision à fin + 70 h, expiration renvoyée à fin + 72 h (V = 168 h). */
const END = Date.parse('2031-07-20T10:00:00.000Z');
const at = (hours: number): Date => new Date(END + hours * H);
const IDS = {
  deposit: '0191d1a0-0000-7000-8000-00000022c001',
  trip: '0191d1a0-0000-7000-8000-00000022c002',
  segment: '0191d1a0-0000-7000-8000-00000022c003',
  tender: '0191d1a0-0000-7000-8000-00000022c004',
};

/** T58 : capture partielle NON supportée pour la carte (moyen de la caution). */
const NO_PARTIAL_CAPTURE = [
  { capability: 'SUPPORTS_PARTIAL_CAPTURE', method: '*', value: true, status: 'VALIDATED_SANDBOX' },
  {
    capability: 'SUPPORTS_PARTIAL_CAPTURE',
    method: 'CARD',
    value: false,
    status: 'VALIDATED_SANDBOX',
  },
] as const;

function configOf(c: Case, caps: FakeStackOptions['override'] & object): DepositRailConfig {
  return {
    triggerParams: {},
    amounts: undefined,
    railParams: {
      authLeadH: param('auth_lead_h', c.country),
      releaseDelayH: param('release_delay_h', c.country),
      marginH: param('marge_h', c.country),
      safetyH: param('deposit_safety_h', c.country),
      reauthLeadH: param('deposit_reauth_lead_h', c.country),
      providerMaxHoldH: 168,
      chargeCapMinor: 0n,
      fundsHoldingEnabled: false,
    },
    feeNoticeH: param('deposit_fee_notice_h', c.country),
    capabilities: new CapabilitySet(
      caps.map((x) => ({ ...x, status: x.status as 'VALIDATED_SANDBOX' })),
    ),
  };
}

/** Carburant de T58 : 100 % hôte, prouvé, notifié à fin + 1 h, non contesté ; carte enregistrée. */
const fuel =
  (c: Case): DepositFeeSource =>
  () =>
    Promise.resolve({
      fees: [
        {
          id: 'fuel',
          amount: money(c.fee, c.cur),
          hostShare: ratio(1n, 1n),
          proven: true,
          notifiedAt: at(1),
          disputed: false,
        },
      ],
      instrumentToken: 'tok_card_rt222c',
    });

/**
 * PSP simulé avec la caution posée et acceptée, et une fabrique de minuteries qui partagent ce PSP
 * (redémarrage du travailleur, ou deux répliques) mais chacune sa mémoire. `decide` simule la base :
 * `lose` premières décisions perdues (connexion coupée avant le COMMIT : exception, rien d'écrit),
 * puis la première décision appliquée, les suivantes `STALE` (verrou de ligne et rang de 0150).
 */
async function rig(c: Case, options: FakeStackOptions, lose = 0) {
  const stack = fakeStack({ ...options, override: [...NO_PARTIAL_CAPTURE] });
  const order = await new DepositRailExecutor(stack.provider).place(
    {
      depositId: IDS.deposit,
      tripReference: IDS.trip,
      tripId: IDS.trip,
      segmentId: IDS.segment,
      tenderId: IDS.tender,
      currency: c.cur,
    },
    {
      mechanism: 'PREAUTH_SINGLE',
      amountMinor: c.deposit,
      fundsHoldingEnabled: false,
      attemptNo: 1,
    },
  );
  stack.psp.customerPays(order.providerReference);
  const applied: DepositOutcome[] = [];
  const lost: DepositOutcome[] = [];
  const alerts: OpsAlert[] = [];
  let toLose = lose;
  const timer = () =>
    new DepositDecisionTimer({
      config: () => Promise.resolve(configOf(c, stack.capabilities)),
      decide: (_id, seq, outcome) => {
        if (toLose > 0) {
          toLose -= 1;
          lost.push(outcome);
          return Promise.reject(new Error('connexion perdue avant le COMMIT'));
        }
        if (applied.length > 0 || seq !== 0) return Promise.resolve('STALE' as const);
        applied.push(outcome);
        return Promise.resolve('APPLIED' as const);
      },
      fees: fuel(c),
      alerts: {
        send: (a) => {
          alerts.push(a);
          return Promise.resolve();
        },
      },
      connectors: { get: (name) => (name === 'FAKE' ? stack.provider : undefined) },
    });
  const due: DueDepositDecision = {
    depositId: IDS.deposit,
    tripId: IDS.trip,
    segmentId: IDS.segment,
    tenderId: IDS.tender,
    country: c.country,
    currency: c.currency,
    currencyExponent: c.cur.exponent,
    provider: 'FAKE',
    providerReference: order.providerReference,
    mechanism: 'PREAUTH_SINGLE',
    amountMinor: c.deposit,
    decisionAt: at(70),
    authExpiryAt: at(72),
    reauthSeq: 0,
    now: at(70),
  };
  const mits = () =>
    stack.psp
      .movements()
      .filter((m) => m.operation === 'MIT_CHARGE')
      .map((m) => [m.amountMinor, m.legs?.HOST]);
  return { stack, timer, due, applied, lost, alerts, mits };
}

const VOIDED = (c: Case): DepositOutcome => ({
  status: 'VOIDED',
  capturedMinor: 0n,
  releasedMinor: c.void,
});

describe.each(CASES)('RT-L2-LB01 — MIT de T58 rejoué ($country, $currency)', (c) => {
  it('oracle : T58 = VOID de la caution entière puis MIT du carburant, rien de capturé', () => {
    expect(c.void).toBe(c.deposit);
    expect(c.mit).toBe(c.fee);
  });

  it('témoin (PSP honnête, en-tête d’idempotence validé) : commit perdu après VOID + MIT, rejeu par une nouvelle minuterie ⇒ un seul débit MIT (jambe HOST), VOIDED reporté une fois', async () => {
    const r = await rig(c, {}, 1);
    // première passe : VOID et MIT partis, la décision n'a pas été validée (connexion perdue)
    expect(await r.timer().process(r.due)).toBe('ERROR');
    expect(r.lost).toEqual([VOIDED(c)]);
    expect(r.applied).toEqual([]);
    expect(r.mits()).toEqual([[c.mit, c.mit]]);
    // rejeu : mêmes clés (08 E4), aucun second débit, décision reportée
    expect(await r.timer().process(r.due)).toBe('VOIDED');
    expect(r.applied).toEqual([VOIDED(c)]);
    expect(r.mits()).toEqual([[c.mit, c.mit]]);
    expect(r.stack.psp.calls('CAPTURE')).toBe(0);
    expect(r.alerts).toEqual([]);
  });

  it('témoin (PSP honnête) : deux minuteries simultanées sur la même caution ⇒ un seul débit MIT, une décision APPLIED, l’autre STALE', async () => {
    const r = await rig(c, {});
    const outcomes = await Promise.all([r.timer().process(r.due), r.timer().process(r.due)]);
    expect([...outcomes].sort()).toEqual(['STALE', 'VOIDED']);
    expect(r.applied).toEqual([VOIDED(c)]);
    expect(r.mits()).toEqual([[c.mit, c.mit]]);
  });

  it('attaque jouée (PSP sans en-tête d’idempotence validé, clé ignorée) : commit perdu puis rejeu ; observation de l’issue (F-L2-LB-03)', async () => {
    const r = await rig(
      c,
      { scenario: { ignoreIdempotency: true }, without: ['SUPPORTS_IDEMPOTENCY_HEADER'] },
      1,
    );
    expect(await r.timer().process(r.due)).toBe('ERROR');
    expect(r.mits()).toEqual([[c.mit, c.mit]]);
    const replay = await r.timer().process(r.due);
    // l'attaque a bien eu lieu : la minuterie a rejoué la caution et reporté une décision finale ;
    // le voyageur n'a été débité qu'une fois du carburant (le FAKE refuse le second VOID, donc le
    // MIT n'est pas renvoyé). Issue observée le 2026-11-19 (rapport) : second VOID envoyé sans
    // lecture, refusé ⇒ EXPIRED reporté (avis BLOCKED_UNTIL_EXPIRY), alerte DEPOSIT_DECISION_FAILED.
    expect(['VOIDED', 'EXPIRED']).toContain(replay);
    expect(r.applied).toHaveLength(1);
    expect(r.applied[0]?.releasedMinor).toBe(c.deposit);
    expect(r.mits()).toEqual([[c.mit, c.mit]]);
  });

  // F-L2-LB-03 (moyenne, PROPOSÉE) : sans `SUPPORTS_IDEMPOTENCY_HEADER` validé, le rejeu doit LIRE
  // d'abord (getOperation par la clé, comme MoneyCommandSender, N-108) : la caution déjà annulée et le
  // MIT déjà débité sont reconnus, rien n'est renvoyé, la décision VOIDED est reportée (pas EXPIRED
  // ni BLOCKED_UNTIL_EXPIRY). Signal attendu après correction : un seul VOID et un seul MIT envoyés
  // au PSP, VOIDED reporté, aucune alerte DEPOSIT_DECISION_FAILED.
  it.fails(
    'F-L2-LB-03 — PSP sans en-tête d’idempotence validé : le rejeu lit d’abord, ne renvoie ni le VOID ni le MIT, et reporte VOIDED',
    async () => {
      const r = await rig(
        c,
        { scenario: { ignoreIdempotency: true }, without: ['SUPPORTS_IDEMPOTENCY_HEADER'] },
        1,
      );
      expect(await r.timer().process(r.due)).toBe('ERROR');
      expect(await r.timer().process(r.due)).toBe('VOIDED');
      expect(r.stack.psp.calls('VOID')).toBe(1);
      expect(r.stack.psp.calls('MIT_CHARGE')).toBe(1);
      expect(r.mits()).toEqual([[c.mit, c.mit]]);
      expect(r.applied).toEqual([VOIDED(c)]);
      expect(r.alerts.map((a) => a.code)).not.toContain('DEPOSIT_DECISION_FAILED');
    },
  );
});

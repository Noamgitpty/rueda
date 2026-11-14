/**
 * US-045 — résilience du consommateur KYC face au FAKE hostile du fournisseur d'identité
 * (`@rueda/fake-adapters/identity`, mode scripté ; 17 §5 « KYC », §12 « Résilience » ; ADR-032
 * « mode hostile » ; ADR-058 « échecs en valeurs »).
 *
 * Ce qui est prouvé, au niveau du service `IdentityVerificationService` (construit directement, comme
 * dans identity.contract.test.ts), pour chaque pays de la configuration :
 * - fournisseur lent (`DELAY`), en panne (`UNAVAILABLE`, ponctuelle ou prolongée), délai dépassé
 *   avant (`TIMEOUT_BEFORE`) ou après l'effet (`TIMEOUT_AFTER`) à l'ouverture : 503
 *   `KYC_PROVIDER_UNAVAILABLE`, rien n'est approuvé, la reprise rejoue la MÊME clé et n'ouvre
 *   qu'UNE session chez le fournisseur ;
 * - rappel retardé, perdu, trop tardif, dupliqué ou livré dans le désordre : la décision n'est
 *   appliquée qu'une fois, jamais par un rappel plus ancien qu'une décision déjà appliquée, et la
 *   personne reste non éligible au paiement (`assertDriverEligible`) tant qu'aucune approbation
 *   n'est appliquée (fail-closed) ;
 * - effacement (retrait du consentement) sous `TIMEOUT_*` ou panne prolongée : la demande reste
 *   `PENDING` ; la reprise rejoue la même clé `erase:<demande>` et rend UNE attestation.
 *
 * Attendus tirés du contrat du port (identity-provider.port.ts : « TIMEOUT = issue inconnue :
 * rejouer la même clé d'idempotence ») et de la table de FakeRuntime (ADR-058), de l'en-tête de
 * identity.service.ts (fail-closed, 503, rappel idempotent par événement, effacement laissé en
 * attente) et de 16 VER-001 (contrôle bloquant du paiement). Jamais de l'instantané du code.
 * Heure virtuelle (FakeClock) : aucune attente réelle. Données fictives.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakeIdentityProvider } from '@rueda/fake-adapters';
import {
  IdentityVerificationService,
  LICENSE_DOCUMENT_KIND,
} from '../internal/identity.service.js';
import { kycCountries } from '../internal/production.js';
import type { EligibilityOutcome } from '../internal/identity-store.js';
import { FakeIdentityStore } from './fake-identity-store.js';

const PROVIDER = 'FAKE';
const RETURN_URL = 'https://app.example.invalid/verify-identity';
const SESSION_TTL_MS = 30 * 60_000;
const TOLERANCE_S = 300;
/** Pays de la configuration (CFG) : chaque cas tourne pour chacun (PA et PY). */
const COUNTRY_CODES = kycCountries().map((c) => c.code);

/**
 * Magasin FAKE dont l'éligibilité suit le statut du dossier (contrat de `assertDriverEligible` :
 * `KYC_NOT_APPROVED` sans vérification approuvée) ; le magasin de base rend une issue imposée.
 */
class StatusEligibilityStore extends FakeIdentityStore {
  override async eligibility(tokenHash: Buffer): Promise<EligibilityOutcome> {
    const base = await super.eligibility(tokenHash);
    if (base === 'AUTH_REQUIRED') return base;
    return this.statusOf(tokenHash.toString('hex')) === 'APPROVED'
      ? 'ELIGIBLE'
      : 'KYC_NOT_APPROVED';
  }
}

const LICENCE = (country: string) => ({
  livenessScore: 0.97,
  faceMatchScore: 0.93,
  document: {
    kind: LICENSE_DOCUMENT_KIND,
    country,
    expiresOn: '2031-06-30',
    licenseClass: 'B',
    isPermanent: true,
    providerDocumentRef: 'doc_resilience',
  },
});

const sessionOf = (hostedUrl: string) => hostedUrl.slice(hostedUrl.lastIndexOf('/') + 1);

async function world(country: string) {
  const clock = new FakeClock('2026-11-14T12:00:00Z');
  const store = new StatusEligibilityStore();
  const kyc = new FakeIdentityProvider({
    clock,
    documents: COUNTRY_CODES.map((c) => ({ country: c, kind: LICENSE_DOCUMENT_KIND })),
    webhookSecret: randomBytes(24).toString('hex'),
    sessionTtlMs: SESSION_TTL_MS,
    webhookToleranceSeconds: TOLERANCE_S,
    env: { RUEDA_ENV: 'test' },
  });
  const warnings: { readonly message: string; readonly fields: unknown }[] = [];
  const svc = new IdentityVerificationService({
    store,
    providers: { active: { code: PROVIDER, provider: kyc }, byCode: new Map([[PROVIDER, kyc]]) },
    returnUrl: RETURN_URL,
    countries: kycCountries(),
    log: { warn: (message, fields) => warnings.push({ message, fields }) },
    // heure du service = heure virtuelle du fournisseur (fraîcheur des rappels, échéance de session)
    now: () => clock.now(),
  });
  const hashHex = randomBytes(32).toString('hex');
  store.addPerson(hashHex);
  const proof = Buffer.from(hashHex, 'hex');
  await svc.consent(proof, { version: 1, accepted: true, country });

  const start = () => svc.start(proof, { country }, 'es');
  /** Livre les rappels arrivés à échéance, dans l'ordre donné (par défaut celui d'émission). */
  const deliver = async (deliveries = kyc.takeDeliveries()) => {
    const statuses: number[] = [];
    for (const d of deliveries) {
      statuses.push(await svc.webhook(PROVIDER, Buffer.from(d.body, 'utf8'), d.signature));
    }
    return statuses;
  };
  const eligible = () =>
    svc.assertDriverEligible(proof, new Date(clock.nowMs() + 86_400_000), country);
  const withdraw = () => svc.consent(proof, { accepted: false });
  const status = () => store.statusOf(hashHex);
  return { clock, store, kyc, svc, warnings, start, deliver, eligible, withdraw, status };
}

type World = Awaited<ReturnType<typeof world>>;

async function startedSession(w: World): Promise<string> {
  const r = await w.start();
  expect(r.code).toBe('KYC_SESSION_STARTED');
  return sessionOf(r.hostedUrl);
}

const UNAVAILABLE = { code: 'KYC_PROVIDER_UNAVAILABLE', status: 503 };

describe.each(COUNTRY_CODES)('US-045 — KYC face au fournisseur hostile (%s)', (country) => {
  describe('ouverture de la session hébergée', () => {
    it('TIMEOUT_BEFORE : 503, aucune session ni approbation ; la reprise ouvre UNE session', async () => {
      const w = await world(country);
      w.kyc.runtime.script.script('start', { kind: 'TIMEOUT_BEFORE' });
      await expect(w.start()).rejects.toMatchObject(UNAVAILABLE);
      // rien n'a été fait chez le fournisseur ; rien n'est posé en base
      expect(await w.kyc.getStatus('fk_idv_000001')).toEqual({
        status: 'REFUSED',
        reason: 'UNKNOWN_SESSION',
      });
      expect(w.status()).not.toBe('DOCS_SUBMITTED');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });

      const again = await w.start();
      expect(again.code).toBe('KYC_SESSION_STARTED');
      expect(sessionOf(again.hostedUrl)).toBe('fk_idv_000001');
      expect(w.status()).toBe('DOCS_SUBMITTED');
      expect(w.kyc.runtime.script.calls('start')).toBe(2);
    });

    it('TIMEOUT_AFTER (issue inconnue, deux fois) : 503 ; la reprise rejoue la même clé, une seule session, une seule décision', async () => {
      const w = await world(country);
      w.kyc.runtime.script.script('start', { kind: 'TIMEOUT_AFTER' }, { kind: 'TIMEOUT_AFTER' });
      await expect(w.start()).rejects.toMatchObject(UNAVAILABLE);
      // l'effet a eu lieu chez le fournisseur, mais rien n'est approuvé ni posé chez nous
      expect(await w.kyc.getStatus('fk_idv_000001')).toMatchObject({
        status: 'OK',
        value: { state: 'PENDING' },
      });
      expect(w.status()).not.toBe('DOCS_SUBMITTED');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
      // second TIMEOUT sur le rejeu (le scénario décrit le fournisseur) : toujours 503
      await expect(w.start()).rejects.toMatchObject(UNAVAILABLE);

      const again = await w.start();
      expect(again.code).toBe('KYC_SESSION_STARTED');
      // même clé (vérification, tentative) : la session du premier appel, aucune seconde session
      const sessionId = sessionOf(again.hostedUrl);
      expect(sessionId).toBe('fk_idv_000001');
      expect(await w.kyc.getStatus('fk_idv_000002')).toEqual({
        status: 'REFUSED',
        reason: 'UNKNOWN_SESSION',
      });

      w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      expect(await w.deliver()).toEqual([200]);
      expect(w.store.decisions.map((d) => d.outcome)).toEqual(['APPLIED']);
      await expect(w.eligible()).resolves.toBeUndefined();
      // une nouvelle demande ne rouvre rien : déjà approuvé
      await expect(w.start()).rejects.toMatchObject({ code: 'KYC_ALREADY_APPROVED' });
      expect(w.kyc.runtime.script.calls('start')).toBe(3);
    });

    it('DELAY : session ouverte une fois, échéance postérieure à l’heure de réponse', async () => {
      const w = await world(country);
      const before = w.clock.nowMs();
      w.kyc.runtime.script.script('start', { kind: 'DELAY', ms: 45_000 });
      const r = await w.start();
      expect(r.code).toBe('KYC_SESSION_STARTED');
      expect(sessionOf(r.hostedUrl)).toBe('fk_idv_000001');
      expect(w.clock.nowMs()).toBe(before + 45_000);
      expect(new Date(r.expiresAt).getTime()).toBeGreaterThan(w.clock.nowMs());
      expect(w.status()).toBe('DOCS_SUBMITTED');
      // la reprise rend la session en cours, sans nouvel appel au fournisseur
      const again = await w.start();
      expect(again).toMatchObject({ code: 'KYC_SESSION_IN_PROGRESS', hostedUrl: r.hostedUrl });
      expect(w.kyc.runtime.script.calls('start')).toBe(1);
    });

    it('panne prolongée (UNAVAILABLE par défaut) : chaque demande 503, aucune session cachée ; au retour, UNE session', async () => {
      const w = await world(country);
      w.kyc.runtime.script.setDefault('start', { kind: 'UNAVAILABLE' });
      for (let i = 0; i < 5; i++) {
        await expect(w.start()).rejects.toMatchObject(UNAVAILABLE);
        w.clock.advance(60_000);
      }
      expect(w.status()).not.toBe('DOCS_SUBMITTED');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });

      w.kyc.runtime.script.setDefault('start', { kind: 'OK' });
      const r = await w.start();
      expect(sessionOf(r.hostedUrl)).toBe('fk_idv_000001');
      expect(w.kyc.runtime.script.calls('start')).toBe(6);
    });
  });

  describe('rappels de décision', () => {
    it('rappel retardé (DELAY) : rien d’appliqué ni d’éligible avant son arrivée, puis une décision', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.runtime.script.script('webhook', { kind: 'DELAY', ms: 120_000 });
      w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      expect(await w.deliver()).toEqual([]);
      expect(w.status()).toBe('DOCS_SUBMITTED');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });

      w.clock.advance(120_000);
      expect(await w.deliver()).toEqual([200]);
      expect(w.status()).toBe('APPROVED');
      expect(w.store.decisions.map((d) => d.outcome)).toEqual(['APPLIED']);
      await expect(w.eligible()).resolves.toBeUndefined();
    });

    it('rappel reçu hors de la fenêtre de fraîcheur : 401 journalisé, décision non appliquée (fail-closed)', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      const late = w.kyc.takeDeliveries();
      w.clock.advance((TOLERANCE_S + 60) * 1000);
      expect(await w.deliver(late)).toEqual([401]);
      expect(w.store.rejections.map((r) => r.reason)).toEqual(['STALE']);
      expect(w.store.decisions).toEqual([]);
      expect(w.status()).toBe('DOCS_SUBMITTED');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
    });

    it.each(['UNAVAILABLE', 'TIMEOUT_BEFORE', 'TIMEOUT_AFTER'] as const)(
      'rappel perdu (%s) : décision non appliquée, non éligible, aucune nouvelle session ; appliquée à la livraison suivante',
      async (kind) => {
        const w = await world(country);
        const sessionId = await startedSession(w);
        w.kyc.runtime.script.script('webhook', { kind });
        w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
        expect(await w.deliver()).toEqual([]);
        // le fournisseur a décidé (lisible par getStatus) ; chez nous, rien n'est approuvé
        expect(await w.kyc.getStatus(sessionId)).toMatchObject({
          status: 'OK',
          value: { state: 'APPROVED' },
        });
        expect(w.status()).toBe('DOCS_SUBMITTED');
        await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
        // la personne qui revient retrouve sa session : aucune seconde session ouverte
        const again = await w.start();
        expect(again.code).toBe('KYC_SESSION_IN_PROGRESS');
        expect(w.kyc.runtime.script.calls('start')).toBe(1);

        // livraison suivante du fournisseur (nouvel événement de décision) : appliquée une fois
        w.clock.advance(10 * 60_000);
        w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
        expect(await w.deliver()).toEqual([200]);
        expect(w.store.decisions.map((d) => d.outcome)).toEqual(['APPLIED']);
        await expect(w.eligible()).resolves.toBeUndefined();
      },
    );

    it('désordre : une approbation ANCIENNE livrée après un refus plus récent n’approuve pas', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      const older = w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      w.clock.advance(30_000);
      const newer = w.kyc.decide(sessionId, 'DECLINED', ['LIVENESS_FAILED'], LICENCE(country));
      const [first, second] = w.kyc.takeDeliveries();
      if (first === undefined || second === undefined) throw new Error('deux rappels attendus');
      // le plus récent arrive d'abord, l'ancien ensuite
      expect(await w.deliver([second, first])).toEqual([200, 200]);
      expect(w.store.decisions).toEqual([
        { eventId: newer.eventId, outcome: 'APPLIED' },
        { eventId: older.eventId, outcome: 'STALE' },
      ]);
      expect(w.status()).toBe('MANUAL_REVIEW');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
      expect(w.warnings).toContainEqual({
        message: 'kyc.webhook.ignored',
        fields: { provider: PROVIDER, outcome: 'STALE' },
      });
    });

    it('désordre : un refus ANCIEN livré après une approbation plus récente ne fait pas régresser l’état', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      const older = w.kyc.decide(sessionId, 'DECLINED', ['LIVENESS_FAILED'], LICENCE(country));
      w.clock.advance(30_000);
      const newer = w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      const [first, second] = w.kyc.takeDeliveries();
      if (first === undefined || second === undefined) throw new Error('deux rappels attendus');
      expect(await w.deliver([second, first])).toEqual([200, 200]);
      expect(w.store.decisions).toEqual([
        { eventId: newer.eventId, outcome: 'APPLIED' },
        { eventId: older.eventId, outcome: 'STALE' },
      ]);
      expect(w.status()).toBe('APPROVED');
      await expect(w.eligible()).resolves.toBeUndefined();
    });

    it('doublon (DUPLICATE) dont la copie arrive après une décision plus récente : une seule décision appliquée', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.runtime.script.script('webhook', { kind: 'DUPLICATE' });
      const review = w.kyc.decide(sessionId, 'REVIEW', [], LICENCE(country));
      w.clock.advance(30_000);
      const approved = w.kyc.decide(sessionId, 'APPROVED', [], LICENCE(country));
      const deliveries = w.kyc.takeDeliveries();
      expect(deliveries).toHaveLength(3);
      const [copy1, copy2, later] = deliveries;
      if (copy1 === undefined || copy2 === undefined || later === undefined) {
        throw new Error('trois rappels attendus');
      }
      // copie 1, puis la décision plus récente, puis la copie périmée du premier événement
      expect(await w.deliver([copy1, later, copy2])).toEqual([200, 200, 200]);
      expect(w.store.decisions).toEqual([
        { eventId: review.eventId, outcome: 'APPLIED' },
        { eventId: approved.eventId, outcome: 'STALE' },
        { eventId: review.eventId, outcome: 'DUPLICATE' },
      ]);
      expect(w.store.decisions.filter((d) => d.outcome === 'APPLIED')).toHaveLength(1);
      expect(w.status()).toBe('MANUAL_REVIEW');
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
    });
  });

  describe('effacement au retrait du consentement (VER-004)', () => {
    it('TIMEOUT_BEFORE : retrait acquis, demande PENDING ; la reprise efface et atteste une fois', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.runtime.script.script('erase', { kind: 'TIMEOUT_BEFORE' });
      await expect(w.withdraw()).resolves.toMatchObject({ version: 1 });
      expect(w.status()).toBe('RECHECK');
      expect(w.store.erasures).toMatchObject([{ sessionRef: sessionId, status: 'PENDING' }]);
      expect(w.kyc.erased.has(sessionId)).toBe(false);
      expect(w.warnings).toContainEqual({
        message: 'kyc.erasure.pending',
        fields: { provider: PROVIDER },
      });

      await w.withdraw();
      expect(w.store.erasures).toMatchObject([
        { sessionRef: sessionId, status: 'DONE', attestationRef: 'fk_idv_erase_000001' },
      ]);
      expect(w.kyc.erased.has(sessionId)).toBe(true);
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
    });

    it('TIMEOUT_AFTER : effacé chez le fournisseur mais PENDING chez nous ; la reprise rejoue la même clé, une seule attestation', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.runtime.script.script('erase', { kind: 'TIMEOUT_AFTER' });
      await w.withdraw();
      // issue inconnue : jamais notée DONE sans attestation
      expect(w.kyc.erased.has(sessionId)).toBe(true);
      expect(w.store.erasures).toMatchObject([
        { sessionRef: sessionId, status: 'PENDING', attestationRef: null },
      ]);

      await w.withdraw();
      // rejeu idempotent : l'attestation du premier effacement, aucune seconde
      expect(w.store.erasures).toMatchObject([
        { sessionRef: sessionId, status: 'DONE', attestationRef: 'fk_idv_erase_000001' },
      ]);
      expect(w.kyc.runtime.script.calls('erase')).toBe(2);
    });

    it('panne prolongée : chaque retrait réussit, la demande reste unique et PENDING', async () => {
      const w = await world(country);
      const sessionId = await startedSession(w);
      w.kyc.runtime.script.setDefault('erase', { kind: 'UNAVAILABLE' });
      for (let i = 0; i < 3; i++) {
        await expect(w.withdraw()).resolves.toMatchObject({ version: 1 });
        w.clock.advance(60 * 60_000);
      }
      expect(w.status()).toBe('RECHECK');
      expect(w.store.erasures).toMatchObject([{ sessionRef: sessionId, status: 'PENDING' }]);
      expect(w.kyc.erased.has(sessionId)).toBe(false);
      expect(w.kyc.runtime.script.calls('erase')).toBe(3);
      await expect(w.eligible()).rejects.toMatchObject({ code: 'KYC_NOT_APPROVED' });
    });
  });
});

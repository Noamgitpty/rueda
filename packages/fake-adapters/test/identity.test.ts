import { describe, expect, it } from 'vitest';
import { FakeIdentityProvider } from '../src/identity/index.ts';
import type { IdentityDocumentRef, StartVerificationRequest } from '../src/identity/index.ts';
import { clock, configuredCountries, secret } from './support.ts';

// Pièces par pays : codes et pièces fiscales lus dans la configuration pays ; les pièces d'identité
// génériques (pièce nationale, pièce d'étranger résident, passeport) sont des types neutres.
const countries = configuredCountries();
const documents: IdentityDocumentRef[] = countries.flatMap((c) =>
  ['NATIONAL_ID', 'FOREIGN_RESIDENT_ID', 'PASSPORT', ...c.hostTaxIdKinds].map((kind) => ({
    country: c.code,
    kind,
  })),
);

function setup() {
  const webhookSecret = secret();
  const kyc = new FakeIdentityProvider({
    clock: clock(),
    documents,
    webhookSecret,
    sessionTtlMs: 30 * 60_000,
    webhookToleranceSeconds: 300,
  });
  return { kyc, webhookSecret };
}

const request = (country: string, key = `k-${country}`): StartVerificationRequest => ({
  idempotencyKey: key,
  subjectRef: 'subj_0001',
  document: { country, kind: 'NATIONAL_ID' },
  locale: 'es',
  returnUrl: 'https://app.example.invalid/kyc/retour',
});

describe('FakeIdentityProvider (KYC hébergé)', () => {
  it.each(countries.map((c) => c.code))(
    'réussite : pièce du pays %s, session hébergée sans donnée du sujet',
    async (country) => {
      const { kyc } = setup();
      const out = await kyc.startVerification(request(country));
      expect(out.status).toBe('OK');
      if (out.status !== 'OK') return;
      expect(out.value.hostedUrl).toMatch(
        /^https:\/\/identity\.fake\.invalid\/session\/fk_idv_\d{6}$/,
      );
      expect(out.value.hostedUrl).not.toContain('subj_0001');
      expect(out.value.expiresAt.toISOString()).toBe('2026-11-03T12:30:00.000Z');
    },
  );

  it('capacité inconnue = « non » : pièce ou pays non configuré ⇒ UNSUPPORTED_DOCUMENT', async () => {
    const { kyc } = setup();
    const country = countries[0]?.code ?? '';
    expect(kyc.supportsDocument({ country, kind: 'DRIVING_LICENCE' })).toBe(false);
    expect(kyc.supportsDocument({ country: 'XX', kind: 'NATIONAL_ID' })).toBe(false);
    const out = await kyc.startVerification({
      ...request(country),
      document: { country: 'XX', kind: 'NATIONAL_ID' },
    });
    expect(out).toEqual({ status: 'REFUSED', reason: 'UNSUPPORTED_DOCUMENT' });
  });

  it('échec : panne puis issue inconnue ; le rejeu de la clé rend la même session', async () => {
    const { kyc } = setup();
    const country = countries[1]?.code ?? '';
    kyc.runtime.script.script('start', { kind: 'UNAVAILABLE' }, { kind: 'TIMEOUT_AFTER' });
    expect(await kyc.startVerification(request(country))).toEqual({ status: 'UNAVAILABLE' });
    expect(await kyc.startVerification(request(country))).toEqual({ status: 'TIMEOUT' });
    const replay = await kyc.startVerification(request(country));
    expect(replay).toMatchObject({
      status: 'OK',
      replayed: true,
      value: { sessionId: 'fk_idv_000001' },
    });
    expect(await kyc.startVerification({ ...request(country), locale: 'en' })).toEqual({
      status: 'REFUSED',
      reason: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('décision par rappel signé ; refus (DECLINED) lisible aussi par getStatus', async () => {
    const { kyc } = setup();
    const out = await kyc.startVerification(request(countries[0]?.code ?? ''));
    if (out.status !== 'OK') throw new Error('session attendue');
    expect(await kyc.getStatus(out.value.sessionId)).toMatchObject({
      status: 'OK',
      value: { state: 'PENDING' },
    });
    kyc.decide(out.value.sessionId, 'DECLINED', ['DOCUMENT_EXPIRED']);
    const [delivery] = kyc.takeDeliveries();
    if (delivery === undefined) throw new Error('rappel attendu');
    const verdict = kyc.parseWebhook(delivery.body, delivery.signature, kyc.runtime.clock.now());
    expect(verdict).toMatchObject({
      status: 'ACCEPTED',
      event: { decision: 'DECLINED', reasons: ['DOCUMENT_EXPIRED'] },
    });
    expect(await kyc.getStatus(out.value.sessionId)).toMatchObject({
      value: { state: 'DECLINED' },
    });
  });

  it('rappel en double, en retard, perdu, désordonné ; signature fausse ou périmée rejetée', async () => {
    const { kyc } = setup();
    const ids: string[] = [];
    for (const key of ['a', 'b', 'c']) {
      const out = await kyc.startVerification(request(countries[0]?.code ?? '', key));
      if (out.status !== 'OK') throw new Error('session attendue');
      ids.push(out.value.sessionId);
    }
    kyc.runtime.script.script(
      'webhook',
      { kind: 'DUPLICATE' },
      { kind: 'DELAY', ms: 120_000 },
      { kind: 'UNAVAILABLE' },
    );
    const first = kyc.decide(ids[0] ?? '', 'APPROVED');
    kyc.decide(ids[1] ?? '', 'REVIEW');
    kyc.decide(ids[2] ?? '', 'APPROVED');
    const now = kyc.takeDeliveries();
    expect(now).toHaveLength(2); // doublon du premier ; le second est en retard ; le troisième est perdu
    expect(now[0]).toEqual(now[1]);
    expect(kyc.takeDeliveries()).toHaveLength(0);
    kyc.runtime.clock.advance(120_000);
    const late = kyc.takeDeliveries();
    expect(late).toHaveLength(1);
    // désordre : le test présente le rappel tardif avant le doublon
    const events = [...late, ...now].map((d) =>
      kyc.parseWebhook(d.body, d.signature, kyc.runtime.clock.now()),
    );
    expect(events.map((e) => e.status)).toEqual(['ACCEPTED', 'ACCEPTED', 'ACCEPTED']);
    expect(
      events.filter((e) => e.status === 'ACCEPTED' && e.event.eventId === first.eventId),
    ).toHaveLength(2);
    // le rappel perdu : la décision reste lisible
    expect(await kyc.getStatus(ids[2] ?? '')).toMatchObject({ value: { state: 'APPROVED' } });

    const d = now[0];
    if (d === undefined) throw new Error('rappel attendu');
    expect(
      kyc.parseWebhook(
        d.body.replace('APPROVED', 'DECLINED'),
        d.signature,
        kyc.runtime.clock.now(),
      ),
    ).toEqual({
      status: 'REJECTED',
      reason: 'BAD_SIGNATURE',
    });
    expect(
      kyc.parseWebhook(d.body, d.signature, new Date(kyc.runtime.clock.nowMs() + 3_600_000)),
    ).toEqual({
      status: 'REJECTED',
      reason: 'STALE',
    });
  });

  it('session expirée ; session inconnue', async () => {
    const { kyc } = setup();
    const out = await kyc.startVerification(request(countries[0]?.code ?? ''));
    if (out.status !== 'OK') throw new Error('session attendue');
    kyc.runtime.clock.advance(30 * 60_000);
    expect(await kyc.getStatus(out.value.sessionId)).toMatchObject({ value: { state: 'EXPIRED' } });
    expect(await kyc.getStatus('fk_idv_999999')).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SESSION',
    });
  });

  it('délai de réponse simulé, sans attente réelle', async () => {
    const { kyc } = setup();
    kyc.runtime.script.script('start', { kind: 'DELAY', ms: 25_000 });
    const t0 = Date.now();
    expect((await kyc.startVerification(request(countries[0]?.code ?? ''))).status).toBe('OK');
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(kyc.runtime.clock.now().toISOString()).toBe('2026-11-03T12:00:25.000Z');
  });

  it('contrôles du rappel (US-105) : scores et champs minimaux seulement, images ignorées', async () => {
    const { kyc } = setup();
    const country = countries[0]?.code ?? '';
    const out = await kyc.startVerification(request(country));
    if (out.status !== 'OK') throw new Error('session attendue');
    const checks = {
      livenessScore: 0.98,
      faceMatchScore: 0.91,
      document: {
        kind: 'DRIVER_LICENSE',
        country,
        expiresOn: '2030-01-31',
        licenseClass: 'B',
        isPermanent: true,
        providerDocumentRef: 'doc_1',
      },
    };
    kyc.decide(out.value.sessionId, 'APPROVED', [], checks, {
      selfieUrl: 'https://identity.fake.invalid/selfie.jpg',
      frontImage: 'data:image/jpeg;base64,AAAA',
    });
    const [delivery] = kyc.takeDeliveries();
    if (delivery === undefined) throw new Error('rappel attendu');
    const verdict = kyc.parseWebhook(delivery.body, delivery.signature, kyc.runtime.clock.now());
    if (verdict.status !== 'ACCEPTED') throw new Error('rappel accepté attendu');
    expect(verdict.event.checks).toEqual(checks);
    expect(JSON.stringify(verdict.event)).not.toMatch(/selfie|image/i);
    // score hors bornes : rappel mal formé
    kyc.decide(out.value.sessionId, 'APPROVED', [], { ...checks, livenessScore: 2 });
    const [bad] = kyc.takeDeliveries();
    if (bad === undefined) throw new Error('rappel attendu');
    expect(kyc.parseWebhook(bad.body, bad.signature, kyc.runtime.clock.now())).toEqual({
      status: 'REJECTED',
      reason: 'MALFORMED',
    });
  });

  it('effacement d’une session (US-105, retrait) : attestation, idempotent ; session inconnue refusée', async () => {
    const { kyc } = setup();
    const out = await kyc.startVerification(request(countries[0]?.code ?? ''));
    if (out.status !== 'OK') throw new Error('session attendue');
    const first = await kyc.requestErasure({
      idempotencyKey: 'e1',
      sessionId: out.value.sessionId,
    });
    expect(first).toMatchObject({ status: 'OK', value: { attestationRef: 'fk_idv_erase_000001' } });
    expect(
      await kyc.requestErasure({ idempotencyKey: 'e1', sessionId: out.value.sessionId }),
    ).toMatchObject({
      status: 'OK',
      replayed: true,
    });
    expect(await kyc.getStatus(out.value.sessionId)).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SESSION',
    });
    expect(await kyc.requestErasure({ idempotencyKey: 'e2', sessionId: 'fk_idv_999999' })).toEqual({
      status: 'REFUSED',
      reason: 'UNKNOWN_SESSION',
    });
  });
});

describe('FakeIdentityProvider — nom du titulaire lu sur la pièce (US-103)', () => {
  it('prénoms et noms de famille recopiés tels quels ; absents : aucun champ ; mal formés ⇒ MALFORMED', async () => {
    const { kyc } = setup();
    const country = countries[0]?.code ?? '';
    const out = await kyc.startVerification(request(country, 'k-holder'));
    if (out.status !== 'OK') throw new Error('session refusée');
    const document = {
      kind: 'DRIVER_LICENSE',
      country,
      expiresOn: '2030-01-31',
      licenseClass: 'B',
      isPermanent: true,
      providerDocumentRef: 'doc_2',
    };
    const named = {
      ...document,
      holderGivenNames: 'José Luis',
      holderSurnames: 'Núñez de la Cruz',
    };
    kyc.decide(out.value.sessionId, 'APPROVED', [], {
      livenessScore: 0.9,
      faceMatchScore: 0.8,
      document: named,
    });
    kyc.decide(out.value.sessionId, 'APPROVED', [], {
      livenessScore: 0.9,
      faceMatchScore: 0.8,
      document,
    });
    kyc.decide(out.value.sessionId, 'APPROVED', [], {
      livenessScore: 0.9,
      faceMatchScore: 0.8,
      document: { ...document, holderSurnames: 'x'.repeat(201) },
    });
    const [withName, without, bad] = kyc.takeDeliveries();
    if (withName === undefined || without === undefined || bad === undefined) {
      throw new Error('rappels absents');
    }
    const a = kyc.parseWebhook(withName.body, withName.signature, kyc.runtime.clock.now());
    if (a.status !== 'ACCEPTED') throw new Error('rappel rejeté');
    expect(a.event.checks.document).toEqual(named);
    const b = kyc.parseWebhook(without.body, without.signature, kyc.runtime.clock.now());
    if (b.status !== 'ACCEPTED') throw new Error('rappel rejeté');
    expect(b.event.checks.document).toEqual(document);
    expect(kyc.parseWebhook(bad.body, bad.signature, kyc.runtime.clock.now())).toEqual({
      status: 'REJECTED',
      reason: 'MALFORMED',
    });
  });
});

describe('FakeIdentityProvider — faits vérifiés de la personne (US-123)', () => {
  it('date de naissance et pays de résidence lus du rappel ; tout autre champ ignoré ; forme stricte', async () => {
    const { kyc } = setup();
    const country = countries[0]?.code ?? '';
    const out = await kyc.startVerification(request(country, 'k-facts'));
    if (out.status !== 'OK') throw new Error('session refusée');
    kyc.decide(
      out.value.sessionId,
      'APPROVED',
      [],
      {
        livenessScore: 0.9,
        faceMatchScore: 0.8,
        document: null,
        subject: { dateOfBirth: '1990-04-30', residenceCountry: country },
      },
      // un fournisseur réel peut ajouter nom et adresse : la lecture les ignore
      {},
    );
    const [delivery] = kyc.takeDeliveries();
    if (delivery === undefined) throw new Error('rappel absent');
    const raw = JSON.parse(delivery.body) as { checks: { subject: Record<string, unknown> } };
    raw.checks.subject['fullName'] = 'Ana María Pérez Gómez';
    raw.checks.subject['address'] = 'Calle 50';
    const verdict = kyc.parseWebhook(delivery.body, delivery.signature, kyc.runtime.clock.now());
    expect(verdict).toMatchObject({
      status: 'ACCEPTED',
      event: { checks: { subject: { dateOfBirth: '1990-04-30', residenceCountry: country } } },
    });
    if (verdict.status !== 'ACCEPTED') throw new Error('rappel rejeté');
    expect(Object.keys(verdict.event.checks.subject ?? {}).sort()).toEqual([
      'dateOfBirth',
      'residenceCountry',
    ]);
  });

  it('faits mal formés ⇒ rappel MALFORMED ; absents ⇒ aucun champ subject', async () => {
    const { kyc } = setup();
    const country = countries[0]?.code ?? '';
    const out = await kyc.startVerification(request(country, 'k-bad-facts'));
    if (out.status !== 'OK') throw new Error('session refusée');
    kyc.decide(out.value.sessionId, 'APPROVED', [], {
      livenessScore: 0.9,
      faceMatchScore: 0.8,
      document: null,
      subject: { dateOfBirth: '30/04/1990', residenceCountry: country },
    });
    kyc.decide(out.value.sessionId, 'APPROVED');
    const [bad, plain] = kyc.takeDeliveries();
    if (bad === undefined || plain === undefined) throw new Error('rappels absents');
    expect(kyc.parseWebhook(bad.body, bad.signature, kyc.runtime.clock.now())).toEqual({
      status: 'REJECTED',
      reason: 'MALFORMED',
    });
    const v = kyc.parseWebhook(plain.body, plain.signature, kyc.runtime.clock.now());
    if (v.status !== 'ACCEPTED') throw new Error('rappel rejeté');
    expect('subject' in v.event.checks).toBe(false);
  });
});

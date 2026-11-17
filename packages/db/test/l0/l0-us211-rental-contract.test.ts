/**
 * US-211 (partie 211a) — contrat de location hôte–voyageur par trip et signature horodatée
 * (migration 0122, ADR-143 ; fixture 9963). Rôles de production seulement (assertion L0-05 par
 * `connectAs`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-211 (critères 1 à 3), de 16 BKG-018 / BKG-019 (états GENERATED → SIGNED
 * → SUPERSEDED, « l'ancienne version reste consultable », « refus de la remise d'un contrat non
 * signé », CONTRACT_HASH_MISMATCH, horodatage serveur), de 17 §2.7 / §3.1.3 (C2 retenues,
 * registre immuable), de 17 §7.2 (`grace_minutes` = 29, graine US-013), de 08 BR-CXL-06 (retenue
 * de TA01 : 42,80 ; au PY, 08 BR-CXL-06 sur le devis de la partie A : j = 1 sur 3 jours, (1 000 000
 * + 71 000) / 3 = 357 000 ; retenue écrite par le travailleur, bornée par le total) et du pré-mortem du
 * lot 2 (L2-PM-26, L2-PM-33, L2-PM-35), jamais du code testé.
 *
 * Partie A (transaction ANNULÉE, `app_worker`) : monde complet d'un trip BOOKED (fixture 9963),
 * source, enregistrement idempotent, version suivante, faits refusés s'ils diffèrent, garde de la
 * remise. Partie B (données VALIDÉES, deux sessions) : lecture par les parties, signature du
 * voyageur, CONTRACT_HASH_MISMATCH, version remplacée. Aucun interrupteur n'est touché.
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import { connectAs, releaseClient } from '../../src/testing/index.ts';
import { at, bookTrip, COUNTRIES, inTx, newSlot, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { checkoutPerson } from '../support/checkout.ts';
import type { Person } from '../support/checkout.ts';
import { newToken, SESSION_TTL_S } from '../support/iam.ts';
import { uniquePlate } from '../support/unique.ts';

type Tx = pg.ClientBase;
type Json = Record<string, unknown>;

/** 17 §7.2 : `grace_minutes` = 29 au PA et au PY (graine US-013). */
const GRACE_MIN = 29;

/**
 * Montants de TEST (unités mineures) ; retenues de 08 BR-CXL-06 sur CES devis (3 jours, j = 1 :
 * un tiers du loyer et des frais, aucune taxe) : PA (12 000 + 840) / 3 = 4 280 (TA01) ; PY
 * (1 000 000 + 71 000) / 3 = 357 000. La retenue réelle d'un devis figé de l'oracle est prouvée par
 * apps/api/src/modules/avl/internal/contract/contract-generator.test.ts.
 */
const AMOUNTS: Readonly<Record<string, Json>> = {
  PA: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '12000' },
      { type: 'TRIP_FEE', amountMinor: '840' },
    ],
    total: '12840',
    deductibles: { BASICA: '50000', ESTANDAR: '25000', TOTAL: '0' },
    rc: '10000000',
    deposit: '25000',
    extraKm: '35',
    retained: '4280',
  },
  PY: {
    lines: [
      { type: 'TRIP_PRICE', amountMinor: '1000000' },
      { type: 'TRIP_FEE', amountMinor: '71000' },
    ],
    total: '1071000',
    deductibles: { BASICA: '3500000', ESTANDAR: '1750000', TOTAL: '0' },
    rc: '750000000',
    deposit: '1750000',
    extraKm: '2500',
    retained: '357000',
  },
};

const SOURCE = 'SELECT core.booking_contract_source($1::uuid) AS s';
const RECORD = `SELECT * FROM core.booking_cmd_record_contract($1::uuid, $2, $3::jsonb, $4::jsonb,
                  $5::jsonb, $6::uuid, $7::uuid, $8, $9::bytea)`;
const READ = 'SELECT * FROM core.booking_trip_contract($1, $2::uuid, $3::integer)';
const SIGN = 'SELECT * FROM core.booking_cmd_sign_contract($1, $2::uuid, $3::uuid, $4::bytea)';
const TRANSITION = 'SELECT core.booking_cmd_trip_transition($1, $2, $3, NULL) AS r';

const sha = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();
const BODY = JSON.stringify([{ s: 'p', t: 'texte rendu de test' }]);

/** Appel dans un SAVEPOINT : lignes, ou code métier traduit. */
async function attempt(
  tx: Tx,
  sql: string,
  args: unknown[],
): Promise<{ ok: true; rows: Json[] } | { ok: false; code: string }> {
  await tx.query('SAVEPOINT us211');
  try {
    const r = await tx.query<Json>(sql, args);
    await tx.query('RELEASE SAVEPOINT us211');
    return { ok: true, rows: r.rows };
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT us211');
    return { ok: false, code: translateDbError(error).code };
  }
}

async function asWorker(tx: Tx, name: string): Promise<void> {
  await tx.query(
    `SELECT pg_catalog.set_config('app.actor_kind', 'WORKER', true),
            pg_catalog.set_config('app.worker_name', $1, true)`,
    [name],
  );
}

/** Heure locale « AAAA-MM-JJ HH:MM » dans le fuseau du pays (attendu indépendant du SQL). */
function local(iso: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')} ${g('hour')}:${g('minute')}`;
}

describe.each(COUNTRIES)('US-211 — contrat de location ($country, $currency)', (c: CountryCase) => {
  const a = AMOUNTS[c.country]!;

  it('partie A : faits du devis et de la fiche, idempotence, version suivante, faits altérés refusés, remise refusée sans contrat signé', async () => {
    const worker = await connectAs('app_worker');
    try {
      const NOW = '2034-02-01T12:00:00.000Z';
      const start = '2034-02-10T15:00:00.000Z';
      const end = '2034-02-13T15:00:00.000Z';
      await inTx(worker, { worker: 'booking_contract', virtualNow: NOW }, async (tx) => {
        const guest = uuid();
        const plate = await uniquePlate(tx, 'C');
        const w = (
          await tx.query<{ trip_id: string; quote_id: string; listing_id: string }>(
            `SELECT * FROM test_fixture.us211_world($1, $2, 'Ana', 'Pérez', 'pt-BR', 'María',
                                                    'Gómez', $3, 'HOST', $4, $5, $6::jsonb,
                                                    'BASICA', 600, $7, $8::jsonb, $9, $10)`,
            [
              c.country,
              guest,
              plate,
              start,
              end,
              JSON.stringify(a['lines']),
              a['extraKm'],
              JSON.stringify(a['deductibles']),
              a['rc'],
              a['deposit'],
            ],
          )
        ).rows[0]!;
        const trip = w.trip_id;

        // critère 1 : faits du devis figé (prix, protection, distance : N-199) et de la fiche
        // (assureur en vigueur à la réservation, caution, tolérance de retard), parties minimisées
        const src = (await tx.query<{ s: Json }>(SOURCE, [trip])).rows[0]!.s;
        expect(src['outcome']).toBe('OK');
        expect(src['nextVersion']).toBe(1);
        const facts = src['facts'] as { terms: Json; identity: Json };
        expect(facts.terms).toEqual({
          schema: 'ctr.rental/1',
          tripRef: `K-${trip.slice(0, 8).toUpperCase()}`,
          country: c.country,
          currency: c.currency,
          timezone: c.timezone,
          startLocal: local(start, c.timezone),
          endLocal: local(end, c.timezone),
          bookedAtLocal: local(NOW, c.timezone),
          vehicle: { make: 'Toyota', model: 'Yaris', year: 2022 },
          hostCapacity: 'OWNER',
          priceTotalMinor: a['total'],
          priceLines: (a['lines'] as Json[]).map((l) => ({ ...l, taxMinor: '0' })),
          protection: {
            level: 'BASICA',
            deductibleMinor: (a['deductibles'] as Json)['BASICA'],
            rcMinor: a['rc'],
            insurer: 'Aseguradora de prueba',
            broker: null,
          },
          depositMinor: a['deposit'],
          mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: a['extraKm'] },
          lateGraceMinutes: GRACE_MIN,
        });
        // L2-PM-35 : voyageur = prénom et initiale ; aucune pièce, aucun contact
        expect(facts.identity).toEqual({
          hostName: 'María Gómez',
          guestName: 'Ana P.',
          plate,
          handoverPlace: 'Fixture',
          handoverAddress: 'Fixture 1',
          handoverCity: 'Fixture',
        });
        expect(JSON.stringify(src)).not.toContain('Pérez');
        const tpl = src['template'] as Json;
        const courtesy = src['courtesy'] as Json;
        expect(courtesy['locale']).toBe('pt');
        expect(tpl['isDraft']).toBe(true);
        expect(String(tpl['body'])).toMatch(/^BORRADOR/);
        expect(String(tpl['body']).toLowerCase()).not.toContain('inapelable');

        // gabarit BROUILLON dans les quatre langues : marqueur, onze clauses, jamais « inapelable »
        const tpls = (
          await tx.query<{
            locale: string;
            body_md: string;
            draft: boolean;
            authoritative: boolean;
          }>('SELECT * FROM test_fixture.us211_templates()')
        ).rows;
        expect(tpls.map((r) => r.locale).sort()).toEqual(['en', 'es', 'fr', 'pt']);
        const MARK: Readonly<Record<string, RegExp>> = {
          es: /^BORRADOR/,
          en: /^DRAFT/,
          fr: /^BROUILLON/,
          pt: /^RASCUNHO/,
        };
        for (const r of tpls) {
          expect(r.draft, r.locale).toBe(true);
          expect(r.authoritative, r.locale).toBe(r.locale === 'es');
          expect(r.body_md, r.locale).toMatch(MARK[r.locale]!);
          expect(r.body_md.toLowerCase(), r.locale).not.toContain('inapelable');
          expect(
            r.body_md.split('\n').filter((l) => /^\d{1,2}\. /.test(l)),
            r.locale,
          ).toHaveLength(11);
        }

        const derived = JSON.stringify({
          brand: 'Marca',
          cancellation: {
            freeUntilLocal: local('2034-02-09T15:00:00.000Z', c.timezone),
            penaltyDays: '1',
            retainedMinor: a['retained'],
            engineVersion: 'cxl-beta/1',
          },
        });
        const record = (key: string, f: unknown = facts, d = derived, h = sha('v1')) =>
          attempt(tx, RECORD, [
            trip,
            key,
            JSON.stringify(f),
            d,
            BODY,
            tpl['id'],
            courtesy['id'],
            'ctr.pdf/1',
            h,
          ]);

        const r1 = await record('evt:A');
        expect(r1).toMatchObject({ ok: true, rows: [{ outcome: 'RECORDED', version: 1 }] });
        const v1 = (r1 as { rows: Json[] }).rows[0]!['document_id'] as string;
        // L2-PM-33 : événement rejoué ⇒ la même version, rien d'autre
        expect(await record('evt:A')).toMatchObject({
          ok: true,
          rows: [{ outcome: 'ALREADY_RECORDED', document_id: v1, version: 1 }],
        });
        // faits altérés (nom, montant) ou gabarit périmé ⇒ SOURCE_CHANGED, rien n'est écrit
        const altered = { ...facts, identity: { ...facts.identity, guestName: 'Ana Pérez' } };
        expect(await record('evt:C', altered)).toMatchObject({
          rows: [{ outcome: 'SOURCE_CHANGED' }],
        });
        const cheaper = { ...facts, terms: { ...facts.terms, priceTotalMinor: '1' } };
        expect(await record('evt:C', cheaper)).toMatchObject({
          rows: [{ outcome: 'SOURCE_CHANGED' }],
        });
        expect(
          await record('evt:C', facts, JSON.stringify({ brand: 'Marca', extra: 1 })),
        ).toMatchObject({ rows: [{ outcome: 'REQUEST_INVALID' }] });
        // retenue supérieure au total payé ⇒ refus (08 E4 : jamais plus que l'encaissé)
        const tooMuch = JSON.stringify({
          brand: 'Marca',
          cancellation: {
            freeUntilLocal: '2034-02-09 10:00',
            penaltyDays: '1',
            retainedMinor: (BigInt(a['total'] as string) + 1n).toString(),
            engineVersion: 'cxl-beta/1',
          },
        });
        expect(await record('evt:C', facts, tooMuch)).toMatchObject({
          rows: [{ outcome: 'REQUEST_INVALID' }],
        });
        expect(await record('evt:C', facts, derived, sha('x').subarray(0, 16))).toMatchObject({
          rows: [{ outcome: 'REQUEST_INVALID' }],
        });

        // contrat v1 signé, puis seconde génération : v2 la remplace, v1 reste lisible
        await tx.query('SELECT test_fixture.us211_sign($1)', [trip]);
        const r2 = await record('evt:B', facts, derived, sha('v2'));
        expect(r2).toMatchObject({ ok: true, rows: [{ outcome: 'RECORDED', version: 2 }] });
        const v2 = (r2 as { rows: Json[] }).rows[0]!['document_id'] as string;
        const docs = (
          await tx.query<Json>('SELECT * FROM test_fixture.us211_documents($1)', [trip])
        ).rows;
        expect(docs.map((d) => [d['version'], d['supersedes_id'], d['trigger_key']])).toEqual([
          [1, null, 'evt:A'],
          [2, v1, 'evt:B'],
        ]);
        expect(docs[0]).toMatchObject({
          locale: 'pt',
          template_locale: 'es',
          courtesy_locale: 'pt',
          terms: facts.terms,
          identity: facts.identity,
          derived: JSON.parse(derived),
          sha256: sha('v1').toString('hex'),
          renderer_version: 'ctr.pdf/1',
        });
        expect(
          (
            await tx.query<{ c: string }>('SELECT test_fixture.us211_segment_contract($1) AS c', [
              trip,
            ])
          ).rows[0]!.c,
        ).toBe(v2);
        const ev = (await tx.query<Json>('SELECT * FROM test_fixture.us211_events($1)', [trip]))
          .rows;
        expect(ev.filter((e) => e['type'] === 'contract.document.generated')).toEqual([
          expect.objectContaining({
            aggregate_id: v1,
            aggregate_version: '1',
            actor_role: 'SYSTEM',
          }),
          expect.objectContaining({
            aggregate_id: v2,
            aggregate_version: '2',
            actor_role: 'SYSTEM',
          }),
        ]);
        // registre immuable, même sous le propriétaire des tables
        expect(await attempt(tx, 'SELECT test_fixture.us211_try_update($1)', [v1])).toEqual({
          ok: false,
          code: 'IMMUTABLE_RECORD',
        });

        // critère 2 : remise refusée tant que la DERNIÈRE version n'est pas signée (v1 signée ne
        // suffit plus)
        await asWorker(tx, 'trip_lifecycle');
        expect(await attempt(tx, SOURCE, [trip])).toEqual({ ok: false, code: 'FORBIDDEN' });
        expect(
          await attempt(tx, TRANSITION, [trip, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED']),
        ).toMatchObject({ ok: true });
        expect(await attempt(tx, TRANSITION, [trip, 'IN_PROGRESS', 'CHECKIN_VALIDATED'])).toEqual({
          ok: false,
          code: 'CONTRACT_NOT_SIGNED',
        });
        await tx.query('SELECT test_fixture.us211_sign($1)', [trip]);
        expect(
          await attempt(tx, TRANSITION, [trip, 'IN_PROGRESS', 'CHECKIN_VALIDATED']),
        ).toMatchObject({ ok: true, rows: [{ r: { status: 'IN_PROGRESS' } }] });
        // trip remis : plus de génération
        await asWorker(tx, 'booking_contract');
        expect((await tx.query<{ s: Json }>(SOURCE, [trip])).rows[0]!.s).toEqual({
          outcome: 'NOT_CONTRACTABLE',
        });
        expect(await record('evt:D')).toMatchObject({ rows: [{ outcome: 'NOT_CONTRACTABLE' }] });
      });
    } finally {
      await releaseClient(worker);
    }
  });

  it('partie B : lecture par les parties, signature horodatée du voyageur, CONTRACT_HASH_MISMATCH, version remplacée', async () => {
    const api = await connectAs('app_api');
    const worker = await connectAs('app_worker');
    try {
      const T1 = c.country === 'PA' ? '2052-03-01T12:00:00.000Z' : '2052-04-01T12:00:00.000Z';
      const T2 = at(T1, 90);
      const slot = newSlot(at(T1, 7 * 1440), at(T1, 10 * 1440));
      const [guest, stranger] = await inTx(api, { virtualNow: T1, commit: true }, async (tx) => [
        await checkoutPerson(tx, c.country, 'Ana', 'Pérez'),
        await checkoutPerson(tx, c.country, 'Eva', 'Ruiz'),
      ]);
      const { tripId: trip } = await bookTrip(api, worker, slot, c, T1, guest!.id);

      // trip sans devis du checkout : source incomplète, aucun contrat deviné
      expect(
        await inTx(
          worker,
          { worker: 'booking_contract', virtualNow: T1 },
          async (tx) => (await tx.query<{ s: Json }>(SOURCE, [trip])).rows[0]!.s,
        ),
      ).toEqual({ outcome: 'SOURCE_UNAVAILABLE' });

      const doc1 = sha(`doc1-${trip}`);
      const doc2 = sha(`doc2-${trip}`);
      const v1 = await inTx(
        api,
        { virtualNow: T1, commit: true },
        async (tx) =>
          (
            await tx.query<{ document_id: string }>(
              'SELECT * FROM test_fixture.us211_document($1, $2, $3)',
              [trip, doc1, 'fixture:1'],
            )
          ).rows[0]!.document_id,
      );
      // titulaire du compte d'hôte du trip et sa session
      const host: Person = await inTx(api, { virtualNow: T1, commit: true }, async (tx) => {
        const holder = (
          await tx.query<{ h: string }>('SELECT test_fixture.us211_holder($1) AS h', [trip])
        ).rows[0]!.h;
        const t = newToken();
        await tx.query(`SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest')`, [
          uuid(),
          holder,
          t.hash,
          SESSION_TTL_S,
        ]);
        return { id: holder, hash: t.hash };
      });
      const read = (p: Person, version: number | null = null) =>
        inTx(
          api,
          { virtualNow: T2 },
          async (tx) => (await tx.query<Json>(READ, [p.hash, trip, version])).rows,
        );
      const sign = (p: Person, doc: string, presented: Buffer) =>
        inTx(
          api,
          { virtualNow: T2, commit: true },
          async (tx) => (await tx.query<Json>(SIGN, [p.hash, trip, doc, presented])).rows[0],
        );
      const signatures = () =>
        inTx(
          api,
          {},
          async (tx) =>
            (await tx.query<Json>('SELECT * FROM test_fixture.us211_signatures($1)', [trip])).rows,
        );

      // lecture : le voyageur du trip (et le titulaire du compte d'hôte), personne d'autre
      expect(await read(guest!)).toEqual([
        expect.objectContaining({
          outcome: 'OK',
          viewer_role: 'GUEST',
          document_id: v1,
          version: 1,
          latest_version: 1,
          sha256: doc1.toString('hex'),
          is_draft: true,
          signature_id: null,
        }),
      ]);
      expect(await read(stranger!)).toEqual([
        expect.objectContaining({ outcome: 'NOT_FOUND', document_id: null }),
      ]);
      expect(await read(host)).toEqual([
        expect.objectContaining({ outcome: 'OK', viewer_role: 'HOST', document_id: v1 }),
      ]);
      // l'hôte ne signe pas à la place du voyageur
      expect(await sign(host, v1, doc1)).toMatchObject({ outcome: 'NOT_FOUND' });

      // critère 3 : empreinte présentée ≠ celle du document ⇒ CONTRACT_HASH_MISMATCH, rien d'écrit
      expect(await sign(guest!, v1, sha('modifié'))).toMatchObject({
        outcome: 'CONTRACT_HASH_MISMATCH',
        signature_id: null,
      });
      expect(await sign(stranger!, v1, doc1)).toMatchObject({ outcome: 'NOT_FOUND' });
      expect(await signatures()).toEqual([]);

      // signature : heure SERVEUR (horloge de la base), sceau du bloc de signature, C2 retenues
      const s = await sign(guest!, v1, doc1);
      expect(s).toMatchObject({ outcome: 'SIGNED' });
      expect(s!['signed_at']).toEqual(new Date(T2));
      const seal = createHash('sha256')
        .update(
          ['ctr.seal/1', doc1.toString('hex'), s!['signature_id'], 'GUEST', T2].join('|'),
          'utf8',
        )
        .digest('hex');
      expect(s!['seal_sha256']).toBe(seal);
      expect(await signatures()).toEqual([
        expect.objectContaining({
          id: s!['signature_id'],
          document_id: v1,
          signer_user_id: guest!.id,
          signer_role: 'GUEST',
          method: 'CLICKWRAP',
          document_sha256: doc1.toString('hex'),
          seal_sha256: seal,
          ip_enc: null,
          user_agent_enc: null,
          c2_withheld: true,
        }),
      ]);
      // rejeu : la signature d'origine
      expect(await sign(guest!, v1, doc1)).toMatchObject({
        outcome: 'ALREADY_SIGNED',
        signature_id: s!['signature_id'],
        seal_sha256: seal,
      });
      const signedEvents = await inTx(api, {}, async (tx) =>
        (await tx.query<Json>('SELECT * FROM test_fixture.us211_events($1)', [trip])).rows.filter(
          (e) => e['type'] === 'contract.document.signed',
        ),
      );
      expect(signedEvents).toEqual([
        expect.objectContaining({
          aggregate_id: v1,
          actor_role: 'GUEST',
          actor_user_id: guest!.id,
        }),
      ]);

      // seconde version : la v1 signée reste consultable ; la v2 doit être signée à son tour
      const v2 = await inTx(
        api,
        { virtualNow: T2, commit: true },
        async (tx) =>
          (
            await tx.query<{ document_id: string }>(
              'SELECT * FROM test_fixture.us211_document($1, $2, $3)',
              [trip, doc2, 'fixture:2'],
            )
          ).rows[0]!.document_id,
      );
      expect(await read(guest!, 1)).toEqual([
        expect.objectContaining({
          outcome: 'OK',
          version: 1,
          latest_version: 2,
          signature_id: s!['signature_id'],
        }),
      ]);
      expect(await read(guest!)).toEqual([
        expect.objectContaining({ outcome: 'OK', version: 2, document_id: v2, signature_id: null }),
      ]);
      expect(await read(guest!, 3)).toEqual([expect.objectContaining({ outcome: 'NOT_FOUND' })]);
      expect(await sign(guest!, v2, doc1)).toMatchObject({ outcome: 'CONTRACT_HASH_MISMATCH' });
      // troisième version avant toute signature de la v2 : la v2 n'est plus signable
      const doc3 = sha(`doc3-${trip}`);
      const v3 = await inTx(
        api,
        { virtualNow: T2, commit: true },
        async (tx) =>
          (
            await tx.query<{ document_id: string }>(
              'SELECT * FROM test_fixture.us211_document($1, $2, $3)',
              [trip, doc3, 'fixture:3'],
            )
          ).rows[0]!.document_id,
      );
      expect(await sign(guest!, v2, doc2)).toMatchObject({
        outcome: 'CONTRACT_SUPERSEDED',
        signature_id: null,
      });
      // entrées mal formées ; document inconnu du trip
      expect(await sign(guest!, v3, doc3.subarray(0, 31))).toMatchObject({
        outcome: 'REQUEST_INVALID',
      });
      expect(await sign(guest!, uuid(), doc3)).toMatchObject({ outcome: 'NOT_FOUND' });
      expect((await signatures()).map((x) => x['document_id'])).toEqual([v1]);

      const pickup = () =>
        inTx(worker, { worker: 'trip_lifecycle', virtualNow: at(slot.start, 5) }, async (tx) => {
          await tx.query(TRANSITION, [trip, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED']);
          return attempt(tx, TRANSITION, [trip, 'IN_PROGRESS', 'CHECKIN_VALIDATED']);
        });
      expect(await pickup()).toEqual({ ok: false, code: 'CONTRACT_NOT_SIGNED' });
      expect(await sign(guest!, v3, doc3)).toMatchObject({ outcome: 'SIGNED' });
      expect(await pickup()).toMatchObject({ ok: true });

      // trip remis (remise VALIDÉE) puis nouvelle version : plus de signature possible
      await inTx(
        worker,
        { worker: 'trip_lifecycle', virtualNow: at(slot.start, 5), commit: true },
        async (tx) => {
          await tx.query(TRANSITION, [trip, 'CHECKIN_OPEN', 'CHECKIN_WINDOW_OPENED']);
          await tx.query(TRANSITION, [trip, 'IN_PROGRESS', 'CHECKIN_VALIDATED']);
        },
      );
      const doc4 = sha(`doc4-${trip}`);
      const v4 = await inTx(
        api,
        { virtualNow: T2, commit: true },
        async (tx) =>
          (
            await tx.query<{ document_id: string }>(
              'SELECT * FROM test_fixture.us211_document($1, $2, $3)',
              [trip, doc4, 'fixture:4'],
            )
          ).rows[0]!.document_id,
      );
      expect(await sign(guest!, v4, doc4)).toMatchObject({
        outcome: 'NOT_SIGNABLE',
        signature_id: null,
      });
    } finally {
      await releaseClient(worker);
      await releaseClient(api);
    }
  });
});

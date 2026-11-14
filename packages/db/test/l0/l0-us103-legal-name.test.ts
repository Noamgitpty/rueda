/**
 * Preuves du nom légal identique au permis (US-103, migration 0088, ADR-117 ; fixtures 9966, 9996,
 * 9984) sous le rôle de production app_api (assertion L0-05 en tête de chaque connexion,
 * withRole), au Panama (USD) et au Paraguay (PYG). Chaque test crée ses propres personnes par les
 * VRAIES commandes (inscription avec consentements, consentement biométrique, ouverture, session
 * hébergée, rappel du fournisseur, changement du nom) ; le téléphone vérifié est posé par la
 * fixture 9996 (raison : passation US-105).
 *
 * Attendus tirés de 19 US-103 (« Given un compte approuvé, When le nom change, Then SM-3 passe
 * RECHECK et la remise est bloquée » ; « Given un contrat généré, When on le compare au compte,
 * Then nom identique caractère pour caractère »), de 16 ACC-006 (deux apellidos ; nom différent
 * du permis ⇒ revue ; `PROFILE_NAME_REQUIRED`, `PROFILE_NAME_LOCKED_PENDING_REVIEW`), de 08
 * BR-ACC-07, de 17 §4.5 et de la règle de rapprochement écrite dans ADR-117 (DEC-FONDATEUR-22 :
 * tolérance aux écarts courants en Amérique latine), jamais du code testé. Les noms sont des
 * noms latino-américains et brésiliens réalistes, fictifs.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import {
  checks,
  claim,
  decide,
  isoDay,
  itemsOf,
  licence,
  one,
  PROVIDER,
  staff,
  toReview,
  uuid,
} from '../support/kyc.ts';
import type { LegalName, Person } from '../support/kyc.ts';

const byCountry = COUNTRIES.map((c) => [c.country, c.currency] as const);
const PURPOSE = 'Instruction du dossier KYC assigné';

const fixture = async <T extends pg.QueryResultRow>(c: pg.ClientBase, fn: string, arg: unknown) =>
  (await c.query<T>(`SELECT * FROM test_fixture.${fn}($1)`, [arg])).rows;

interface VerificationRow {
  readonly id: string;
  readonly status: string;
  readonly attempt: number;
  readonly provider_session_ref: string | null;
  readonly decision_reason_code: string | null;
  readonly approved_at: Date | null;
  readonly expires_at: Date | null;
}
const current = async (c: pg.ClientBase, userId: string): Promise<VerificationRow> =>
  (await fixture<VerificationRow & pg.QueryResultRow>(c, 'us105_verification', userId)).at(
    -1,
  ) as VerificationRow;

interface DocumentRow {
  readonly attempt: number;
  readonly status: string;
  readonly holder_given_names: string | null;
  readonly holder_surnames: string | null;
  readonly name_match: string | null;
}
const documents = (c: pg.ClientBase, userId: string) =>
  fixture<DocumentRow & pg.QueryResultRow>(c, 'us103_documents', userId);

/** Nom lu sur le permis par le fournisseur (champs du port, ADR-117). */
const named = (country: string, given: string | null, surnames: string | null) =>
  licence(country, isoDay(400), { holderGivenNames: given, holderSurnames: surnames });

const change = (c: pg.ClientBase, token: Buffer, first: string, last: string) =>
  one<{ outcome: string; status: string | null }>(
    c,
    'SELECT * FROM core.kyc_cmd_change_legal_name($1, $2, $3)',
    [token, first, last],
  );

const eligibility = (c: pg.ClientBase, token: Buffer, country: string) =>
  one<{ outcome: string }>(c, 'SELECT * FROM core.kyc_driver_eligibility($1, $2, $3)', [
    token,
    new Date(Date.now() + 3 * 86_400_000).toISOString(),
    country,
  ]);

/** Personne approuvée par le fournisseur, nom déclaré `names`, permis au nom `given surnames`. */
async function approved(
  c: pg.ClientBase,
  country: string,
  names: LegalName,
  given: string,
  surnames: string,
) {
  const r = await toReview(c, country, {
    decision: 'APPROVED',
    names,
    document: named(country, given, surnames),
  });
  expect((await current(c, r.userId)).status).toBe('APPROVED');
  return r;
}

/** Nouvelle vérification (dossier `RECHECK`) : ouverture, session, rappel « approved ». */
async function verifyAgain(
  c: pg.ClientBase,
  p: Person,
  country: string,
  document: Record<string, unknown>,
): Promise<{ outcome: string; status: string }> {
  const o = await one<{ outcome: string; verification_id: string; attempt: number }>(
    c,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  expect(o.outcome).toBe('READY');
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  const s = await one<{ outcome: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_record_session($1, $2, $3, $4, $5, $6, $7)',
    [
      p.token,
      o.verification_id,
      o.attempt,
      PROVIDER,
      sessionRef,
      `https://identity.fake.invalid/session/${sessionRef}`,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    ],
  );
  expect(s.outcome).toBe('RECORDED');
  return one<{ outcome: string; status: string }>(
    c,
    'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [
      PROVIDER,
      `evt_${randomBytes(6).toString('hex')}`,
      sessionRef,
      o.verification_id,
      'APPROVED',
      0.97,
      0.93,
      JSON.stringify(document),
    ],
  );
}

/**
 * Règle de rapprochement d'ADR-117 (PROPOSÉ), cas écrits à la main : [nom déclaré (prénoms, noms),
 * nom lu sur le permis (prénoms, noms), verdict attendu].
 */
const RULE_CASES: readonly (readonly [
  string,
  string,
  string | null,
  string | null,
  'MATCH' | 'MISMATCH' | 'MISSING',
  string,
])[] = [
  ['Ana', 'Pérez', 'Ana', 'Pérez', 'MATCH', 'identique'],
  ['ana', 'PEREZ', 'ANA', 'PÉREZ', 'MATCH', 'casse et accents'],
  ['Ñandú', 'Núñez', 'NANDU', 'NUNEZ', 'MATCH', 'tilde et accents absents du permis'],
  ['Juan', 'Pérez', 'Juan Carlos', 'Pérez Gómez', 'MATCH', 'sans deuxième prénom, paterno seul'],
  ['Juan Carlos', 'Gómez', 'Juan Carlos', 'Pérez Gómez', 'MATCH', 'materno seul'],
  [
    'María José',
    'Fernández de la Cruz',
    'MARÍA JOSÉ',
    'FERNÁNDEZ DE LA CRUZ',
    'MATCH',
    'particules',
  ],
  [
    'María José',
    'Fernández Cruz',
    'María José',
    'Fernández de la Cruz',
    'MATCH',
    'particules omises',
  ],
  ['José', 'del Valle', 'José', 'Del Valle Rivas', 'MATCH', 'particule « del »'],
  ['Ana', 'Pérez y Gómez', 'Ana', 'Pérez Gómez', 'MATCH', 'conjonction « y »'],
  ['João', 'Silva', 'João Pedro', 'da Silva Santos', 'MATCH', 'Brésil : « da », un seul sobrenome'],
  ['Sofía', 'González-Benítez', 'Sofía', 'González Benítez', 'MATCH', 'tiret'],
  ['Juan Pérez', 'Gómez', 'Juan', 'Pérez Gómez', 'MATCH', 'nom saisi dans le champ du prénom'],
  [
    'María Ángeles',
    'D’Ávila de la Peña-Núñez',
    'MARIA ANGELES',
    'DAVILA DE LA PENA NUNEZ',
    'MATCH',
    'apostrophe et tiret',
  ],
  ['Luiz', "O'Neill", 'Luiz', 'ONEILL', 'MATCH', 'apostrophe droite'],
  ['Ana', 'Pérez', 'Ana', 'Gómez Ruiz', 'MISMATCH', 'autre nom de famille'],
  ['Carlos', 'Pérez', 'Juan', 'Pérez Gómez', 'MISMATCH', 'autre prénom'],
  ['Juan', 'Pérez Gómez Ruiz', 'Juan', 'Pérez Gómez', 'MISMATCH', 'nom de famille en plus'],
  ['Pérez', 'Gómez', 'Juan', 'Pérez Gómez', 'MISMATCH', 'aucun prénom du permis'],
  ['Juan', 'Carlos', 'Juan Carlos', 'Pérez', 'MISMATCH', 'aucun nom de famille du permis'],
  ['Ana', 'Peres', 'Ana', 'Pérez', 'MISMATCH', 'une lettre changée'],
  ['Ana', 'Pérez', null, 'Pérez', 'MISSING', 'prénoms absents du permis'],
  ['Ana', 'Pérez', 'Ana', null, 'MISSING', 'noms absents du permis'],
  ['Ana', 'Pérez', '  ', 'Pérez', 'MISSING', 'prénoms vides'],
  ['Ana', 'Pérez', 'Ана', 'Петрова', 'MISSING', 'écriture non latine : non lisible'],
];

describe('US-103 — règle de rapprochement du nom (ADR-117, PROPOSÉ)', () => {
  it.each(RULE_CASES)(
    '« %s %s » contre le permis « %s %s » : %s (%s)',
    async (first, last, given, surnames, expected) => {
      await withRole('app_api', async (c) => {
        const r = await one<{ v: string }>(
          c,
          'SELECT test_fixture.us103_name_match($1, $2, $3, $4) AS v',
          [first, last, given, surnames],
        );
        expect(r.v).toBe(expected);
      });
    },
  );

  it('clé du signal SAME_IDENTITY : mots normalisés triés, particules retirées', async () => {
    await withRole('app_api', async (c) => {
      const key = (g: string, s: string) =>
        one<{ k: string }>(c, 'SELECT test_fixture.us103_name_key($1, $2) AS k', [g, s]);
      expect((await key('María José', 'Núñez de la Cruz')).k).toBe('jose maria|cruz nunez');
      expect((await key('JOSÉ  MARÍA', 'Cruz-Núñez')).k).toBe('jose maria|cruz nunez');
    });
  });
});

describe('US-103 — décision du fournisseur : nom du compte rapproché du nom du permis', () => {
  it.each(byCountry)(
    '%s (%s) : noms concordants (deux apellidos, particules, deuxième prénom, accents) ⇒ APPROVED sans revue',
    async (country) => {
      await withRole('app_api', async (c) => {
        for (const [names, given, surnames] of [
          [
            { first: 'María José', last: 'Fernández de la Cruz' },
            'MARIA JOSE',
            'FERNANDEZ DE LA CRUZ',
          ],
          [{ first: 'Juan', last: 'Gómez' }, 'Juan Carlos', 'Pérez Gómez'],
          [{ first: 'Luiz', last: 'Souza' }, 'Luiz Fernando', 'de Souza Oliveira'],
        ] as const) {
          const r = await approved(c, country, names, given, surnames);
          expect(await documents(c, r.userId)).toEqual([
            {
              attempt: 1,
              status: 'ACCEPTED',
              holder_given_names: given,
              holder_surnames: surnames,
              name_match: 'MATCH',
            },
          ]);
          // aucune revue humaine : aucun élément dans la file KYC
          expect(await itemsOf(c, r.userId)).toEqual([]);
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : vraie discordance ⇒ MANUAL_REVIEW LEGAL_NAME_MISMATCH, file KYC (US-106), nom du permis montré à l’ops qui peut approuver ; aucun nom dans les événements',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country, {
          decision: 'APPROVED',
          names: { first: 'Ana', last: 'Pérez' },
          document: named(country, 'Rosa Elena', 'Benítez Ruiz'),
        });
        expect(await current(c, r.userId)).toMatchObject({
          status: 'MANUAL_REVIEW',
          decision_reason_code: 'LEGAL_NAME_MISMATCH',
          approved_at: null,
        });
        expect(await documents(c, r.userId)).toMatchObject([
          { status: 'IN_REVIEW', name_match: 'MISMATCH', holder_surnames: 'Benítez Ruiz' },
        ]);
        // 17 §4.5 : transition journalisée avec son motif, jamais un nom
        const events = await fixture<{ type: string; payload: Record<string, unknown> }>(
          c,
          'us105_events',
          r.verificationId,
        );
        expect(events.at(-1)?.payload).toMatchObject({
          from: 'AUTO_CHECKS',
          to: 'MANUAL_REVIEW',
          reason_code: 'LEGAL_NAME_MISMATCH',
        });
        expect(JSON.stringify(events)).not.toMatch(/Rosa|Benítez|Pérez|Ana/);

        // file KYC existante (US-106) : un élément ouvert ; l'ops voit le nom lu et le verdict
        const [item] = await itemsOf(c, r.userId);
        expect(item).toMatchObject({ status: 'OPEN', country_code: country });
        const ops = await staff(c, 'OPS_AGENT', [country], country);
        expect((await claim(c, ops, item?.id ?? '')).outcome).toBe('CLAIMED');
        const d = await one<{ outcome: string; body: Record<string, unknown> }>(
          c,
          'SELECT * FROM core.support_staff_kyc_dossier($1, $2, $3, $4)',
          [ops.hash, uuid(), item?.id, PURPOSE],
        );
        expect(d.outcome).toBe('GRANTED');
        expect(d.body).toMatchObject({
          legalFirstName: 'Ana',
          legalLastName: 'Pérez',
          verification: {
            reasonCode: 'LEGAL_NAME_MISMATCH',
            document: {
              holderGivenNames: 'Rosa Elena',
              holderSurnames: 'Benítez Ruiz',
              nameMatch: 'MISMATCH',
            },
          },
        });
        // une personne honnête (nom d'usage légitime) n'est pas bloquée : l'ops tranche
        expect((await decide(c, ops, r.verificationId, checks('APPROVED'))).outcome).toBe('DONE');
        expect((await current(c, r.userId)).status).toBe('APPROVED');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : nom absent ou illisible sur le permis ⇒ MANUAL_REVIEW LEGAL_NAME_MISSING (fail-closed)',
    async (country) => {
      await withRole('app_api', async (c) => {
        for (const document of [
          named(country, null, null),
          named(country, 'Ana María', ''),
          named(country, 'x'.repeat(201), 'Pérez'),
          named(country, 'Ana\u0007', 'Pérez'),
          licence(country, isoDay(400), { holderGivenNames: 7, holderSurnames: ['Pérez'] }),
        ]) {
          const r = await toReview(c, country, { decision: 'APPROVED', document });
          expect(await current(c, r.userId)).toMatchObject({
            status: 'MANUAL_REVIEW',
            decision_reason_code: 'LEGAL_NAME_MISSING',
          });
          expect(await documents(c, r.userId)).toMatchObject([
            { status: 'IN_REVIEW', name_match: 'MISSING' },
          ]);
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : un motif du permis passe avant le nom (permis expiré, provisoire, fournisseur en revue)',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country, {
          decision: 'APPROVED',
          document: licence(country, isoDay(400), {
            isPermanent: false,
            holderGivenNames: 'Rosa',
            holderSurnames: 'Benítez',
          }),
        });
        expect((await current(c, r.userId)).decision_reason_code).toBe('LICENSE_PROVISIONAL');
        const v = await toReview(c, country, {
          decision: 'REVIEW',
          document: named(country, null, null),
        });
        expect((await current(c, v.userId)).decision_reason_code).toBe('PROVIDER_REVIEW');
      });
    },
  );
});

describe('US-103 critère 1 — changement du nom d’un compte approuvé', () => {
  it.each(byCountry)(
    '%s (%s) : SM-3 passe RECHECK, paiement et remise refusés, nouvelle vérification rapprochant le NOUVEAU nom ; audit sans nom',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await approved(
          c,
          country,
          { first: 'Ana', last: 'Pérez' },
          'Ana María',
          'Pérez Gómez',
        );
        const before = await current(c, r.userId);
        expect((await eligibility(c, r.token, country)).outcome).toBe('ELIGIBLE');

        expect(await change(c, r.token, 'Ana María', 'Pérez Gómez')).toEqual({
          outcome: 'CHANGED',
          status: 'RECHECK',
        });
        expect(await current(c, r.userId)).toMatchObject({
          id: before.id,
          status: 'RECHECK',
          decision_reason_code: 'LEGAL_NAME_CHANGED',
          attempt: before.attempt + 1,
          provider_session_ref: null,
          approved_at: null,
          expires_at: null,
        });
        // la remise (contrôle du permis par l'hôte) et le paiement lisent la même éligibilité
        expect((await eligibility(c, r.token, country)).outcome).toBe('KYC_NOT_APPROVED');
        const events = await fixture<{ actor_role: string; payload: Record<string, unknown> }>(
          c,
          'us105_events',
          r.verificationId,
        );
        expect(events.at(-1)).toMatchObject({
          actor_role: 'GUEST',
          payload: { from: 'APPROVED', to: 'RECHECK', reason_code: 'LEGAL_NAME_CHANGED' },
        });
        const audit = await fixture<{ action_code: string }>(c, 'us103_audit', r.userId);
        expect(audit).toEqual([
          {
            action_code: 'LEGAL_NAME_CHANGED',
            actor_role: 'GUEST',
            before: { status: 'APPROVED' },
            after: { status: 'RECHECK' },
          },
        ]);
        expect(JSON.stringify([events, audit])).not.toMatch(/Ana|Pérez|Gómez|María/);

        // nouvelle vérification : le permis lu porte « Rosa Benítez » ⇒ discordance, en revue
        expect(await verifyAgain(c, r, country, named(country, 'Rosa', 'Benítez'))).toEqual({
          outcome: 'APPLIED',
          status: 'MANUAL_REVIEW',
        });
        expect((await current(c, r.userId)).decision_reason_code).toBe('LEGAL_NAME_MISMATCH');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : nouvelle vérification au nom du permis ⇒ APPROVED de nouveau',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await approved(
          c,
          country,
          { first: 'Juan', last: 'Gómez' },
          'Juan',
          'Gómez Ríos',
        );
        expect((await change(c, r.token, 'Juan', 'Gómez Ríos')).status).toBe('RECHECK');
        expect(await verifyAgain(c, r, country, named(country, 'JUAN', 'GOMEZ RIOS'))).toEqual({
          outcome: 'APPLIED',
          status: 'APPROVED',
        });
        expect((await eligibility(c, r.token, country)).outcome).toBe('ELIGIBLE');
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : décision en cours ⇒ LOCKED_PENDING_REVIEW ; nom vide ⇒ NAME_REQUIRED ; même nom ⇒ UNCHANGED ; avant toute vérification ⇒ CHANGED sans RECHECK',
    async (country) => {
      await withRole('app_api', async (c) => {
        // en revue (file KYC) : nom verrouillé jusqu'à la décision, rien n'est écrit
        const inReview = await toReview(c, country);
        expect(await change(c, inReview.token, 'Rosa', 'Benítez')).toEqual({
          outcome: 'LOCKED_PENDING_REVIEW',
          status: 'MANUAL_REVIEW',
        });
        expect(
          await fixture<{ legal_first_name: string }>(c, 'us103_account_name', inReview.userId),
        ).toMatchObject([{ legal_first_name: 'Ana', legal_last_name: 'Pérez' }]);
        expect(await fixture(c, 'us103_audit', inReview.userId)).toEqual([]);

        const r = await approved(c, country, { first: 'Ana', last: 'Pérez' }, 'Ana', 'Pérez');
        for (const [first, last] of [
          ['   ', 'Pérez'],
          ['Ana', ''],
          ['x'.repeat(101), 'Pérez'],
          ['Ana\u0001', 'Pérez'],
          ['Ana', 'Pé\u007frez'],
        ] as const) {
          expect(await change(c, r.token, first, last)).toEqual({
            outcome: 'NAME_REQUIRED',
            status: null,
          });
        }
        // même nom, espaces de bord et doubles : rien n'est écrit, le dossier reste approuvé
        expect(await change(c, r.token, '  Ana ', 'Pérez')).toEqual({
          outcome: 'UNCHANGED',
          status: 'APPROVED',
        });
        expect((await current(c, r.userId)).status).toBe('APPROVED');
        expect(await fixture(c, 'us103_audit', r.userId)).toEqual([]);
        expect(await change(c, Buffer.alloc(32), 'Rosa', 'Benítez')).toEqual({
          outcome: 'AUTH_REQUIRED',
          status: null,
        });
      });
    },
  );
});

describe('US-103 critère 2 — nom gardé caractère pour caractère', () => {
  it.each(byCountry)(
    '%s (%s) : nom enregistré tel que saisi (accents, particules, apostrophe, tiret), jamais réécrit par le rapprochement',
    async (country) => {
      await withRole('app_api', async (c) => {
        const names = { first: 'María Ángeles', last: 'D’Ávila de la Peña-Núñez' };
        const r = await toReview(c, country, {
          decision: 'APPROVED',
          names,
          document: named(country, 'MARIA ANGELES', 'DAVILA DE LA PENA NUNEZ'),
        });
        const account = async () =>
          (
            await fixture<{ first_utf8: Buffer; last_utf8: Buffer }>(
              c,
              'us103_account_name',
              r.userId,
            )
          )[0];
        // le nom que reprendront le contrat et le contrôle de remise : octet pour octet
        expect(await account()).toMatchObject({
          first_utf8: Buffer.from(names.first, 'utf8'),
          last_utf8: Buffer.from(names.last, 'utf8'),
        });
        // changement : espaces de bord retirés, espaces internes réduits, caractères gardés
        const approvedOne = await approved(
          c,
          country,
          { first: 'Ana', last: 'Pérez' },
          'Ana Lucía',
          'Pérez Ñáñez',
        );
        expect((await change(c, approvedOne.token, ' Ana   Lucía ', 'Pérez  Ñáñez')).outcome).toBe(
          'CHANGED',
        );
        expect(
          (
            await fixture<{ first_utf8: Buffer; last_utf8: Buffer }>(
              c,
              'us103_account_name',
              approvedOne.userId,
            )
          )[0],
        ).toMatchObject({
          first_utf8: Buffer.from('Ana Lucía', 'utf8'),
          last_utf8: Buffer.from('Pérez Ñáñez', 'utf8'),
        });
      });
    },
  );
});

describe('US-103 — seule la commande KYC écrit le nom légal (RLS, droits de colonne)', () => {
  it('aucun rôle applicatif ni autre propriétaire de commandes ne peut modifier le nom légal', async () => {
    await withRole('app_api', async (c) => {
      const { rows } = await c.query<{ role: string; first: boolean; last: boolean }>(
        `SELECT r AS role,
                pg_catalog.has_column_privilege(r::name, 'core.iam_user_account', 'legal_first_name', 'UPDATE') AS first,
                pg_catalog.has_column_privilege(r::name, 'core.iam_user_account', 'legal_last_name', 'UPDATE') AS last
           FROM pg_catalog.unnest($1::text[]) AS r
          ORDER BY r`,
        [
          [
            'app_api',
            'app_worker',
            'app_anon',
            'iam_auth_owner',
            'iam_staff_owner',
            'risk_limit_owner',
            'kyc_cmd_owner',
          ],
        ],
      );
      expect(rows).toEqual(
        [
          { role: 'app_anon', first: false, last: false },
          { role: 'app_api', first: false, last: false },
          { role: 'app_worker', first: false, last: false },
          { role: 'iam_auth_owner', first: false, last: false },
          { role: 'iam_staff_owner', first: false, last: false },
          { role: 'kyc_cmd_owner', first: true, last: true },
          { role: 'risk_limit_owner', first: false, last: false },
        ].sort((a, b) => a.role.localeCompare(b.role)),
      );
      // le nom lu sur le permis [C2] n'est lisible par aucun rôle applicatif
      const { rows: doc } = await c.query<{ r: string; ok: boolean }>(
        `SELECT r, pg_catalog.has_column_privilege(r::name, 'core.kyc_identity_document',
                                                  'holder_surnames', 'SELECT') AS ok
           FROM pg_catalog.unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r`,
      );
      expect(doc.every((x) => !x.ok)).toBe(true);
    });
  });
});

describe('US-103 — index du chemin de la pose (signal d’auto-réservation, ADR-110, ADR-117)', () => {
  it('titulaire des comptes d’hôte, membres vivants et vérification approuvée sont indexés', async () => {
    await withRole('app_api', async (c) => {
      const { rows } = await c.query<{ name: string; def: string }>(
        `SELECT cl.relname::text AS name, pg_catalog.pg_get_indexdef(i.indexrelid) AS def
           FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class cl ON cl.oid = i.indexrelid
          WHERE cl.relname = ANY ($1::text[])`,
        [
          [
            'iam_organization_holder_idx',
            'membership_org_live_idx',
            'kyc_identity_verification_approved_user_idx',
          ],
        ],
      );
      const defs = Object.fromEntries(rows.map((r) => [r.name, r.def]));
      expect(defs['iam_organization_holder_idx']).toMatch(/iam_organization .*\(holder_user_id\)/);
      expect(defs['membership_org_live_idx']).toMatch(/\(org_id, user_id\) WHERE/);
      expect(defs['kyc_identity_verification_approved_user_idx']).toMatch(
        /\(user_id\) WHERE \(first_approved_at IS NOT NULL\)/,
      );
    });
  });
});

/** Attend que la connexion `pid` soit bloquée sur un verrou (verrou consultatif de la personne). */
async function blocked(c: pg.ClientBase, pid: number | undefined): Promise<boolean> {
  for (let k = 0; k < 100; k += 1) {
    const { rows } = await c.query<{ w: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity
                       WHERE pid = $1 AND wait_event_type = 'Lock') AS w`,
      [pid],
    );
    if (rows[0]?.w === true) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

describe('US-103 — entrelacement : changement du nom contre décision de l’ops (deux connexions)', () => {
  it.each(byCountry)(
    '%s (%s) : la décision APPROVED tient le verrou de la personne ; le changement attend, puis voit APPROVED et repasse le dossier en RECHECK',
    async (country) => {
      await withRole('app_api', async (c) => {
        const r = await toReview(c, country);
        const [item] = await itemsOf(c, r.userId);
        const ops = await staff(c, 'OPS_AGENT', [country], country);
        expect((await claim(c, ops, item?.id ?? '')).outcome).toBe('CLAIMED');
        const a = await connectAs('app_api');
        const b = await connectAs('app_api');
        try {
          // A : décision de l'ops dans une transaction ouverte (verrou de la personne tenu)
          await a.query('BEGIN');
          expect((await decide(a, ops, r.verificationId, checks('APPROVED'))).outcome).toBe('DONE');
          const pidB = (await b.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid'))
            .rows[0]?.pid;
          // B : changement du nom lancé pendant ce temps : bloqué, jamais jugé sur l'état d'avant
          const pending = change(b, r.token, 'Ana María', 'Pérez Gómez');
          expect(await blocked(c, pidB)).toBe(true);
          await a.query('COMMIT');
          expect(await pending).toEqual({ outcome: 'CHANGED', status: 'RECHECK' });
          expect(await current(c, r.userId)).toMatchObject({
            status: 'RECHECK',
            decision_reason_code: 'LEGAL_NAME_CHANGED',
          });
        } finally {
          await a.query('ROLLBACK').catch(() => undefined);
          await releaseClient(a);
          await releaseClient(b);
        }
      });
    },
  );

  it.each(byCountry)(
    '%s (%s) : le changement tient le verrou ; la décision de l’ops attend, puis s’applique au dossier en revue (nom changé seulement hors revue)',
    async (country) => {
      await withRole('app_api', async (c) => {
        // A (changement, dossier en revue) prend le verrou et rend LOCKED_PENDING_REVIEW sans
        // rien écrire ; B (décision de l'ops) attend la fin de A, puis approuve le nom inchangé
        const r = await toReview(c, country);
        const [item] = await itemsOf(c, r.userId);
        const ops = await staff(c, 'OPS_AGENT', [country], country);
        expect((await claim(c, ops, item?.id ?? '')).outcome).toBe('CLAIMED');
        const a = await connectAs('app_api');
        const b = await connectAs('app_api');
        try {
          await a.query('BEGIN');
          expect(await change(a, r.token, 'Rosa', 'Benítez')).toEqual({
            outcome: 'LOCKED_PENDING_REVIEW',
            status: 'MANUAL_REVIEW',
          });
          const pidB = (await b.query<{ pid: number }>('SELECT pg_catalog.pg_backend_pid() AS pid'))
            .rows[0]?.pid;
          const pending = decide(b, ops, r.verificationId, checks('APPROVED'));
          expect(await blocked(c, pidB)).toBe(true);
          await a.query('COMMIT');
          expect((await pending).outcome).toBe('DONE');
          expect((await current(c, r.userId)).status).toBe('APPROVED');
          expect(
            await fixture<{ legal_first_name: string }>(c, 'us103_account_name', r.userId),
          ).toMatchObject([{ legal_first_name: 'Ana', legal_last_name: 'Pérez' }]);
        } finally {
          await a.query('ROLLBACK').catch(() => undefined);
          await releaseClient(a);
          await releaseClient(b);
        }
      });
    },
  );
});

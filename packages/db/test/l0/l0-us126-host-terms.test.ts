/**
 * Preuves des CGU de l'hôte versionnées (US-126, migration 0070) sous le rôle de PRODUCTION app_api
 * (assertion L0-05 en tête de chaque connexion, withRole), en USD (PA) et en PYG (PY). Chaque test
 * crée ses propres personnes, sessions, comptes d'hôte et annonces par les VRAIES commandes ; les
 * publications de versions se font dans une transaction annulée (base partagée).
 *
 * Attendus tirés de 19 US-126 (critères), de 16 LEG-001 / LEG-002 (« l'hôte accepte en plus les
 * CGU de l'hôte avant sa première annonce » ; « version majeure → ré-acceptation »), LEG-014
 * (intermédiaire, jamais bailleur ni partie au contrat), de 17 §3.2.6 (`document_template`,
 * `consent`), de 22 OQ-BR-24 (aucune décision « définitive et sans appel ») et du pré-mortem du
 * lot 1 (L1-PM-28 : garde dans la commande, consentement avec langue et horodatage serveur), jamais
 * du code testé ; l'empreinte du texte est recalculée par node:crypto (oracle indépendant du SQL) :
 * - critère 1 : CGU de l'hôte non acceptées, ou acceptées dans une version majeure dépassée ⇒
 *   la soumission d'une annonce rend TERMS_REACCEPT_REQUIRED et l'annonce reste DRAFT ;
 * - critère 2 : CGU servies avec version, date, langue (repli sur l'espagnol qui fait foi),
 *   BROUILLON ; aucune mention « definitiva e inapelable » ;
 * - critère 3 : l'acceptation crée un consentement TOS_HOST versionné (langue, horodatage de la
 *   base, contexte), refusé pour une version périmée ;
 * - portée : pays du compte d'hôte (document propre à un pays, commun ailleurs) ;
 * - IDOR (L1-PM-11) : compte d'hôte d'un autre, session inventée ; droits d'EXECUTE.
 */
import { createHash, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES, uuid } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newToken, phcArgon2id, SESSION_TTL_S } from '../support/iam.ts';
import { elevatedStaff, installTestProofKey } from '../support/staff.ts';

const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const T0 = '2031-06-02T09:30:00.000Z';
const ALL = COUNTRIES.map((c) => c.country);
const BODIES = {
  es: { title: 'Condiciones del anfitrión v2', body: 'Texto de prueba de la versión 2.' },
  en: { title: 'Host terms v2', body: 'Test text of version 2.' },
  fr: { title: 'Conditions de l’hôte v2', body: 'Texte d’essai de la version 2.' },
  pt: { title: 'Condições do anfitrião v2', body: 'Texto de teste da versão 2.' },
};
const byCountry = COUNTRIES.map((c) => [c.country, c.currency, c] as const);

beforeAll(async () => {
  await withRole('app_api', async (client) => {
    await installTestProofKey(client);
  });
});

interface Host {
  readonly userId: string;
  readonly hash: Buffer;
  readonly org: string;
}

async function session(client: pg.ClientBase, userId: string): Promise<Buffer> {
  const t = newToken();
  const { rows } = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!rows[0]?.expires_at) throw new Error('session refusée');
  return t.hash;
}

/** Personne inscrite (compte ACTIVE), session ouverte, compte d'hôte ouvert dans le pays. */
async function host(client: pg.ClientBase, country: string): Promise<Host> {
  const userId = uuid();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Pérez', 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [userId, `h126-${userId}@example.test`, phcArgon2id(), uuid(), randomBytes(32), country, DOCS],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  await client.query('SELECT test_fixture.iam_set_account_status($1, $2)', [userId, 'ACTIVE']);
  const hash = await session(client, userId);
  return { userId, hash, org: await openAccount(client, hash, country) };
}

async function openAccount(client: pg.ClientBase, hash: Buffer, country: string) {
  const { rows } = await client.query<{ outcome: string; org_id: string | null }>(
    'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
    [hash, country, 'INDIVIDUAL'],
  );
  if (rows[0]?.outcome !== 'DONE' || !rows[0].org_id) throw new Error('compte d’hôte refusé');
  return rows[0].org_id;
}

interface TermsRow {
  outcome: string;
  country_code: string | null;
  version: number | null;
  is_major: boolean | null;
  locale: string | null;
  title: string | null;
  content_hash: Buffer | null;
  is_draft: boolean | null;
  valid_from: Date | null;
  required_version: number | null;
  accepted_version: number | null;
  accepted_at: Date | null;
  reaccept_required: boolean | null;
}

const terms = async (c: pg.ClientBase, h: { hash: Buffer; org: string }, language = 'es') =>
  (
    await c.query<TermsRow>('SELECT * FROM core.ctr_host_terms($1, $2, $3)', [
      h.hash,
      h.org,
      language,
    ])
  ).rows[0];

const accept = async (
  c: pg.ClientBase,
  h: { hash: Buffer; org: string },
  version: number | null,
  language: string | null = 'es',
) =>
  (
    await c.query<{ outcome: string; version: number | null }>(
      'SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, $3, $4)',
      [h.hash, h.org, version, language],
    )
  ).rows[0];

const hostConsents = async (c: pg.ClientBase, hash: Buffer) =>
  (
    await c.query<{
      doc_kind: string;
      doc_version: number;
      locale: string;
      accepted: boolean;
      accepted_at: Date;
      context: string;
    }>('SELECT * FROM core.ctr_consent_history($1)', [hash])
  ).rows.filter((r) => r.doc_kind === 'TOS_HOST');

/** Annonce DRAFT complète (lieu, véhicule, six photos) : seule la garde des CGU reste à juger. */
async function completeDraft(client: pg.ClientBase, h: Host, c: CountryCase): Promise<string> {
  const loc = await client.query<{ outcome: string; location_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_location($1, $2, 'HOME', 'Casa', 'Calle 1', 'Ciudad',
                                                    'Zona', 8.9837, -79.5198)`,
    [h.hash, h.org],
  );
  const veh = await client.query<{ outcome: string; vehicle_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_vehicle($1, $2, $3, $4, NULL, NULL, 'Marca', 'Modelo',
                                                   2021, NULL, 'AUTOMATIC', 5::smallint,
                                                   'GASOLINE', 42000, false, false)`,
    [h.hash, h.org, loc.rows[0]?.location_id, `T${randomBytes(4).toString('hex').toUpperCase()}`],
  );
  const lst = await client.query<{ outcome: string; listing_id: string | null }>(
    `SELECT * FROM core.catalog_cmd_create_listing($1, $2, $3, $4, 'UNLIMITED', NULL, NULL, NULL)`,
    [h.hash, h.org, veh.rows[0]?.vehicle_id, 40 * c.priceStepMinor],
  );
  const listing = lst.rows[0]?.listing_id;
  if (!listing) {
    throw new Error(
      `préparation : ${loc.rows[0]?.outcome} ${veh.rows[0]?.outcome} ${lst.rows[0]?.outcome}`,
    );
  }
  for (let i = 0; i < 6; i += 1) {
    const p = await client.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
      [h.hash, h.org, listing, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    );
    if (p.rows[0]?.outcome !== 'DONE') throw new Error(`photo : ${p.rows[0]?.outcome}`);
  }
  return listing;
}

const submit = async (c: pg.ClientBase, h: Host, listing: string) =>
  (
    await c.query<{ outcome: string }>(
      'SELECT * FROM core.catalog_cmd_submit_listing($1, $2, $3)',
      [h.hash, h.org, listing],
    )
  ).rows[0]?.outcome;

const listingStatus = async (c: pg.ClientBase, listing: string) =>
  (
    await c.query<{ status: string; submitted_at: Date | null }>(
      'SELECT * FROM test_fixture.us115_listing_row($1)',
      [listing],
    )
  ).rows[0];

const publish = async (
  c: pg.ClientBase,
  hash: Buffer,
  options: { country?: string | null; major?: boolean } = {},
) =>
  (
    await c.query<{ outcome: string; version: number | null }>(
      `SELECT * FROM core.ctr_staff_cmd_publish_document($1, $2, 'TOS_HOST', $3, $4, NULL, NULL,
                                                         $5::jsonb)`,
      [hash, uuid(), options.country ?? null, options.major ?? true, JSON.stringify(BODIES)],
    )
  ).rows[0];

// ---------------------------------------------------------------------------------------------
describe('critère 2 — CGU de l’hôte servies : version, date, langue, es fait foi, BROUILLON', () => {
  it('graine : version 1 majeure BROUILLON commune, quatre langues, es seule langue qui fait foi ; empreinte = SHA-256 du texte (node:crypto)', async () => {
    await withRole('app_api', async (client) => {
      for (const country of [...ALL, null]) {
        for (const language of ['es', 'en', 'fr', 'pt']) {
          const { rows } = await client.query<{
            doc_kind: string;
            version: number;
            is_major: boolean;
            locale: string;
            title: string;
            body_md: string;
            content_hash: Buffer;
            is_draft: boolean;
            valid_from: Date;
          }>('SELECT * FROM core.ctr_document_body($1, $2, $3, NULL)', [
            'TOS_HOST',
            country,
            language,
          ]);
          const d = rows[0];
          expect(d, `${country ?? 'commun'} ${language}`).toMatchObject({
            doc_kind: 'TOS_HOST',
            version: 1,
            is_major: true,
            locale: language,
            is_draft: true,
          });
          expect(d?.valid_from).toBeInstanceOf(Date);
          expect(Buffer.from(d?.content_hash ?? []).toString('hex')).toBe(
            createHash('sha256')
              .update(d?.body_md ?? '', 'utf8')
              .digest('hex'),
          );
        }
      }
    });
  });

  it('textes : marqués BROUILLON « à valider », Kmino intermédiaire, jamais « definitiva e inapelable » (OQ-BR-24 ouverte)', async () => {
    await withRole('app_api', async (client) => {
      const marks: Record<string, RegExp> = {
        es: /BORRADOR/,
        en: /DRAFT/,
        fr: /BROUILLON/,
        pt: /RASCUNHO/,
      };
      const intermediary: Record<string, RegExp> = {
        es: /intermediaria/,
        en: /intermediary/,
        fr: /intermédiaire/,
        pt: /intermediária/,
      };
      const prevails: Record<string, RegExp> = {
        es: /El texto en español hace fe\./,
        en: /The Spanish text prevails\./,
        fr: /Le texte espagnol fait foi\./,
        pt: /O texto em espanhol prevalece\./,
      };
      for (const language of ['es', 'en', 'fr', 'pt']) {
        const { rows } = await client.query<{ title: string; body_md: string }>(
          'SELECT title, body_md FROM core.ctr_document_body($1, NULL, $2, 1)',
          ['TOS_HOST', language],
        );
        const d = rows[0];
        expect(d?.title).toMatch(marks[language] as RegExp);
        expect(d?.body_md).toMatch(marks[language] as RegExp);
        expect(d?.body_md).toMatch(intermediary[language] as RegExp);
        expect(d?.body_md).toMatch(prevails[language] as RegExp);
        expect(d?.body_md.toLowerCase()).not.toMatch(
          /inapelable|definitiva e|sans appel|without appeal|final and binding|irrecorr[ií]vel|sem recurso/,
        );
      }
    });
  });

  it.each(byCountry)(
    '%s (%s) : langue inconnue ⇒ repli sur l’espagnol qui fait foi (locale rendue) ; version future illisible',
    async (country) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const t = await terms(client, h, 'de');
        expect(t).toMatchObject({ outcome: 'OK', country_code: country, version: 1, locale: 'es' });
        const none = await client.query('SELECT * FROM core.ctr_document_body($1, $2, $3, 99)', [
          'TOS_HOST',
          country,
          'es',
        ]);
        expect(none.rows).toEqual([]);
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('critère 1 — CGU de l’hôte non acceptées ⇒ TERMS_REACCEPT_REQUIRED à la soumission', () => {
  it.each(byCountry)(
    '%s (%s) : jamais acceptées ⇒ TERMS_REACCEPT_REQUIRED, l’annonce reste DRAFT ; acceptées ⇒ la soumission passe la garde (étape suivante : HOST_NOT_ACTIVATED)',
    async (country, _currency, c) => {
      await withRole('app_api', async (client) => {
        const h = await host(client, country);
        const listing = await completeDraft(client, h, c);
        expect(await terms(client, h)).toMatchObject({
          outcome: 'OK',
          country_code: country,
          version: 1,
          required_version: 1,
          accepted_version: null,
          accepted_at: null,
          reaccept_required: true,
          is_draft: true,
        });
        expect(await submit(client, h, listing)).toBe('TERMS_REACCEPT_REQUIRED');
        expect(await listingStatus(client, listing)).toMatchObject({
          status: 'DRAFT',
          submitted_at: null,
        });
        expect(await accept(client, h, 1)).toEqual({ outcome: 'DONE', version: 1 });
        expect(await terms(client, h)).toMatchObject({
          accepted_version: 1,
          reaccept_required: false,
        });
        // garde passée : l'étape suivante (compte ONBOARDING, pays fermé) refuse encore
        expect(await submit(client, h, listing)).toBe('HOST_NOT_ACTIVATED');
        expect((await listingStatus(client, listing))?.status).toBe('DRAFT');
      });
    },
  );

  it('version MAJEURE publiée ⇒ réacceptation exigée (TERMS_REACCEPT_REQUIRED) ; version périmée refusée ; mineure ⇒ rien', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const [pa] = COUNTRIES;
      await withTestTransaction(client, {}, async (tx) => {
        const h = await host(tx, pa.country);
        const listing = await completeDraft(tx, h, pa);
        expect((await accept(tx, h, 1))?.outcome).toBe('DONE');
        const major = await publish(tx, admin.hash, { major: true });
        expect(major).toEqual({ outcome: 'PUBLISHED', version: 2 });
        expect(await terms(tx, h)).toMatchObject({
          version: 2,
          required_version: 2,
          accepted_version: 1,
          reaccept_required: true,
        });
        expect(await submit(tx, h, listing)).toBe('TERMS_REACCEPT_REQUIRED');
        // version affichée périmée : refus, rien n'est écrit
        expect(await accept(tx, h, 1)).toEqual({ outcome: 'TERMS_VERSION_CHANGED', version: 2 });
        expect(await hostConsents(tx, h.hash)).toHaveLength(1);
        expect(await accept(tx, h, 2, 'pt')).toEqual({ outcome: 'DONE', version: 2 });
        const rows = await hostConsents(tx, h.hash);
        expect(rows[0]).toMatchObject({ doc_version: 2, locale: 'pt', context: 'REACCEPT' });
        expect(rows[1]).toMatchObject({ doc_version: 1, context: 'HOST_ONBOARDING' });
        expect(await submit(tx, h, listing)).toBe('HOST_NOT_ACTIVATED');
        // mineure : en vigueur, sans réacceptation exigée
        const minor = await publish(tx, admin.hash, { major: false });
        expect(minor).toEqual({ outcome: 'PUBLISHED', version: 3 });
        expect(await terms(tx, h)).toMatchObject({
          version: 3,
          required_version: 2,
          accepted_version: 2,
          reaccept_required: false,
        });
        expect(await submit(tx, h, listing)).toBe('HOST_NOT_ACTIVATED');
      });
    });
  });

  it('portée = pays du compte d’hôte : document propre au premier pays ⇒ réacceptation là seulement ; l’autre compte de la même personne reste à jour', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const [first, second] = COUNTRIES;
      await withTestTransaction(client, {}, async (tx) => {
        const h1 = await host(tx, first.country);
        const h2 = { ...h1, org: await openAccount(tx, h1.hash, second.country) };
        // documents communs : une acceptation vaut pour les deux comptes
        expect((await accept(tx, h1, 1))?.outcome).toBe('DONE');
        expect((await terms(tx, h2))?.reaccept_required).toBe(false);
        const own = await publish(tx, admin.hash, { country: first.country, major: true });
        expect(own).toEqual({ outcome: 'PUBLISHED', version: 1 });
        // le document propre au pays porte le numéro 1 : seul le genre et le pays du gabarit
        // accepté comptent, jamais l'entier de version seul
        expect(await terms(tx, h1)).toMatchObject({
          country_code: first.country,
          version: 1,
          accepted_version: null,
          reaccept_required: true,
        });
        expect(await terms(tx, h2)).toMatchObject({
          country_code: second.country,
          accepted_version: 1,
          reaccept_required: false,
        });
        expect(await accept(tx, h1, 1, 'en')).toEqual({ outcome: 'DONE', version: 1 });
        expect((await terms(tx, h1))?.reaccept_required).toBe(false);
        const rows = await hostConsents(tx, h1.hash);
        expect(rows[0]).toMatchObject({ locale: 'en', context: 'REACCEPT' });
      });
    });
  });
});

// ---------------------------------------------------------------------------------------------
describe('critère 3 — acceptation : consentement TOS_HOST versionné (langue, horodatage serveur, contexte)', () => {
  it.each(byCountry)(
    '%s (%s) : version exacte, langue affichée, platform.now(), HOST_ONBOARDING, pays du compte d’hôte ; demande invalide refusée sans écriture',
    async (country) => {
      await withRole('app_api', async (client) => {
        await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
          const h = await host(tx, country);
          expect(await accept(tx, h, null)).toEqual({ outcome: 'REQUEST_INVALID', version: null });
          expect(await accept(tx, h, 1, 'de')).toEqual({
            outcome: 'REQUEST_INVALID',
            version: null,
          });
          expect(await accept(tx, h, 0)).toEqual({ outcome: 'REQUEST_INVALID', version: null });
          expect(await accept(tx, h, 7)).toEqual({ outcome: 'TERMS_VERSION_CHANGED', version: 1 });
          expect(await hostConsents(tx, h.hash)).toEqual([]);

          expect(await accept(tx, h, 1, 'fr')).toEqual({ outcome: 'DONE', version: 1 });
          const rows = await hostConsents(tx, h.hash);
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({
            doc_kind: 'TOS_HOST',
            doc_version: 1,
            locale: 'fr',
            accepted: true,
            context: 'HOST_ONBOARDING',
          });
          expect(rows[0]?.accepted_at.toISOString()).toBe(T0);
          // pays du consentement = pays du compte d'hôte (relecture de test, sans C2)
          const row = await tx.query<{ country_code: string; c2_withheld: boolean }>(
            'SELECT * FROM test_fixture.us126_host_consent_row($1)',
            [h.userId],
          );
          expect(row.rows).toEqual([{ country_code: country, c2_withheld: true }]);
          expect(await terms(tx, h, 'fr')).toMatchObject({
            locale: 'fr',
            accepted_version: 1,
            reaccept_required: false,
          });
          expect((await terms(tx, h))?.accepted_at?.toISOString()).toBe(T0);
        });
      });
    },
  );
});

// ---------------------------------------------------------------------------------------------
describe('IDOR et droits (L1-PM-11, RLS-15)', () => {
  it.each(byCountry)(
    '%s (%s) : compte d’hôte d’un autre ⇒ FORBIDDEN (lecture et acceptation), session inventée ⇒ AUTH_REQUIRED ; aucune écriture',
    async (country) => {
      await withRole('app_api', async (client) => {
        const a = await host(client, country);
        const b = await host(client, country);
        const bOnA = { hash: b.hash, org: a.org };
        expect((await terms(client, bOnA))?.outcome).toBe('FORBIDDEN');
        expect((await terms(client, bOnA))?.version).toBeNull();
        expect(await accept(client, bOnA, 1)).toEqual({ outcome: 'FORBIDDEN', version: null });
        expect(await hostConsents(client, b.hash)).toEqual([]);
        expect((await terms(client, { hash: b.hash, org: uuid() }))?.outcome).toBe('FORBIDDEN');
        const forged = { hash: newToken().hash, org: a.org };
        expect((await terms(client, forged))?.outcome).toBe('AUTH_REQUIRED');
        expect(await accept(client, forged, 1)).toEqual({
          outcome: 'AUTH_REQUIRED',
          version: null,
        });
        expect(await hostConsents(client, a.hash)).toEqual([]);
      });
    },
  );

  it('app_api n’exécute ni la garde ni l’état interne ; app_worker et app_anon n’exécutent aucune fonction des CGU de l’hôte', async () => {
    const country = ALL[0] as string;
    const user = uuid();
    const token = newToken().hash;
    const calls: Record<string, readonly [string, readonly unknown[]]> = {
      required: ['SELECT core.ctr_host_terms_required($1, $2)', [user, country]],
      state: ['SELECT * FROM core.ctr_host_terms_state($1, $2, $3)', [user, country, 'es']],
      read: ['SELECT * FROM core.ctr_host_terms($1, $2, $3)', [token, user, 'es']],
      accept: ['SELECT * FROM core.ctr_cmd_accept_host_terms($1, $2, 1, $3)', [token, user, 'es']],
    };
    const denied: Record<string, readonly string[]> = {
      app_api: ['required', 'state'],
      app_worker: ['required', 'state', 'read', 'accept'],
      app_anon: ['required', 'state', 'read', 'accept'],
    };
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const name of denied[role] ?? []) {
          const [sql, values] = calls[name] as readonly [string, readonly unknown[]];
          await expect(client.query(sql, [...values]), `${role} ${name}`).rejects.toMatchObject({
            code: '42501',
          });
        }
      });
    }
  });
});

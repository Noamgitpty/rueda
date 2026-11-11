/**
 * Preuves des consentements versionnés (US-102, migration 0059 ; 16 ACC-001, LEG-001, LEG-002,
 * NFR-17 ; 17 §3.2.6) sous le rôle de PRODUCTION app_api (assertion L0-05 en tête de chaque test
 * par withRole), horloge de la base `platform.now()` (virtuelle quand le test la fixe) :
 *
 * - critère 1 : l'inscription crée le compte `PENDING_EMAIL` ET les consentements CGU +
 *   confidentialité, avec la version, la langue et l'horodatage de la base ;
 * - AUCUNE inscription sans consentement, imposée par la base : l'ancienne commande seule échoue
 *   à la validation (déclencheur différé `ctr_signup_consents_required`) ;
 * - version affichée périmée : refus avant toute écriture, que l'email soit libre ou pris ;
 * - opt-in des communications non pré-coché, accord puis révocation, historique conservé ;
 * - critère 3 : une version MAJEURE publiée par un ADMIN (session élevée) exige la réacceptation ;
 *   une version mineure non ; publication journalisée, jamais rétroactive, quatre langues ensemble,
 *   refusée sans la permission ;
 * - documents propres à un pays (PA puis PY) : numérotation séparée, le commun reste en vigueur
 *   ailleurs ; version future illisible ;
 * - aucun droit de table pour app_api sur les tables CTR ; empreinte du texte = SHA-256 calculé
 *   ici par node:crypto (oracle indépendant du SQL).
 *
 * Attendus : story US-102 de 19, 16 ACC-001, 17 §3.2.6 ; jamais le code testé. Les écritures de
 * publication sont faites dans une transaction annulée (aucune trace dans la base partagée).
 */
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { newToken, openSession, phcArgon2id, uuid } from '../support/iam.ts';
import {
  auditOf,
  createStaff,
  elevatedStaff,
  installTestProofKey,
  login,
} from '../support/staff.ts';

const T0 = '2031-05-04T10:00:00.000Z';
const ALL = COUNTRIES.map((c) => c.country);
const BODIES = {
  es: { title: 'Términos v2', body: 'Texto de prueba de la versión 2.' },
  en: { title: 'Terms v2', body: 'Test text of version 2.' },
  fr: { title: 'Conditions v2', body: 'Texte d’essai de la version 2.' },
  pt: { title: 'Termos v2', body: 'Texto de teste da versão 2.' },
};

beforeAll(async () => {
  await withRole('app_api', async (client) => {
    await installTestProofKey(client);
  });
});

interface StatusRow {
  doc_kind: string;
  required: boolean;
  current_version: number | null;
  required_version: number | null;
  accepted_version: number | null;
  accepted: boolean;
  reaccept_required: boolean;
}

const status = async (c: pg.ClientBase, hash: Buffer): Promise<StatusRow[]> =>
  (await c.query<StatusRow>('SELECT * FROM core.ctr_consent_status($1)', [hash])).rows;

const history = async (c: pg.ClientBase, hash: Buffer) =>
  (
    await c.query<{
      doc_kind: string;
      doc_version: number;
      locale: string;
      accepted: boolean;
      accepted_at: Date;
      context: string;
    }>('SELECT * FROM core.ctr_consent_history($1)', [hash])
  ).rows;

const current = async (c: pg.ClientBase, country: string | null, language: string) =>
  (
    await c.query<{
      doc_kind: string;
      version: number;
      is_major: boolean;
      locale: string;
      is_draft: boolean;
    }>(
      'SELECT doc_kind, version, is_major, locale, is_draft FROM core.ctr_published_documents($1, $2)',
      [country, language],
    )
  ).rows;

async function signup(
  c: pg.ClientBase,
  options: {
    locale?: string;
    email?: string;
    documents?: unknown;
    marketing?: boolean;
    country?: string | null;
  } = {},
): Promise<{ created: boolean; userId: string; email: string }> {
  const userId = uuid();
  const email = options.email ?? `c-${userId}@example.test`;
  const { rows } = await c.query<{ created: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Ana', 'Prueba', $4, $5, $6, 86400,
                                                NULL, $7, $8::jsonb, $9) AS created`,
    [
      userId,
      email,
      phcArgon2id(),
      options.locale ?? 'es',
      uuid(),
      newToken().hash,
      options.country ?? null,
      options.documents === undefined ? null : JSON.stringify(options.documents),
      options.marketing ?? false,
    ],
  );
  return { created: rows[0]?.created === true, userId, email };
}

async function expectConstraint(
  c: pg.ClientBase,
  run: () => Promise<unknown>,
  constraint: string | null,
  code = '23514',
): Promise<void> {
  await c.query('SAVEPOINT s');
  await expect(run()).rejects.toMatchObject(constraint === null ? { code } : { code, constraint });
  await c.query('ROLLBACK TO SAVEPOINT s');
}

const publish = async (
  c: pg.ClientBase,
  hash: Buffer,
  kind: string,
  options: { country?: string | null; major?: boolean; validFrom?: string; bodies?: unknown } = {},
) =>
  (
    await c.query<{ outcome: string; version: number | null }>(
      `SELECT * FROM core.ctr_staff_cmd_publish_document($1, $2, $3, $4, $5,
                $6::timestamptz, NULL, $7::jsonb)`,
      [
        hash,
        uuid(),
        kind,
        options.country ?? null,
        options.major ?? true,
        options.validFrom ?? null,
        JSON.stringify(options.bodies ?? BODIES),
      ],
    )
  ).rows[0];

describe('critère 1 — inscription : compte et consentements versionnés dans la même instruction', () => {
  it('CGU et confidentialité à la version en vigueur, langue du compte, horodatage platform.now()', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        for (const locale of ['es', 'en', 'fr', 'pt']) {
          const r = await signup(tx, {
            locale,
            documents: [
              { kind: 'TOS_GUEST', version: 1 },
              { kind: 'PRIVACY', version: 1 },
            ],
          });
          expect(r.created).toBe(true);
          const { rows } = await tx.query<{ status: string }>(
            'SELECT status FROM core.iam_auth_lookup($1)',
            [r.email],
          );
          expect(rows).toEqual([{ status: 'PENDING_EMAIL' }]);
          const s = await openSession(tx, r.userId);
          const h = await history(tx, s.hash);
          expect(
            h.map((x) => [x.doc_kind, x.doc_version, x.locale, x.accepted, x.context]).sort(),
          ).toEqual([
            ['PRIVACY', 1, locale, true, 'SIGNUP'],
            ['TOS_GUEST', 1, locale, true, 'SIGNUP'],
          ]);
          for (const x of h) expect(x.accepted_at.toISOString()).toBe(T0);
          // opt-in non pré-coché : aucune ligne de communication
          const st = await status(tx, s.hash);
          expect(st.find((x) => x.doc_kind === 'MARKETING')).toMatchObject({
            accepted: false,
            accepted_version: null,
            reaccept_required: false,
          });
          expect(st.filter((x) => x.reaccept_required)).toEqual([]);
        }
      });
    });
  });

  it('langue sans texte : repli sur l’espagnol, qui fait foi, consigné dans le consentement', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const r = await signup(tx, { locale: 'de' });
        const s = await openSession(tx, r.userId);
        expect((await history(tx, s.hash)).map((x) => x.locale)).toEqual(['es', 'es']);
      });
    });
  });

  it('AUCUNE inscription sans consentement : l’ancienne commande seule échoue à la validation', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        // ancienne commande (0011) seule : le compte est écrit, sans aucun consentement
        const { rows } = await tx.query<{ ok: boolean }>(
          `SELECT core.iam_cmd_register($1, $2, $3, 'Ana', 'Prueba', 'es', $4, $5, 86400, NULL) AS ok`,
          [uuid(), `old-${uuid()}@example.test`, phcArgon2id(), uuid(), newToken().hash],
        );
        expect(rows[0]?.ok).toBe(true);
        await expectConstraint(
          tx,
          () => tx.query('SET CONSTRAINTS core.ctr_signup_consents_required IMMEDIATE'),
          'ctr_signup_consents_required',
        );
      });
    });
  });

  it('version affichée périmée ou liste invalide : refus avant l’écriture, email libre ou pris', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const taken = await signup(tx);
        const stale = [
          { kind: 'TOS_GUEST', version: 1 },
          { kind: 'PRIVACY', version: 7 },
        ];
        for (const email of [`libre-${uuid()}@example.test`, taken.email]) {
          await expectConstraint(
            tx,
            () => signup(tx, { email, documents: stale }),
            'ctr_document_version_current',
          );
        }
        for (const bad of [{}, [{ kind: 'MARKETING', version: 1 }], [{ version: 1 }], ['x']]) {
          await expectConstraint(
            tx,
            () => signup(tx, { documents: bad }),
            'ctr_document_request_invalid',
          );
        }
        const again = await signup(tx, { email: taken.email });
        expect(again.created).toBe(false);
      });
    });
  });
});

describe('communications commerciales : opt-in, révocation, historique', () => {
  it('coché à l’inscription, révoqué puis redonné : une ligne par changement, rien si inchangé', async () => {
    await withRole('app_api', async (client) => {
      await withTestTransaction(client, { virtualNow: T0 }, async (tx) => {
        const r = await signup(tx, { marketing: true });
        const s = await openSession(tx, r.userId);
        const set = async (optIn: boolean) =>
          (
            await tx.query<{ o: string }>('SELECT core.ctr_cmd_set_marketing($1, $2) AS o', [
              s.hash,
              optIn,
            ])
          ).rows[0]?.o;
        expect(await set(true)).toBe('UNCHANGED');
        expect(await set(false)).toBe('CHANGED');
        expect(await set(false)).toBe('UNCHANGED');
        expect(await set(true)).toBe('CHANGED');
        const m = (await history(tx, s.hash)).filter((x) => x.doc_kind === 'MARKETING');
        expect(m.map((x) => [x.accepted, x.context])).toEqual([
          [true, 'SETTINGS'],
          [false, 'SETTINGS'],
          [true, 'SIGNUP'],
        ]);
        expect((await status(tx, s.hash)).find((x) => x.doc_kind === 'MARKETING')?.accepted).toBe(
          true,
        );
      });
    });
  });

  it('session inconnue : aucune ligne, aucune écriture', async () => {
    await withRole('app_api', async (client) => {
      const ghost = newToken().hash;
      expect(await status(client, ghost)).toEqual([]);
      expect(await history(client, ghost)).toEqual([]);
      const { rows } = await client.query<{ n: number; o: string }>(
        `SELECT core.ctr_cmd_accept_documents($1, '[{"kind":"TOS_GUEST","version":1}]') AS n,
                core.ctr_cmd_set_marketing($1, true) AS o`,
        [ghost],
      );
      expect(rows[0]).toEqual({ n: -1, o: 'AUTH_REQUIRED' });
    });
  });
});

describe('critère 3 — version majeure publiée : réacceptation avant toute réservation', () => {
  it('majeure ⇒ TERMS_REACCEPT_REQUIRED ; version périmée refusée ; acceptation ⇒ à jour ; mineure ⇒ rien', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      await withTestTransaction(client, {}, async (tx) => {
        const r = await signup(tx);
        const s = await openSession(tx, r.userId);
        const before = (await current(tx, null, 'es')).find((d) => d.doc_kind === 'TOS_GUEST');
        const v = (before?.version ?? 0) + 1;

        expect(await publish(tx, admin.hash, 'TOS_GUEST', { major: true })).toEqual({
          outcome: 'PUBLISHED',
          version: v,
        });
        const tos = (await status(tx, s.hash)).find((x) => x.doc_kind === 'TOS_GUEST');
        expect(tos).toMatchObject({
          current_version: v,
          required_version: v,
          accepted_version: before?.version,
          reaccept_required: true,
        });
        // publication journalisée dans la chaîne d'audit (16 ADM-001)
        const audit = await auditOf(tx, admin.userId);
        expect(audit.map((a) => a.action_code)).toContain('LEGAL_DOCUMENT_PUBLISHED');

        await expectConstraint(
          tx,
          () =>
            tx.query('SELECT core.ctr_cmd_accept_documents($1, $2::jsonb)', [
              s.hash,
              JSON.stringify([{ kind: 'TOS_GUEST', version: v - 1 }]),
            ]),
          'ctr_document_version_current',
        );
        const n = await tx.query<{ n: number }>(
          'SELECT core.ctr_cmd_accept_documents($1, $2::jsonb) AS n',
          [s.hash, JSON.stringify([{ kind: 'TOS_GUEST', version: v }])],
        );
        expect(n.rows[0]?.n).toBe(1);
        expect((await status(tx, s.hash)).filter((x) => x.reaccept_required)).toEqual([]);
        expect((await history(tx, s.hash))[0]).toMatchObject({
          doc_kind: 'TOS_GUEST',
          doc_version: v,
          context: 'REACCEPT',
        });

        // mineure : en vigueur pour les nouveaux comptes, sans réacceptation exigée
        const minor = await publish(tx, admin.hash, 'PRIVACY', { major: false });
        expect(minor?.outcome).toBe('PUBLISHED');
        const privacy = (await status(tx, s.hash)).find((x) => x.doc_kind === 'PRIVACY');
        expect(privacy).toMatchObject({
          current_version: minor?.version,
          reaccept_required: false,
        });
        // l'inscription exige désormais la version mineure affichée
        await expectConstraint(
          tx,
          () =>
            signup(tx, {
              documents: [
                { kind: 'TOS_GUEST', version: v },
                { kind: 'PRIVACY', version: (minor?.version ?? 1) - 1 },
              ],
            }),
          'ctr_document_version_current',
        );
      });
    });
  });

  it('publication : quatre langues exigées, jamais rétroactive, refusée sans permission ou sans TOTP', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const support = await elevatedStaff(client, 'SUPPORT_AGENT', ALL);
      const plain = await createStaff(client, 'ADMIN', ALL, { withFactor: false });
      const notElevated = await login(client, plain.userId);
      await withTestTransaction(client, {}, async (tx) => {
        const three = { es: BODIES.es, en: BODIES.en, fr: BODIES.fr };
        await expectConstraint(
          tx,
          () => publish(tx, admin.hash, 'TOS_GUEST', { bodies: three }),
          null,
          '22023',
        );
        await expectConstraint(tx, () => publish(tx, admin.hash, 'TOS_HOST'), null, '22023');
        await expectConstraint(
          tx,
          () => publish(tx, admin.hash, 'TOS_GUEST', { validFrom: '2001-01-01T00:00:00Z' }),
          'document_template_not_retroactive',
        );
        expect((await publish(tx, support.hash, 'TOS_GUEST'))?.outcome).toBe('FORBIDDEN');
        expect((await publish(tx, notElevated, 'TOS_GUEST'))?.outcome).toBe('MFA_REQUIRED');
        expect((await publish(tx, newToken().hash, 'TOS_GUEST'))?.outcome).toBe('AUTH_REQUIRED');
      });
    });
  });

  it('document propre à un pays (chaque pays) : numérotation séparée ; version future illisible', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      for (const country of ALL) {
        await withTestTransaction(client, {}, async (tx) => {
          const common = (await current(tx, null, 'fr')).find((d) => d.doc_kind === 'PRIVACY');
          expect(await publish(tx, admin.hash, 'PRIVACY', { country })).toEqual({
            outcome: 'PUBLISHED',
            version: 1,
          });
          const here = (await current(tx, country, 'fr')).find((d) => d.doc_kind === 'PRIVACY');
          expect(here).toMatchObject({ version: 1, locale: 'fr', is_draft: true });
          // ailleurs (aucun pays) : le document commun reste en vigueur
          expect((await current(tx, null, 'fr')).find((d) => d.doc_kind === 'PRIVACY')).toEqual(
            common,
          );
          // version future : publiée, mais ni en vigueur ni lisible
          const future = await publish(tx, admin.hash, 'PRIVACY', {
            country,
            validFrom: '2099-01-01T00:00:00Z',
          });
          expect(future).toEqual({ outcome: 'PUBLISHED', version: 2 });
          expect(
            (await current(tx, country, 'fr')).find((d) => d.doc_kind === 'PRIVACY')?.version,
          ).toBe(1);
          const body = await tx.query('SELECT * FROM core.ctr_document_body($1, $2, $3, $4)', [
            'PRIVACY',
            country,
            'fr',
            2,
          ]);
          expect(body.rows).toEqual([]);
        });
      }
    });
  });
});

describe('documents en vigueur, empreintes et droits', () => {
  it('trois documents BROUILLON en quatre langues ; empreinte = SHA-256 du texte (oracle node:crypto)', async () => {
    await withRole('app_api', async (client) => {
      for (const language of ['es', 'en', 'fr', 'pt']) {
        const docs = await current(client, null, language);
        expect(docs.map((d) => d.doc_kind)).toEqual(['MARKETING', 'PRIVACY', 'TOS_GUEST']);
        for (const d of docs) {
          const { rows } = await client.query<{
            body_md: string;
            content_hash: Buffer;
            title: string;
          }>(
            'SELECT body_md, content_hash, title FROM core.ctr_document_body($1, NULL, $2, NULL)',
            [d.doc_kind, language],
          );
          const row = rows[0];
          expect(row, `${d.doc_kind} ${language}`).toBeDefined();
          expect(Buffer.from(row?.content_hash ?? []).toString('hex')).toBe(
            createHash('sha256')
              .update(row?.body_md ?? '', 'utf8')
              .digest('hex'),
          );
        }
      }
      // le brouillon initial (version 1) est marqué comme tel dans chaque langue
      const v1 = await client.query<{ locale: string; body_md: string }>(
        `SELECT d.locale, d.body_md
           FROM unnest(ARRAY['es', 'en', 'fr', 'pt']) AS l,
                LATERAL core.ctr_document_body('TOS_GUEST', NULL, l, 1) AS d`,
      );
      expect(v1.rows).toHaveLength(4);
      const marks: Record<string, string> = {
        es: 'BORRADOR',
        en: 'DRAFT',
        fr: 'BROUILLON',
        pt: 'RASCUNHO',
      };
      for (const r of v1.rows) expect(r.body_md).toContain(marks[r.locale]);
    });
  });

  it('tables CTR : RLS ENABLE + FORCE, propriétaire migrator, politiques des seuls propriétaires', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        t: string;
        rls: boolean;
        force: boolean;
        owner: string;
        pols: string;
      }>(
        `SELECT c.relname AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                pg_catalog.array_to_string(ARRAY(
                  SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                           SELECT pg_catalog.pg_get_userbyid(r) FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',')
                    FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1), ';') AS pols
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relkind = 'r' AND c.relname ~ '^contract_'
          ORDER BY 1`,
      );
      expect(rows).toEqual([
        {
          t: 'contract_consent',
          rls: true,
          force: true,
          owner: 'migrator',
          pols: 'iam_auth_insert:iam_auth_owner;iam_auth_select:iam_auth_owner;migrator_all:migrator',
        },
        {
          t: 'contract_document_template',
          rls: true,
          force: true,
          owner: 'migrator',
          pols: 'iam_auth_select:iam_auth_owner;iam_staff_insert:iam_staff_owner;iam_staff_select:iam_staff_owner;migrator_all:migrator',
        },
      ]);
    });
  });

  it('aucun droit de table CTR pour app_api : lecture et écriture directes refusées (42501)', async () => {
    await withRole('app_api', async (client) => {
      for (const sql of [
        'SELECT * FROM core.contract_consent LIMIT 1',
        'SELECT * FROM core.contract_document_template LIMIT 1',
        `INSERT INTO core.contract_consent (user_id, template_id, doc_kind, doc_version, locale, accepted, context, c2_withheld)
         VALUES ('${uuid()}', '${uuid()}', 'TOS_GUEST', 1, 'es', true, 'SIGNUP', true)`,
        'DELETE FROM core.contract_consent',
        'UPDATE core.contract_document_template SET title = title',
      ]) {
        await expect(client.query(sql), sql).rejects.toMatchObject({ code: '42501' });
      }
    });
  });
});

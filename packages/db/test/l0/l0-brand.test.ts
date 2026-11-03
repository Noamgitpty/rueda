/**
 * Preuves du socle de marque (US-034, migration 0042) sous le rôle de production app_api
 * (assertion L0-05 en tête de chaque test par withRole / connectAs), avec des membres du staff
 * enrôlés et élevés par les VRAIES commandes (support/staff.ts) :
 * - critère 1 : un brouillon publié devient actif de façon atomique, la précédente reste dans
 *   l'historique (ARCHIVED) ; une seule version publiée, même sous publications concurrentes ;
 * - critère 2 : retour arrière = nouvelle version copiée de la précédente, publiée, journalisée ;
 * - critère 4 (côté base) : un rapport de contraste en échec (ou forgé) refuse la publication, le
 *   refus est journalisé avec les paires en cause, rien ne change ;
 * - permissions (`brand.edit`, `brand.publish` : ADMIN de TOUS les pays pour le thème commun),
 *   TOTP exigé, refus journalisés ; versions jamais écrasées (gardes, migrator compris) ;
 * - blocs de contenu : trois langues obligatoires, clés `legal.*` et Markdown hors règles refusés,
 *   publication et retour arrière par pays (PA et PY) et commun ;
 * - actifs : `file_asset` en bucket public BRAND (C0), SVG refusé, actif invisible au public tant
 *   qu'aucune version publiée ne le référence.
 * Valeurs attendues : 17 §3.2.13 (brand_version, content_block, brand_asset, file_asset), 16
 * DSN-003 / DSN-004, ADR-036, ADR-067. Le contrôle de contraste lui-même (US-030) est prouvé côté
 * API (apps/api, test:int) : ici, la base reçoit un rapport et doit le faire respecter.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { connectAs, releaseClient, withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { auditOf, elevatedStaff, installTestProofKey, login, uuid } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const TINTA = JSON.parse(
  readFileSync(
    new URL('../../../../docs/design/US-028/tokens-lienzo-tinta.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
const PASSED = { checker: 'test', tokensSchemaVersion: 1, passed: true, failures: [] };
const FAILED = {
  checker: 'test',
  tokensSchemaVersion: 1,
  passed: false,
  failures: [{ mode: 'light', pair: 'text-muted / surface', ratio: 2.8, min: 4.5 }],
};

const BODIES = {
  es: 'Alquila el auto de un vecino.',
  en: 'Rent a car from a neighbor.',
  fr: 'Louez la voiture d’un voisin.',
  pt: 'Alugue o carro de um vizinho.',
};

beforeAll(async () => {
  await withRole('app_api', async (client) => {
    await installTestProofKey(client);
  });
});

interface Outcome {
  outcome: string;
  version_id: string | null;
  version_no: number | null;
}

async function saveDraft(
  client: pg.ClientBase,
  hash: Buffer,
  name = 'Kmino',
  extra: { logo?: string | null; copiedFrom?: string | null; versionId?: string } = {},
): Promise<Outcome> {
  const { rows } = await client.query<Outcome>(
    `SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, $4, $5, 1, $6, NULL, NULL, $7)`,
    [
      hash,
      uuid(),
      extra.versionId ?? uuid(),
      name,
      TINTA,
      extra.logo ?? null,
      extra.copiedFrom ?? null,
    ],
  );
  return rows[0] ?? { outcome: '', version_id: null, version_no: null };
}

/** Empreinte des jetons d'une version, lue par la fixture (sous migrator) ; '' si inconnue. */
async function shaOf(client: pg.ClientBase, versionId: string): Promise<string> {
  const { rows } = await client.query<{ tokens_sha256: string }>(
    'SELECT tokens_sha256 FROM test_fixture.brand_versions() WHERE id = $1',
    [versionId],
  );
  return rows[0]?.tokens_sha256 ?? '';
}

/** Rapport lié à la version visée, sauf si le test fixe lui-même `tokensSha256`. */
async function bound(client: pg.ClientBase, versionId: string, check: object): Promise<object> {
  return 'tokensSha256' in check
    ? check
    : { ...check, tokensSha256: await shaOf(client, versionId) };
}

async function publish(
  client: pg.ClientBase,
  hash: Buffer,
  versionId: string,
  check: object = PASSED,
): Promise<Outcome> {
  const { rows } = await client.query<Outcome>(
    'SELECT * FROM core.cfg_brand_cmd_publish($1, $2, $3, $4)',
    [hash, uuid(), versionId, await bound(client, versionId, check)],
  );
  return rows[0] ?? { outcome: '', version_id: null, version_no: null };
}

async function rollback(
  client: pg.ClientBase,
  hash: Buffer,
  targetId: string,
  check: object = PASSED,
): Promise<Outcome> {
  const { rows } = await client.query<Outcome>(
    'SELECT * FROM core.cfg_brand_cmd_rollback($1, $2, $3, $4, $5)',
    [hash, uuid(), uuid(), targetId, await bound(client, targetId, check)],
  );
  return rows[0] ?? { outcome: '', version_id: null, version_no: null };
}

interface VersionRow {
  id: string;
  version_no: number;
  status: string;
  brand_name: string;
  contrast_check: Record<string, unknown> | null;
  copied_from_id: string | null;
  created_by: string;
  published_by: string | null;
  archived_at: Date | null;
}

async function versions(client: pg.ClientBase): Promise<VersionRow[]> {
  return (await client.query<VersionRow>('SELECT * FROM test_fixture.brand_versions()')).rows;
}

const published = async (client: pg.ClientBase): Promise<VersionRow[]> =>
  (await versions(client)).filter((v) => v.status === 'PUBLISHED');

describe('structure et droits', () => {
  it('RLS ENABLE + FORCE, propriétaire migrator ; app_api ne lit que des colonnes publiques ; app_worker et app_anon : rien', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{
        relname: string;
        rls: boolean;
        force: boolean;
        owner: string;
      }>(
        `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core'
            AND c.relname IN ('config_brand_asset', 'config_brand_version', 'config_content_block')
          ORDER BY 1`,
      );
      expect(rows).toEqual(
        ['config_brand_asset', 'config_brand_version', 'config_content_block'].map((relname) => ({
          relname,
          rls: true,
          force: true,
          owner: 'migrator',
        })),
      );
      const privileges = await client.query<{
        role: string;
        tbl: string;
        col: string;
        priv: string;
      }>(
        `SELECT r.role, c.relname AS tbl, a.attname AS col, p.priv
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
           CROSS JOIN unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r(role)
           CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) AS p(priv)
          WHERE n.nspname = 'core'
            AND c.relname IN ('config_brand_asset', 'config_brand_version', 'config_content_block')
            AND pg_catalog.has_column_privilege(r.role, c.oid, a.attnum, p.priv)
          ORDER BY 1, 2, 3, 4`,
      );
      const granted = privileges.rows.map((r) => `${r.role}:${r.tbl}.${r.col}:${r.priv}`);
      // lecture seule, et seulement par app_api
      expect(granted.filter((g) => !g.startsWith('app_api:') || !g.endsWith(':SELECT'))).toEqual(
        [],
      );
      // aucun identifiant du personnel, aucune requête, aucun rapport interne
      for (const col of [
        'created_by',
        'published_by',
        'uploaded_by',
        'request_id',
        'license_note',
      ]) {
        expect(
          granted.filter((g) => g.includes(`.${col}:`)),
          col,
        ).toEqual([]);
      }
      const tablePrivs = await client.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM unnest(ARRAY['config_brand_asset', 'config_brand_version', 'config_content_block']) AS t(tbl),
                unnest(ARRAY['app_api', 'app_worker', 'app_anon']) AS r(role),
                unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']) AS p(priv)
          WHERE pg_catalog.has_table_privilege(r.role, 'core.' || t.tbl, p.priv)`,
      );
      expect(tablePrivs.rows[0]?.n).toBe(0);
    });
  });

  it('commandes : EXECUTE au seul app_api (app_worker et app_anon refusés)', async () => {
    await withRole('app_worker', async (client) => {
      await expect(
        client.query('SELECT * FROM core.cfg_brand_cmd_publish($1, $2, $3, $4)', [
          Buffer.alloc(32),
          uuid(),
          uuid(),
          PASSED,
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
    await withRole('app_anon', async (client) => {
      await expect(
        client.query('SELECT * FROM core.cfg_brand_staff_versions($1, NULL, 10)', [
          Buffer.alloc(32),
        ]),
      ).rejects.toMatchObject({ code: '42501' });
    });
  });
});

describe('critère 1 — publication atomique, la précédente reste dans l’historique', () => {
  it('brouillon invisible au public ; publié : actif, l’ancien ARCHIVED ; une seule version publiée', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const first = await saveDraft(client, admin.hash, 'Kmino');
      expect(first.outcome).toBe('SAVED');
      expect((await publish(client, admin.hash, first.version_id ?? '')).outcome).toBe('PUBLISHED');

      const draft = await saveDraft(client, admin.hash, 'Kmino bis');
      expect(draft).toMatchObject({ outcome: 'SAVED' });
      expect(draft.version_no).toBeGreaterThan(first.version_no ?? 0);
      // le public (app_api, aucune session) ne voit que la version publiée, jamais le brouillon
      const before = await client.query<{ id: string; brand_name: string }>(
        'SELECT id, brand_name FROM core.config_brand_version',
      );
      expect(before.rows.map((r) => r.id)).not.toContain(draft.version_id);
      expect((await published(client)).map((v) => v.id)).toEqual([first.version_id]);

      expect(await publish(client, admin.hash, draft.version_id ?? '')).toEqual({
        outcome: 'PUBLISHED',
        version_id: draft.version_id,
        version_no: draft.version_no,
      });
      const all = await versions(client);
      expect(all.filter((v) => v.status === 'PUBLISHED').map((v) => v.id)).toEqual([
        draft.version_id,
      ]);
      const old = all.find((v) => v.id === first.version_id);
      expect(old).toMatchObject({ status: 'ARCHIVED', brand_name: 'Kmino' });
      expect(old?.archived_at).not.toBeNull();
      expect(all.find((v) => v.id === draft.version_id)).toMatchObject({
        published_by: admin.userId,
        contrast_check: PASSED,
      });
      const pub = await client.query<{ id: string; brand_name: string }>(
        'SELECT id, brand_name FROM core.config_brand_version',
      );
      expect(pub.rows).toEqual([{ id: draft.version_id, brand_name: 'Kmino bis' }]);
      // journal : publication avec la version remplacée
      const last = (await auditOf(client, admin.userId)).at(-1);
      expect(last).toMatchObject({
        action_code: 'BRAND_PUBLISHED',
        actor_role: 'ADMIN',
        subject_type: 'BRAND_VERSION',
        subject_id: draft.version_id,
        before: { publishedVersionId: first.version_id, versionNo: first.version_no },
        after: { versionId: draft.version_id, versionNo: draft.version_no },
      });
      // republier une version déjà publiée : refus sans effet
      expect((await publish(client, admin.hash, draft.version_id ?? '')).outcome).toBe('NOT_DRAFT');
      expect((await publish(client, admin.hash, uuid())).outcome).toBe('NOT_FOUND');
    });
  });

  it('publications concurrentes de 8 brouillons : toutes sérialisées, exactement une version publiée à la fin', async () => {
    const clients: pg.Client[] = [];
    try {
      for (let i = 0; i < 8; i += 1) clients.push(await connectAs('app_api'));
      const first = clients[0] as pg.Client;
      const admin = await elevatedStaff(first, 'ADMIN', ALL);
      const drafts: string[] = [];
      for (let i = 0; i < clients.length; i += 1) {
        drafts.push((await saveDraft(first, admin.hash, `Kmino ${i}`)).version_id ?? '');
      }
      const results = await Promise.all(
        clients.map((c, i) => publish(c, admin.hash, drafts[i] ?? '')),
      );
      expect(results.map((r) => r.outcome)).toEqual(drafts.map(() => 'PUBLISHED'));
      const all = await versions(first);
      expect(all.filter((v) => v.status === 'PUBLISHED')).toHaveLength(1);
      expect(all.filter((v) => drafts.includes(v.id) && v.status === 'ARCHIVED')).toHaveLength(7);
    } finally {
      for (const c of clients) await releaseClient(c);
    }
  });
});

describe('critère 2 — retour arrière en un clic, journalisé', () => {
  it('la précédente redevient active par une NOUVELLE version copiée ; rien n’est écrasé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const a = await saveDraft(client, admin.hash, 'Version A');
      await publish(client, admin.hash, a.version_id ?? '');
      const b = await saveDraft(client, admin.hash, 'Version B');
      await publish(client, admin.hash, b.version_id ?? '');

      const r = await rollback(client, admin.hash, a.version_id ?? '');
      expect(r.outcome).toBe('ROLLED_BACK');
      expect(r.version_no).toBeGreaterThan(b.version_no ?? 0);
      const all = await versions(client);
      const copy = all.find((v) => v.id === r.version_id);
      expect(copy).toMatchObject({
        status: 'PUBLISHED',
        brand_name: 'Version A',
        copied_from_id: a.version_id,
        created_by: admin.userId,
      });
      expect(all.find((v) => v.id === a.version_id)?.status).toBe('ARCHIVED');
      expect(all.find((v) => v.id === b.version_id)?.status).toBe('ARCHIVED');
      expect(all.filter((v) => v.status === 'PUBLISHED')).toHaveLength(1);
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'BRAND_ROLLED_BACK',
        subject_id: r.version_id,
        before: { publishedVersionId: b.version_id, versionNo: b.version_no },
        after: {
          copiedFromId: a.version_id,
          copiedFromVersionNo: a.version_no,
          versionNo: r.version_no,
        },
      });
      // cible ni archivée ni existante : refus sans effet
      expect((await rollback(client, admin.hash, r.version_id ?? '')).outcome).toBe('NOT_ARCHIVED');
      expect((await rollback(client, admin.hash, uuid())).outcome).toBe('NOT_FOUND');
      const draft = await saveDraft(client, admin.hash, 'Brouillon');
      expect((await rollback(client, admin.hash, draft.version_id ?? '')).outcome).toBe(
        'NOT_ARCHIVED',
      );
    });
  });

  it('idempotence : même requête de brouillon rejouée => DUPLICATE, une seule version', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const requestId = uuid();
      const versionId = uuid();
      const call = async (): Promise<Outcome | undefined> =>
        (
          await client.query<Outcome>(
            `SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, 'Kmino', $4, 1, NULL, NULL, NULL, NULL)`,
            [admin.hash, requestId, versionId, TINTA],
          )
        ).rows[0];
      expect((await call())?.outcome).toBe('SAVED');
      expect(await call()).toMatchObject({ outcome: 'DUPLICATE', version_id: versionId });
    });
  });
});

describe('critère 4 (base) — contraste en échec : publication refusée, paire nommée, journalisée', () => {
  it.each([
    ['rapport en échec', FAILED],
    ['rapport forgé « passé » avec une paire en échec', { ...FAILED, passed: true }],
    ['rapport sans vérificateur', { passed: true, failures: [] }],
  ])('%s : CONTRAST_INSUFFICIENT, rien ne change', async (_label, check) => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const before = (await published(client)).map((v) => v.id);
      const draft = await saveDraft(client, admin.hash, 'Contraste');
      expect((await publish(client, admin.hash, draft.version_id ?? '', check)).outcome).toBe(
        'CONTRAST_INSUFFICIENT',
      );
      expect((await published(client)).map((v) => v.id)).toEqual(before);
      expect((await versions(client)).find((v) => v.id === draft.version_id)?.status).toBe('DRAFT');
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'BRAND_PUBLISH_REFUSED',
        subject_id: draft.version_id,
        after: { reason: 'BRAND_CONTRAST_INSUFFICIENT', failures: check.failures },
      });
    });
  });

  it('retour arrière vers une version qui échoue au contrôle actuel : refusé et journalisé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const a = await saveDraft(client, admin.hash, 'A');
      await publish(client, admin.hash, a.version_id ?? '');
      const b = await saveDraft(client, admin.hash, 'B');
      await publish(client, admin.hash, b.version_id ?? '');
      expect((await rollback(client, admin.hash, a.version_id ?? '', FAILED)).outcome).toBe(
        'CONTRAST_INSUFFICIENT',
      );
      expect((await published(client)).map((v) => v.id)).toEqual([b.version_id]);
      expect((await auditOf(client, admin.userId)).at(-1)?.action_code).toBe(
        'BRAND_ROLLBACK_REFUSED',
      );
    });
  });

  it('rapport mal formé : 22023 (rien n’est journalisé comme publication)', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const draft = await saveDraft(client, admin.hash);
      await expect(
        client.query('SELECT * FROM core.cfg_brand_cmd_publish($1, $2, $3, $4)', [
          admin.hash,
          uuid(),
          draft.version_id,
          { passed: 'yes', failures: [] },
        ]),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });
});

describe('permissions : TOTP, brand.edit / brand.publish (ADMIN de tous les pays), refus journalisés', () => {
  it('sans session : AUTH_REQUIRED ; session non élevée : MFA_REQUIRED journalisé', async () => {
    await withRole('app_api', async (client) => {
      expect((await saveDraft(client, Buffer.alloc(32, 7))).outcome).toBe('AUTH_REQUIRED');
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const plain = await login(client, admin.userId);
      expect((await saveDraft(client, plain)).outcome).toBe('MFA_REQUIRED');
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'STAFF_ACCESS_DENIED',
        after: { reason: '2FA_REQUIRED', attempted: 'BRAND_SAVE_DRAFT' },
      });
      const read = await client.query('SELECT * FROM core.cfg_brand_staff_versions($1, NULL, 10)', [
        plain,
      ]);
      expect(read.rows).toEqual([]);
    });
  });

  it.each(['FINANCE', 'OPS_AGENT', 'SUPPORT_AGENT'])(
    '%s élevé : brouillon et publication FORBIDDEN, journalisés',
    async (role) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', ALL);
        const draft = await saveDraft(client, admin.hash);
        const s = await elevatedStaff(client, role, ALL);
        expect((await saveDraft(client, s.hash)).outcome).toBe('FORBIDDEN');
        expect((await publish(client, s.hash, draft.version_id ?? '')).outcome).toBe('FORBIDDEN');
        const rows = await auditOf(client, s.userId);
        expect(rows.slice(-2).map((r) => [r.action_code, r.after?.['permission']])).toEqual([
          ['STAFF_FORBIDDEN', 'brand.edit'],
          ['STAFF_FORBIDDEN', 'brand.publish'],
        ]);
        expect((await versions(client)).find((v) => v.id === draft.version_id)?.status).toBe(
          'DRAFT',
        );
      });
    },
  );

  it.each(COUNTRIES.map((c) => c.country))(
    'ADMIN du seul pays %s : thème commun refusé (FORBIDDEN), bloc de son pays permis',
    async (country) => {
      await withRole('app_api', async (client) => {
        const local = await elevatedStaff(client, 'ADMIN', [country]);
        expect((await saveDraft(client, local.hash)).outcome).toBe('FORBIDDEN');
        const own = await client.query<{ outcome: string }>(
          'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, NULL)',
          [local.hash, uuid(), `home.local_${country.toLowerCase()}.title`, country, BODIES],
        );
        expect(own.rows[0]?.outcome).toBe('SAVED');
        const other = ALL.find((c) => c !== country);
        const foreign = await client.query<{ outcome: string }>(
          'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, NULL)',
          [local.hash, uuid(), 'home.foreign.title', other, BODIES],
        );
        expect(foreign.rows[0]?.outcome).toBe('FORBIDDEN');
      });
    },
  );
});

describe('versions jamais écrasées (gardes, migrator compris)', () => {
  it.each(['TOKENS', 'NAME', 'UNARCHIVE', 'DELETE', 'TRUNCATE', 'INSERT_PUBLISHED'])(
    'brand_version %s : refusé (23000)',
    async (kind) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', ALL);
        const a = await saveDraft(client, admin.hash, 'Garde A');
        await publish(client, admin.hash, a.version_id ?? '');
        const b = await saveDraft(client, admin.hash, 'Garde B');
        await publish(client, admin.hash, b.version_id ?? '');
        const target =
          kind === 'TOKENS' ? (await saveDraft(client, admin.hash)).version_id : a.version_id;
        await expect(
          client.query('SELECT test_fixture.brand_tamper($1, $2)', [target, kind]),
        ).rejects.toMatchObject({ code: '23000' });
      });
    },
  );

  it('content_block et brand_asset : corps, suppression et TRUNCATE refusés', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const key = `home.guard_${randomUUID().slice(0, 8)}.title`;
      await client.query(
        'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, NULL, $4, NULL)',
        [admin.hash, uuid(), key, BODIES],
      );
      const block = (
        await client.query<{ id: string }>('SELECT * FROM test_fixture.content_blocks($1)', [key])
      ).rows[0];
      for (const kind of ['BODY', 'DELETE', 'TRUNCATE']) {
        await expect(
          client.query('SELECT test_fixture.content_tamper($1, $2)', [block?.id, kind]),
        ).rejects.toMatchObject({ code: '23000' });
      }
      const asset = await registerAsset(client, admin.hash, 'LOGO', 'image/png');
      await expect(
        client.query('SELECT test_fixture.brand_asset_tamper($1)', [asset.asset_id]),
      ).rejects.toMatchObject({ code: '23000' });
    });
  });
});

async function registerAsset(
  client: pg.ClientBase,
  hash: Buffer,
  kind: string,
  mime: string,
  alt: { es: string | null; en: string | null; fr: string | null; pt: string | null } = {
    es: 'Logotipo',
    en: 'Logo',
    fr: 'Logo',
    pt: 'Logotipo',
  },
): Promise<{ outcome: string; asset_id: string | null; storage_key: string | null }> {
  const body = Buffer.from(`asset ${randomUUID()}`, 'utf8');
  const { rows } = await client.query<{
    outcome: string;
    asset_id: string | null;
    storage_key: string | null;
  }>(
    `SELECT * FROM core.cfg_brand_cmd_register_asset($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, 'Licence vérifiée (test)')`,
    [
      hash,
      uuid(),
      uuid(),
      kind,
      mime,
      body.length,
      createHash('sha256').update(body).digest(),
      alt.es,
      alt.en,
      alt.fr,
      alt.pt,
    ],
  );
  return rows[0] ?? { outcome: '', asset_id: null, storage_key: null };
}

describe('actifs de marque : file_asset en bucket public BRAND', () => {
  it('enregistré : file_asset BRAND / C0 / STAFF_UPLOAD ; invisible au public tant qu’aucune version publiée ne le référence', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const asset = await registerAsset(client, admin.hash, 'LOGO', 'image/png');
      expect(asset).toMatchObject({
        outcome: 'REGISTERED',
        storage_key: `brand/${asset.asset_id}`,
      });
      const file = (
        await client.query('SELECT * FROM test_fixture.brand_file_asset($1)', [asset.asset_id])
      ).rows[0];
      expect(file).toMatchObject({
        bucket: 'BRAND',
        storage_key: `brand/${asset.asset_id}`,
        mime: 'image/png',
        uploader_user_id: admin.userId,
        source: 'STAFF_UPLOAD',
        classification: 'C0',
      });
      const visible = async (): Promise<string[]> =>
        (await client.query<{ id: string }>('SELECT id FROM core.config_brand_asset')).rows.map(
          (r) => r.id,
        );
      expect(await visible()).not.toContain(asset.asset_id);
      const draft = await saveDraft(client, admin.hash, 'Avec logo', { logo: asset.asset_id });
      expect(draft.outcome).toBe('SAVED');
      expect(await visible()).not.toContain(asset.asset_id);
      await publish(client, admin.hash, draft.version_id ?? '');
      expect(await visible()).toContain(asset.asset_id);
      const pub = await client.query<{ logo_asset_id: string }>(
        'SELECT logo_asset_id FROM core.config_brand_version',
      );
      expect(pub.rows).toEqual([{ logo_asset_id: asset.asset_id }]);
    });
  });

  it('SVG refusé (script possible dans un bucket public), police hors WOFF2 refusée, actif d’un autre type refusé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      await expect(
        registerAsset(client, admin.hash, 'LOGO', 'image/svg+xml'),
      ).rejects.toMatchObject({
        code: '23514',
      });
      await expect(registerAsset(client, admin.hash, 'FONT', 'font/ttf')).rejects.toMatchObject({
        code: '23514',
      });
      const favicon = await registerAsset(client, admin.hash, 'FAVICON', 'image/png');
      await expect(
        saveDraft(client, admin.hash, 'Logo faux', { logo: favicon.asset_id }),
      ).rejects.toMatchObject({ code: '22023' });
      const font = await registerAsset(client, admin.hash, 'FONT', 'font/woff2');
      expect(font.outcome).toBe('REGISTERED');
    });
  });
});

async function content(
  client: pg.ClientBase,
  hash: Buffer,
  fn: 'save' | 'publish' | 'rollback',
  key: string,
  country: string | null,
  arg: unknown = null,
): Promise<{ outcome: string; version_no: number | null }> {
  const sql = {
    save: 'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, NULL)',
    publish: 'SELECT * FROM core.cfg_content_cmd_publish($1, $2, $3, $4, $5)',
    rollback: 'SELECT * FROM core.cfg_content_cmd_rollback($1, $2, $3, $4, $5)',
  }[fn];
  const { rows } = await client.query<{ outcome: string; version_no: number | null }>(sql, [
    hash,
    uuid(),
    key,
    country,
    arg,
  ]);
  return rows[0] ?? { outcome: '', version_no: null };
}

describe('blocs de contenu (es, en, fr, pt) : brouillon, publication, retour arrière', () => {
  it('une langue absente ou vide : LOCALE_MISSING (CONTENT_BLOCK_REQUIRED_MISSING), rien n’est créé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const key = `home.missing_${randomUUID().slice(0, 8)}.title`;
      for (const bodies of [
        { es: BODIES.es, en: BODIES.en },
        { es: BODIES.es, en: BODIES.en, fr: BODIES.fr },
        { ...BODIES, fr: '   ' },
        { ...BODIES, pt: '   ' },
        { ...BODIES, pt: null },
      ]) {
        expect((await content(client, admin.hash, 'save', key, null, bodies)).outcome).toBe(
          'LOCALE_MISSING',
        );
      }
      expect(
        (await client.query('SELECT * FROM test_fixture.content_blocks($1)', [key])).rows,
      ).toEqual([]);
      await expect(
        content(client, admin.hash, 'save', key, null, { ...BODIES, de: 'Hallo' }),
      ).rejects.toMatchObject({ code: '22023' });
    });
  });

  it.each([
    ['clé legal.*', 'legal.terms.body', BODIES.es],
    ['balise <script>', 'home.x.body', 'Hola <script>alert(1)</script>'],
    ['lien externe', 'home.x.body', 'Ver [aquí](https://example.test)'],
    ['lien javascript:', 'home.x.body', 'Ver [aquí](javascript:alert(1))'],
    ['lien protocole relatif', 'home.x.body', 'Ver [aquí](//example.test)'],
    ['URL nue', 'home.x.body', 'Visita www.example.test'],
    ['lien par référence', 'home.x.body', 'Ver [aquí][1]\n\n[1]: /ayuda'],
  ])('%s : refusé par la base (23514)', async (_label, key, body) => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      await expect(
        content(client, admin.hash, 'save', key, null, { ...BODIES, es: body }),
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  it.each([null, ...COUNTRIES.map((c) => c.country)])(
    'pays %s : quatre langues publiées ensemble, la précédente archivée, retour arrière par copie',
    async (country) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', ALL);
        const key = `home.hero_${randomUUID().slice(0, 8)}.title`;
        const v1 = await content(client, admin.hash, 'save', key, country, BODIES);
        expect(v1).toEqual({ outcome: 'SAVED', version_no: 1 });
        expect((await content(client, admin.hash, 'publish', key, country, 1)).outcome).toBe(
          'PUBLISHED',
        );
        const v2bodies = {
          es: 'Hola [ayuda](/ayuda)',
          en: 'Hello [help](/help)',
          fr: 'Bonjour [aide](/aide)',
          pt: 'Olá [ajuda](/ajuda)',
        };
        expect((await content(client, admin.hash, 'save', key, country, v2bodies)).version_no).toBe(
          2,
        );
        // public : la version 1 seulement, dans les quatre langues
        const read = async (): Promise<
          Array<{ locale: string; version_no: number; body_md: string }>
        > =>
          (
            await client.query<{ locale: string; version_no: number; body_md: string }>(
              `SELECT locale, version_no, body_md FROM core.config_content_block
                WHERE block_key = $1 AND country_code IS NOT DISTINCT FROM $2 ORDER BY locale`,
              [key, country],
            )
          ).rows;
        expect(await read()).toEqual([
          { locale: 'en', version_no: 1, body_md: BODIES.en },
          { locale: 'es', version_no: 1, body_md: BODIES.es },
          { locale: 'fr', version_no: 1, body_md: BODIES.fr },
          { locale: 'pt', version_no: 1, body_md: BODIES.pt },
        ]);
        expect((await content(client, admin.hash, 'publish', key, country, 2)).outcome).toBe(
          'PUBLISHED',
        );
        expect((await read()).map((r) => r.version_no)).toEqual([2, 2, 2, 2]);
        expect((await content(client, admin.hash, 'publish', key, country, 2)).outcome).toBe(
          'NOT_DRAFT',
        );
        expect((await content(client, admin.hash, 'publish', key, country, 9)).outcome).toBe(
          'NOT_FOUND',
        );

        const back = await content(client, admin.hash, 'rollback', key, country, null);
        expect(back).toEqual({ outcome: 'ROLLED_BACK', version_no: 3 });
        expect(await read()).toEqual([
          { locale: 'en', version_no: 3, body_md: BODIES.en },
          { locale: 'es', version_no: 3, body_md: BODIES.es },
          { locale: 'fr', version_no: 3, body_md: BODIES.fr },
          { locale: 'pt', version_no: 3, body_md: BODIES.pt },
        ]);
        const rows = (
          await client.query<{ version_no: number; status: string; copied_from_id: string | null }>(
            'SELECT * FROM test_fixture.content_blocks($1)',
            [key],
          )
        ).rows;
        expect(rows.map((r) => `${r.version_no}:${r.status}`)).toEqual([
          ...['1:ARCHIVED', '1:ARCHIVED', '1:ARCHIVED', '1:ARCHIVED'],
          ...['2:ARCHIVED', '2:ARCHIVED', '2:ARCHIVED', '2:ARCHIVED'],
          ...['3:PUBLISHED', '3:PUBLISHED', '3:PUBLISHED', '3:PUBLISHED'],
        ]);
        expect(rows.filter((r) => r.version_no === 3).every((r) => r.copied_from_id !== null)).toBe(
          true,
        );
        expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
          action_code: 'CONTENT_ROLLED_BACK',
          before: { versionNo: 2 },
          after: { blockKey: key, versionNo: 3, copiedFromVersionNo: 1 },
        });
        if (country !== null) {
          expect((await auditOf(client, admin.userId)).at(-1)?.after?.['countries']).toEqual([
            country,
          ]);
        }
      });
    },
  );
});

describe('revue code US-034 : textes alternatifs, rejeux, rapport lié à la version', () => {
  it.each(['es', 'en', 'fr', 'pt'] as const)(
    'texte alternatif %s absent (NULL) ou vide : refusé par la base (23514), rien n’est écrit',
    async (locale) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', ALL);
        for (const value of [null, '   ']) {
          const alt = { es: 'Logotipo', en: 'Logo', fr: 'Logo', pt: 'Logotipo', [locale]: value };
          await expect(
            registerAsset(client, admin.hash, 'LOGO', 'image/png', alt),
          ).rejects.toMatchObject({
            code: '23514',
          });
        }
        // une police n'a pas de texte alternatif
        const font = await registerAsset(client, admin.hash, 'FONT', 'font/woff2', {
          es: null,
          en: null,
          fr: null,
          pt: null,
        });
        expect(font.outcome).toBe('REGISTERED');
      });
    },
  );

  it('rapport de contraste d’une AUTRE version : refusé (REPORT_VERSION_MISMATCH), journalisé, rien ne change', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const other = structuredClone(TINTA);
      (other['meta'] as Record<string, unknown>)['version'] = '9.9.9';
      const a = await saveDraft(client, admin.hash, 'A');
      const b = await client.query<Outcome>(
        `SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, 'B', $4, 1, NULL, NULL, NULL, NULL)`,
        [admin.hash, uuid(), uuid(), other],
      );
      const bId = b.rows[0]?.version_id ?? '';
      const before = (await published(client)).map((v) => v.id);
      const forged = { ...PASSED, tokensSha256: await shaOf(client, a.version_id ?? '') };
      expect((await publish(client, admin.hash, bId, forged)).outcome).toBe(
        'CONTRAST_INSUFFICIENT',
      );
      expect((await published(client)).map((v) => v.id)).toEqual(before);
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'BRAND_PUBLISH_REFUSED',
        subject_id: bId,
        after: { reason: 'REPORT_VERSION_MISMATCH' },
      });
      // le même rapport, pour SA version, passe
      expect((await publish(client, admin.hash, a.version_id ?? '', forged)).outcome).toBe(
        'PUBLISHED',
      );
    });
  });

  it('rejeu concurrent d’un brouillon (même requête, 6 connexions) : une seule version, aucune erreur', async () => {
    const clients: pg.Client[] = [];
    try {
      for (let i = 0; i < 6; i += 1) clients.push(await connectAs('app_api'));
      const first = clients[0] as pg.Client;
      const admin = await elevatedStaff(first, 'ADMIN', ALL);
      const requestId = uuid();
      const results = await Promise.all(
        clients.map(
          async (c) =>
            (
              await c.query<Outcome>(
                `SELECT * FROM core.cfg_brand_cmd_save_draft($1, $2, $3, 'Rejeu', $4, 1, NULL, NULL, NULL, NULL)`,
                [admin.hash, requestId, uuid(), TINTA],
              )
            ).rows[0],
        ),
      );
      expect(results.filter((r) => r?.outcome === 'SAVED')).toHaveLength(1);
      expect(results.filter((r) => r?.outcome === 'DUPLICATE')).toHaveLength(5);
      expect(new Set(results.map((r) => r?.version_id)).size).toBe(1);
    } finally {
      for (const c of clients) await releaseClient(c);
    }
  });

  it('rejeu d’un retour arrière : DUPLICATE avec la version source d’origine, même si la cible par défaut a changé', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const a = await saveDraft(client, admin.hash, 'Source A');
      await publish(client, admin.hash, a.version_id ?? '');
      const b = await saveDraft(client, admin.hash, 'Source B');
      await publish(client, admin.hash, b.version_id ?? '');
      const requestId = uuid();
      const call = async (target: string): Promise<Record<string, unknown> | undefined> =>
        (
          await client.query<Record<string, unknown>>(
            'SELECT * FROM core.cfg_brand_cmd_rollback($1, $2, $3, $4, $5)',
            [admin.hash, requestId, uuid(), target, await bound(client, target, PASSED)],
          )
        ).rows[0];
      expect(await call(a.version_id ?? '')).toMatchObject({
        outcome: 'ROLLED_BACK',
        copied_from_id: a.version_id,
      });
      // rejeu avec une autre cible (B, désormais archivée) : la réponse reste celle d'origine
      expect(await call(b.version_id ?? '')).toMatchObject({
        outcome: 'DUPLICATE',
        copied_from_id: a.version_id,
      });
    });
  });
});

/**
 * test:int — socle de marque de bout en bout sur la base jetable du banc de @rueda/db, sous
 * app_api (assertion L0-05 par connectAs, une connexion par test) : `BrandConsoleService` +
 * `PgBrandStore` + commandes `core.cfg_brand_*` / `core.cfg_content_*` (0042), avec le VRAI
 * contrôle de contraste d'US-030 (@rueda/design-tokens) et la liste des polices approuvées.
 *
 * Critères de 19 US-034 :
 * 1. un brouillon publié devient actif atomiquement ; la précédente reste dans l'historique ;
 * 2. retour arrière en un clic : la précédente redevient active, l'action est journalisée ;
 * 3. police hors liste : FONT_NOT_APPROVED (rien n'est écrit) ;
 * 4. paire texte / fond sous AA : publication refusée, paire nommée (même contrôle qu'US-030),
 *    refus journalisé en base — sans l'écran US-120.
 * Oracle de la paire : README de @rueda/design-tokens (Lienzo · Azur refusée, « lien primary sur
 * verre 3,89:1 (clair) »). Pays lus en base (aucune constante).
 *
 * US-121 (blocs éditables, ADR-095, migration 0060) : registre des blocs injecté (une clé tirée
 * au hasard par test, déclarée au registre, isole les tests sur la base partagée) ; texte
 * juridique refusé et JOURNALISÉ par la base ; signalement au back-office réservé à `brand.edit`.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { paletteDocument } from '@rueda/design-tokens';
import { EDITABLE_BLOCKS } from '@rueda/i18n';
import type { EditableBlock } from '@rueda/i18n';
import { connectAs, releaseClient } from '@rueda/db/testing';
// types du contexte fourni par le globalSetup du banc (inject('ruedaBench'))
import type {} from '@rueda/db/testing/global-setup';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrandAccessError, BrandConsoleService, BrandReadService } from './brand.service.js';
import { BrandError } from './errors.js';
import { loadBrandParams } from './params.js';
import { PgBrandStore } from './store.js';

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

let client: pg.Client;
let read: BrandReadService;
let brand: BrandConsoleService;
/** Registre des blocs du test : celui du produit, plus les clés tirées par chaque test. */
const REGISTRY: Record<string, EditableBlock> = { ...EDITABLE_BLOCKS };
const TEST_BLOCK: EditableBlock = { catalogKey: 'web.s01.title', format: 'plain', maxLength: 80 };
const testKey = (prefix: string): string => {
  const key = `home.${prefix}_${randomUUID().slice(0, 8)}.title`;
  REGISTRY[key] = TEST_BLOCK;
  return key;
};

beforeEach(async () => {
  client = await connectAs('app_api');
  const options = {
    store: new PgBrandStore(client),
    files: new InMemoryFileStore(),
    params: loadBrandParams(),
    blocks: REGISTRY,
  };
  read = new BrandReadService(options);
  brand = new BrandConsoleService(options, read);
});

afterEach(async () => {
  await releaseClient(client);
});

const countries = async (): Promise<string[]> =>
  (
    await client.query<{ code: string }>(
      'SELECT code::text AS code FROM core.config_country ORDER BY code',
    )
  ).rows.map((r) => r.code);

/** Compte staff ACTIVE, rôle, session déjà élevée (fixture 9650 : la MFA est prouvée ailleurs). */
async function staff(
  role: string,
  scope: readonly string[],
): Promise<{ userId: string; hash: Buffer }> {
  const userId = randomUUID();
  await client.query(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, 'Int', 'Brand', 'es', $4, $5, 86400, NULL, NULL, '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]'::jsonb, false)`,
    [userId, `brand-${userId}@example.test`, PHC, randomUUID(), randomBytes(32)],
  );
  await client.query(`SELECT test_fixture.iam_set_account_status($1, 'ACTIVE')`, [userId]);
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [randomUUID(), userId, role, scope],
  );
  const hash = createHash('sha256').update(randomBytes(32)).digest();
  await client.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [userId, hash]);
  return { userId, hash };
}

async function audit(
  actor: string,
): Promise<Array<{ action_code: string; after: Record<string, unknown> | null }>> {
  return (
    await client.query<{ action_code: string; after: Record<string, unknown> | null }>(
      'SELECT action_code, after FROM test_fixture.audit_rows_of_actor($1)',
      [actor],
    )
  ).rows;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (error) {
    return error;
  }
  throw new Error('aucune erreur');
}

describe('socle de marque de bout en bout (PostgreSQL, app_api)', () => {
  it('critères 1 et 2 : publication atomique, historique, retour arrière en un clic journalisé ; cache vidé', async () => {
    const admin = await staff('ADMIN', await countries());
    const a = await brand.saveDraft(admin.hash, {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-tinta',
    });
    await brand.publish(admin.hash, randomUUID(), a.versionId ?? '');
    expect(await read.publishedTheme()).toMatchObject({
      versionId: a.versionId,
      brandName: 'Kmino',
    });

    // retouche : nouvelle version, ancienne palette (Grafito), publiée
    const b = await brand.saveDraft(admin.hash, {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-grafito',
    });
    await brand.publish(admin.hash, randomUUID(), b.versionId ?? '');
    const live = await read.publishedTheme();
    expect(live?.versionId).toBe(b.versionId);
    expect(live?.css).toContain('--color-primary:');
    const history = await brand.versions(admin.hash);
    expect(history.find((v) => v.id === a.versionId)?.status).toBe('ARCHIVED');
    expect(history.filter((v) => v.status === 'PUBLISHED').map((v) => v.id)).toEqual([b.versionId]);

    // un clic : la précédente (A) redevient active par une nouvelle version copiée
    const r = await brand.rollback(admin.hash, randomUUID());
    expect(r.copiedFromId).toBe(a.versionId);
    const after = await read.publishedTheme();
    expect(after).toMatchObject({ versionId: r.versionId, brandName: 'Kmino' });
    expect(after?.tokens).toEqual(paletteDocument('lienzo-tinta'));
    expect((await audit(admin.userId)).map((x) => x.action_code)).toEqual([
      'BRAND_DRAFT_SAVED',
      'BRAND_PUBLISHED',
      'BRAND_DRAFT_SAVED',
      'BRAND_PUBLISHED',
      'BRAND_ROLLED_BACK',
    ]);
  });

  it('critère 4 : paire sous AA => refus nommant la paire (contrôle d’US-030), journalisé, rien ne change', async () => {
    const admin = await staff('ADMIN', await countries());
    const before = (await read.publishedTheme())?.versionId ?? null;
    const azur = await brand.saveDraft(admin.hash, {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-azur',
    });
    const error = await caught(brand.publish(admin.hash, randomUUID(), azur.versionId ?? ''));
    expect(error).toBeInstanceOf(BrandError);
    expect((error as BrandError).code).toBe('BRAND_CONTRAST_INSUFFICIENT');
    expect((error as BrandError).details?.['failures']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ mode: 'light', pair: 'primary / glass', ratio: 3.89 }),
      ]),
    );
    read.invalidate();
    expect((await read.publishedTheme())?.versionId ?? null).toBe(before);
    const refused = (await audit(admin.userId)).at(-1);
    expect(refused?.action_code).toBe('BRAND_PUBLISH_REFUSED');
    expect(refused?.after?.['failures']).toEqual(
      expect.arrayContaining([expect.objectContaining({ pair: 'primary / glass' })]),
    );
  });

  it('critère 3 : police hors liste approuvée => FONT_NOT_APPROVED, aucune version écrite', async () => {
    const admin = await staff('ADMIN', await countries());
    const doc = paletteDocument('lienzo-tinta');
    const family = (doc['font'] as Record<string, Record<string, Record<string, unknown>>>)[
      'family'
    ];
    if (family) family['body'] = { $value: ['Comic Neue', 'sans-serif'], $type: 'fontFamily' };
    const count = (await brand.versions(admin.hash, null, 100)).length;
    const error = await caught(
      brand.saveDraft(admin.hash, { requestId: randomUUID(), brandName: 'Kmino', tokens: doc }),
    );
    expect(error).toMatchObject({ code: 'FONT_NOT_APPROVED', details: { fonts: ['Comic Neue'] } });
    expect(await brand.versions(admin.hash, null, 100)).toHaveLength(count);
  });

  it('rôle sans brand.publish : FORBIDDEN, refus journalisé par la base', async () => {
    const ops = await staff('OPS_AGENT', await countries());
    const error = await caught(
      brand.saveDraft(ops.hash, {
        requestId: randomUUID(),
        brandName: 'Kmino',
        fromPalette: 'lienzo-tinta',
      }),
    );
    expect(error).toBeInstanceOf(BrandAccessError);
    expect((error as BrandAccessError).outcome).toBe('FORBIDDEN');
    expect((await audit(ops.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
  });

  it('blocs de contenu : quatre langues publiées par pays, repli es signalé côté lecture, retour arrière', async () => {
    const all = await countries();
    const admin = await staff('ADMIN', all);
    for (const country of [null, ...all]) {
      const key = testKey('hero');
      const v1 = await brand.saveContentDraft(admin.hash, randomUUID(), key, country, {
        es: 'Alquila el auto de un vecino.',
        en: 'Rent a car from a neighbor.',
        fr: 'Louez la voiture d’un voisin.',
        pt: 'Alugue o carro de um vizinho.',
      });
      await brand.publishContent(admin.hash, randomUUID(), key, country, v1.versionNo ?? 0);
      const v2 = await brand.saveContentDraft(admin.hash, randomUUID(), key, country, {
        es: 'Hola',
        en: 'Hello',
        fr: 'Bonjour',
        pt: 'Olá',
      });
      await brand.publishContent(admin.hash, randomUUID(), key, country, v2.versionNo ?? 0);
      for (const locale of ['es', 'en', 'fr', 'pt'] as const) {
        const blocks = await read.publishedContent(locale, country);
        expect(
          blocks.find((b) => b.key === key),
          `${String(country)} ${locale}`,
        ).toMatchObject({
          locale,
          fallback: false,
          versionNo: 2,
        });
      }
      const back = await brand.rollbackContent(admin.hash, randomUUID(), key, country);
      expect(back.versionNo).toBe(3);
      const fr = (await read.publishedContent('fr', country)).find((b) => b.key === key);
      expect(fr).toMatchObject({ bodyMd: 'Louez la voiture d’un voisin.', versionNo: 3 });
      const pt = (await read.publishedContent('pt', country)).find((b) => b.key === key);
      expect(pt).toMatchObject({ bodyMd: 'Alugue o carro de um vizinho.', versionNo: 3 });
    }
    await expect(
      brand.saveContentDraft(admin.hash, randomUUID(), 'home.hero.title', null, {
        es: 'Hola',
        en: 'Hello',
        fr: 'Bonjour',
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_BLOCK_REQUIRED_MISSING' });
  });

  it('actif : ligne file_asset BRAND puis dépôt ; servi seulement une fois référencé par une version publiée', async () => {
    const admin = await staff('ADMIN', await countries());
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), randomBytes(32)]);
    const asset = await brand.registerAsset(admin.hash, {
      requestId: randomUUID(),
      kind: 'LOGO',
      body: png,
      alt: {
        es: 'Logotipo de Kmino',
        en: 'Kmino logo',
        fr: 'Logo de Kmino',
        pt: 'Logotipo da Kmino',
      },
      licenseNote: 'Création interne',
    });
    expect(asset.sha256).toBe(createHash('sha256').update(png).digest('hex'));
    expect(await read.publicAsset(asset.assetId)).toBeNull();
    const d = await brand.saveDraft(admin.hash, {
      requestId: randomUUID(),
      brandName: 'Kmino',
      fromPalette: 'lienzo-tinta',
      logoAssetId: asset.assetId,
    });
    await brand.publish(admin.hash, randomUUID(), d.versionId ?? '');
    expect(await read.publicAsset(asset.assetId)).toMatchObject({
      kind: 'LOGO',
      mime: 'image/png',
    });
    expect((await read.publishedTheme())?.assets.logo).toMatchObject({
      id: asset.assetId,
      alt: {
        es: 'Logotipo de Kmino',
        en: 'Kmino logo',
        fr: 'Logo de Kmino',
        pt: 'Logotipo da Kmino',
      },
    });
  });

  it('US-121 critères 1 et 3 : bloc publié servi avec son arbre assaini ; texte juridique refusé et journalisé', async () => {
    const admin = await staff('ADMIN', await countries());
    const key = testKey('us121');
    const v = await brand.saveContentDraft(admin.hash, randomUUID(), key, null, {
      es: 'Texto **nuevo**',
      en: 'New text',
      fr: 'Nouveau texte',
      pt: 'Texto novo',
    });
    await brand.publishContent(admin.hash, randomUUID(), key, null, v.versionNo ?? 0);
    expect((await read.publishedContent('fr', null)).find((b) => b.key === key)).toMatchObject({
      locale: 'fr',
      fallback: false,
      format: 'plain',
      doc: { format: 'plain', text: 'Nouveau texte' },
    });
    // bloc complet : rien à signaler pour lui
    expect((await brand.contentGaps(admin.hash)).filter((g) => g.key === key)).toEqual([]);

    const legal = `legal.us121_${randomUUID().slice(0, 8)}.body`;
    const error = await caught(
      brand.saveContentDraft(admin.hash, randomUUID(), legal, null, {
        es: 'Términos',
        en: 'Terms',
        fr: 'Conditions',
        pt: 'Termos',
      }),
    );
    expect(error).toBeInstanceOf(BrandError);
    expect((error as BrandError).code).toBe('CONTENT_KEY_FORBIDDEN');
    expect((await audit(admin.userId)).at(-1)).toMatchObject({
      action_code: 'CONTENT_KEY_REFUSED',
      after: { blockKey: legal, reason: 'LEGAL_TEXT' },
    });
    const rows = await client.query(
      'SELECT 1 FROM core.config_content_block WHERE block_key = $1',
      [legal],
    );
    expect(rows.rowCount).toBe(0);
  });

  it('US-121 : signalement au back-office réservé à brand.edit (OPS : 403)', async () => {
    const ops = await staff('OPS_AGENT', await countries());
    const error = await caught(brand.contentGaps(ops.hash));
    expect(error).toBeInstanceOf(BrandAccessError);
    expect((error as BrandAccessError).outcome).toBe('FORBIDDEN');
  });
});

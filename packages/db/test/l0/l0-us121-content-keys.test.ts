/**
 * Preuves de la migration 0059 (US-121, ADR-095) sous le rôle de production app_api (assertion
 * L0-05 en tête de chaque test par withRole), avec des membres du staff élevés par les VRAIES
 * commandes (support/staff.ts).
 *
 * Critère 3 de 19 US-121 : « Given un texte juridique (CGU, contrat, politique d'annulation),
 * When on tente de l'éditer comme bloc, Then refus : il reste un gabarit versionné ». Attendus :
 * ces trois exemples de la story (et leurs équivalents es / fr / pt), 17 §3.2.13 (`legal.*`
 * refusé). La base refuse, journalise la tentative et n'écrit rien ; le CHECK de la table est en
 * place (validé) ; le motif SQL est identique, caractère pour caractère, à `LEGAL_BLOCK_KEY` de
 * `@rueda/i18n` (même liste dans l'API et dans la base).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { withRole } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import { auditOf, elevatedStaff, installTestProofKey, uuid } from '../support/staff.ts';

const ALL = COUNTRIES.map((c) => c.country);
const BODIES = {
  es: 'Términos del servicio',
  en: 'Terms of service',
  fr: 'Conditions du service',
  pt: 'Termos do serviço',
};

beforeAll(async () => {
  await withRole('app_api', async (client) => {
    await installTestProofKey(client);
  });
});

async function save(
  client: pg.ClientBase,
  hash: Buffer,
  key: string,
  country: string | null,
  bodies: object = BODIES,
): Promise<{ outcome: string; version_no: number | null }> {
  const { rows } = await client.query<{ outcome: string; version_no: number | null }>(
    'SELECT * FROM core.cfg_content_cmd_save_draft($1, $2, $3, $4, $5, NULL)',
    [hash, uuid(), key, country, bodies],
  );
  return rows[0] ?? { outcome: '', version_no: null };
}

const suffix = (): string => randomUUID().slice(0, 8);

describe('critère 3 — texte juridique : refusé par la base, tentative journalisée, rien n’est écrit', () => {
  it.each([
    // CGU (es, en, fr, pt)
    ['page.cgu', 'body'],
    ['legal.terms', 'body'],
    ['help.terminos', 'x'],
    ['footer.terms', 'link'],
    // contrat
    ['trip.contract', 'body'],
    ['trip.contrato', 'body'],
    ['trip.contrat', 'body'],
    // politique d'annulation
    ['checkout.cancellation_policy', 'body'],
    ['help.politica_cancelacion', 'body'],
    ['help.politique_annulation', 'body'],
    ['help.politica_cancelamento', 'body'],
    // confidentialité, assurance, remboursement
    ['footer.privacy', 'body'],
    ['protection.plans', 'body'],
    ['home.insurance', 'body'],
    ['home.refund', 'title'],
  ])('%s.%s… : KEY_FORBIDDEN, CONTENT_KEY_REFUSED journalisé', async (prefix, leaf) => {
    // « terminos » n'est pas dans la liste : seuls les mots qui nomment un texte juridique le sont
    const legal = prefix !== 'help.terminos';
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      const key = `${prefix}.k${suffix()}.${leaf}`;
      const r = await save(client, admin.hash, key, null);
      if (!legal) {
        expect(r.outcome).toBe('SAVED');
        return;
      }
      expect(r).toEqual({ outcome: 'KEY_FORBIDDEN', version_no: null });
      expect((await auditOf(client, admin.userId)).at(-1)).toMatchObject({
        action_code: 'CONTENT_KEY_REFUSED',
        subject_type: 'CONTENT_BLOCK',
        after: { blockKey: key, reason: 'LEGAL_TEXT' },
      });
      expect(
        (await client.query('SELECT * FROM test_fixture.content_blocks($1)', [key])).rows,
      ).toEqual([]);
    });
  });

  it.each([null, ...ALL])(
    'pays %s : refus même avec un corps vide ou incomplet (aucun corps n’est requis pour refuser)',
    async (country) => {
      await withRole('app_api', async (client) => {
        const admin = await elevatedStaff(client, 'ADMIN', ALL);
        for (const bodies of [{}, { es: 'Solo es' }]) {
          expect(
            (await save(client, admin.hash, `legal.k${suffix()}.body`, country, bodies)).outcome,
          ).toBe('KEY_FORBIDDEN');
        }
      });
    },
  );

  it('droits d’abord : sans session AUTH_REQUIRED, sans brand.edit FORBIDDEN (refus d’accès journalisé)', async () => {
    await withRole('app_api', async (client) => {
      expect((await save(client, Buffer.alloc(32, 9), 'legal.k.body', null, {})).outcome).toBe(
        'AUTH_REQUIRED',
      );
      const ops = await elevatedStaff(client, 'OPS_AGENT', ALL);
      expect((await save(client, ops.hash, `legal.k${suffix()}.body`, null, {})).outcome).toBe(
        'FORBIDDEN',
      );
      expect((await auditOf(client, ops.userId)).at(-1)?.action_code).toBe('STAFF_FORBIDDEN');
    });
  });

  it('clé non juridique : enregistrée comme avant (aucune régression de 0043)', async () => {
    await withRole('app_api', async (client) => {
      const admin = await elevatedStaff(client, 'ADMIN', ALL);
      for (const key of [
        `home.hero_${suffix()}.title`,
        `home.how_${suffix()}.body`,
        `faq.pickup_${suffix()}.where`,
      ]) {
        expect(await save(client, admin.hash, key, null)).toEqual({
          outcome: 'SAVED',
          version_no: 1,
        });
      }
    });
  });
});

describe('filet de la table et parité avec l’API', () => {
  it('contrainte content_block_key_not_legal_text en place et validée ; celle de 0042 aussi', async () => {
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ conname: string; convalidated: boolean }>(
        `SELECT conname, convalidated FROM pg_catalog.pg_constraint
          WHERE conrelid = 'core.config_content_block'::regclass AND contype = 'c'
            AND conname IN ('content_block_key_not_legal', 'content_block_key_not_legal_text')
          ORDER BY conname`,
      );
      expect(rows).toEqual([
        { conname: 'content_block_key_not_legal', convalidated: true },
        { conname: 'content_block_key_not_legal_text', convalidated: true },
      ]);
    });
  });

  it('motif SQL identique à LEGAL_BLOCK_KEY de @rueda/i18n (caractère pour caractère)', async () => {
    const source = readFileSync(
      new URL('../../../i18n/src/editable-blocks.ts', import.meta.url),
      'utf8',
    );
    const ts = /export const LEGAL_BLOCK_KEY =\s*\/(.+)\/;/.exec(source)?.[1];
    expect(ts).toBeDefined();
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<{ def: string }>(
        `SELECT pg_catalog.pg_get_functiondef('core.cfg_content_key_not_legal(text)'::regprocedure) AS def`,
      );
      const sql = /p_key !~ '([^']+)'/.exec(rows[0]?.def ?? '')?.[1];
      expect(sql).toBe(ts);
    });
  });

  it('fonction de motif : non exécutable par app_api, app_worker, app_anon (seul iam_staff_owner)', async () => {
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        await expect(
          client.query(`SELECT core.cfg_content_key_not_legal('home.hero.title')`),
        ).rejects.toMatchObject({ code: '42501' });
      });
    }
  });
});

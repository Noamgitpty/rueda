/**
 * US-046 — données personnelles sous les rôles de production, en PA et en PY (17 §3.1.3, §3.1.4 ;
 * ADR-026 ; 08 BR-ACC-09 ; ADR-081).
 *
 * Critère 2 de 19 US-046 : « Given une personne, When son export est demandé, Then toutes ses
 * données lisibles sont exportées ; When sa clé est détruite, Then ses colonnes C2 / C3 deviennent
 * illisibles sans casser les registres. »
 * Preuves :
 * - inventaire = catalogue de la base de production : toute colonne réelle est classée (une colonne
 *   nouvelle non classée fait échouer ce test), aucune entrée orpheline ; chaque colonne
 *   « crypto-shredding » est un `bytea` dont les colonnes de clé existent ;
 * - export en libre-service, sous `app_api` avec la session de la personne : toutes les tables
 *   qu'elle peut lire d'elle-même (matrice d'US-043) y sont, avec exactement SES lignes (attendus
 *   tirés du monde de test, pas de l'export), sans aucun secret (C4) ni donnée d'une autre personne,
 *   et l'hôte n'y reçoit aucune donnée C2 du voyageur ;
 * - destruction de la clé : pour CHAQUE colonne et contenu de fichier marqués « crypto-shredding »
 *   dans l'inventaire, les octets du sujet restent identiques mais illisibles, aucune ligne n'est
 *   ajoutée ni retirée des registres, la chaîne d'audit reste valide, et le sujet de l'autre pays
 *   reste lisible.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { setSessionContext } from '../../src/index.ts';
import {
  appendAuditLog,
  columnAad,
  open,
  receiveFile,
  SubjectKeyStore,
  verifyFileAsset,
} from '../../src/audit/index.ts';
import type { SubjectRef } from '../../src/audit/index.ts';
import {
  checkInventoryCoverage,
  classOf,
  exportOwnPersonalData,
  isPersonalPredicate,
  loadAuthorizationMatrix,
  loadPersonalDataInventory,
} from '../../src/privacy/index.ts';
import type { PersonalExport } from '../../src/privacy/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { auditTx, setActor, uuid, VERIFIER, verifyChainIn } from '../support/audit.ts';
import type { ActorContext } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import { account, buildWorld } from '../support/rls.ts';
import type { World } from '../support/rls.ts';

const inventory = loadPersonalDataInventory();
const matrix = loadAuthorizationMatrix();
// US-049 (0057, F-RLS-06) : seuls des travailleurs nommés écrivent l'audit et lisent les clés de
// sujet ; `privacy_request` (demandes des personnes, PROPOSÉ) remplace le nom de test libre.
const WRITER: ActorContext = { kind: 'WORKER', worker: 'privacy_request' };
const EVIDENCE: ActorContext = { kind: 'WORKER', worker: 'evidence_verifier' };

let world: World;

beforeAll(async () => {
  world = await withRole('app_api', (api) => buildWorld(api, COUNTRIES));
});

/** Export dans la session de la personne (contexte posé par la couche d'accès), annulé. */
async function exportAs(ctx: Parameters<typeof setSessionContext>[1]): Promise<PersonalExport> {
  return withRole('app_api', (client) =>
    withTestTransaction(client, {}, async (tx) => {
      await setSessionContext(tx, ctx);
      return exportOwnPersonalData(tx, inventory, matrix);
    }),
  );
}

const idsOf = (exp: PersonalExport, table: string, column = 'id'): string[] =>
  (exp[table] ?? []).map((r) => String(r[column])).sort();

/** Tables lisibles « d'elle-même » par un acteur, d'après la matrice d'US-043 (pas l'export). */
const personalTablesOf = (actor: 'voyageur' | 'hote'): string[] =>
  Object.entries(matrix.relations)
    .filter(([, r]) => r.type === 'table' && isPersonalPredicate(r.lecture?.[actor]))
    .map(([t]) => t)
    .sort();

const C4_COLUMNS = Object.values(inventory.tables).flatMap((t) =>
  Object.entries(t.columns)
    .filter(([, e]) => classOf(e) === 'C4')
    .map(([c]) => c),
);

describe('US-046 — inventaire des données personnelles = catalogue de production', () => {
  it('toute colonne de toute table de production est classée ; aucune entrée orpheline', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const { rows } = await client.query<{ rel: string; col: string; type: string }>(
          `SELECT n.nspname || '.' || c.relname AS rel, a.attname AS col,
                  pg_catalog.format_type(a.atttypid, a.atttypmod) AS type
             FROM pg_catalog.pg_class c
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
            WHERE n.nspname IN ('core', 'platform', 'app') AND c.relkind IN ('r', 'p')
            ORDER BY 1, a.attnum`,
        );
        const actual = new Map<string, string[]>();
        const types = new Map<string, string>();
        for (const r of rows) {
          actual.set(r.rel, [...(actual.get(r.rel) ?? []), r.col]);
          types.set(`${r.rel}.${r.col}`, r.type);
        }
        expect(actual.size).toBeGreaterThan(50);
        expect(checkInventoryCoverage(inventory, actual)).toEqual([]);
        // crypto-shredding : octets chiffrés (bytea) ; colonnes de clé présentes
        for (const [table, t] of Object.entries(inventory.tables)) {
          for (const [col, e] of Object.entries(t.columns)) {
            if (typeof e === 'string' || e.erasure !== 'crypto-shredding') continue;
            expect(types.get(`${table}.${col}`), `${table}.${col}`).toBe('bytea');
            for (const k of e.key ?? []) expect(types.has(`${table}.${k}`)).toBe(true);
          }
        }
      },
      { database: 'production' },
    );
  });
});

describe.each(COUNTRIES.map((c, i) => [c.country, i] as const))(
  'US-046 — export en libre-service (%s)',
  (_country, index) => {
    it('voyageur : toutes ses données lisibles, seulement les siennes, sans secret', async () => {
      const exp = await exportAs({ kind: 'GUEST', actorId: world.guest1 });
      // toutes les tables qu'il lit de lui-même (matrice US-043) sont exportées
      for (const t of personalTablesOf('voyageur')) expect(Object.keys(exp)).toContain(t);
      // ses lignes, attendues d'après le monde (deux pays, un voyageur commun)
      const all = world.countries;
      expect(idsOf(exp, 'core.iam_user_account')).toEqual([world.guest1]);
      expect(String(exp['core.iam_user_account']?.[0]?.['email'])).toContain('@example.test');
      expect(idsOf(exp, 'core.booking_trip')).toEqual(
        all.flatMap((w) => [w.trips.a1.id, w.trips.b1.id]).sort(),
      );
      expect(idsOf(exp, 'core.booking_checkout_hold')).toEqual(all.map((w) => w.holds.h1).sort());
      expect(idsOf(exp, 'core.payment_payment_operation')).toEqual(
        all.flatMap((w) => [w.ops.a1, w.ops.b1, w.ops.h1]).sort(),
      );
      expect(idsOf(exp, 'core.booking_guest_occupancy', 'trip_id')).toEqual(
        all.flatMap((w) => [w.trips.a1.id, w.trips.b1.id]).sort(),
      );
      // rien d'une autre personne, aucun secret
      const text = JSON.stringify(exp);
      for (const other of [
        world.guest2,
        world.holderA,
        world.cohost,
        ...all.map((w) => w.holderB),
      ]) {
        expect(text).not.toContain(other);
      }
      for (const rows of Object.values(exp)) {
        for (const row of rows)
          for (const c4 of C4_COLUMNS) expect(Object.keys(row)).not.toContain(c4);
      }
      // le pays du cas : ses trips y sont
      const w = world.countries[index];
      if (!w) throw new Error('pays attendu');
      expect(idsOf(exp, 'core.booking_trip')).toContain(w.trips.a1.id);
    });

    it('hôte titulaire : les données de SON compte d’hôte de ce pays, aucune C2 du voyageur', async () => {
      const w = world.countries[index];
      if (!w) throw new Error('pays attendu');
      const exp = await exportAs({ kind: 'HOST', actorId: world.holderA, orgId: w.orgA });
      for (const t of personalTablesOf('hote')) expect(Object.keys(exp)).toContain(t);
      expect(idsOf(exp, 'core.iam_user_account')).toEqual([world.holderA]);
      expect(idsOf(exp, 'core.iam_organization')).toEqual([w.orgA]);
      expect(idsOf(exp, 'core.booking_trip')).toEqual([w.trips.a1.id, w.trips.a2.id].sort());
      const text = JSON.stringify(exp);
      // jamais l'autre pays ni l'autre hôte
      for (const other of world.countries.filter((x) => x !== w)) {
        expect(text).not.toContain(other.orgA);
        expect(text).not.toContain(other.trips.a1.id);
      }
      expect(text).not.toContain(w.orgB);
      // minimisation (17 §2.3) : aucune donnée C2 du voyageur (identifiant compris)
      expect(text).not.toContain(world.guest1);
      expect(text).not.toContain(world.guest2);
      expect(text).not.toContain(`rls-${world.guest1}@example.test`);
    });
  },
);

/** Colonnes et contenus « crypto-shredding » de l'inventaire (attendus pilotés par l'inventaire). */
const SHREDDED = Object.entries(inventory.tables).flatMap(([table, t]) => [
  ...Object.entries(t.columns)
    .filter(([, e]) => typeof e !== 'string' && e.erasure === 'crypto-shredding')
    .map(([col, e]) => ({ table, col, key: (e as { key: readonly [string, string] }).key })),
  ...(t.content ? [{ table, col: '(contenu du fichier)', key: t.content.key }] : []),
]);

describe('US-046 — destruction de la clé : C2 / C3 illisibles, registres intacts', () => {
  it('l’inventaire désigne les colonnes à détruire (journal d’audit et fichiers du sujet)', async () => {
    await withRole('app_worker', async () => undefined); // L0-05
    expect(SHREDDED.map((s) => `${s.table}.${s.col}`).sort()).toEqual([
      'core.audit_audit_log.ip_enc',
      'core.audit_file_asset.(contenu du fichier)',
      // consentements (US-102, 0059) : preuve C2 chiffrée par la clé du sujet
      'core.contract_consent.ip_enc',
      'core.contract_consent.user_agent_enc',
      // profil fiscal de l'hôte (US-123, 0075) : numéro chiffré par la clé du compte d'hôte
      'core.kyc_host_tax_profile.tax_id_enc',
    ]);
  });

  it('PA puis PY : seul le sujet effacé devient illisible ; comptes, octets et chaîne inchangés', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const store = new InMemoryFileStore();
    const people = await withRole('app_api', (api) =>
      withTestTransaction(api, { commit: true }, async (tx) => {
        const out: Array<{
          country: string;
          subject: SubjectRef;
          requestId: string;
          file: string;
        }> = [];
        for (const c of COUNTRIES)
          out.push({
            country: c.country,
            subject: { type: 'USER', id: await account(tx) },
            requestId: uuid(),
            file: uuid(),
          });
        return out;
      }),
    );
    const ip = (k: number): string => `203.0.113.${20 + k}`; // RFC 5737
    for (const [k, p] of people.entries()) {
      const w = world.countries[k];
      if (!w) throw new Error('pays attendu');
      await withRole('app_api', (client) =>
        auditTx(
          client,
          { actor: { kind: 'GUEST', actorId: p.subject.id }, commit: true },
          async (tx) => {
            await appendAuditLog(tx, keys, {
              actorUserId: p.subject.id,
              actorRole: 'GUEST',
              actionCode: 'TRIP_VIEWED',
              subjectType: 'TRIP',
              subjectId: w.trips.a1.id,
              ip: ip(k),
              requestId: p.requestId,
            });
            await receiveFile(
              tx,
              store,
              keys,
              {
                id: p.file,
                bucket: 'PRIVATE_EVIDENCE',
                storageKey: `us046/${p.file}.jpg`,
                mime: 'image/jpeg',
                uploaderUserId: p.subject.id,
                source: 'IN_APP_CAMERA',
                deviceCapturedAt: new Date(Date.now() - 60_000),
                classification: 'C3',
                retentionClass: 'CLAIM_EVIDENCE',
                encryptFor: p.subject,
              },
              [Buffer.concat([Buffer.from(`permis-${p.country}:`), randomBytes(1024)])],
            );
          },
        ),
      );
    }

    /** État des registres du sujet : octets du journal, contenu du fichier, comptes. */
    const registers = async (p: (typeof people)[number]) => {
      const audit = await withRole('app_worker', (client) =>
        auditTx(client, { actor: VERIFIER }, async (tx) => {
          const { rows } = await tx.query<{ ip_enc: Buffer; total: number }>(
            `SELECT ip_enc,
                    (SELECT count(*)::int FROM core.audit_audit_log
                      WHERE actor_user_id = $2
                         OR (subject_type = 'SUBJECT_KEY' AND subject_id = $2)) AS total
               FROM core.audit_audit_log WHERE request_id = $1`,
            [p.requestId, p.subject.id],
          );
          return rows[0];
        }),
      );
      const file = await withRole('app_worker', (client) =>
        auditTx(client, { actor: EVIDENCE }, async (tx) => {
          const { rows } = await tx.query<{ sha256: Buffer; total: number }>(
            `SELECT sha256,
                    (SELECT count(*)::int FROM core.audit_file_asset WHERE enc_subject_id = $2) AS total
               FROM core.audit_file_asset WHERE id = $1`,
            [p.file, p.subject.id],
          );
          return { row: rows[0], verdict: await verifyFileAsset(tx, store, keys, p.file) };
        }),
      );
      return { audit, file };
    };
    const readIp = async (p: (typeof people)[number], enc: Buffer): Promise<string | null> =>
      withRole('app_worker', (client) =>
        auditTx(client, { actor: WRITER }, async (tx) => {
          const dek = await keys.dekFor(tx, p.subject, 'read');
          if (dek.status !== 'OK') return null;
          return open(dek.dek, enc, columnAad('audit_log', 'ip_enc', p.subject)).toString('utf8');
        }),
      );

    const [first, second] = people;
    if (!first || !second) throw new Error('deux pays attendus');
    const before = await registers(first);
    const otherBefore = await registers(second);
    if (!before.audit || !otherBefore.audit) throw new Error('lignes d’audit attendues');
    expect(await readIp(first, before.audit.ip_enc)).toBe(ip(0));
    expect(before.file.verdict).toMatchObject({ status: 'MATCH' });

    // destruction de la clé du sujet du premier pays (procédure manuelle tracée, ADR-051)
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: WRITER, commit: true }, (tx) =>
        tx.query(
          `SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'demande d''effacement')`,
          [first.subject.id, uuid()],
        ),
      ),
    );

    const after = await registers(first);
    const other = await registers(second);
    // registres intacts : mêmes octets, mêmes empreintes ; seule la ligne SUBJECT_KEY_DESTROYED
    // s'ajoute au journal du sujet ; aucun de ses fichiers ajouté ni retiré
    expect(after.audit?.ip_enc).toEqual(before.audit.ip_enc);
    expect(after.audit?.total).toBe(before.audit.total + 1);
    expect(after.file.row?.sha256).toEqual(before.file.row?.sha256);
    expect(after.file.row?.total).toBe(before.file.row?.total);
    // C2 / C3 du sujet effacé : illisibles (colonne chiffrée et contenu du fichier)
    expect(await readIp(first, before.audit.ip_enc)).toBeNull();
    expect(after.file.verdict).toEqual({ status: 'UNREADABLE', reason: 'KEY_DESTROYED' });
    // l'autre pays, l'autre sujet : toujours lisible
    expect(await readIp(second, other.audit?.ip_enc as Buffer)).toBe(ip(1));
    expect(other.file.verdict).toMatchObject({ status: 'MATCH' });
    // la chaîne d'audit reste valide
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        await setActor(tx, VERIFIER);
        expect(await verifyChainIn(tx)).toMatchObject({ ok: true });
      }),
    );
  });
});

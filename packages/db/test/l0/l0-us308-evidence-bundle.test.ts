/**
 * US-308 — dossier de preuve d'un trip (migration 0165, ADR-184 ; fixture 9922, plus 9948, 9997,
 * 9300, 9650 et 9990). Rôles de PRODUCTION seulement (assertion L0-05 par `withRole`), au Panama
 * (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-308 (« le manifeste liste chaque fichier avec son SHA-256 et chaque
 * empreinte correspond » ; « lien expirant après 7 j »), de 16 CLM-034 (pièces : contrat, versions
 * des CGU acceptées, photos des deux parties avec heure serveur et SHA-256, journal d'événements ;
 * « pièce manquante → listée comme absente » ; REQUESTED → READY → EXPIRED ;
 * `EVIDENCE_EXPORT_FAILED` ; bêta : généré à la demande par l'ops), de 17 §2.3 (`data.export` OPS
 * « lim. : C2 de sa file », 403 journalisé ; ADR-122) et §3.2.13 (`data_access_log`, `file_asset`),
 * du pré-mortem du lot 3 (RT-L3-D03 : export par un autre hôte, par un agent sans dossier, lien
 * rejoué après 7 j, empreinte du manifeste modifiée ; RT-L3-P04 : objet remplacé après l'empreinte),
 * jamais du code testé. Les empreintes attendues sont recalculées ici par `node:crypto`.
 *
 * Données VALIDÉES (le travailleur lit sous une autre connexion) : un trip par pays et par test,
 * des photos d'état (US-303) déposées scellées dans un `InMemoryFileStore`, des comptes de staff.
 * Le travailleur `evidence_verifier` est rejoué ici pas à pas avec les vraies commandes (relecture
 * et recalcul par `readFileAsset`, dépôt en création seule) ; l'archive ZIP réelle est prouvée dans
 * `apps/api` (zip.test.ts, bundler.test.ts). Aucun interrupteur.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { InMemoryFileStore } from '@rueda/fake-adapters/files';
import { describe, expect, it } from 'vitest';
import { fileAad, open, readFileAsset, seal, SubjectKeyStore } from '../../src/audit/index.ts';
import { FakeKeyWrapper, withRole, withTestTransaction } from '../../src/testing/index.ts';
import { setActor } from '../support/audit.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { newHash } from '../support/golive.ts';
import { openSession, setVirtualNow } from '../support/iam.ts';
import { createStaff } from '../support/staff.ts';

type Tx = pg.ClientBase;
type Row = Record<string, unknown>;

const uuid = (): string => randomUUID();
const sha = (b: Buffer | string): Buffer =>
  createHash('sha256')
    .update(typeof b === 'string' ? Buffer.from(b, 'utf8') : b)
    .digest();
const plus = (iso: string, s: number): string => new Date(Date.parse(iso) + s * 1000).toISOString();

const T0 = '2035-07-01T09:00:00.000Z';
const T1 = plus(T0, 3600);
const T2 = plus(T0, 7200);
/** 19 US-308 : lien expirant après 7 j (seuil PROPOSÉ) = 168 h après la génération. */
const TTL_S = 7 * 24 * 3600;
const START = '2035-07-10T15:00:00.000Z';
const END = '2035-07-13T15:00:00.000Z';
const LINES: Readonly<Record<string, readonly { type: string; amountMinor: string }[]>> = {
  USD: [{ type: 'TRIP_PRICE', amountMinor: '12000' }],
  PYG: [{ type: 'TRIP_PRICE', amountMinor: '1000000' }],
};
const REASON = 'Litige de dommage : dossier pour l’assureur partenaire';

const REQUEST = `SELECT outcome, bundle_id::text AS bundle_id, status, manifest_sha256
  FROM core.support_staff_request_evidence_bundle($1, $2::uuid, $3::uuid, $4::uuid, $5, $6)`;
const STATUS =
  'SELECT outcome, body FROM core.support_staff_evidence_bundle($1, $2::uuid, $3::uuid)';
const OPEN = `SELECT outcome, file_id::text AS file_id, storage_key, sha256, bytes, manifest_sha256
  FROM core.support_staff_open_evidence_bundle($1, $2::uuid, $3::uuid, $4)`;
const CAPTURE = 'SELECT * FROM core.trip_cmd_open_photo_capture($1, $2::uuid, $3, $4)';
const POST = 'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)';
/** Numéros FICTIFS de test, au format de chaque pays (données de test, pas du code). */
const PHONE: Readonly<Record<string, string>> = { PA: '+507 6123-4567', PY: '+595 981 123 456' };
const HELLO = 'Hola, llego a las diez al punto de entrega';
const ADD = `SELECT * FROM core.trip_cmd_add_inspection_photo($1, $2::uuid, $3, $4::uuid, $5, $6::uuid,
                                                              $7, $8::bigint, $9, $10::timestamptz)`;
const DUE = 'SELECT bundle_id::text AS bundle_id FROM core.claim_worker_evidence_due($1)';
const SOURCE = `SELECT outcome, manifest, manifest_sha256, requested_by::text AS requested_by, contracts,
       messages
  FROM core.claim_worker_evidence_source($1::uuid)`;
const COMPLETE =
  'SELECT core.claim_worker_complete_evidence_bundle($1::uuid, $2::uuid, $3, $4, $5::bigint) AS r';
const FAIL = 'SELECT core.claim_worker_fail_evidence_bundle($1::uuid, $2, $3::jsonb) AS r';

interface Photo {
  readonly fileId: string;
  readonly slot: string;
  readonly side: 'GUEST' | 'HOST';
  readonly body: Buffer;
  readonly storageKey: string;
}

interface World {
  readonly trip: string;
  readonly guest: string;
  readonly holder: string;
  readonly photos: readonly Photo[];
  /** Texte reçu du message de l'hôte (numéro en clair : preuve, jamais dans le manifeste). */
  readonly phoneMessage: string;
}

/** Clé USER d'une personne (coffre de l'application, sous app_api, contexte de la personne). */
async function keyOf(
  tx: Tx,
  keys: SubjectKeyStore,
  kind: 'GUEST' | 'HOST' | 'STAFF',
  userId: string,
): Promise<Buffer> {
  await setActor(tx, { kind, actorId: userId });
  const k = await keys.dekFor(tx, { type: 'USER', id: userId }, 'create');
  if (k.status !== 'OK') throw new Error(`clé du sujet : ${k.status}`);
  return k.dek;
}

/** Une photo prise par la VRAIE commande d'US-303, déposée scellée par la clé de la personne. */
async function shoot(
  tx: Tx,
  keys: SubjectKeyStore,
  store: InMemoryFileStore,
  who: { hash: Buffer; id: string; side: 'GUEST' | 'HOST' },
  trip: string,
  slot: string,
): Promise<Photo> {
  const cap = (await tx.query<Row>(CAPTURE, [who.hash, trip, 'CHECKIN', slot])).rows[0]!;
  expect(cap['outcome'], slot).toBe('DONE');
  const body = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), randomBytes(512)]);
  const fileId = uuid();
  const r = (
    await tx.query<Row>(ADD, [
      who.hash,
      trip,
      'CHECKIN',
      cap['capture_id'],
      slot,
      fileId,
      'image/jpeg',
      body.length,
      sha(body),
      null,
    ])
  ).rows[0]!;
  expect(r['outcome'], slot).toBe('DONE');
  const storageKey = String(r['storage_key']);
  const dek = await keyOf(tx, keys, who.side, who.id);
  const sealed = seal(dek, body, fileAad(fileId, { type: 'USER', id: who.id }));
  expect((await store.put('PRIVATE_EVIDENCE', storageKey, sealed)).status).toBe('STORED');
  return { fileId, slot, side: who.side, body, storageKey };
}

/** Trip BOOKED (9948), CGU acceptées (9922), départ ouvert, photos des deux côtés. VALIDÉ. */
async function world(
  api: Tx,
  c: CountryCase,
  keys: SubjectKeyStore,
  store: InMemoryFileStore,
): Promise<World> {
  return withTestTransaction(api, { virtualNow: T0, commit: true }, async (tx) => {
    const guest = uuid();
    const { rows } = await tx.query<{ trip_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us214_trip($1, $2, 'Ana', 'Pérez', 'María', 'Gómez', $3, $4,
                                             $5::jsonb)`,
      [c.country, guest, START, END, JSON.stringify(LINES[c.currency])],
    );
    const trip = rows[0]!.trip_id;
    const holder = rows[0]!.holder_id;
    // CGU : acceptées AVANT la réservation (dans le dossier) ; une réacceptation APRÈS : exclue
    await tx.query('SELECT test_fixture.us308_consent($1, $2, $3)', [
      guest,
      'TOS_GUEST',
      plus(T0, -86_400),
    ]);
    await tx.query('SELECT test_fixture.us308_consent($1, $2, $3)', [
      holder,
      'TOS_HOST',
      plus(T0, -86_400),
    ]);
    await tx.query('SELECT test_fixture.us308_consent($1, $2, $3)', [
      guest,
      'PRIVACY',
      plus(T0, 600),
    ]);
    await tx.query('SELECT test_fixture.us207_force_status($1, $2)', [trip, 'CHECKIN_OPEN']);
    const g = { hash: (await openSession(tx, guest)).hash, id: guest, side: 'GUEST' as const };
    const h = { hash: (await openSession(tx, holder)).hash, id: holder, side: 'HOST' as const };
    const photos: Photo[] = [];
    photos.push(await shoot(tx, keys, store, g, trip, 'EXT_01'));
    // reprise du même angle une minute plus tard : les deux restent, la dernière compte
    await setVirtualNow(tx, plus(T0, 60));
    photos.push(await shoot(tx, keys, store, g, trip, 'EXT_01'));
    photos.push(await shoot(tx, keys, store, h, trip, 'ODOMETER'));
    // fil de messages (US-525) : un message ordinaire, un message dont le numéro est masqué (signalé)
    const phoneMessage = `Mi número es ${PHONE[c.country]!}`;
    for (const body of [HELLO, phoneMessage]) {
      const r = (await tx.query<Row>(POST, [g.hash, trip, uuid(), body])).rows[0]!;
      expect(r['outcome'], body).toBe('DONE');
    }
    return { trip, guest, holder, photos, phoneMessage };
  });
}

interface Staff {
  readonly id: string;
}

/** Compte de staff ACTIVE (rôle, portée pays) ; sessions élevées ouvertes dans chaque transaction. */
async function staff(api: Tx, role: string, countries: readonly string[]): Promise<Staff> {
  return { id: (await createStaff(api, role, countries, { withFactor: false })).userId };
}

/** Session élevée (9650) ouverte à l'heure de la transaction ; contexte STAFF de la personne. */
async function elevated(tx: Tx, who: Staff): Promise<Buffer> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [who.id, hash]);
  await setActor(tx, { kind: 'STAFF', actorId: who.id });
  return hash;
}

async function supportCase(
  tx: Tx,
  c: CountryCase,
  trip: string,
  assignee: string,
  status = 'OPEN',
): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.rls_insert_support_case($1, $2, $3, $4, $5, $6, $7)', [
    id,
    c.country,
    trip,
    assignee,
    status,
    'CLAIM',
    null,
  ]);
  return id;
}

async function audits(tx: Tx, actor: string, requestId: string): Promise<Row[]> {
  return (
    await tx.query<Row>(
      `SELECT action_code, after ->> 'reason' AS reason, after ->> 'field_or_file' AS field
         FROM test_fixture.audit_rows_of_actor($1) WHERE request_id = $2`,
      [actor, requestId],
    )
  ).rows;
}

async function request(
  tx: Tx,
  hash: Buffer,
  trip: string,
  caseId: string,
  requestId = uuid(),
): Promise<Row & { requestId: string }> {
  const r = (await tx.query<Row>(REQUEST, [hash, requestId, trip, caseId, 'INSURER', REASON]))
    .rows[0]!;
  return { ...r, requestId };
}

const bundleOf = async (tx: Tx, id: string): Promise<Row> =>
  (await tx.query<Row>('SELECT * FROM test_fixture.us308_bundle($1)', [id])).rows[0]!;

/** Travailleur `evidence_verifier` rejoué : relit et recalcule chaque fichier, puis dépose. */
async function generate(
  worker: Tx,
  keys: SubjectKeyStore,
  store: InMemoryFileStore,
  bundleId: string,
  at: string,
): Promise<{ outcome: string; zip: Buffer | null; verdicts: string[]; messages: string }> {
  return withTestTransaction(worker, { virtualNow: at, commit: true }, async (tx) => {
    await setActor(tx, { kind: 'WORKER', worker: 'evidence_verifier' });
    const due = (await tx.query<{ bundle_id: string }>(DUE, [100])).rows.map((r) => r.bundle_id);
    expect(due).toContain(bundleId);
    const src = (await tx.query<Row>(SOURCE, [bundleId])).rows[0]!;
    expect(src['outcome']).toBe('OK');
    // scellé : SHA-256 du texte exact du manifeste
    expect(sha(String(src['manifest'])).toString('hex')).toBe(src['manifest_sha256']);
    const manifest = JSON.parse(String(src['manifest'])) as { files: Row[] };
    const verdicts: string[] = [];
    for (const f of manifest.files) {
      if (f['kind'] === 'MESSAGES') {
        // document du fil : relu par la base, empreinte recalculée ici
        verdicts.push(sha(String(src['messages'])).toString('hex') === f['sha256'] ? 'MATCH' : 'X');
        continue;
      }
      const read = await readFileAsset(tx, store, keys, String(f['ref']));
      verdicts.push(
        read.status === 'MATCH' && read.sha256.toString('hex') === f['sha256']
          ? 'MATCH'
          : read.status,
      );
    }
    if (verdicts.some((v) => v !== 'MATCH')) {
      const findings = manifest.files
        .filter((_, i) => verdicts[i] !== 'MATCH')
        .map((f) => ({
          piece: String(f['kind']),
          ref: String(f['ref']),
          reason: 'SHA256_MISMATCH',
        }));
      const r = (
        await tx.query<{ r: string }>(FAIL, [
          bundleId,
          'INTEGRITY_MISMATCH',
          JSON.stringify(findings),
        ])
      ).rows[0]!.r;
      return { outcome: r, zip: null, verdicts, messages: String(src['messages']) };
    }
    const zip = Buffer.concat([Buffer.from(String(src['manifest']), 'utf8'), randomBytes(64)]);
    const requester = String(src['requested_by']);
    const k = await keys.dekFor(tx, { type: 'USER', id: requester }, 'read');
    if (k.status !== 'OK') throw new Error(`clé du demandeur : ${k.status}`);
    const fileId = uuid();
    const storageKey = `evidence-bundles/${bundleId}/${fileId}.zip`;
    const sealed = seal(k.dek, zip, fileAad(fileId, { type: 'USER', id: requester }));
    expect((await store.put('PRIVATE_EVIDENCE', storageKey, sealed)).status).toBe('STORED');
    // clé de stockage hors forme : refus, rien n'est écrit
    await tx.query('SAVEPOINT bad_key');
    await expect(
      tx.query(COMPLETE, [bundleId, fileId, `other/${fileId}.zip`, sha(zip), zip.length]),
    ).rejects.toMatchObject({ code: '22023' });
    await tx.query('ROLLBACK TO SAVEPOINT bad_key');
    const r = (
      await tx.query<{ r: string }>(COMPLETE, [bundleId, fileId, storageKey, sha(zip), zip.length])
    ).rows[0]!.r;
    // rejeu : le dossier n'est plus dû
    expect(
      (await tx.query<{ r: string }>(COMPLETE, [bundleId, uuid(), storageKey, sha(zip), 1]))
        .rows[0]!.r,
    ).toBe('NOT_DUE');
    return { outcome: r, zip, verdicts, messages: String(src['messages']) };
  });
}

describe.each(COUNTRIES)('US-308 — dossier de preuve ($country, $currency)', (c: CountryCase) => {
  it('critères 1 et 2 : manifeste scellé (chaque fichier, son SHA-256 ; CGU, journal, pièces absentes ; aucune donnée nominative), empreintes recalculées égales, archive du demandeur, lien de 168 h ; accès réservé à l’ops du dossier, journalisé (RT-L3-D03)', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const store = new InMemoryFileStore();
    const other = COUNTRIES.find((x) => x.country !== c.country)!;
    let bundleId = '';
    let manifestSha = '';
    await withRole('app_api', async (api) => {
      const w = await world(api, c, keys, store);
      const elsewhere = await world(api, c, keys, store); // autre trip, autre hôte, autre voyageur
      const ops = await staff(api, 'OPS_AGENT', [c.country]);
      const colleague = await staff(api, 'OPS_AGENT', [c.country]);
      const away = await staff(api, 'OPS_AGENT', [other.country]);
      const support = await staff(api, 'SUPPORT_AGENT', [c.country]);
      // l'hôte du trip est aussi agent OPS (séparation des tâches, ADR-122)
      await api.query(
        `SELECT test_fixture.iam_grant_staff_role($1, $2, 'OPS_AGENT', $3::text[], NULL, NULL)`,
        [uuid(), w.holder, [c.country]],
      );
      await withTestTransaction(api, { virtualNow: T1, commit: true }, async (tx) => {
        const caseId = await supportCase(tx, c, w.trip, ops.id);
        const closed = await supportCase(tx, c, w.trip, ops.id, 'CLOSED');
        const otherTrip = await supportCase(tx, c, elsewhere.trip, ops.id);
        const hostCase = await supportCase(tx, c, w.trip, w.holder);

        // autre hôte, voyageur du trip : leur session n'est pas une session élevée de staff
        for (const party of [elsewhere.holder, w.guest]) {
          const s = await openSession(tx, party);
          const r = await request(tx, s.hash, w.trip, caseId);
          expect(['AUTH_REQUIRED', 'MFA_REQUIRED']).toContain(r['outcome']);
          expect(r['bundle_id']).toBeNull();
        }
        // permission absente, autre pays, dossier d'un collègue, dossier clos, autre trip
        for (const [who, cid, expected, reason] of [
          [support, caseId, 'FORBIDDEN', 'PERMISSION'],
          [away, caseId, 'FORBIDDEN', 'PERMISSION'],
          [colleague, caseId, 'CASE_REQUIRED', 'CASE'],
          [ops, closed, 'CASE_REQUIRED', 'CASE'],
          [ops, otherTrip, 'CASE_REQUIRED', 'CASE'],
          [ops, uuid(), 'CASE_REQUIRED', 'CASE'],
        ] as const) {
          const r = await request(tx, await elevated(tx, who), w.trip, cid);
          expect(r['outcome'], `${expected} ${reason}`).toBe(expected);
          expect(await audits(tx, who.id, r.requestId)).toEqual([
            { action_code: 'STAFF_FORBIDDEN', reason, field: 'evidence_bundle' },
          ]);
        }
        // l'hôte du trip, agent OPS, sur son propre trip : SELF_FORBIDDEN journalisé
        const self = await request(tx, await elevated(tx, { id: w.holder }), w.trip, hostCase);
        expect(self['outcome']).toBe('SELF_FORBIDDEN');
        expect(await audits(tx, w.holder, self.requestId)).toEqual([
          { action_code: 'STAFF_FORBIDDEN', reason: 'SELF', field: 'evidence_bundle' },
        ]);
        // l'OPS assigné : dossier scellé ; clé USER du demandeur créée (elle chiffrera l'archive)
        const hash = await elevated(tx, ops);
        await keyOf(tx, keys, 'STAFF', ops.id);
        const ok = await request(tx, hash, w.trip, caseId);
        expect(ok).toMatchObject({ outcome: 'REQUESTED', status: 'REQUESTED' });
        bundleId = String(ok['bundle_id']);
        manifestSha = String(ok['manifest_sha256']);
        // rejeu de la même requête : le même dossier, rien de plus au journal
        const replay = await request(tx, hash, w.trip, caseId, ok.requestId);
        expect(replay).toMatchObject({ outcome: 'ALREADY_REQUESTED', bundle_id: bundleId });
        // journal d'accès (BULK_EXPORT, motif, dossier) et audit chaîné, une fois
        expect(
          (await tx.query<Row>('SELECT * FROM test_fixture.us109_access_log($1)', [ok.requestId]))
            .rows,
        ).toEqual([
          {
            actor_user_id: ops.id,
            actor_role: 'OPS_AGENT',
            subject_type: 'TRIP',
            subject_id: w.trip,
            field_or_file: `evidence_bundle:${bundleId}`,
            purpose: REASON,
            access_kind: 'BULK_EXPORT',
            case_ref: caseId,
          },
        ]);
        expect(await audits(tx, ops.id, ok.requestId)).toEqual([
          { action_code: 'STAFF_DATA_ACCESS', reason: null, field: `evidence_bundle:${bundleId}` },
        ]);

        // manifeste : scellé = SHA-256 du texte ; registres seulement
        const b = await bundleOf(tx, bundleId);
        expect(b).toMatchObject({ status: 'REQUESTED', purpose: 'INSURER', case_id: caseId });
        expect(sha(String(b['manifest_text'])).toString('hex')).toBe(manifestSha);
        expect((b['manifest_sha256'] as Buffer).toString('hex')).toBe(manifestSha);
        const m = b['manifest'] as Row;
        expect(m).toMatchObject({
          schema: 'clm.evidence/1',
          bundleId,
          purpose: 'INSURER',
          sealedAt: T1,
          trip: { id: w.trip, country: c.country, currency: c.currency, status: 'CHECKIN_OPEN' },
          contract: [],
        });
        // critère 1 : chaque fichier et son SHA-256 (celui des octets reçus, recalculé ici)
        const files = m['files'] as Row[];
        expect(files).toHaveLength(4);
        // fil de messages : un fichier de l'archive ; le manifeste n'en porte que l'empreinte et
        // les comptes (2 messages, 1 signalé : numéro masqué)
        expect(files).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: 'MESSAGES',
              path: 'messages/messages.json',
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            }),
          ]),
        );
        expect(m['messages']).toMatchObject({ count: 2, flagged: 1 });
        expect(files).toEqual(
          expect.arrayContaining(
            w.photos.map((p) =>
              expect.objectContaining({
                kind: 'PHOTO',
                ref: p.fileId,
                sha256: sha(p.body).toString('hex'),
                bytes: p.body.length,
                path:
                  p.slot === 'EXT_01'
                    ? `photos/CHECKIN/GUEST/01-EXT_01-${p.fileId}.jpg`
                    : `photos/CHECKIN/HOST/25-ODOMETER-${p.fileId}.jpg`,
              }),
            ),
          ),
        );
        // séries des deux côtés : heure serveur, reprise conservée (la dernière compte)
        const insp = m['inspections'] as Row[];
        expect(insp.map((i) => [i['kind'], i['side'], i['status']])).toEqual([
          ['CHECKIN', 'GUEST', 'DRAFT'],
          ['CHECKIN', 'HOST', 'DRAFT'],
        ]);
        const guestPhotos = insp[0]!['photos'] as Row[];
        expect(guestPhotos.map((p) => [p['fileId'], p['receivedAt'], p['current']])).toEqual([
          [w.photos[0]!.fileId, T0, false],
          [w.photos[1]!.fileId, plus(T0, 60), true],
        ]);
        expect(guestPhotos.every((p) => p['registryMismatch'] === false)).toBe(true);
        // CGU acceptées avant la réservation seulement (la réacceptation d'après est exclue)
        expect(m['terms']).toEqual([
          expect.objectContaining({
            party: 'GUEST',
            docKind: 'TOS_GUEST',
            acceptedAt: plus(T0, -86_400),
          }),
          expect.objectContaining({
            party: 'HOST',
            docKind: 'TOS_HOST',
            acceptedAt: plus(T0, -86_400),
          }),
        ]);
        // journal d'état : celui du registre, heure serveur, rôle (jamais la personne)
        const log = (
          await tx.query<Row>('SELECT * FROM test_fixture.us207_state_log($1)', [w.trip])
        ).rows;
        expect((m['events'] as Row[]).length).toBe(log.length);
        // pièces absentes listées (16 CLM-034 « pièce manquante → listée comme absente »)
        expect(m['absent']).toEqual(
          expect.arrayContaining([
            { piece: 'CONTRACT', reason: 'NOT_GENERATED' },
            { piece: 'CONSTANCIA', reason: 'RENDERED_ON_DEMAND' },
            { piece: 'INSPECTION', kind: 'CHECKIN', side: 'GUEST', reason: 'NOT_SUBMITTED' },
            { piece: 'INSPECTION', kind: 'CHECKOUT', side: 'HOST', reason: 'NOT_SUBMITTED' },
          ]),
        );
        // minimisation : ni nom, ni pièce, ni permis, ni position, ni texte de message
        const text = String(b['manifest_text']);
        expect(text.includes(HELLO)).toBe(false);
        expect(text.includes(PHONE[c.country]!)).toBe(false);
        for (const forbidden of [
          'Ana',
          'Pérez',
          'María',
          'Gómez',
          'license',
          'licence',
          'documentNumber',
          'latitude',
          'longitude',
          'birth',
        ]) {
          expect(text.includes(forbidden), forbidden).toBe(false);
        }
        // le dossier d'un autre trip ne contient rien de celui-ci
        for (const p of elsewhere.photos) expect(text.includes(p.fileId)).toBe(false);
      });

      // scellé : aucune écriture, même par le propriétaire (manifeste, empreinte, suppression)
      for (const what of ['MANIFEST', 'SHA256', 'DELETE']) {
        await withTestTransaction(api, {}, async (tx) => {
          await expect(
            tx.query('SELECT test_fixture.us308_try_tamper($1, $2)', [bundleId, what]),
          ).rejects.toMatchObject({ code: '23000', constraint: 'claim_evidence_sealed' });
        });
      }

      // pas encore générée : NOT_READY, rien n'est servi ni journalisé comme accès
      await withTestTransaction(api, { virtualNow: T1 }, async (tx) => {
        const r = (await tx.query<Row>(OPEN, [await elevated(tx, ops), uuid(), bundleId, REASON]))
          .rows[0]!;
        expect(r).toMatchObject({ outcome: 'NOT_READY', storage_key: null });
      });
    });

    // travailleur : chaque empreinte recalculée égale (critère 1), archive déposée, READY
    await withRole('app_worker', async (worker) => {
      const g = await generate(worker, keys, store, bundleId, T2);
      expect(g.verdicts).toEqual(['MATCH', 'MATCH', 'MATCH', 'MATCH']);
      // le document du fil porte le texte reçu (preuve) et le texte masqué servi aux parties
      expect(g.messages).toContain(HELLO);
      expect(g.messages).toContain(PHONE[c.country]!);
      expect(g.outcome).toBe('READY');
      // création seule : l'archive déposée ne se remplace pas
      const b = await withTestTransaction(worker, {}, async (tx) => bundleOf(tx, bundleId));
      expect(b).toMatchObject({ status: 'READY', generated_at: new Date(T2) });
      expect((b['expires_at'] as Date).toISOString()).toBe(plus(T2, TTL_S));
    });

    await withRole('app_api', async (api) => {
      const ops = (await withTestTransaction(api, {}, async (tx) => bundleOf(tx, bundleId)))[
        'requested_by'
      ] as string;
      const admin = await staff(api, 'ADMIN', [c.country]);
      const away = await staff(api, 'OPS_AGENT', [other.country]);
      // archive : PRIVATE_EVIDENCE, C2, générée, chiffrée par la clé USER du demandeur
      await withTestTransaction(api, {}, async (tx) => {
        const b = await bundleOf(tx, bundleId);
        const f = (
          await tx.query<Row>('SELECT * FROM test_fixture.us109_file($1)', [b['export_file_id']])
        ).rows[0]!;
        expect(f).toMatchObject({
          bucket: 'PRIVATE_EVIDENCE',
          mime: 'application/zip',
          source: 'GENERATED',
          classification: 'C2',
          enc_subject_type: 'USER',
          enc_subject_id: ops,
          uploader_user_id: ops,
        });
        expect(
          (await store.put('PRIVATE_EVIDENCE', String(f['storage_key']), Buffer.from('x'))).status,
        ).toBe('CONFLICT');
        // une autre écriture sur un dossier READY (prolonger le lien, le rouvrir) : refusée
        for (const what of ['EXTEND', 'REOPEN']) {
          await tx.query('SAVEPOINT t');
          await expect(
            tx.query('SELECT test_fixture.us308_try_tamper($1, $2)', [bundleId, what]),
          ).rejects.toMatchObject({ code: '23000', constraint: 'claim_evidence_sealed' });
          await tx.query('ROLLBACK TO SAVEPOINT t');
        }
      });
      // état et ouverture par le demandeur, avant l'échéance : déchiffrée, empreinte égale
      await withTestTransaction(api, { virtualNow: plus(T2, 3600) }, async (tx) => {
        const hash = await elevated(tx, { id: ops });
        const st = (await tx.query<Row>(STATUS, [hash, uuid(), bundleId])).rows[0]!;
        expect(st['outcome']).toBe('OK');
        expect(st['body']).toMatchObject({
          bundleId,
          status: 'READY',
          manifestSha256: manifestSha,
          expiresAt: plus(T2, TTL_S),
          fileCount: 4,
        });
        const requestId = uuid();
        const r = (await tx.query<Row>(OPEN, [hash, requestId, bundleId, REASON])).rows[0]!;
        expect(r['outcome']).toBe('OK');
        expect(r['manifest_sha256']).toBe(manifestSha);
        const got = await store.get('PRIVATE_EVIDENCE', String(r['storage_key']));
        if (got.status !== 'FOUND') throw new Error('archive absente');
        const k = await keys.dekFor(tx, { type: 'USER', id: ops }, 'read');
        if (k.status !== 'OK') throw new Error('clé du demandeur');
        const zip = open(k.dek, got.body, fileAad(String(r['file_id']), { type: 'USER', id: ops }));
        expect(sha(zip).toString('hex')).toBe(r['sha256']);
        expect(
          (await tx.query<Row>('SELECT * FROM test_fixture.us109_access_log($1)', [requestId]))
            .rows,
        ).toEqual([
          expect.objectContaining({
            actor_user_id: ops,
            access_kind: 'BULK_EXPORT',
            field_or_file: `evidence_bundle:${bundleId}:download`,
            purpose: REASON,
          }),
        ]);
        // un autre membre du staff du pays (même ADMIN) : le lien ne se partage pas (NOT_FOUND,
        // journalisé) ; un membre sans la permission, ou d'un autre pays : FORBIDDEN, journalisé
        for (const [who, outcome, reason] of [
          [admin.id, 'NOT_FOUND', 'NOT_REQUESTER'],
          [away.id, 'FORBIDDEN', 'PERMISSION'],
        ] as const) {
          const h = await elevated(tx, { id: who });
          const deniedId = uuid();
          expect(
            (await tx.query<Row>(OPEN, [h, deniedId, bundleId, REASON])).rows[0],
          ).toMatchObject({ outcome, storage_key: null });
          expect(await audits(tx, who, deniedId)).toEqual([
            { action_code: 'STAFF_FORBIDDEN', reason, field: 'evidence_bundle' },
          ]);
          expect((await tx.query<Row>(STATUS, [h, uuid(), bundleId])).rows[0]).toMatchObject({
            outcome,
            body: null,
          });
        }
      });
      // critère 2 : lien rejoué après 7 j ⇒ EXPIRED, journalisé ; l'état le dit
      await withTestTransaction(api, { virtualNow: plus(T2, TTL_S + 1) }, async (tx) => {
        const hash = await elevated(tx, { id: ops });
        const requestId = uuid();
        expect(
          (await tx.query<Row>(OPEN, [hash, requestId, bundleId, REASON])).rows[0],
        ).toMatchObject({ outcome: 'EXPIRED', storage_key: null });
        expect(await audits(tx, ops, requestId)).toEqual([
          { action_code: 'STAFF_FORBIDDEN', reason: 'EXPIRED', field: 'evidence_bundle' },
        ]);
        expect(
          (await tx.query<{ body: Row }>(STATUS, [hash, uuid(), bundleId])).rows[0]!.body['status'],
        ).toBe('EXPIRED');
      });
    });
  });

  it('RT-L3-P04 : objet remplacé dans le stockage après l’empreinte ⇒ constat FAILED (INTEGRITY_MISMATCH), rien n’est servi', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const store = new InMemoryFileStore();
    let bundleId = '';
    let ops = '';
    let target: Photo | undefined;
    await withRole('app_api', async (api) => {
      const w = await world(api, c, keys, store);
      target = w.photos[2];
      ops = (await staff(api, 'OPS_AGENT', [c.country])).id;
      await withTestTransaction(api, { virtualNow: T1, commit: true }, async (tx) => {
        const caseId = await supportCase(tx, c, w.trip, ops);
        const hash = await elevated(tx, { id: ops });
        await keyOf(tx, keys, 'STAFF', ops);
        const r = await request(tx, hash, w.trip, caseId);
        expect(r['outcome']).toBe('REQUESTED');
        bundleId = String(r['bundle_id']);
      });
    });
    // un octet de l'objet stocké change (bucket sans verrou objet : FAKE)
    store.corrupt('PRIVATE_EVIDENCE', target!.storageKey, 40);
    await withRole('app_worker', async (worker) => {
      const g = await generate(worker, keys, store, bundleId, T2);
      expect(g.verdicts.filter((v) => v !== 'MATCH')).toHaveLength(1);
      expect(g.outcome).toBe('FAILED');
      const b = await withTestTransaction(worker, {}, async (tx) => bundleOf(tx, bundleId));
      expect(b).toMatchObject({
        status: 'FAILED',
        failure_code: 'INTEGRITY_MISMATCH',
        findings: [{ piece: 'PHOTO', ref: target!.fileId, reason: 'SHA256_MISMATCH' }],
        export_file_id: null,
      });
      // constat hors forme : refusé (codes et identifiants seulement)
      await withTestTransaction(worker, {}, async (tx) => {
        await setActor(tx, { kind: 'WORKER', worker: 'evidence_verifier' });
        await expect(
          tx.query(FAIL, [
            uuid(),
            'INTEGRITY_MISMATCH',
            JSON.stringify([{ piece: 'PHOTO', ref: 'x', reason: 'a b', extra: 1 }]),
          ]),
        ).rejects.toMatchObject({ code: '22023' });
      });
    });
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: plus(T2, 60) }, async (tx) => {
        const hash = await elevated(tx, { id: ops });
        expect((await tx.query<Row>(OPEN, [hash, uuid(), bundleId, REASON])).rows[0]).toMatchObject(
          {
            outcome: 'FAILED',
            storage_key: null,
          },
        );
        expect(
          (await tx.query<{ body: Row }>(STATUS, [hash, uuid(), bundleId])).rows[0]!.body,
        ).toMatchObject({
          status: 'FAILED',
          failureCode: 'INTEGRITY_MISMATCH',
        });
      });
    });
  });

  it('RLS : aucun rôle applicatif ne lit ni n’écrit la table ; commandes du travailleur réservées à evidence_verifier sous app_worker ; portes du staff fermées aux travailleurs', async () => {
    // catalogue : RLS ENABLE + FORCE, propriétaire migrator, politiques des seuls propriétaires
    // NOLOGIN (commandes cmd_hold_owner, portes iam_staff_owner), aucune pour un rôle applicatif
    await withRole('app_api', async (client) => {
      const { rows } = await client.query<Row>(
        `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
                pg_catalog.pg_get_userbyid(c.relowner) AS owner,
                pg_catalog.array_to_string(ARRAY(
                  SELECT p.polname || ':' || pg_catalog.array_to_string(ARRAY(
                           SELECT pg_catalog.pg_get_userbyid(r)
                             FROM pg_catalog.unnest(p.polroles) AS r ORDER BY 1), ',')
                    FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid ORDER BY 1), ';') AS pols
           FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'core' AND c.relname ~ '^claim_' ORDER BY c.relname`,
      );
      expect(rows).toEqual([
        {
          rls: true,
          force: true,
          owner: 'migrator',
          pols:
            'cmd_hold_evidence_ins:cmd_hold_owner;cmd_hold_evidence_sel:cmd_hold_owner;' +
            'cmd_hold_evidence_upd:cmd_hold_owner;iam_staff_evidence_sel:iam_staff_owner;' +
            'migrator_all:migrator',
        },
      ]);
    });
    for (const role of ['app_api', 'app_worker', 'app_anon'] as const) {
      await withRole(role, async (client) => {
        for (const sql of [
          'SELECT 1 FROM core.claim_evidence_bundle LIMIT 1',
          'DELETE FROM core.claim_evidence_bundle',
        ]) {
          await expect(client.query(sql), `${role} ${sql}`).rejects.toMatchObject({
            code: '42501',
          });
        }
        if (role !== 'app_worker') {
          await expect(client.query(DUE, [1]), role).rejects.toMatchObject({ code: '42501' });
        }
        if (role !== 'app_api') {
          await expect(
            client.query(REQUEST, [newHash(), uuid(), uuid(), uuid(), 'INSURER', REASON]),
            role,
          ).rejects.toMatchObject({ code: '42501' });
        }
        for (const internal of [
          `SELECT core.claim_evidence_manifest('${uuid()}'::uuid, '${uuid()}'::uuid, 'INSURER',
                                                '2035-01-01T00:00:00Z'::timestamptz)`,
          `SELECT * FROM core.claim_evidence_export_file('${uuid()}'::uuid)`,
        ]) {
          await expect(client.query(internal), role).rejects.toMatchObject({ code: '42501' });
        }
      });
    }
    await withRole('app_worker', async (worker) => {
      await withTestTransaction(worker, {}, async (tx) => {
        // un autre nom de travailleur (ou aucun) : refus
        await setActor(tx, { kind: 'WORKER', worker: 'booking_contract' });
        await expect(tx.query(DUE, [1])).rejects.toMatchObject({ code: '42501' });
      });
      await withTestTransaction(worker, {}, async (tx) => {
        await setActor(tx, { kind: 'WORKER', worker: 'evidence_verifier' });
        expect((await tx.query<Row>(SOURCE, [uuid()])).rows[0]!['outcome']).toBe('NOT_DUE');
        await expect(tx.query(DUE, [0])).rejects.toMatchObject({ code: '22023' });
      });
    });
  });
});

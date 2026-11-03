/**
 * US-009 — colonnes C2 des registres immuables chiffrées avec la clé du sujet, et crypto-shredding
 * (17 §3.1.3 points 1, 2, 3, 5, 9 ; §3.2.13 ; ADR-026 ; ADR-051), sous les rôles de production.
 *
 * Critère : « Given une colonne C2 / C3 d'une table immuable, When elle est écrite, Then elle est
 * chiffrée avec la clé du sujet (`subject_key`). »
 * Preuves :
 * - `audit_log.ip_enc` : enveloppe AES-256-GCM sous la DEK du sujet ACTEUR ; le clair n'est nulle
 *   part en base ; seule la DEK enveloppée par le KMS (FAKE) est stockée ; une autre DEK ne
 *   déchiffre pas ;
 * - la base refuse un clair, une IP sans clé ou sous la clé d'un autre sujet ;
 * - KMS injoignable : ligne écrite sans l'IP (`c2_withheld`), chaîne intacte ;
 * - destruction de la clé : aucune ligne de registre modifiée, octets illisibles, chaîne intacte,
 *   plus aucune IP écrite pour ce sujet ; refusée sous gel légal ; jamais par un rôle applicatif.
 */
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../src/index.ts';
import {
  appendAuditLog,
  columnAad,
  EnvelopeError,
  open,
  receiveFile,
  seal,
  SubjectKeyStore,
} from '../../src/audit/index.ts';
import type { SubjectRef } from '../../src/audit/index.ts';
import { FakeKeyWrapper, InMemoryFileStore, withRole } from '../../src/testing/index.ts';
import { attempt, auditTx, setActor, uuid, VERIFIER, verifyChainIn } from '../support/audit.ts';
import type { ActorContext } from '../support/audit.ts';

const IP = '203.0.113.7'; // RFC 5737 (documentation)
const T0 = '2031-05-01T10:00:00.000Z';
const WRITER: ActorContext = { kind: 'WORKER', worker: 'audit_test_writer' };
const ipAad = (s: SubjectRef): string => columnAad('audit_log', 'ip_enc', s);

interface StoredAudit {
  ip_enc: Buffer | null;
  ip_key_subject_type: string | null;
  ip_key_subject_id: string | null;
  c2_withheld: boolean;
  everything: string;
}

/** Ligne d'audit par request_id, lue par le vérificateur (seul lecteur du journal). */
async function readAudit(requestId: string): Promise<StoredAudit | undefined> {
  return withRole('app_worker', (client) =>
    auditTx(client, { actor: VERIFIER }, async (tx) => {
      const { rows } = await tx.query<StoredAudit>(
        `SELECT ip_enc, ip_key_subject_type, ip_key_subject_id::text AS ip_key_subject_id,
                c2_withheld, row_to_json(l)::text AS everything
           FROM core.audit_audit_log l WHERE request_id = $1`,
        [requestId],
      );
      return rows[0];
    }),
  );
}

/** Clé de sujet telle que stockée (lecture machine, worker nommé). */
async function readKey(subject: SubjectRef) {
  return withRole('app_worker', (client) =>
    auditTx(client, { actor: WRITER }, async (tx) => {
      const { rows } = await tx.query<{
        wrapped_dek: Buffer | null;
        kms_key_id: string;
        destroyed_at: Date | null;
      }>(
        `SELECT wrapped_dek, kms_key_id, destroyed_at FROM core.audit_subject_key
          WHERE subject_type = $1 AND subject_id = $2`,
        [subject.type, subject.id],
      );
      return rows[0];
    }),
  );
}

describe('US-009 — C2 chiffrées par sujet et crypto-shredding (17 §3.1.3, ADR-026)', () => {
  it('IP écrite par app_api : chiffrée avec la DEK du sujet acteur, jamais en clair en base', async () => {
    const kms = new FakeKeyWrapper();
    const keys = new SubjectKeyStore(kms);
    const actor: SubjectRef = { type: 'USER', id: uuid() };
    const requestId = uuid();
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'GUEST' }, commit: true }, (tx) =>
        appendAuditLog(tx, keys, {
          actorUserId: actor.id,
          actorRole: 'GUEST',
          actionCode: 'TRIP_CANCELLED',
          subjectType: 'TRIP',
          subjectId: uuid(),
          ip: IP,
          requestId,
        }),
      ),
    );
    const row = await readAudit(requestId);
    expect(row).toMatchObject({
      ip_key_subject_type: 'USER',
      ip_key_subject_id: actor.id,
      c2_withheld: false,
    });
    expect(row?.everything).not.toContain(IP);
    expect(row?.ip_enc?.toString('latin1')).not.toContain(IP);
    // la clé stockée est ENVELOPPÉE par le KMS ; la DEK déroulée déchiffre, une autre non
    const stored = await readKey(actor);
    expect(stored).toMatchObject({ kms_key_id: kms.keyId, destroyed_at: null });
    const dek = await withRole('app_worker', (client) =>
      auditTx(client, { actor: WRITER }, (tx) => keys.dekFor(tx, actor, 'read')),
    );
    if (dek.status !== 'OK' || row?.ip_enc == null) throw new Error('clé et IP attendues');
    expect(stored?.wrapped_dek?.includes(dek.dek)).toBe(false);
    expect(open(dek.dek, row.ip_enc, ipAad(actor)).toString('utf8')).toBe(IP);
    // la même enveloppe ne s'ouvre ni sous la clé d'un autre sujet, ni pour un autre sujet
    const other: SubjectRef = { type: 'USER', id: uuid() };
    const otherDek = await withRole('app_worker', (client) =>
      auditTx(client, { actor: WRITER }, (tx) => keys.dekFor(tx, other, 'create')),
    );
    if (otherDek.status !== 'OK') throw new Error('clé attendue');
    expect(() => open(otherDek.dek, row.ip_enc as Buffer, ipAad(actor))).toThrow(EnvelopeError);
    expect(() => open(dek.dek, row.ip_enc as Buffer, ipAad(other))).toThrow(EnvelopeError);
    // un autre KMS (autre clé maîtresse) ne déroule pas la DEK : repli WITHHELD, jamais d'exception
    // qui bloquerait l'audit (revue sécurité US-009, constat 5)
    const foreign = new SubjectKeyStore(new FakeKeyWrapper());
    expect(
      await withRole('app_worker', (client) =>
        auditTx(client, { actor: WRITER }, (tx) => foreign.dekFor(tx, actor, 'read')),
      ),
    ).toEqual({ status: 'WITHHELD' });
  });

  it('la base refuse un clair, une IP sans clé, ou chiffrée sous la clé d’un autre sujet', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const actor: SubjectRef = { type: 'USER', id: uuid() };
    const other: SubjectRef = { type: 'USER', id: uuid() };
    await withRole('app_api', async (client) => {
      await auditTx(client, { actor: { kind: 'STAFF' } }, async (tx) => {
        const otherDek = await keys.dekFor(tx, other, 'create');
        await keys.dekFor(tx, actor, 'create');
        if (otherDek.status !== 'OK') throw new Error('clé attendue');
        const insert = `INSERT INTO core.audit_audit_log
            (actor_user_id, actor_role, action_code, subject_type, subject_id, ip_enc,
             ip_key_subject_type, ip_key_subject_id, c2_withheld)
          VALUES ($1, 'STAFF', 'TEST_ACTION', 'TRIP', $2, $3, $4, $5, $6)`;
        const cases: ReadonlyArray<readonly [string, unknown[], string]> = [
          [
            'IP en clair',
            [actor.id, uuid(), Buffer.from(IP), 'USER', actor.id, false],
            'audit_log_ip_envelope',
          ],
          [
            'enveloppe sans clé',
            [
              actor.id,
              uuid(),
              seal(otherDek.dek, Buffer.from(IP), ipAad(actor)),
              null,
              null,
              false,
            ],
            'audit_log_ip_key_complete',
          ],
          [
            'clé d’un autre sujet que l’acteur',
            [
              actor.id,
              uuid(),
              seal(otherDek.dek, Buffer.from(IP), ipAad(other)),
              'USER',
              other.id,
              false,
            ],
            'audit_log_ip_key_is_actor',
          ],
          [
            'IP et c2_withheld',
            [
              actor.id,
              uuid(),
              seal(otherDek.dek, Buffer.from(IP), ipAad(actor)),
              'USER',
              actor.id,
              true,
            ],
            'audit_log_withheld_has_no_ip',
          ],
        ];
        for (const [name, params, constraint] of cases) {
          expect(await attempt(tx, insert, params), name).toMatchObject({
            code: '23514',
            constraint,
          });
        }
        // clé inexistante : clé étrangère
        const ghost = uuid();
        expect(
          await attempt(tx, insert, [
            ghost,
            uuid(),
            seal(otherDek.dek, Buffer.from(IP), 'x'),
            'USER',
            ghost,
            false,
          ]),
        ).toMatchObject({ code: '23503', constraint: 'audit_log_ip_key_fk' });
      });
    });
  });

  it('KMS injoignable : la ligne est écrite sans l’IP (c2_withheld), la chaîne reste vérifiable', async () => {
    const kms = new FakeKeyWrapper();
    kms.setAvailable(false);
    const keys = new SubjectKeyStore(kms);
    const requestId = uuid();
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'HOST' }, commit: true }, async (tx) => {
        const result = await appendAuditLog(tx, keys, {
          actorUserId: uuid(),
          actorRole: 'HOST',
          actionCode: 'LISTING_UPDATED',
          subjectType: 'LISTING',
          subjectId: uuid(),
          ip: IP,
          requestId,
        });
        expect(result).toEqual({ c2Withheld: true });
      }),
    );
    const row = await readAudit(requestId);
    expect(row).toMatchObject({ ip_enc: null, ip_key_subject_type: null, c2_withheld: true });
    expect(row?.everything).not.toContain(IP);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: VERIFIER }, async (tx) => {
        expect(await verifyChainIn(tx)).toMatchObject({ ok: true });
      }),
    );
  });

  it('destruction de la clé : registre inchangé, octets illisibles, chaîne valide, plus d’IP pour ce sujet', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const actor: SubjectRef = { type: 'USER', id: uuid() };
    const requestId = uuid();
    await withRole('app_api', (client) =>
      auditTx(client, { actor: { kind: 'GUEST' }, commit: true }, (tx) =>
        appendAuditLog(tx, keys, {
          actorUserId: actor.id,
          actorRole: 'GUEST',
          actionCode: 'ACCOUNT_CLOSED',
          subjectType: 'USER_ACCOUNT',
          subjectId: actor.id,
          ip: IP,
          requestId,
        }),
      ),
    );
    const before = await readAudit(requestId);
    const dsr = uuid();
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: WRITER, commit: true }, async (tx) => {
        const { rows } = await tx.query<{ audit_id: string }>(
          `SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'demande d''effacement')::text AS audit_id`,
          [actor.id, dsr],
        );
        expect(Number(rows[0]?.audit_id)).toBeGreaterThan(0);
      }),
    );
    // clé détruite : DEK enveloppée effacée, horodatage et demande tracés
    const key = await readKey(actor);
    expect(key?.wrapped_dek).toBeNull();
    expect(key?.destroyed_at).toBeInstanceOf(Date);
    // registre inchangé : mêmes octets ; plus aucune DEK pour les lire (même depuis le cache)
    const after = await readAudit(requestId);
    expect(after?.ip_enc).toEqual(before?.ip_enc);
    expect(after?.everything).toBe(before?.everything);
    await withRole('app_worker', (client) =>
      auditTx(client, { actor: WRITER }, async (tx) => {
        expect(await keys.dekFor(tx, actor, 'read')).toEqual({ status: 'DESTROYED' });
        expect(await keys.dekFor(tx, actor, 'create')).toEqual({ status: 'DESTROYED' });
        // nouvelle action du sujet effacé : écrite sans IP
        expect(
          await appendAuditLog(tx, keys, {
            actorUserId: actor.id,
            actorRole: 'GUEST',
            actionCode: 'LOGIN',
            subjectType: 'USER_ACCOUNT',
            subjectId: actor.id,
            ip: IP,
          }),
        ).toEqual({ c2Withheld: true });
        // écriture directe d'une enveloppe sous la clé détruite : refusée par la base
        const error = await attempt(
          tx,
          `INSERT INTO core.audit_audit_log
              (actor_user_id, actor_role, action_code, subject_type, subject_id, ip_enc,
               ip_key_subject_type, ip_key_subject_id)
            VALUES ($1, 'GUEST', 'LOGIN', 'USER_ACCOUNT', $1, $2, 'USER', $1)`,
          [actor.id, before?.ip_enc],
        );
        expect(error).toMatchObject({ code: '23000', constraint: 'audit_log_key_destroyed' });
        expect(translateDbError(error)).toEqual({ code: 'SUBJECT_ERASED', retryable: false });
        // seconde destruction : refusée
        const again = await attempt(
          tx,
          `SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'x')`,
          [actor.id, uuid()],
        );
        expect(translateDbError(again)).toEqual({ code: 'SUBJECT_ERASED', retryable: false });
        // la destruction est journalisée, et la chaîne reste valide
        await setActor(tx, VERIFIER);
        const { rows } = await tx.query<{ action_code: string; request_id: string }>(
          `SELECT action_code, request_id::text AS request_id FROM core.audit_audit_log
            WHERE subject_type = 'SUBJECT_KEY' AND subject_id = $1`,
          [actor.id],
        );
        expect(rows).toEqual([{ action_code: 'SUBJECT_KEY_DESTROYED', request_id: dsr }]);
        expect(await verifyChainIn(tx)).toMatchObject({ ok: true });
      }),
    );
  });

  it('destruction refusée sous gel légal (LEGAL_HOLD_ACTIVE), acceptée après son échéance', async () => {
    const keys = new SubjectKeyStore(new FakeKeyWrapper());
    const store = new InMemoryFileStore();
    const guest: SubjectRef = { type: 'USER', id: uuid() };
    await withRole('app_worker', (client) =>
      auditTx(
        client,
        { actor: { kind: 'WORKER', worker: 'evidence_ingest' }, virtualNow: T0 },
        async (tx) => {
          const fileId = uuid();
          await receiveFile(
            tx,
            store,
            keys,
            {
              id: fileId,
              bucket: 'PRIVATE_EVIDENCE',
              storageKey: `claims/${fileId}`,
              mime: 'image/jpeg',
              uploaderUserId: guest.id,
              source: 'IN_APP_CAMERA',
              classification: 'C3',
              retentionClass: 'CLAIM_EVIDENCE',
              encryptFor: guest,
            },
            [Buffer.from('photo du dommage')],
          );
          await tx.query(
            `SELECT test_fixture.set_file_legal_hold($1, $2::timestamptz + interval '15 months')`,
            [fileId, T0],
          );
          const error = await attempt(
            tx,
            `SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'demande d''effacement')`,
            [guest.id, uuid()],
          );
          expect(error).toMatchObject({ code: '23000', constraint: 'subject_key_legal_hold' });
          expect(translateDbError(error)).toEqual({ code: 'LEGAL_HOLD_ACTIVE', retryable: false });
          // gel échu (dans le passé de platform.now()) : destruction acceptée
          await tx.query(
            `SELECT test_fixture.set_file_legal_hold($1, $2::timestamptz - interval '1 second')`,
            [fileId, T0],
          );
          await tx.query(`SELECT test_fixture.destroy_subject_key('USER', $1, $2, 'gel levé')`, [
            guest.id,
            uuid(),
          ]);
          expect(await keys.dekFor(tx, guest, 'read')).toEqual({ status: 'DESTROYED' });
        },
      ),
    );
  });

  it('subject_key : UPDATE, DELETE et la procédure de destruction sont interdits aux rôles applicatifs', async () => {
    const subject = uuid();
    for (const role of ['app_api', 'app_worker'] as const) {
      await withRole(role, async (client) => {
        await auditTx(
          client,
          { actor: role === 'app_api' ? { kind: 'STAFF' } : WRITER },
          async (tx) => {
            for (const sql of [
              `UPDATE core.audit_subject_key SET wrapped_dek = NULL, destroyed_at = '2031-01-01' WHERE subject_id = $1`,
              `DELETE FROM core.audit_subject_key WHERE subject_id = $1`,
              `SELECT core.audit_destroy_subject_key('USER', $1, $1, 'x')`,
            ]) {
              expect(await attempt(tx, sql, [subject]), `${role} : ${sql}`).toMatchObject({
                code: '42501',
              });
            }
            expect(await attempt(tx, `TRUNCATE core.audit_subject_key`)).toMatchObject({
              code: '42501',
            });
            // création directe d'une clé déjà « détruite » : colonne interdite
            expect(
              await attempt(
                tx,
                `INSERT INTO core.audit_subject_key (subject_type, subject_id, kms_key_id, destroyed_at)
                 VALUES ('USER', $1, 'k', '2031-01-01')`,
                [subject],
              ),
            ).toMatchObject({ code: '42501' });
          },
        );
      });
    }
  });
});

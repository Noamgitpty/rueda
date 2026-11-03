/**
 * Écrivain du journal d'audit, sans base (US-009) : validation, chiffrement de l'IP avec la clé du
 * sujet acteur, repli `c2_withheld`. L'écriture réelle est prouvée par les tests L0.
 */
import { describe, expect, it } from 'vitest';
import { FakeKeyWrapper } from '../testing/fake-audit-adapters.ts';
import { appendAuditLog, AuditEntryError } from './audit-log.ts';
import type { AuditEntry } from './audit-log.ts';
import { columnAad, open } from './envelope.ts';
import { SubjectKeyStore } from './subject-keys.ts';
import type { Queryable } from './subject-keys.ts';

const ACTOR = '0a0a0a0a-0000-4000-8000-000000000001';
const TRIP = '0c0c0c0c-0000-4000-8000-000000000003';

/** Exécuteur qui garde les clés en mémoire et capture l'INSERT d'audit. */
function captureDb() {
  const keys = new Map<string, { wrapped_dek: Buffer; kms_key_id: string; destroyed_at: null }>();
  const audits: unknown[][] = [];
  const db = {
    audits,
    async query(text: string, params: unknown[]) {
      if (text.includes('core.audit_audit_log')) {
        audits.push(params);
        return { rows: [] };
      }
      const k = `${String(params[0])}:${String(params[1])}`;
      if (text.includes('INSERT')) {
        if (!keys.has(k)) {
          keys.set(k, {
            wrapped_dek: params[2] as Buffer,
            kms_key_id: params[3] as string,
            destroyed_at: null,
          });
        }
        return { rows: [] };
      }
      const row = keys.get(k);
      return { rows: row === undefined ? [] : [row] };
    },
  };
  return db as unknown as Queryable & { audits: unknown[][] };
}

const entry = (over: Partial<AuditEntry> = {}): AuditEntry => ({
  actorUserId: ACTOR,
  actorRole: 'STAFF',
  actionCode: 'TRIP_CANCELLED',
  subjectType: 'TRIP',
  subjectId: TRIP,
  before: { status: 'BOOKED' },
  after: { status: 'CANCELLED', at: '2031-07-01T08:00:00.000Z' },
  reason: 'demande du guest',
  ip: '203.0.113.7',
  ...over,
});

describe('appendAuditLog', () => {
  it('IP chiffrée avec la clé du sujet acteur (USER:<acteur>), jamais transmise en clair', async () => {
    const db = captureDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    expect(await appendAuditLog(db, keys, entry())).toEqual({ c2Withheld: false });
    const params = db.audits[0]!;
    expect(JSON.stringify(params)).not.toContain('203.0.113.7');
    const ipEnc = params[8] as Buffer;
    expect([params[9], params[10], params[11]]).toEqual(['USER', ACTOR, false]);
    const dek = await keys.dekFor(db, { type: 'USER', id: ACTOR }, 'read');
    if (dek.status !== 'OK') throw new Error('clé attendue');
    const aad = columnAad('audit_log', 'ip_enc', { type: 'USER', id: ACTOR });
    expect(open(dek.dek, ipEnc, aad).toString('utf8')).toBe('203.0.113.7');
  });

  it('KMS injoignable : ligne écrite quand même, sans IP, c2_withheld = true', async () => {
    const db = captureDb();
    const kms = new FakeKeyWrapper({});
    kms.setAvailable(false);
    const keys = new SubjectKeyStore(kms);
    expect(await appendAuditLog(db, keys, entry())).toEqual({ c2Withheld: true });
    const params = db.audits[0]!;
    expect([params[8], params[9], params[10], params[11]]).toEqual([null, null, null, true]);
    expect(JSON.stringify(params)).not.toContain('203.0.113.7');
  });

  it('sans IP : aucune clé créée ni lue', async () => {
    const db = captureDb();
    const kms = new FakeKeyWrapper({});
    const keys = new SubjectKeyStore(kms);
    const { ip, ...withoutIp } = entry();
    expect(ip).toBeDefined();
    await appendAuditLog(db, keys, withoutIp);
    expect(kms.unwrapCalls).toBe(0);
    expect(db.audits[0]?.[11]).toBe(false);
  });

  it.each<[string, Partial<AuditEntry>]>([
    ['email dans after', { after: { contact: 'ana@example.com' } }],
    ['IPv4 dans before', { before: { from: '198.51.100.1' } }],
    ['IP imbriquée', { after: { list: [{ ip: '192.0.2.1' }] } }],
    ['code d’action invalide', { actionCode: 'trip cancelled' }],
    ['IP d’un acteur système', { actorUserId: null }],
  ])('refus avant écriture : %s', async (_name, over) => {
    const db = captureDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    await expect(appendAuditLog(db, keys, entry(over))).rejects.toBeInstanceOf(AuditEntryError);
    expect(db.audits).toHaveLength(0);
  });

  it('un message d’erreur ne recopie pas la valeur refusée', async () => {
    const db = captureDb();
    const keys = new SubjectKeyStore(new FakeKeyWrapper({}));
    const error = await appendAuditLog(db, keys, entry({ after: { c: 'ana@example.com' } })).catch(
      (e: unknown) => e,
    );
    expect(String((error as Error).message)).not.toContain('ana@example.com');
  });
});

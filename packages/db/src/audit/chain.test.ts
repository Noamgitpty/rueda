/**
 * Chaîne d'audit (US-009, ADR-051) : forme canonique v1 et détection de toute altération.
 * Oracle : la forme canonique attendue est ÉCRITE À LA MAIN d'après ADR-051 (pas produite par le
 * code testé) et son SHA-256 calculé directement par node:crypto.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AUDIT_CHAIN_GENESIS, auditRowHash, canonicalAuditRow, verifyAuditChain } from './chain.ts';
import type { AuditChainRow } from './chain.ts';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const SUBJECT = '22222222-2222-4222-8222-222222222222';

type Draft = Omit<AuditChainRow, 'id' | 'prevHash' | 'hash'>;

const draft = (over: Partial<Draft> = {}): Draft => ({
  atUs: '1940000000123456',
  actorUserId: ACTOR,
  actorRole: 'STAFF',
  actionCode: 'TRIP_CANCELLED',
  subjectType: 'TRIP',
  subjectId: SUBJECT,
  beforeText: '{"status": "BOOKED"}',
  afterText: '{"status": "CANCELLED"}',
  reason: 'Motif é',
  ipEnc: null,
  ipKeySubjectType: null,
  ipKeySubjectId: null,
  c2Withheld: false,
  requestId: null,
  ...over,
});

/** Chaîne valide construite à partir de brouillons. */
function link(drafts: readonly Draft[]): AuditChainRow[] {
  let prev = AUDIT_CHAIN_GENESIS;
  return drafts.map((d, i) => {
    const partial = { ...d, id: String(i + 1), prevHash: prev };
    const hash = auditRowHash(partial);
    prev = hash;
    return { ...partial, hash };
  });
}

describe('forme canonique v1 (ADR-051)', () => {
  it('vecteur écrit à la main : texte et SHA-256', () => {
    const expected =
      'rueda.audit_log.v1\n' +
      'id=1:1\n' +
      'at_us=16:1940000000123456\n' +
      `actor_user_id=36:${ACTOR}\n` +
      'actor_role=5:STAFF\n' +
      'action_code=14:TRIP_CANCELLED\n' +
      'subject_type=4:TRIP\n' +
      `subject_id=36:${SUBJECT}\n` +
      'before=20:{"status": "BOOKED"}\n' +
      'after=23:{"status": "CANCELLED"}\n' +
      'reason=8:Motif é\n' + // 7 caractères, 8 octets UTF-8
      'ip_enc=~\n' +
      'ip_key_subject_type=~\n' +
      'ip_key_subject_id=~\n' +
      'c2_withheld=5:false\n' +
      'request_id=~\n' +
      `prev_hash=64:${'0'.repeat(64)}\n`;
    const row = { ...draft(), id: '1', prevHash: AUDIT_CHAIN_GENESIS };
    expect(canonicalAuditRow(row)).toBe(expected);
    expect(auditRowHash(row).toString('hex')).toBe(
      createHash('sha256').update(expected, 'utf8').digest('hex'),
    );
  });

  it('ip_enc en hexadécimal minuscule ; c2_withheld « true »', () => {
    const row = {
      ...draft({
        ipEnc: Buffer.from([0x01, 0xab]),
        ipKeySubjectType: 'USER',
        ipKeySubjectId: ACTOR,
        c2Withheld: false,
      }),
      id: '7',
      prevHash: Buffer.alloc(32, 0xff),
    };
    expect(canonicalAuditRow(row)).toContain('\nip_enc=4:01ab\nip_key_subject_type=4:USER\n');
    expect(canonicalAuditRow({ ...row, ipEnc: null, c2Withheld: true })).toContain(
      '\nc2_withheld=4:true\n',
    );
    expect(canonicalAuditRow(row)).toContain(`\nprev_hash=64:${'f'.repeat(64)}\n`);
  });

  it('NULL (~) et chaîne vide (0:) sont distincts ; un séparateur dans une valeur ne crée pas de collision', () => {
    const base = { ...draft(), id: '1', prevHash: AUDIT_CHAIN_GENESIS };
    expect(auditRowHash({ ...base, reason: null })).not.toEqual(
      auditRowHash({ ...base, reason: '' }),
    );
    // déplacer du texte d'un champ à l'autre change la forme (longueurs préfixées)
    const a = { ...base, actorRole: 'AB', actionCode: 'CD' };
    const b = { ...base, actorRole: 'ABC', actionCode: 'D' };
    expect(canonicalAuditRow(a)).not.toBe(canonicalAuditRow(b));
    expect(auditRowHash({ ...base, reason: 'x\nreason=1:y' })).not.toEqual(
      auditRowHash({ ...base, reason: 'x' }),
    );
  });
});

describe('verifyAuditChain : toute altération est détectée', () => {
  const chain = link([
    draft(),
    draft({ actionCode: 'HOLD_RELEASED', reason: null, beforeText: null }),
    draft({ actorUserId: null, actorRole: 'WORKER', afterText: '{"n": 1}' }),
    draft({ c2Withheld: true }),
  ]);

  it('chaîne intacte : ok, dernier id et dernier hachage', () => {
    const result = verifyAuditChain(chain);
    expect(result).toMatchObject({ ok: true, count: 4, lastId: '4' });
    if (result.ok) expect(result.lastHash).toEqual(chain[3]?.hash);
    expect(verifyAuditChain([])).toMatchObject({ ok: true, count: 0, lastId: '0' });
  });

  const tampered = (i: number, patch: Partial<AuditChainRow>): AuditChainRow[] =>
    chain.map((r, j) => (j === i ? { ...r, ...patch } : r));

  it.each<[string, Partial<AuditChainRow>]>([
    ['reason', { reason: 'autre motif' }],
    ['before', { beforeText: '{"status": "HOLD"}' }],
    ['after', { afterText: '{"status": "BOOKED"}' }],
    ['acteur', { actorUserId: SUBJECT }],
    ['instant (1 µs)', { atUs: '1940000000123457' }],
    ['c2_withheld', { c2Withheld: true }],
    ['ip_enc', { ipEnc: Buffer.from([0x01]) }],
    ['action_code', { actionCode: 'TRIP_BOOKED' }],
  ])('modification de « %s » : HASH_MISMATCH sur la ligne', (_name, patch) => {
    expect(verifyAuditChain(tampered(1, patch))).toEqual({
      ok: false,
      break: { id: '2', reason: 'HASH_MISMATCH' },
    });
  });

  it('ligne modifiée PUIS re-hachée : détectée à la ligne suivante (PREV_HASH_MISMATCH)', () => {
    const row = { ...chain[1]!, reason: 'autre motif' };
    const rehashed = { ...row, hash: auditRowHash(row) };
    const forged = chain.map((r, j) => (j === 1 ? rehashed : r));
    expect(verifyAuditChain(forged)).toEqual({
      ok: false,
      break: { id: '3', reason: 'PREV_HASH_MISMATCH' },
    });
  });

  it('ligne supprimée au milieu : ID_GAP', () => {
    expect(verifyAuditChain([chain[0]!, chain[2]!, chain[3]!])).toEqual({
      ok: false,
      break: { id: '3', reason: 'ID_GAP' },
    });
  });

  it('lignes permutées : ID_GAP ; id renumérotés après suppression : PREV_HASH_MISMATCH', () => {
    expect(verifyAuditChain([chain[1]!, chain[0]!])).toMatchObject({
      ok: false,
      break: { reason: 'ID_GAP' },
    });
    const renumbered = [chain[0]!, { ...chain[2]!, id: '2' }];
    expect(verifyAuditChain(renumbered)).toMatchObject({
      ok: false,
      break: { id: '2', reason: 'PREV_HASH_MISMATCH' },
    });
  });

  it('première ligne sans la genèse : PREV_HASH_MISMATCH ; chaîne lue sans son début : ID_GAP', () => {
    expect(verifyAuditChain(tampered(0, { prevHash: Buffer.alloc(32, 1) }))).toEqual({
      ok: false,
      break: { id: '1', reason: 'PREV_HASH_MISMATCH' },
    });
    expect(verifyAuditChain(chain.slice(1))).toMatchObject({
      ok: false,
      break: { reason: 'ID_GAP' },
    });
  });

  it('fin tronquée : détectée par la tête attendue (HEAD_MISMATCH)', () => {
    const head = { lastId: '4', lastHash: chain[3]!.hash };
    expect(verifyAuditChain(chain, head)).toMatchObject({ ok: true });
    expect(verifyAuditChain(chain.slice(0, 3), head)).toEqual({
      ok: false,
      break: { id: '4', reason: 'HEAD_MISMATCH' },
    });
    expect(verifyAuditChain(chain, { lastId: '4', lastHash: Buffer.alloc(32) })).toMatchObject({
      ok: false,
      break: { reason: 'HEAD_MISMATCH' },
    });
  });
});

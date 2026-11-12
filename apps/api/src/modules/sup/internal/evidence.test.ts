/**
 * Pièces du staff (US-109 ; pré-mortem du lot 1 L1-PM-41 à L1-PM-43 ; 17 §5) : type réel lu sur
 * les octets, taille bornée, droit jugé AVANT toute analyse, antivirus fail-closed, et rien n'est
 * déposé tant qu'un pas échoue. Attendus tirés du pré-mortem (liste blanche JPEG, PNG, HEIC, PDF ;
 * SVG, HTML et polyglottes refusés ; fichier non analysé jamais servi), jamais du code testé.
 */
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_MAX_BYTES,
  EvidenceError,
  EvidenceService,
  sniffEvidenceMime,
  unavailableEvidence,
} from './evidence.js';
import type { EvidenceOptions, EvidenceScanResult } from './evidence.js';
import type { OpsConsoleStore, OpsResult } from './ops-console-store.js';
import type { StaffActor } from './staff-context.js';

const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(24, 7)]);
const JPEG = Buffer.concat([Buffer.from('ffd8ffe0', 'hex'), Buffer.alloc(24, 7)]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n', 'latin1');
const HEIC = Buffer.concat([
  Buffer.from('00000018', 'hex'),
  Buffer.from('ftypheic', 'latin1'),
  Buffer.alloc(16, 0),
]);
const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const actor: StaffActor = { userId: ID, tokenHash: Buffer.alloc(32, 1), countries: ['AA'] };

describe('type réel lu sur les octets (L1-PM-41)', () => {
  it.each([
    [PNG, 'image/png'],
    [JPEG, 'image/jpeg'],
    [PDF, 'application/pdf'],
    [HEIC, 'image/heic'],
  ] as const)('liste blanche : %#', (body, mime) => {
    expect(sniffEvidenceMime(body)).toBe(mime);
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>', 'utf8')],
    ['HTML', Buffer.from('<!doctype html><script>alert(1)</script>', 'utf8')],
    ['HTML après espaces', Buffer.from('   <html>', 'utf8')],
    ['texte', Buffer.from('bonjour', 'utf8')],
    ['ZIP', Buffer.from('504b0304', 'hex')],
    ['ftyp sans marque HEIF', Buffer.concat([Buffer.from('00000018ftypisom', 'latin1')])],
    ['vide', Buffer.alloc(0)],
  ])('%s : refusé', (_name, body) => {
    expect(sniffEvidenceMime(body)).toBeNull();
  });
});

interface Trace {
  readonly calls: string[];
}

function storeOf(trace: Trace, permitted = 'PERMITTED', recorded = 'RECORDED'): OpsConsoleStore {
  const never = (): Promise<OpsResult> => Promise.reject(new Error('non prévu'));
  return {
    queues: never,
    claim: never,
    kycDossier: never,
    findUser: never,
    profile: never,
    addNote: never,
    openCase: never,
    setCaseStatus: never,
    evidencePermitted: () => {
      trace.calls.push('permitted');
      return Promise.resolve({ outcome: permitted, body: null });
    },
    recordEvidence: (_tx, _a, input) => {
      trace.calls.push('record');
      return Promise.resolve({
        outcome: recorded,
        body: { fileId: input.requestId, storageKey: `staff-evidence/${input.requestId}` },
      });
    },
  };
}

function optionsOf(
  trace: Trace,
  scan: EvidenceScanResult,
  put = 'STORED' as const,
): EvidenceOptions {
  const client = {
    query: (text: string) => {
      trace.calls.push(text);
      return Promise.resolve({ rows: [] });
    },
    release: () => undefined,
  };
  return {
    pool: {
      query: () => Promise.reject(new Error('non prévu')),
      connect: () => Promise.resolve(client),
    } as unknown as EvidenceOptions['pool'],
    scanner: {
      scan: () => {
        trace.calls.push('scan');
        return Promise.resolve(scan);
      },
    },
    vault: {
      prepare: () => {
        trace.calls.push('prepare');
        return Promise.resolve('READY');
      },
      seal: (_tx, _u, _f, body) => {
        trace.calls.push('seal');
        return Promise.resolve({
          status: 'SEALED',
          body: Buffer.concat([Buffer.from('enc:'), body]),
        });
      },
    },
    files: {
      put: () => {
        trace.calls.push('put');
        return Promise.resolve({ status: put });
      },
    },
  };
}

const clean: EvidenceScanResult = {
  status: 'SCANNED',
  report: { verdict: 'CLEAN', detectedMime: 'image/png', threat: null },
};
const upload = { requestId: ID, subjectUserId: ID, declaredMime: 'image/png', content: PNG };

async function reason(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (error) {
    if (error instanceof EvidenceError) return `${error.kind}:${error.reason}`;
    throw error;
  }
}

describe('ordre fail-closed du téléversement', () => {
  it('pièce saine : droit, analyse, puis clé, ligne, chiffrement et dépôt dans UNE transaction', async () => {
    const t: Trace = { calls: [] };
    const r = await new EvidenceService(storeOf(t), optionsOf(t, clean)).upload(actor, upload);
    expect(r).toMatchObject({ fileId: ID, duplicate: false });
    expect(t.calls).toEqual([
      'permitted',
      'scan',
      'BEGIN',
      'prepare',
      'record',
      'seal',
      'put',
      'COMMIT',
    ]);
  });

  it('taille nulle ou au-delà du maximum, type réel hors liste ou différent du type déclaré : refus AVANT la base', async () => {
    const t: Trace = { calls: [] };
    const s = new EvidenceService(storeOf(t), optionsOf(t, clean));
    expect(await reason(s.upload(actor, { ...upload, content: Buffer.alloc(0) }))).toBe(
      'REJECTED:SIZE',
    );
    const big = Buffer.concat([PNG, Buffer.alloc(EVIDENCE_MAX_BYTES)]);
    expect(await reason(s.upload(actor, { ...upload, content: big }))).toBe('REJECTED:SIZE');
    const svg = Buffer.from('<svg/>', 'utf8');
    expect(
      await reason(s.upload(actor, { ...upload, declaredMime: 'image/svg+xml', content: svg })),
    ).toBe('REJECTED:TYPE');
    expect(await reason(s.upload(actor, { ...upload, declaredMime: 'application/pdf' }))).toBe(
      'REJECTED:TYPE',
    );
    expect(t.calls).toEqual([]);
  });

  it('acteur sans droit : refus avant toute analyse, rien n’est analysé ni déposé', async () => {
    const t: Trace = { calls: [] };
    const s = new EvidenceService(storeOf(t, 'FORBIDDEN'), optionsOf(t, clean));
    expect(await reason(s.upload(actor, upload))).toBe('ACCESS:FORBIDDEN');
    expect(t.calls).toEqual(['permitted']);
  });

  it.each([
    [
      'INFECTED',
      { status: 'SCANNED', report: { verdict: 'INFECTED', detectedMime: null, threat: 'EICAR' } },
      'REJECTED:SCAN',
    ],
    [
      'MIME_MISMATCH',
      {
        status: 'SCANNED',
        report: { verdict: 'MIME_MISMATCH', detectedMime: 'text/html', threat: null },
      },
      'REJECTED:SCAN',
    ],
    ['UNAVAILABLE', { status: 'UNAVAILABLE' }, 'UNAVAILABLE:SCAN'],
    ['TIMEOUT', { status: 'TIMEOUT' }, 'UNAVAILABLE:SCAN'],
  ] as const)('antivirus %s : jamais déposé (L1-PM-43)', async (_n, scan, expected) => {
    const t: Trace = { calls: [] };
    const s = new EvidenceService(storeOf(t), optionsOf(t, scan as EvidenceScanResult));
    expect(await reason(s.upload(actor, upload))).toBe(expected);
    expect(t.calls).toEqual(['permitted', 'scan']);
  });

  it('dépôt en échec : la transaction est annulée (la ligne file_asset disparaît)', async () => {
    const t: Trace = { calls: [] };
    const opts = {
      ...optionsOf(t, clean),
      files: { put: () => Promise.resolve({ status: 'UNAVAILABLE' as const }) },
    };
    expect(await reason(new EvidenceService(storeOf(t), opts).upload(actor, upload))).toBe(
      'UNAVAILABLE:STORE',
    );
    expect(t.calls.at(-1)).toBe('ROLLBACK');
    expect(t.calls).not.toContain('COMMIT');
  });

  it('rejeu (DUPLICATE) : aucun second dépôt', async () => {
    const t: Trace = { calls: [] };
    const r = await new EvidenceService(
      storeOf(t, 'PERMITTED', 'DUPLICATE'),
      optionsOf(t, clean),
    ).upload(actor, upload);
    expect(r.duplicate).toBe(true);
    expect(t.calls).not.toContain('put');
  });

  it('production (Bêta) : antivirus, coffre et stockage indisponibles ⇒ jamais un dépôt', async () => {
    const t: Trace = { calls: [] };
    const pool = optionsOf(t, clean).pool;
    const s = new EvidenceService(storeOf(t), unavailableEvidence(pool));
    expect(await reason(s.upload(actor, upload))).toBe('UNAVAILABLE:SCAN');
    expect(t.calls).toEqual(['permitted']);
  });
});

/**
 * Porte des lectures de données personnelles par le staff (US-004) : la lecture n'a lieu QUE sur
 * l'issue GRANTED, après l'appel de la porte, dans la même transaction ; toute autre issue (ou une
 * issue inconnue) est un refus sans lecture. Les preuves en base (journal, chaîne, rôles, pays)
 * sont dans packages/db/test/l0/l0-us004-data-access.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { SqlClient } from '../../bus/index.js';
import {
  readPersonalDataAsStaff,
  STAFF_DATA_ACCESS_SQL,
  StaffDataAccessDenied,
} from './staff-data-access.js';
import type { StaffDataAccessRequest } from './staff-data-access.js';

const REQUEST: StaffDataAccessRequest = {
  requestId: '00000000-0000-4000-8000-000000000001',
  caseId: '00000000-0000-4000-8000-000000000002',
  subjectType: 'USER',
  subjectId: '00000000-0000-4000-8000-000000000003',
  fieldOrFile: 'identity_document.number_enc',
  accessKind: 'READ_C3',
  purpose: 'Vérification du dossier KYC assigné',
};

function tx(answer: Record<string, unknown> | undefined): { tx: SqlClient; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    tx: {
      query: <R>(text: string, params?: readonly unknown[]) => {
        calls.push(text === STAFF_DATA_ACCESS_SQL ? `porte ${String(params?.length)}` : text);
        const rows = (
          text === STAFF_DATA_ACCESS_SQL && answer !== undefined ? [answer] : []
        ) as R[];
        return Promise.resolve({ rows, rowCount: rows.length });
      },
    },
  };
}

describe('readPersonalDataAsStaff (US-004, ADM-032)', () => {
  it('GRANTED : la porte journalise d’abord, puis la lecture a lieu dans la même transaction', async () => {
    const t = tx({ outcome: 'GRANTED', access_id: 'acc-1' });
    const r = await readPersonalDataAsStaff(t.tx, Buffer.alloc(32), REQUEST, async (same) => {
      await same.query('SELECT lecture');
      return 'donnée';
    });
    expect(r).toEqual({ data: 'donnée', accessId: 'acc-1' });
    expect(t.calls).toEqual(['porte 8', 'SELECT lecture']);
  });

  it.each(['FORBIDDEN', 'MFA_REQUIRED', 'AUTH_REQUIRED'] as const)(
    '%s : refus sans lecture',
    async (outcome) => {
      const t = tx({ outcome, access_id: null });
      let read = false;
      await expect(
        readPersonalDataAsStaff(t.tx, Buffer.alloc(32), REQUEST, () => {
          read = true;
          return Promise.resolve(1);
        }),
      ).rejects.toMatchObject({ name: 'StaffDataAccessDenied', outcome });
      expect(read).toBe(false);
      expect(t.calls).toEqual(['porte 8']);
    },
  );

  it.each([undefined, { outcome: 'OK', access_id: 'x' }, { outcome: 'GRANTED', access_id: null }])(
    'issue absente ou inconnue (%j) : refus fail-closed, aucune lecture',
    async (answer) => {
      const t = tx(answer);
      await expect(
        readPersonalDataAsStaff(t.tx, Buffer.alloc(32), REQUEST, () => Promise.resolve(1)),
      ).rejects.toBeInstanceOf(StaffDataAccessDenied);
      expect(t.calls).toEqual(['porte 8']);
    },
  );
});

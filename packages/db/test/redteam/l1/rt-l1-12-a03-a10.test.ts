/**
 * US-122 — red team du lot 1, passe n° 2, RT-L1-A03 (même personne, deux comptes d'hôte) et
 * RT-L1-A10 (rappel du fournisseur KYC : angles non joués en passe n° 1). Rôles de production
 * seulement (assertion L0-05 par withRole), USD (PA) et PYG (PY). Rapport :
 * docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 19 US-122 critère 3 et pré-mortem RT-L1-A03 (« second refusé à
 * l'activation »), 08 BR-ACC-06 (une personne, un compte d'hôte), 16 VER-001 (rappel « rejeté et
 * journalisé », décision d'un permis définitif, valable, au nom concordant).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { installTestProofKey } from '../../support/staff.ts';
import { isoDay, licence, person, PROVIDER } from '../../support/kyc.ts';
import { byCountry, hostOf, ops, rolledBack, uuid } from './support.ts';
import type { Tx } from './support.ts';
import { act, first, hostState, outcomeOf, readyHost } from './support-host.ts';

describe.each(byCountry)('RT-L1-A03 — même personne, deux comptes d’hôte (%s)', (country) => {
  it('témoin : le même compte ne rouvre pas un second compte d’hôte dans le pays (HOST_ACCOUNT_EXISTS)', async () => {
    await rolledBack(async (tx) => {
      const h = await hostOf(tx, country);
      const again = await first<{ outcome: string }>(
        tx,
        'SELECT * FROM core.iam_cmd_open_host_account($1, $2, $3)',
        [h.hash, country, 'INDIVIDUAL'],
      );
      expect(again.outcome).toBe('HOST_ACCOUNT_EXISTS');
    });
  });

  it('F2-A03-01 : deux comptes (deux e-mails) de la même personne (même nom, même naissance, mêmes permis) ne sont pas tous deux approuvés comme hôtes', async () => {
    await rolledBack(async (tx) => {
      await installTestProofKey(tx);
      const first1 = await readyHost(tx, country, 'CLEAR');
      const second = await readyHost(tx, country, 'CLEAR');
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const a = await act(tx, agent, 'HOST_VERIFICATION_DECISION', first1.org, {
        input: { decision: 'APPROVED' },
      });
      expect(a.outcome, 'premier compte').toBe('DONE');
      const b = await act(tx, agent, 'HOST_VERIFICATION_DECISION', second.org, {
        input: { decision: 'APPROVED' },
      });
      expect(b.outcome, 'second compte de la même personne').not.toBe('DONE');
      expect((await hostState(tx, second))['verification_status']).not.toBe('APPROVED');
    });
  });
});

interface Opened {
  readonly token: Buffer;
  readonly userId: string;
  readonly verificationId: string;
  readonly sessionRef: string;
}

/** Personne consentante, vérification ouverte et session hébergée enregistrée (rappel attendu). */
async function withSession(tx: Tx, country: string): Promise<Opened> {
  const p = await person(tx, country);
  const c = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, 1, true],
  );
  if (c.outcome !== 'RECORDED') throw new Error(`consentement : ${c.outcome}`);
  const o = await first<{ outcome: string; verification_id: string; attempt: number }>(
    tx,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  if (o.outcome !== 'READY') throw new Error(`ouverture : ${o.outcome}`);
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  const s = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.kyc_cmd_record_session($1, $2, $3, $4, $5, $6, $7)',
    [
      p.token,
      o.verification_id,
      o.attempt,
      PROVIDER,
      sessionRef,
      `https://identity.fake.invalid/session/${sessionRef}`,
      new Date(Date.now() + 30 * 60_000).toISOString(),
    ],
  );
  if (s.outcome !== 'RECORDED') throw new Error(`session : ${s.outcome}`);
  return { token: p.token, userId: p.userId, verificationId: o.verification_id, sessionRef };
}

const callback = (
  tx: Tx,
  a: { sessionRef: string; verificationId: string },
  decision: string,
  document: Record<string, unknown> | null,
  options: { provider?: string; eventId?: string } = {},
) =>
  first<{ outcome: string; status: string | null }>(
    tx,
    'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [
      options.provider ?? PROVIDER,
      options.eventId ?? `evt_${randomBytes(6).toString('hex')}`,
      a.sessionRef,
      a.verificationId,
      decision,
      0.9871,
      0.9612,
      document === null ? null : JSON.stringify(document),
    ],
  );

describe.each(byCountry)(
  'RT-L1-A10 — rappel du fournisseur : angles de la passe n° 2 (%s)',
  (country) => {
    it('décision APPROVED sans document, permis provisoire, passeport, permis expiré : jamais APPROVED (revue de l’ops)', async () => {
      await rolledBack(async (tx) => {
        const docs: readonly [string, Record<string, unknown> | null][] = [
          ['sans document', null],
          ['permis provisoire', licence(country, isoDay(400), { isPermanent: false })],
          ['passeport', licence(country, isoDay(400), { kind: 'PASSPORT' })],
          ['permis expiré', licence(country, isoDay(-1))],
        ];
        for (const [name, doc] of docs) {
          const a = await withSession(tx, country);
          const r = await callback(tx, a, 'APPROVED', doc);
          expect(r.status, name).not.toBe('APPROVED');
        }
        const ok = await withSession(tx, country);
        expect((await callback(tx, ok, 'APPROVED', licence(country, isoDay(400)))).status).toBe(
          'APPROVED',
        );
      });
    });

    it('un second rappel APPROVED (autre identifiant d’événement) après un passage en revue ne transforme jamais la revue en approbation', async () => {
      await rolledBack(async (tx) => {
        const a = await withSession(tx, country);
        const review = await callback(tx, a, 'REVIEW', licence(country, isoDay(400)));
        expect(review.status).toBe('MANUAL_REVIEW');
        const late = await callback(tx, a, 'APPROVED', licence(country, isoDay(400)));
        expect(late.outcome).not.toBe('APPLIED');
        expect(late.status).not.toBe('APPROVED');
      });
    });

    it('fournisseur différent de celui de la session : session inconnue, aucune transition', async () => {
      await rolledBack(async (tx) => {
        const a = await withSession(tx, country);
        const r = await callback(tx, a, 'APPROVED', licence(country, isoDay(400)), {
          provider: 'OTHERPROV',
        });
        expect(r.outcome).toBe('UNKNOWN_SESSION');
        expect(r.status).toBeNull();
      });
    });

    it('scores hors de 0 à 1 et fournisseur mal formé : refusés (22023) avant toute écriture', async () => {
      await rolledBack(async (tx) => {
        const a = await withSession(tx, country);
        const call = (provider: string, liveness: number) =>
          outcomeOf(
            tx,
            'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
            [
              provider,
              uuid(),
              a.sessionRef,
              a.verificationId,
              'APPROVED',
              liveness,
              0.9,
              JSON.stringify(licence(country, isoDay(400))),
            ],
          );
        expect(await call(PROVIDER, 1.5)).toBe('ERR:22023');
        expect(await call(PROVIDER, -0.1)).toBe('ERR:22023');
        expect(await call('fake; drop', 0.9)).toBe('ERR:22023');
      });
    });

    it('journal des rappels rejetés : motif hors liste, empreinte de mauvaise longueur, taille négative refusés (22023) ; un rejet valide est accepté', async () => {
      await rolledBack(async (tx) => {
        const log = (reason: string, sha: Buffer, length: number) =>
          outcomeOf(tx, 'SELECT core.kyc_cmd_record_webhook_rejection($1, $2, $3, $4)', [
            PROVIDER,
            reason,
            sha,
            length,
          ]);
        expect(await log('NOT_A_REASON', randomBytes(32), 10)).toBe('ERR:22023');
        expect(await log('BAD_SIGNATURE', randomBytes(31), 10)).toBe('ERR:22023');
        expect(await log('BAD_SIGNATURE', randomBytes(32), -1)).toBe('ERR:22023');
        expect(await log('BAD_SIGNATURE', randomBytes(32), 10)).toBe('ROWS:1');
      });
    });
  },
);

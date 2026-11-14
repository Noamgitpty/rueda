/**
 * US-122 — red team du lot 1, axe KYC et auto-réservation (RT-L1-A04, A10, US-103, US-105,
 * US-127) : rejeu et falsification du rappel du fournisseur, contournement du consentement
 * biométrique, nom légal, auto-réservation par un second compte (changement de nom, autre pays,
 * autre découpage du nom du permis). Rôles de production seulement (assertion L0-05 par
 * withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 16 VER-001 à VER-013, ACC-014 (« elle ne peut jamais réserver un véhicule
 * de son propre compte d'hôte, ni par un compte lié (même appareil, même carte, même pièce) »),
 * BKG-012 ; 19 US-103, US-105, US-127 ; pré-mortem L1-PM-03, L1-PM-30. Les formats de nom du
 * permis (prénoms puis noms, ou noms puis prénoms) sont des données de test tirées des usages des
 * documents d'identité, jamais du code testé.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { translateDbError } from '../../../src/index.ts';
import { placeHoldCommand, registerVehicles } from '../../support/concurrency.ts';
import { isoDay, licence, person, PROVIDER } from '../../support/kyc.ts';
import { byCountry, otherOf, rolledBack, uuid } from './support.ts';
import type { CountryCase, Tx } from './support.ts';
import { first } from './support-host.ts';

interface Opened {
  readonly userId: string;
  readonly token: Buffer;
  readonly verificationId: string;
  readonly attempt: number;
  readonly sessionRef: string;
}

/** Personne consentante, vérification ouverte et session hébergée enregistrée (rappel attendu). */
async function withSession(
  tx: Tx,
  country: string,
  names?: { first: string; last: string },
): Promise<Opened> {
  const p = await person(tx, country, names);
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
  return { ...p, verificationId: o.verification_id, attempt: o.attempt, sessionRef };
}

interface Applied {
  readonly outcome: string;
  readonly status: string | null;
}

/** Rappel signé du fournisseur (commande du travailleur d'ingestion, jouée sous app_api en test). */
const callback = (
  tx: Tx,
  a: { sessionRef: string; verificationId: string },
  decision: string,
  document: Record<string, unknown> | null,
  eventId = `evt_${randomBytes(6).toString('hex')}`,
): Promise<Applied> =>
  first<Applied>(
    tx,
    'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [
      PROVIDER,
      eventId,
      a.sessionRef,
      a.verificationId,
      decision,
      0.9871,
      0.9612,
      document === null ? null : JSON.stringify(document),
    ],
  );

describe.each(byCountry)(
  'RT-L1-A10 — rappel du fournisseur : rejeu, falsification (%s)',
  (country) => {
    it('session d’un compte, verification_id d’un autre : jamais appliqué ; la victime reste en attente', async () => {
      await rolledBack(async (tx) => {
        const mine = await withSession(tx, country);
        const victim = await withSession(tx, country);
        const forged = await callback(
          tx,
          { sessionRef: mine.sessionRef, verificationId: victim.verificationId },
          'APPROVED',
          licence(country, isoDay(400)),
        );
        expect(forged.outcome).not.toBe('APPLIED');
        expect(forged.status).not.toBe('APPROVED');
        // témoin : le rappel honnête de la victime est appliqué (la garde n'est pas vide)
        const honest = await callback(tx, victim, 'APPROVED', licence(country, isoDay(400)));
        expect(honest).toMatchObject({ outcome: 'APPLIED', status: 'APPROVED' });
      });
    });

    it('même événement rejoué, et événement d’un identifiant inconnu : une seule transition ; session inconnue refusée', async () => {
      await rolledBack(async (tx) => {
        const a = await withSession(tx, country);
        const doc = licence(country, isoDay(400));
        const eventId = `evt_${randomBytes(6).toString('hex')}`;
        expect((await callback(tx, a, 'APPROVED', doc, eventId)).outcome).toBe('APPLIED');
        const replay = await callback(tx, a, 'APPROVED', doc, eventId);
        expect(replay.outcome).not.toBe('APPLIED');
        const unknown = await callback(
          tx,
          { sessionRef: `fk_idv_${randomBytes(6).toString('hex')}`, verificationId: uuid() },
          'APPROVED',
          doc,
        );
        expect(unknown.outcome).not.toBe('APPLIED');
      });
    });

    it('retrait du consentement biométrique avant le rappel : le rappel APPROVED ne rend jamais APPROVED', async () => {
      await rolledBack(async (tx) => {
        const a = await withSession(tx, country);
        const withdrawn = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
          [a.token, country, 1, false],
        );
        expect(withdrawn.outcome).toBe('RECORDED');
        const r = await callback(tx, a, 'APPROVED', licence(country, isoDay(400)));
        expect(r.status).not.toBe('APPROVED');
      });
    });

    it('sans consentement, ou refus du consentement : aucune vérification ouverte ; version de consentement inconnue : refus', async () => {
      await rolledBack(async (tx) => {
        const p = await person(tx, country);
        const open = (token: Buffer) =>
          first<{ outcome: string }>(
            tx,
            'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
            [token, country, PROVIDER],
          );
        expect((await open(p.token)).outcome, 'sans consentement').not.toBe('READY');
        const no = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
          [p.token, country, 1, false],
        );
        expect(no.outcome).toBe('RECORDED');
        expect((await open(p.token)).outcome, 'consentement refusé').not.toBe('READY');
        const wrong = await first<{ outcome: string }>(
          tx,
          'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
          [p.token, country, 99_999, true],
        );
        expect(wrong.outcome, 'version de consentement inexistante').not.toBe('RECORDED');
        expect((await open(p.token)).outcome).not.toBe('READY');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-A10 — nom légal (US-103) : faux positifs exploitables (%s)',
  (country) => {
    const approved = async (
      tx: Tx,
      declared: { first: string; last: string },
      license: { given: string; surnames: string },
    ) => {
      const a = await withSession(tx, country, declared);
      return callback(
        tx,
        a,
        'APPROVED',
        licence(country, isoDay(400), {
          holderGivenNames: license.given,
          holderSurnames: license.surnames,
        }),
      );
    };

    it.each([
      ['personne différente', { first: 'Ana', last: 'Pérez' }, { given: 'Juan', surnames: 'Soto' }],
      [
        'seul le prénom commun',
        { first: 'Ana', last: 'López' },
        { given: 'Ana María', surnames: 'Pérez Gómez' },
      ],
      [
        'prénom plus long, même début',
        { first: 'Ana', last: 'Pérez' },
        { given: 'Anabel', surnames: 'Pérez Gómez' },
      ],
      [
        'initiales seules',
        { first: 'A', last: 'P' },
        { given: 'María José', surnames: 'Núñez Pérez' },
      ],
      [
        'permis non latin (illisible)',
        { first: 'Ana', last: 'Pérez' },
        { given: '李明', surnames: '王' },
      ],
      ['permis sans noms', { first: 'Ana', last: 'Pérez' }, { given: '', surnames: '' }],
    ] as const)(
      '%s : la décision automatique n’approuve pas (revue de l’ops)',
      async (_name, declared, license) => {
        await rolledBack(async (tx) => {
          const r = await approved(tx, declared, license);
          expect(r.status).not.toBe('APPROVED');
        });
      },
    );

    it('témoin : mêmes noms (casse et accents ignorés) ⇒ approuvé', async () => {
      await rolledBack(async (tx) => {
        const r = await approved(
          tx,
          { first: 'María José', last: 'Núñez Pérez' },
          { given: 'MARIA JOSE', surnames: 'NUNEZ PEREZ' },
        );
        expect(r.status).toBe('APPROVED');
      });
    });
  },
);

// ---------------------------------------------------------------------------------------------
// Auto-réservation (US-127) : monde de test copié sur l0-us127 (mêmes fixtures)
// ---------------------------------------------------------------------------------------------
let day = 0;
function slot(): { start: string; end: string } {
  day += 3;
  const start = new Date(Date.UTC(2038, 0, 1, 10) + day * 86_400_000);
  return {
    start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 86_400_000).toISOString(),
  };
}

async function pose(
  tx: Tx,
  guestId: string,
  vehicleId: string,
  orgId: string,
  s: { start: string; end: string },
): Promise<string> {
  await tx.query('SAVEPOINT pose');
  try {
    await placeHoldCommand(tx, {
      slot: { vehicleId, orgId, start: s.start, end: s.end, bufferHours: 0 },
      guestId,
    });
    await tx.query('RELEASE SAVEPOINT pose');
    return 'OK';
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT pose');
    return translateDbError(error).code;
  }
}

async function party(tx: Tx): Promise<string> {
  const id = uuid();
  await tx.query('SELECT test_fixture.ensure_party($1, NULL, NULL)', [id]);
  return id;
}

async function hostWithVehicle(
  tx: Tx,
  c: CountryCase,
): Promise<{ org: string; holder: string; vehicle: string }> {
  const org = uuid();
  const vehicle = uuid();
  const r = await tx.query<{ h: string }>('SELECT test_fixture.create_org($1, $2, $3) AS h', [
    org,
    c.country,
    'ACTIVE',
  ]);
  await registerVehicles(tx, [vehicle], org, c);
  return { org, holder: r.rows[0]?.h as string, vehicle };
}

/** Identité vérifiée dont le permis porte `license` (le nom déclaré du compte est `declared`). */
async function verifyWithLicense(
  tx: Tx,
  user: string,
  c: CountryCase,
  declared: readonly [string, string],
  license: readonly [string, string],
  birth: string,
): Promise<void> {
  const v = await tx.query<{ id: string }>(
    'SELECT test_fixture.us127_verified_identity($1, $2, $3, $4, $5::date) AS id',
    [user, c.country, declared[0], declared[1], birth],
  );
  await tx.query('SELECT test_fixture.us103_license_name($1, $2, $3)', [
    v.rows[0]?.id,
    license[0],
    license[1],
  ]);
}

const holds = async (tx: Tx, guest: string, vehicle: string) =>
  (
    await tx.query<{ holds: number; occupancies: number }>(
      'SELECT * FROM test_fixture.us127_holds($1, $2)',
      [guest, vehicle],
    )
  ).rows[0];

describe.each(byCountry)(
  'RT-L1-A04 — auto-réservation par un second compte (%s)',
  (_country, _cur, c) => {
    const birth = '1988-09-03';

    /** Le même titulaire, un second compte de `other` dont le permis porte `license`. */
    async function attempt(license: readonly [string, string], other: CountryCase) {
      return rolledBack(async (tx) => {
        const a = await hostWithVehicle(tx, c);
        await verifyWithLicense(
          tx,
          a.holder,
          c,
          ['María José', 'Núñez Pérez'],
          ['MARIA JOSE', 'NUNEZ PEREZ'],
          birth,
        );
        const second = await party(tx);
        await verifyWithLicense(tx, second, other, ['Majo', 'Núñez'], license, birth);
        const code = await pose(tx, second, a.vehicle, a.org, slot());
        return { code, held: await holds(tx, second, a.vehicle) };
      });
    }

    it('témoin : même permis, même découpage, autre pays ⇒ SELF_BOOKING_FORBIDDEN (le test n’est pas vide)', async () => {
      const r = await attempt(['MARIA JOSE', 'NUNEZ PEREZ'], otherOf(c));
      expect(r.code).toBe('SELF_BOOKING_FORBIDDEN');
      expect(r.held).toEqual({ holds: 0, occupancies: 0 });
    });

    it('permis d’un autre pays qui écrit les noms avant les prénoms (même personne, même naissance) : refusé', async () => {
      const r = await attempt(['NUNEZ PEREZ', 'MARIA JOSE'], otherOf(c));
      expect(r.code, 'pose du second compte').toBe('SELF_BOOKING_FORBIDDEN');
      expect(r.held).toEqual({ holds: 0, occupancies: 0 });
    });

    it('permis qui ne porte que le premier prénom et le premier nom (même personne, même naissance) : refusé', async () => {
      const r = await attempt(['MARIA', 'NUNEZ'], otherOf(c));
      expect(r.code, 'pose du second compte').toBe('SELF_BOOKING_FORBIDDEN');
      expect(r.held).toEqual({ holds: 0, occupancies: 0 });
    });

    it('permis avec un prénom en plus (deuxième prénom ajouté) : refusé', async () => {
      const r = await attempt(['MARIA JOSE DEL CARMEN', 'NUNEZ PEREZ'], c);
      expect(r.code, 'pose du second compte').toBe('SELF_BOOKING_FORBIDDEN');
    });

    it('témoin d’innocence : un voyageur sans lien, même nom commun mais autre naissance, réserve', async () => {
      await rolledBack(async (tx) => {
        const a = await hostWithVehicle(tx, c);
        await verifyWithLicense(
          tx,
          a.holder,
          c,
          ['María José', 'Núñez Pérez'],
          ['MARIA JOSE', 'NUNEZ PEREZ'],
          birth,
        );
        const guest = await party(tx);
        await verifyWithLicense(
          tx,
          guest,
          c,
          ['María José', 'Núñez Pérez'],
          ['MARIA JOSE', 'NUNEZ PEREZ'],
          '1990-01-01',
        );
        expect(await pose(tx, guest, a.vehicle, a.org, slot())).toBe('OK');
      });
    });
  },
);

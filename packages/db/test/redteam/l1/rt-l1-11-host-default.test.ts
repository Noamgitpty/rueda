/**
 * US-122 — red team du lot 1, passe n° 2, hôte défaillant (RT-L1-T01 ; 19 US-122 critère 4 ;
 * BR-TRUST-09, BR-CXL-12, BR-CXL-13, E7 règles 6 et 7, vecteurs T14, T15, T22, T26, T31, T48,
 * TJ06) : l'hôte qui ne remet pas le véhicule ou annule tard. Ce qui existe au lot 1 est joué :
 * restriction de l'hôte (suspension des nouvelles réservations, déjà prouvée par l0-us109,
 * L1-PM-33), moteur de règlement pur (effets sur le voyageur et sur les jambes). Ce qui manque au
 * lot 1 (liste des trips futurs de l'hôte pour l'ops, prévenir chaque voyageur) est joué comme
 * attaque : un test rouge est une suite à ouvrir (US-222, lot 2), avec sa gravité. Rôles de
 * production seulement (assertion L0-05 par withRole), USD (PA) et PYG (PY). Rapport :
 * docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 08 BR-TRUST-09 (« suspendre les nouvelles réservations d'un hôte défaillant ;
 * prévenir les voyageurs concernés »), BR-CXL-12 (« le guest est remboursé intégralement »),
 * BR-CXL-13 (pénalité de 25 au-delà de 24 h, de 50 jusqu'à 24 h inclus, versée au `host_ledger`),
 * E7 (variation négative de toutes les jambes, jamais un prorata) ; les montants viennent de
 * l'export des oracles Python (`@rueda/money/golden-vectors`), jamais du moteur.
 */
import { computeCancellationSettlement } from '@rueda/money';
import { loadGoldenVectors, settlementVector } from '@rueda/money/golden-vectors';
import type { GoldenEvent } from '@rueda/money/golden-vectors';
import { testParams, toEvent, toTrip } from '@rueda/money/testing';
import { describe, expect, it } from 'vitest';
import { withRole } from '../../../src/testing/index.ts';
import { installTestProofKey } from '../../support/staff.ts';
import { byCountry, hostOf, ops, rolledBack, uuid } from './support.ts';
import type { Tx } from './support.ts';
import { act, first } from './support-host.ts';
import { PURPOSE } from './support-p2.ts';

describe.each(byCountry)(
  'RT-L1-T01 — hôte défaillant : l’ops suspend, liste et prévient (%s)',
  (country, _currency, cc) => {
    /** Hôte réel avec un trip à venir d'un voyageur ; l'ops restreint son titulaire (TS_HOLD). */
    async function defaultingHost(tx: Tx) {
      await installTestProofKey(tx);
      const host = await hostOf(tx, country);
      const guest = uuid();
      const trip = uuid();
      await tx.query(`SELECT test_fixture.rls_insert_trip($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [
        trip,
        guest,
        host.org,
        uuid(),
        cc.country,
        cc.currency,
        cc.timezone,
        new Date(Date.now() + 5 * 86_400_000).toISOString(),
        new Date(Date.now() + 8 * 86_400_000).toISOString(),
      ]);
      const agent = await ops(tx, 'OPS_AGENT', [country]);
      const restricted = await act(tx, agent, 'RESTRICT_ACCOUNT', host.userId, {
        input: { kind: 'TS_HOLD' },
      });
      expect(restricted.outcome, 'suspension des nouvelles réservations').toBe('DONE');
      return { host, guest, trip };
    }

    it('F2-T-01 : l’ops liste les trips à venir de l’hôte défaillant (la fiche de l’hôte porte ses trips en tant qu’hôte, pas seulement ceux qu’il a réservés)', async () => {
      await rolledBack(async (tx) => {
        const { host, trip } = await defaultingHost(tx);
        const admin = await ops(tx, 'ADMIN', [country]);
        const r = await first<{ outcome: string; body: unknown }>(
          tx,
          'SELECT * FROM core.support_staff_profile($1, $2, $3, $4)',
          [admin.hash, uuid(), host.userId, PURPOSE],
        );
        expect(r.outcome).toBe('GRANTED');
        expect(JSON.stringify(r.body), 'trip à venir du compte d’hôte').toContain(trip);
      });
    });

    it('F2-T-02 : chaque voyageur d’un trip à venir de l’hôte défaillant est prévenu (un événement le concerne dès la suspension)', async () => {
      await rolledBack(async (tx) => {
        const { guest, trip } = await defaultingHost(tx);
        const events = (
          await tx.query<{ type: string }>(
            'SELECT * FROM test_fixture.us122b_events_mentioning($1::text[])',
            [[guest, trip]],
          )
        ).rows;
        expect(events.length, 'événement citant le voyageur ou son trip').toBeGreaterThan(0);
      });
    });
  },
);

const golden = loadGoldenVectors();
/** Un trip de référence par devise (vecteurs de 08) : PA en USD (T14), PY en PYG (T48). */
const REFERENCE: Readonly<Record<string, string>> = { USD: 'T14', PYG: 'T48' };

describe.each(byCountry)(
  'RT-L1-T01 — hôte défaillant : le voyageur est remboursé intégralement, les jambes de l’hôte ne gagnent rien (%s)',
  (_country, currency) => {
    const settle = (over: Partial<GoldenEvent>) => {
      const v = settlementVector(golden, REFERENCE[currency] ?? '');
      const trip = toTrip(v.trip);
      const s = computeCancellationSettlement(
        trip,
        toEvent({ ...v.event, ...over }),
        testParams(trip.currency),
      );
      return { s, trip, v };
    };
    const OFFSETS = [-4320, -1441, -1440, -1439, -60, -1];

    it('annulation par l’hôte à toute heure avant le départ : remboursement du total payé, aucun gain d’hôte, aucune marge de plateforme conservée (BR-CXL-12, E7)', async () => {
      await withRole('app_worker', async () => undefined);
      for (const m of OFFSETS) {
        const { s, trip } = settle({ reason: 'HOST_CANCELLED', requestedAtMinutes: m });
        expect(s.guestRefund.amountMinor, `remboursement à T${m} min`).toBe(
          trip.totalPaid.amountMinor,
        );
        expect(s.hostEarnings.amountMinor, `gain de l’hôte à T${m} min`).toBe(0n);
        expect(s.platformNet.amountMinor, `marge de la plateforme à T${m} min`).toBe(0n);
        expect(s.retained.amountMinor, `retenue sur le voyageur à T${m} min`).toBe(0n);
      }
    });

    it('la pénalité de l’hôte ne baisse jamais à mesure que le départ approche, au-delà de 24 h : celle des vecteurs ; à 24 h pile et moins : au moins celle-ci (BR-CXL-13)', async () => {
      await withRole('app_worker', async () => undefined);
      const early = BigInt(
        settlementVector(golden, REFERENCE[currency] ?? '').expected.hostPenaltyMinor,
      );
      let previous = 0n;
      for (const m of OFFSETS) {
        const { s } = settle({ reason: 'HOST_CANCELLED', requestedAtMinutes: m });
        const penalty = s.hostPenalty.amountMinor;
        expect(penalty, `pénalité à T${m} min`).toBeGreaterThanOrEqual(previous);
        if (m <= -1441) expect(penalty, `au-delà de 24 h (T${m} min)`).toBe(early);
        if (m >= -1440) expect(penalty, `à 24 h et moins (T${m} min)`).toBeGreaterThan(early);
        previous = penalty;
      }
    });

    it('PA : à 24 h pile et moins, la pénalité vaut celle de T15 ; une minute de plus que 24 h, celle de T14 (oracles T14 et T15)', async () => {
      await withRole('app_worker', async () => undefined);
      if (currency !== 'USD') return;
      const t14 = BigInt(settlementVector(golden, 'T14').expected.hostPenaltyMinor);
      const t15 = BigInt(settlementVector(golden, 'T15').expected.hostPenaltyMinor);
      expect(
        settle({ reason: 'HOST_CANCELLED', requestedAtMinutes: -1441 }).s.hostPenalty.amountMinor,
      ).toBe(t14);
      expect(
        settle({ reason: 'HOST_CANCELLED', requestedAtMinutes: -1440 }).s.hostPenalty.amountMinor,
      ).toBe(t15);
      expect(
        settle({ reason: 'HOST_CANCELLED', requestedAtMinutes: -1439 }).s.hostPenalty.amountMinor,
      ).toBe(t15);
    });

    it('compte d’hôte fermé par la plateforme : même remboursement intégral, sans pénalité d’hôte (T22)', async () => {
      await withRole('app_worker', async () => undefined);
      if (currency !== 'USD') return;
      const v = settlementVector(golden, 'T22');
      for (const m of [-600, -1]) {
        const s = computeCancellationSettlement(
          toTrip(v.trip),
          toEvent({ ...v.event, requestedAtMinutes: m }),
          testParams(toTrip(v.trip).currency),
        );
        expect(s.guestRefund.amountMinor, `T${m} min`).toBe(toTrip(v.trip).totalPaid.amountMinor);
        expect(s.hostEarnings.amountMinor).toBe(0n);
        expect(s.hostPenalty.amountMinor).toBe(0n);
      }
    });
  },
);

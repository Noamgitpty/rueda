/**
 * US-706 — frais annexes : demande de l'hôte, délai de réponse du voyageur (payer ou contester avec
 * preuves), décision de l'ops après contestation, débit séparé par Kmino (migration 0177, ADR-197 ;
 * fixture 9907, et 9300, 9909, 9948, 9650 réutilisées). Rôles de PRODUCTION seulement (assertion
 * L0-05 par `withRole`), au Panama (USD) et au Paraguay (PYG sans décimale).
 *
 * Attendus tirés de 19 US-706 (critère 1 : frais validé par l'hôte et notifié à J0 10:00,
 * `invoice_guest_response_h` = 72, à J+3 09:59 aucun débit `GUEST_RESPONSE_WINDOW_OPEN` ;
 * contestation avec preuves ⇒ `DISPUTED` et décision de l'ops ; critère 2 : frais hors de la liste
 * fermée de BR-REIMB refusé), de 16 CLM-021 (à J+3 10:00 Kmino peut trancher, ordre de débit aux
 * jambes dont la somme égale le frais ; demande sans preuve refusée avant notification :
 * `CLAIM_EVIDENCE_MISSING`), de 19 US-315 critère 5 (carburant ou nettoyage refusés selon BR-FUEL-02,
 * BR-FUEL-03, BR-RETURN-05 ; frais sans photo impossible), de 08 (BR-REIMB-01 R09 : demande au plus
 * tard fin effective + 72 h ; BR-REIMB-02 : `invoice_guest_response_h` = 72, fenêtre jamais
 * rouverte ; BR-PROT-08 et « Jambes des frais annexes » : part de l'hôte 100 % ; vecteur T69 :
 * carburant 12,00 ⇒ HOST 12,00, PLATFORM 0,00, aucune caution) et des oracles Python
 * (`docs/specs/tools/check_t49plus.py`, ligne T69 ; `check_legs.alloc_host(m, 1)` = m pour
 * m = 1 200, 4 500, 90 000 et 300 000, `python -I -X utf8`, 2026-11-22), jamais du code testé. Le
 * pré-mortem du lot 3 (L3-PM-24, 25, 26, 28) et la red team (RT-L3-S01, RT-L3-S02 « frais saisi
 * sans preuve », débit à J+3 09:59, contestation à J+3 09:58, frais DISPUTED envoyé au débit ;
 * RT-L3-M04, H09) fixent les cas hostiles ; RT-L3-S02 référence le test « RT-L3-S02 ».
 *
 * Années virtuelles 2097 (libres). Données de préparation VALIDÉES (deux rôles : app_api pour les
 * parties et la console, app_worker pour le débit) ; aucun paramètre ni interrupteur n'est validé :
 * les versions de paramètres ne vivent que dans des transactions ANNULÉES. Aucun compte PSP ACTIVE
 * n'est validé : le moyen débité est l'opération de carte du loyer sur le compte FAKE de fixture.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { withRole, withTestTransaction } from '../../src/testing/index.ts';
import { COUNTRIES } from '../support/avl.ts';
import type { CountryCase } from '../support/avl.ts';
import { caught, payTx } from '../support/pay.ts';
import { elevated, staff, uuid } from '../support/claims.ts';
import type { Staff } from '../support/claims.ts';
import {
  ACCEPT,
  amountsOf,
  asPayments,
  at,
  attach,
  CANCEL,
  CHARGE,
  charges,
  decide,
  DISPUTE,
  DISPUTE_REASON,
  DUE,
  DUE_LIST,
  END,
  HOUR,
  invoices,
  J0,
  MINUTE,
  now,
  param,
  RATIONALE,
  session,
  START,
  STAFF_VIEW,
  submit,
  VIEW,
  world,
} from '../support/incidental.ts';
import type { Row } from '../support/incidental.ts';

describe.each(COUNTRIES)('US-706 — frais annexes ($country, $currency)', (c: CountryCase) => {
  const a = amountsOf(c);

  it('critère 1 : notifié à J0 10:00, invoice_guest_response_h = 72 — à J+3 09:59 aucun débit (GUEST_RESPONSE_WINDOW_OPEN), à J+3 10:00 Kmino tranche : débit séparé d’US-703 aux jambes explicites (HOST 100 %, T69), jamais la caution ; rejeu sans second débit', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const hash = await session(tx, w.holder);
        const r = await submit(tx, hash, w.trip, 'CLEANING', a['cleaning']!, [w.inner, w.outer]);
        expect(r['outcome']).toBe('SUBMITTED');
        // échéance = notification + 72 h, à l'heure de la base (jamais l'heure du client)
        expect((r['response_due_at'] as Date).toISOString()).toBe(DUE);
        const rows = await invoices(tx, w.trip);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          fee_type: 'CLEANING',
          status: 'AWAITING_GUEST',
          amount_minor: a['cleaning']!.toString(),
          // BR-PROT-08, T69 : part de l'hôte 100 % (alloc_host(m, 1) = m), PLATFORM 0
          leg_host_minor: a['cleaning']!.toString(),
          leg_insurer_minor: '0',
          leg_tax_third_party_minor: '0',
          leg_platform_minor: '0',
          host_user_id: w.holder,
          guest_user_id: w.guest,
          charge_id: null,
        });
        expect((rows[0]!['notified_at'] as Date).toISOString()).toBe(J0);
        // BR-REIMB-01 R09 : délai de l'hôte = fin effective + 72 h
        expect((rows[0]!['host_deadline_at'] as Date).toISOString()).toBe(at(END, 72 * HOUR));
        // « notifié à J0 » (19 US-706 ; 16 CLM-021 EVT_INVOICE_TO_GUEST) : un événement dans la même
        // transaction, routé vers le voyageur par NTF ; ni motif ni texte de l'hôte dans le contenu
        const events = (
          await tx.query<Row>('SELECT * FROM test_fixture.us706_events($1)', [r['invoice_id']])
        ).rows;
        expect(events).toEqual([
          {
            type: 'invoice.status_changed',
            aggregate_type: 'incidental_invoice',
            actor_role: 'HOST',
            actor_user_id: w.holder,
            country_code: c.country,
            partition_key: w.trip,
            payload: {
              invoice_id: r['invoice_id'],
              trip_id: w.trip,
              status: 'AWAITING_GUEST',
              fee_type: 'CLEANING',
              amount_minor: a['cleaning']!.toString(),
              currency: c.currency,
              response_due_at: DUE,
            },
          },
        ]);
        return { trip: w.trip, rent: w.rent, invoice: String(r['invoice_id']) };
      }),
    );

    // J+3 09:59 (une minute avant l'échéance) : aucun débit, rien n'est écrit
    await asPayments(at(DUE, -MINUTE), async (tx) => {
      expect(
        (await tx.query<{ id: string }>(DUE_LIST, [[ids.invoice]])).rows.map((x) => x.id),
      ).not.toContain(ids.invoice);
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'GUEST_RESPONSE_WINDOW_OPEN',
      });
      expect(await charges(tx, ids.invoice)).toEqual([]);
      expect((await invoices(tx, ids.trip))[0]).toMatchObject({ status: 'AWAITING_GUEST' });
    });
    // borne exacte : 1 ms avant l'échéance, toujours ouvert
    await asPayments(at(DUE, -1), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'GUEST_RESPONSE_WINDOW_OPEN',
      });
    });

    // J+3 10:00 : échéance passée sans réponse ⇒ ordre de débit d'US-703, jambes explicites
    await asPayments(DUE, async (tx) => {
      expect(
        (await tx.query<{ id: string }>(DUE_LIST, [[ids.invoice]])).rows.map((x) => x.id),
      ).toContain(ids.invoice);
      const chargeId = uuid();
      expect((await tx.query<Row>(CHARGE, [ids.invoice, chargeId])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
      // rejeu : même issue, aucun second débit
      expect((await tx.query<Row>(CHARGE, [ids.invoice, uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
      const list = await charges(tx, ids.invoice);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({
        id: chargeId,
        purpose: 'INCIDENTAL',
        reason: 'DELAYED_CHARGES',
        amount_minor: a['cleaning']!.toString(),
        leg_host_minor: a['cleaning']!.toString(),
        leg_insurer_minor: '0',
        leg_tax_third_party_minor: '0',
        leg_platform_minor: '0',
        guest_agreed: false,
        status: 'NOTIFIED',
        tender_operation_id: ids.rent,
      });
      const inv = (await invoices(tx, ids.trip))[0]!;
      expect(inv).toMatchObject({
        status: 'CHARGED',
        charge_basis: 'NO_RESPONSE',
        charge_id: chargeId,
      });
      expect((inv['charged_at'] as Date).toISOString()).toBe(DUE);
      // jamais la caution (L3-PM-24, RT-L3-M04) : aucune opération DEPOSIT_* sur le trip
      expect(
        (
          await tx.query<{ n: number }>('SELECT test_fixture.us309_deposit_operations($1) AS n', [
            ids.trip,
          ])
        ).rows[0]!.n,
      ).toBe(0);
      expect(
        (
          await tx.query<{ n: number }>('SELECT test_fixture.us706_trip_charges($1) AS n', [
            ids.trip,
          ])
        ).rows[0]!.n,
      ).toBe(1);
    });
  });

  it('RT-L3-S02 : contestation à J+3 09:58 acceptée (DISPUTED), à J+3 10:00 refusée (fenêtre jamais rouverte) ; frais DISPUTED jamais débité avant la décision de l’ops ; décision motivée, débit réservé à ADMIN, garde ADR-122', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const admin = await staff(tx, 'ADMIN', [c.country]);
        const party = await staff(tx, 'ADMIN', [c.country]);
        const w = await world(tx, c);
        const late = await world(tx, c);
        const rejected = await world(tx, c);
        const self = await world(tx, c, { guest: party.id });
        await now(tx, J0);
        const ids: Record<string, string> = {};
        for (const [name, x] of [
          ['disputed', w],
          ['late', late],
          ['rejected', rejected],
          ['self', self],
        ] as const) {
          const r = await submit(
            tx,
            await session(tx, x.holder),
            x.trip,
            'CLEANING',
            a['cleaning']!,
            [x.inner],
          );
          expect(r['outcome']).toBe('SUBMITTED');
          ids[name] = String(r['invoice_id']);
        }

        // J+3 09:58 : contestation sans motif, sans pièce, pièce étrangère : refusées
        await now(tx, at(DUE, -2 * MINUTE));
        let g = await session(tx, w.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              'trop court',
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('INCIDENTAL_DISPUTE_REASON_REQUIRED');
        expect(
          (await tx.query<{ r: string }>(DISPUTE, [g, ids['disputed'], DISPUTE_REASON, []]))
            .rows[0]!.r,
        ).toBe('CLAIM_EVIDENCE_MISSING');
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [late.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('CLAIM_EVIDENCE_MISSING');
        // l'hôte ne conteste pas ; une autre personne : même réponse qu'un frais inconnu
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, w.holder),
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('NOT_FOUND');
        g = await session(tx, w.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              g,
              ids['disputed'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('ALREADY_DISPUTED');
        // contesté : le paiement n'est plus possible
        expect((await tx.query<{ r: string }>(ACCEPT, [g, ids['disputed']])).rows[0]!.r).toBe(
          'INCIDENTAL_NOT_OPEN',
        );
        for (const name of ['rejected', 'self'] as const) {
          const x = name === 'rejected' ? rejected : self;
          expect(
            (
              await tx.query<{ r: string }>(DISPUTE, [
                await session(tx, x.guest),
                ids[name],
                DISPUTE_REASON,
                [x.guestInner],
              ])
            ).rows[0]!.r,
          ).toBe('DISPUTED');
        }

        // J+3 10:00 exactement : la fenêtre est close, ni contestation ni paiement
        await now(tx, DUE);
        const gl = await session(tx, late.guest);
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              gl,
              ids['late'],
              DISPUTE_REASON,
              [late.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('GUEST_RESPONSE_WINDOW_CLOSED');
        expect((await tx.query<{ r: string }>(ACCEPT, [gl, ids['late']])).rows[0]!.r).toBe(
          'GUEST_RESPONSE_WINDOW_CLOSED',
        );
        expect((await invoices(tx, w.trip))[0]).toMatchObject({ status: 'DISPUTED' });
        const view = (await tx.query<{ v: Row }>(VIEW, [g, w.trip])).rows[0]!.v;
        expect(view).toMatchObject({ outcome: 'OK', viewerRole: 'GUEST' });
        expect((view['invoices'] as Row[])[0]).toMatchObject({
          status: 'DISPUTED',
          windowOpen: false,
          disputeReason: DISPUTE_REASON,
          chargeStatus: null,
        });

        // décision de l'ops (US-309) : motif obligatoire, jamais « définitive », débit = ADMIN
        await now(tx, at(DUE, HOUR));
        expect((await decide(tx, ops, ids['disputed']!, 'CHARGE'))['outcome']).toBe(
          'DECISION_ADMIN_REQUIRED',
        );
        expect((await decide(tx, admin, ids['disputed']!, 'CHARGE', 'court'))['outcome']).toBe(
          'DECISION_RATIONALE_REQUIRED',
        );
        expect(
          (
            await decide(
              tx,
              admin,
              ids['disputed']!,
              'CHARGE',
              'Decisión definitiva tras revisar las fotos del retorno.',
            )
          )['outcome'],
        ).toBe('DECISION_FINALITY_FORBIDDEN');
        // séparation des tâches (ADR-122, RT-L3-H09) : l'agent voyageur du trip ne décide pas
        expect((await decide(tx, party, ids['self']!, 'REJECT'))['outcome']).toBe('SELF_FORBIDDEN');
        const hashParty = await elevated(tx, party);
        expect(
          (await tx.query<Row>(STAFF_VIEW, [hashParty, uuid(), ids['self']])).rows[0]!['outcome'],
        ).toBe('SELF_FORBIDDEN');
        // un frais non contesté n'est pas décidé par l'ops
        expect((await decide(tx, admin, ids['late']!, 'CHARGE'))['outcome']).toBe(
          'INCIDENTAL_NOT_DISPUTED',
        );
        const requestId = uuid();
        const ok = await decide(tx, admin, ids['disputed']!, 'CHARGE', RATIONALE, requestId);
        expect(ok['outcome']).toBe('DECIDED');
        expect(ok['body']).toMatchObject({ status: 'DECIDED_CHARGE', decidedRole: 'ADMIN' });
        expect(
          (await decide(tx, admin, ids['disputed']!, 'CHARGE', RATIONALE, requestId))['outcome'],
        ).toBe('ALREADY_DECIDED');
        expect((await decide(tx, ops, ids['rejected']!, 'REJECT'))['outcome']).toBe('DECIDED');
        const hashOps = await elevated(tx, ops);
        const read = (await tx.query<Row>(STAFF_VIEW, [hashOps, uuid(), ids['rejected']])).rows[0]!;
        expect(read['outcome']).toBe('OK');
        expect(read['body']).toMatchObject({
          status: 'REJECTED',
          feeType: 'CLEANING',
          amountMinor: a['cleaning']!.toString(),
          disputeReason: DISPUTE_REASON,
          legs: {
            HOST: a['cleaning']!.toString(),
            INSURER: '0',
            TAX_THIRD_PARTY: '0',
            PLATFORM: '0',
          },
        });
        const out: Record<string, string> = { ...ids, trip: w.trip, rent: w.rent ?? '' };
        return out;
      }),
    );

    // débit : la demande décidée (ADMIN) part ; la rejetée et celle contestée sans décision, jamais
    await asPayments(at(DUE, 2 * HOUR), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids['self'], uuid()])).rows[0]).toEqual({
        outcome: 'NOT_DUE',
        code: 'INCIDENTAL_DISPUTED',
      });
      expect(await charges(tx, ids['self']!)).toEqual([]);
      expect((await tx.query<Row>(CHARGE, [ids['rejected'], uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: 'REJECTED',
      });
      expect(await charges(tx, ids['rejected']!)).toEqual([]);
      const chargeId = uuid();
      expect((await tx.query<Row>(CHARGE, [ids['disputed'], chargeId])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'OPS_DECISION',
      });
      expect(await charges(tx, ids['disputed']!)).toEqual([
        expect.objectContaining({
          id: chargeId,
          purpose: 'INCIDENTAL',
          reason: 'DELAYED_CHARGES',
          amount_minor: a['cleaning']!.toString(),
          leg_host_minor: a['cleaning']!.toString(),
          leg_platform_minor: '0',
          guest_agreed: false,
          tender_operation_id: ids['rent'],
        }),
      ]);
      // sans réponse du voyageur avant l'échéance : débité à l'échéance (base NO_RESPONSE)
      expect((await tx.query<Row>(CHARGE, [ids['late'], uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'NO_RESPONSE',
      });
    });
  });

  it('payer (ACCEPTED) : accord écrit du voyageur avant l’échéance ⇒ débit dès la passe suivante (guest_agreed) ; annulation par l’hôte ⇒ plus aucun débit ; vue de l’hôte et du voyageur', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const paid = await world(tx, c);
        const cancelled = await world(tx, c);
        await now(tx, J0);
        const p = await submit(
          tx,
          await session(tx, paid.holder),
          paid.trip,
          'SMOKING',
          a['cleaning']!,
          [paid.inner],
        );
        const hc = await session(tx, cancelled.holder);
        const k = await submit(tx, hc, cancelled.trip, 'CLEANING', a['cleaning']!, [
          cancelled.inner,
        ]);
        expect([p['outcome'], k['outcome']]).toEqual(['SUBMITTED', 'SUBMITTED']);
        await now(tx, at(J0, HOUR));
        const g = await session(tx, paid.guest);
        // l'hôte ne paie pas à la place du voyageur
        expect(
          (await tx.query<{ r: string }>(ACCEPT, [await session(tx, paid.holder), p['invoice_id']]))
            .rows[0]!.r,
        ).toBe('NOT_FOUND');
        expect((await tx.query<{ r: string }>(ACCEPT, [g, p['invoice_id']])).rows[0]!.r).toBe(
          'ACCEPTED',
        );
        expect((await tx.query<{ r: string }>(ACCEPT, [g, p['invoice_id']])).rows[0]!.r).toBe(
          'ALREADY_ACCEPTED',
        );
        // annulation : par l'hôte qui l'a demandée, avant toute décision et tout débit
        const hc2 = await session(tx, cancelled.holder);
        expect(
          (
            await tx.query<{ r: string }>(CANCEL, [
              await session(tx, cancelled.guest),
              k['invoice_id'],
            ])
          ).rows[0]!.r,
        ).toBe('NOT_FOUND');
        expect((await tx.query<{ r: string }>(CANCEL, [hc2, k['invoice_id']])).rows[0]!.r).toBe(
          'CANCELLED',
        );
        expect((await tx.query<{ r: string }>(CANCEL, [hc2, k['invoice_id']])).rows[0]!.r).toBe(
          'ALREADY_CANCELLED',
        );
        // vue de l'hôte : demandes et photos utilisables ; d'un inconnu : NOT_FOUND
        const hv = (await tx.query<{ v: Row }>(VIEW, [hc2, cancelled.trip])).rows[0]!.v;
        expect(hv).toMatchObject({
          outcome: 'OK',
          viewerRole: 'HOST',
          currency: c.currency,
          canSubmit: true,
          feeTypes: ['FUEL', 'CLEANING', 'SMOKING'],
        });
        expect((hv['invoices'] as Row[])[0]).toMatchObject({ status: 'CANCELLED_BY_HOST' });
        expect((hv['photos'] as Row[]).map((x) => x['fileId'])).toEqual(
          expect.arrayContaining([cancelled.fuelOut, cancelled.fuelIn, cancelled.inner]),
        );
        const stranger = (
          await tx.query<{ v: Row }>(VIEW, [await session(tx, paid.guest), cancelled.trip])
        ).rows[0]!.v;
        expect(stranger).toEqual({ outcome: 'NOT_FOUND' });
        return {
          paid: String(p['invoice_id']),
          cancelled: String(k['invoice_id']),
          trip: paid.trip,
        };
      }),
    );

    await asPayments(at(J0, 2 * HOUR), async (tx) => {
      expect((await tx.query<Row>(CHARGE, [ids.paid, uuid()])).rows[0]).toEqual({
        outcome: 'CHARGED',
        code: 'GUEST_ACCEPTED',
      });
      // accord écrit postérieur à la demande (REQ-PAY-DMG-05) : marqué sur l'ordre de débit
      expect(await charges(tx, ids.paid)).toEqual([
        expect.objectContaining({ purpose: 'INCIDENTAL', guest_agreed: true }),
      ]);
      expect((await tx.query<Row>(CHARGE, [ids.cancelled, uuid()])).rows[0]).toEqual({
        outcome: 'DONE',
        code: 'CANCELLED_BY_HOST',
      });
      expect(await charges(tx, ids.cancelled)).toEqual([]);
    });
  });

  it('critère 2 : frais hors de la liste fermée de BR-REIMB refusé (INCIDENTAL_TYPE_NOT_ALLOWED) ; types de la liste traités ailleurs refusés (INCIDENTAL_TYPE_NOT_SUPPORTED) ; aucune écriture', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const h = await session(tx, w.holder);
        for (const t of ['WEAR_AND_TEAR', 'PARKING_RECOVERY', 'LOST_KEY', 'fuel', '']) {
          expect((await submit(tx, h, w.trip, t, a['cleaning']!, [w.inner]))['outcome']).toBe(
            'INCIDENTAL_TYPE_NOT_ALLOWED',
          );
        }
        for (const t of ['MILEAGE', 'LATE_RETURN', 'TOLL', 'TICKET', 'EV_CHARGE']) {
          expect((await submit(tx, h, w.trip, t, a['cleaning']!, [w.inner]))['outcome']).toBe(
            'INCIDENTAL_TYPE_NOT_SUPPORTED',
          );
        }
        expect(await invoices(tx, w.trip)).toEqual([]);
      });
    });
  });

  it('RT-L3-S02 (« frais saisi sans preuve », RT-L3-S01) : sans pièce justificative, pièce étrangère au trip ou carburant sans jauge de départ ⇒ CLAIM_EVIDENCE_MISSING, rien n’est écrit ni notifié', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        const other = await world(tx, c);
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        // fichier de l'hôte déposé AVANT le début du trip : hors de la fenêtre, jamais une pièce
        await now(tx, at(START, -HOUR));
        const loose = (
          await tx.query<{ id: string }>('SELECT test_fixture.us706_loose_file($1)::text AS id', [
            w.holder,
          ])
        ).rows[0]!.id;
        await now(tx, J0);
        const h = await session(tx, w.holder);
        for (const evidence of [[], [loose], [other.inner], [uuid()], [w.inner, loose]]) {
          expect(
            (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, evidence))['outcome'],
          ).toBe('CLAIM_EVIDENCE_MISSING');
        }
        // carburant : jauge au départ ET au retour (BR-FUEL-01)
        for (const evidence of [[w.fuelIn], [w.fuelOut], [w.inner, w.outer]]) {
          expect((await submit(tx, h, w.trip, 'FUEL', a['fuel']!, evidence))['outcome']).toBe(
            'CLAIM_EVIDENCE_MISSING',
          );
        }
        expect(await invoices(tx, w.trip)).toEqual([]);
        // avec les deux jauges : demande acceptée, jambes de T69 (HOST = montant, PLATFORM 0)
        const ok = await submit(tx, h, w.trip, 'FUEL', a['fuel']!, [w.fuelOut, w.fuelIn]);
        expect(ok['outcome']).toBe('SUBMITTED');
        expect((await invoices(tx, w.trip))[0]).toMatchObject({
          fee_type: 'FUEL',
          amount_minor: a['fuel']!.toString(),
          leg_host_minor: a['fuel']!.toString(),
          leg_platform_minor: '0',
        });
      });
    });
  });

  it('US-315 critère 5 : refus avec le motif de la règle — Extra vendu (BR-FUEL-02), fin anticipée (BR-FUEL-03), même niveau de carburant (BR-FUEL-01), véhicule rangé sans photo de l’intérieur (BR-RETURN-05) ; plafond du pays, plafond absent (PARAM_MISSING), délai de l’hôte aux bornes, doublon, rejeu, trip non rendu', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        const prepaid = await world(tx, c, { extras: true });
        const early = await world(tx, c, { terminatedEarly: true });
        const same = await world(tx, c, { fuel: [6, 6] });
        const ongoing = await world(tx, c, { returned: false });
        await now(tx, J0);
        // plafond du carburant « à fixer » (0009) : aucune demande tant qu'il est absent
        let h = await session(tx, w.holder);
        expect(
          (await submit(tx, h, w.trip, 'FUEL', a['fuel']!, [w.fuelOut, w.fuelIn]))['outcome'],
        ).toBe('PARAM_MISSING');
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        // contrôles plus stricts que Turo (DEC-FONDATEUR-22) : faux par défaut, posés ici à vrai
        await param(tx, 'incidental_fuel_extras_block', c.country, true);
        await param(tx, 'incidental_fuel_early_end_block', c.country, true);
        h = await session(tx, prepaid.holder);
        expect(
          (
            await submit(tx, h, prepaid.trip, 'FUEL', a['fuel']!, [prepaid.fuelOut, prepaid.fuelIn])
          )['outcome'],
        ).toBe('INCIDENTAL_FUEL_PREPAID');
        h = await session(tx, early.holder);
        expect(
          (await submit(tx, h, early.trip, 'FUEL', a['fuel']!, [early.fuelOut, early.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        h = await session(tx, same.holder);
        expect(
          (await submit(tx, h, same.trip, 'FUEL', a['fuel']!, [same.fuelOut, same.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        h = await session(tx, ongoing.holder);
        expect(
          (await submit(tx, h, ongoing.trip, 'CLEANING', a['cleaning']!, [ongoing.inner]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_TRIP_NOT_ENDED');
        h = await session(tx, w.holder);
        // nettoyage d'un véhicule seulement non lavé (photo de l'extérieur) : non facturable
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.outer]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        // plafonds du pays (montant saisi, jamais libre au-delà)
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaningCap']! + 1n, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_AMOUNT_ABOVE_CAP');
        expect(
          (await submit(tx, h, w.trip, 'FUEL', a['fuelCap']! + 1n, [w.fuelOut, w.fuelIn]))[
            'outcome'
          ],
        ).toBe('INCIDENTAL_AMOUNT_ABOVE_CAP');
        expect((await submit(tx, h, w.trip, 'CLEANING', 0n, [w.inner]))['outcome']).toBe(
          'REQUEST_INVALID',
        );
        // le voyageur ne demande pas de frais ; une autre personne : NOT_FOUND
        expect(
          (
            await submit(tx, await session(tx, w.guest), w.trip, 'CLEANING', a['cleaning']!, [
              w.inner,
            ])
          )['outcome'],
        ).toBe('NOT_FOUND');
        expect(await invoices(tx, w.trip)).toEqual([]);

        // délai de l'hôte : fin effective + 72 h acceptée, + 72 h + 1 ms refusée (heure de la base)
        await now(tx, at(END, 72 * HOUR + 1));
        h = await session(tx, w.holder);
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_WINDOW_CLOSED');
        await now(tx, at(END, 72 * HOUR));
        h = await session(tx, w.holder);
        const requestId = uuid();
        const ok = await submit(tx, h, w.trip, 'CLEANING', a['cleaningCap']!, [w.inner], requestId);
        expect(ok['outcome']).toBe('SUBMITTED');
        // rejeu de la même requête : la même demande ; doublon du même type : refusé
        expect(await submit(tx, h, w.trip, 'CLEANING', 1n, [w.inner], requestId)).toMatchObject({
          outcome: 'ALREADY_SUBMITTED',
          invoice_id: ok['invoice_id'],
        });
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect(await invoices(tx, w.trip)).toHaveLength(1);
        // rejeu et doublon : un seul avis au voyageur (une ligne d'outbox pour la demande)
        expect(
          (await tx.query('SELECT * FROM test_fixture.us706_events($1)', [ok['invoice_id']])).rows,
        ).toHaveLength(1);
      });
    });
  });

  it('délai du voyageur en paramètre du pays : invoice_guest_response_h relu à la demande (24 h ⇒ échéance J0 + 24 h) ; valeur hors bornes ⇒ PARAM_MISSING', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await param(tx, 'invoice_guest_response_h', c.country, 24);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        expect(r['outcome']).toBe('SUBMITTED');
        expect((r['response_due_at'] as Date).toISOString()).toBe(at(J0, 24 * HOUR));
        // valeur nulle (hors de 1 à 720 h) : aucune demande (fail-closed)
        const v = await world(tx, c);
        // une version par instant : la nouvelle valeur part une minute après J0
        await now(tx, at(J0, MINUTE));
        await param(tx, 'invoice_guest_response_h', c.country, 0);
        await now(tx, at(J0, 2 * MINUTE));
        expect(
          (
            await submit(tx, await session(tx, v.holder), v.trip, 'CLEANING', a['cleaning']!, [
              v.inner,
            ])
          )['outcome'],
        ).toBe('PARAM_MISSING');
      });
    });
  });

  it('DEC-FONDATEUR-22 (comme Turo, défauts faux) : carburant demandable malgré un Extra vendu ou une fin anticipée (le voyageur conteste) ; fichiers de l’hôte admis comme pièces, mais seulement ceux RATTACHÉS à CE trip dès l’envoi — jamais un fichier non rattaché (même envoyé pendant le trip jumeau), ni rattaché à l’autre voiture, ni une photo d’état, ni des octets déjà vus ; nettoyage toujours avec au moins une preuve valide ; incidental_evidence_trip_photos_only à vrai ⇒ photos du trip seulement', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const prepaid = await world(tx, c, { extras: true });
        const early = await world(tx, c, { terminatedEarly: true });
        const loose = await world(tx, c);
        // trip jumeau : même hôte, autre voiture, mêmes dates (revue sécurité delta 2 n° 1)
        const twin = await world(tx, c, { org: loose.org });
        expect(twin.holder).toBe(loose.holder);
        await param(tx, 'fuel_refill_max', c.country, a['fuelCap']!.toString());
        await now(tx, J0);
        for (const x of [prepaid, early]) {
          const h = await session(tx, x.holder);
          expect(
            (await submit(tx, h, x.trip, 'FUEL', a['fuel']!, [x.fuelOut, x.fuelIn]))['outcome'],
          ).toBe('SUBMITTED');
        }
        // dépôt rattaché au trip : fenêtre, partie, rejeu, empreinte déjà vue
        await now(tx, at(START, -HOUR));
        expect((await attach(tx, loose.holder, loose.trip)).r).toBe('INCIDENTAL_WINDOW_CLOSED');
        await now(tx, J0);
        const mine = await attach(tx, loose.holder, loose.trip);
        expect(mine.r).toBe('ATTACHED');
        const sha = randomBytes(32);
        const onTwin = await attach(tx, loose.holder, twin.trip, { sha });
        expect(onTwin.r).toBe('ATTACHED');
        expect((await attach(tx, loose.holder, twin.trip, { id: onTwin.id, sha })).r).toBe(
          'ALREADY_ATTACHED',
        );
        // mêmes octets sous un autre identifiant, ou octets d'une photo d'état : refusés
        expect((await attach(tx, loose.holder, loose.trip, { sha })).r).toBe('PHOTO_DUPLICATE');
        const photoSha = createHash('sha256').update(twin.inner, 'utf8').digest();
        expect((await attach(tx, loose.holder, loose.trip, { sha: photoSha })).r).toBe(
          'PHOTO_DUPLICATE',
        );
        // le voyageur, ou une autre personne, ne dépose rien pour l'hôte
        expect((await attach(tx, loose.guest, loose.trip)).r).toBe('NOT_FOUND');
        expect((await attach(tx, prepaid.holder, loose.trip)).r).toBe('NOT_FOUND');
        expect((await attach(tx, loose.holder, loose.trip, { bytes: 0 })).r).toBe(
          'REQUEST_INVALID',
        );
        // fichier NON rattaché envoyé pendant le trip jumeau (seau des preuves, même hôte) ; fichier
        // du voyageur ; fichier antérieur au trip
        const file = async (user: string): Promise<string> =>
          (
            await tx.query<{ id: string }>('SELECT test_fixture.us706_loose_file($1)::text AS id', [
              user,
            ])
          ).rows[0]!.id;
        const unattached = await file(loose.holder);
        const guests = await file(loose.guest);
        // défaut PROPOSÉ comme Turo (DEC-FONDATEUR-22) : incidental_evidence_trip_photos_only = faux
        const h = await session(tx, loose.holder);
        expect(
          (await submit(tx, h, twin.trip, 'CLEANING', a['cleaning']!, [onTwin.id, twin.outer]))[
            'outcome'
          ],
        ).toBe('SUBMITTED');
        for (const evidence of [
          [unattached],
          [onTwin.id],
          [twin.inner],
          [twin.outer, mine.id],
          [guests],
          [mine.id, guests],
          [mine.id, uuid()],
        ]) {
          expect(
            (await submit(tx, h, loose.trip, 'CLEANING', a['cleaning']!, evidence))['outcome'],
          ).toBe('CLAIM_EVIDENCE_MISSING');
        }
        // photo du trip sans l'intérieur et aucun fichier : toujours non facturable (BR-RETURN-05)
        expect(
          (await submit(tx, h, loose.trip, 'CLEANING', a['cleaning']!, [loose.outer]))['outcome'],
        ).toBe('INCIDENTAL_NOT_BILLABLE');
        expect(
          (await submit(tx, h, loose.trip, 'CLEANING', a['cleaning']!, [mine.id, loose.outer]))[
            'outcome'
          ],
        ).toBe('SUBMITTED');
        expect((await invoices(tx, loose.trip))[0]).toMatchObject({
          fee_type: 'CLEANING',
          status: 'AWAITING_GUEST',
        });
        // après la fenêtre de l'hôte (fin effective + 72 h) : plus aucun dépôt
        await now(tx, at(END, 72 * HOUR + 1));
        expect((await attach(tx, loose.holder, loose.trip)).r).toBe('INCIDENTAL_WINDOW_CLOSED');
        // paramètre posé à vrai : photos du trip seulement (un fichier de l'hôte ne suffit plus)
        await now(tx, J0);
        const strict = await world(tx, c);
        await now(tx, at(J0, MINUTE));
        const strictFile = (await attach(tx, strict.holder, strict.trip)).id;
        await param(tx, 'incidental_evidence_trip_photos_only', c.country, true);
        await now(tx, at(J0, 2 * MINUTE));
        const hs = await session(tx, strict.holder);
        for (const evidence of [[strictFile], [strictFile, strict.inner]]) {
          expect(
            (await submit(tx, hs, strict.trip, 'CLEANING', a['cleaning']!, evidence))['outcome'],
          ).toBe('CLAIM_EVIDENCE_MISSING');
        }
        expect(
          (await submit(tx, hs, strict.trip, 'CLEANING', a['cleaning']!, [strict.inner]))[
            'outcome'
          ],
        ).toBe('SUBMITTED');
        // la vue ne liste que les photos du trip ; le fichier déposé est compté
        const g = await session(tx, loose.guest);
        const inv = (
          (await tx.query<{ v: Row }>(VIEW, [g, loose.trip])).rows[0]!.v['invoices'] as Row[]
        )[0]!;
        expect(inv['evidenceCount']).toBe(2);
        expect(inv['evidence']).toEqual([
          {
            kind: 'CHECKOUT',
            slotCode: 'EXT_01',
            slotGroup: 'EXTERIOR',
            takenBy: 'HOST',
            receivedAt: END,
          },
        ]);
      });
    });
  });

  it('doublon après rejet (revue code n° 1) : une demande REJETÉE par l’ops ne se redemande pas (INCIDENTAL_DUPLICATE) ; une demande annulée par l’hôte, si ; contestation à 1 ms de l’échéance acceptée', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const ops = await staff(tx, 'OPS_AGENT', [c.country]);
        const w = await world(tx, c);
        const last = await world(tx, c);
        const payLast = await world(tx, c);
        await now(tx, J0);
        let h = await session(tx, w.holder);
        const firstReq = uuid();
        const smokeReq = uuid();
        const first = await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner], firstReq);
        const smoke = await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, [w.inner], smokeReq);
        const l = await submit(
          tx,
          await session(tx, last.holder),
          last.trip,
          'CLEANING',
          a['cleaning']!,
          [last.inner],
        );
        const pl = await submit(
          tx,
          await session(tx, payLast.holder),
          payLast.trip,
          'CLEANING',
          a['cleaning']!,
          [payLast.inner],
        );
        expect(pl['outcome']).toBe('SUBMITTED');
        expect([first['outcome'], smoke['outcome'], l['outcome']]).toEqual([
          'SUBMITTED',
          'SUBMITTED',
          'SUBMITTED',
        ]);
        await now(tx, at(J0, HOUR));
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, w.guest),
              first['invoice_id'],
              DISPUTE_REASON,
              [w.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
        await now(tx, at(J0, 2 * HOUR));
        expect((await decide(tx, ops, String(first['invoice_id']), 'REJECT'))['outcome']).toBe(
          'DECIDED',
        );
        expect(
          (
            await tx.query<{ r: string }>(CANCEL, [
              await session(tx, w.holder),
              smoke['invoice_id'],
            ])
          ).rows[0]!.r,
        ).toBe('CANCELLED');
        await now(tx, at(J0, 3 * HOUR));
        h = await session(tx, w.holder);
        // rejeu après rejet et après annulation : la même demande, aucun second avis (qa)
        for (const [req, inv, fee] of [
          [firstReq, first, 'CLEANING'],
          [smokeReq, smoke, 'SMOKING'],
        ] as const) {
          expect(await submit(tx, h, w.trip, fee, a['cleaning']!, [w.inner], req)).toMatchObject({
            outcome: 'ALREADY_SUBMITTED',
            invoice_id: inv['invoice_id'],
          });
          expect(
            (await tx.query('SELECT * FROM test_fixture.us706_events($1)', [inv['invoice_id']]))
              .rows,
          ).toHaveLength(1);
        }
        expect(
          (await submit(tx, h, w.trip, 'CLEANING', a['cleaning']!, [w.inner]))['outcome'],
        ).toBe('INCIDENTAL_DUPLICATE');
        expect((await submit(tx, h, w.trip, 'SMOKING', a['cleaning']!, [w.inner]))['outcome']).toBe(
          'SUBMITTED',
        );
        expect((await invoices(tx, w.trip)).map((x) => [x['fee_type'], x['status']])).toEqual([
          ['CLEANING', 'REJECTED'],
          ['SMOKING', 'CANCELLED_BY_HOST'],
          ['SMOKING', 'AWAITING_GUEST'],
        ]);
        // borne de l'échéance : 1 ms avant J+3 10:00, la contestation passe encore
        await now(tx, at(DUE, -1));
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, last.guest),
              l['invoice_id'],
              DISPUTE_REASON,
              [last.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
        // et le paiement aussi, 1 ms avant l'échéance (accord daté de la base, avant l'échéance)
        expect(
          (
            await tx.query<{ r: string }>(ACCEPT, [
              await session(tx, payLast.guest),
              pl['invoice_id'],
            ])
          ).rows[0]!.r,
        ).toBe('ACCEPTED');
        expect(((await invoices(tx, payLast.trip))[0]!['accepted_at'] as Date).toISOString()).toBe(
          at(DUE, -1),
        );
      });
    });
  });

  it('preuves visibles avant de payer (revue ux n° 1) : le voyageur et l’hôte du trip voient chaque pièce retenue (côté, emplacement, auteur, heure serveur) ; aucune autre personne ; identifiants des photos seulement quand ils servent ; plafonds du pays à l’hôte seulement', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        const other = await world(tx, c);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner, w.outer],
        );
        expect(r['outcome']).toBe('SUBMITTED');
        const evidence = [
          {
            kind: 'CHECKOUT',
            slotCode: 'EXT_01',
            slotGroup: 'EXTERIOR',
            takenBy: 'HOST',
            receivedAt: END,
          },
          {
            kind: 'CHECKOUT',
            slotCode: 'INT_01',
            slotGroup: 'INTERIOR',
            takenBy: 'HOST',
            receivedAt: END,
          },
        ];
        const view = async (user: string, trip = w.trip): Promise<Row> =>
          (await tx.query<{ v: Row }>(VIEW, [await session(tx, user), trip])).rows[0]!.v;
        const gv = await view(w.guest);
        expect(gv).toMatchObject({
          outcome: 'OK',
          viewerRole: 'GUEST',
          canSubmit: false,
          caps: null,
        });
        expect((gv['invoices'] as Row[])[0]).toMatchObject({ evidenceCount: 2, evidence });
        // fenêtre de contestation ouverte : les photos du trip servent à contester
        expect((gv['photos'] as Row[]).map((x) => x['fileId'])).toContain(w.guestInner);
        const hv = await view(w.holder);
        expect(hv).toMatchObject({ outcome: 'OK', viewerRole: 'HOST', canSubmit: true });
        expect((hv['invoices'] as Row[])[0]).toMatchObject({ evidenceCount: 2, evidence });
        // plafonds PROPOSÉS du pays (0177) ; carburant « à fixer » (0009) : null
        expect(hv['caps']).toEqual({
          FUEL: null,
          CLEANING: a['cleaningCap']!.toString(),
          SMOKING: a['cleaningCap']!.toString(),
        });
        // le voyageur et l'hôte d'un autre trip : même réponse qu'un trip inconnu
        for (const user of [other.guest, other.holder]) {
          expect(await view(user)).toEqual({ outcome: 'NOT_FOUND' });
        }
        // payé : plus rien à contester, les pièces restent lisibles, plus aucun identifiant
        expect(
          (await tx.query<{ r: string }>(ACCEPT, [await session(tx, w.guest), r['invoice_id']]))
            .rows[0]!.r,
        ).toBe('ACCEPTED');
        const paid = await view(w.guest);
        expect(paid['photos']).toEqual([]);
        expect((paid['invoices'] as Row[])[0]).toMatchObject({ status: 'ACCEPTED', evidence });
        // plafond illisible : la garde des paramètres (config_param_value_guard, type MONEY) le
        // refuse à l'écriture ; la vue n'en reçoit donc jamais (filtre de la vue : défense en
        // profondeur ; lecture de l'API prouvée par store.test.ts)
        await now(tx, at(J0, 2 * HOUR));
        expect(
          (await caught(tx, () => param(tx, 'incidental_cleaning_max_minor', c.country, '15000.5')))
            ?.code,
        ).toBe('23514');
        // délai de l'hôte passé : plus de demande possible, plus aucun identifiant pour l'hôte
        await now(tx, at(END, 72 * HOUR + 1));
        const late = await view(w.holder);
        expect(late).toMatchObject({ canSubmit: false, photos: [] });
        expect((late['invoices'] as Row[])[0]).toMatchObject({ evidence });
      });
    });
  });

  it('débit bloqué (revue qa n° 6) : trip sans opération de carte du loyer, ou seulement une caution ⇒ BLOCKED NO_CARD_TENDER, aucun débit, relu dans 24 h, jamais la caution', async () => {
    const ids = await withRole('app_api', async (api) =>
      withTestTransaction(api, { virtualNow: START, commit: true }, async (tx) => {
        const none = await world(tx, c, { rent: false });
        const deposit = await world(tx, c, { rent: false });
        const older = await world(tx, c);
        await tx.query('SELECT test_fixture.us309_deposit_auth($1, $2)', [
          deposit.trip,
          a['rent']!.toString(),
        ]);
        const out: Record<string, string> = {};
        // demande plus ancienne d'une heure : due avant les autres (filtre avant la limite, qa)
        await now(tx, at(J0, -HOUR));
        const o = await submit(
          tx,
          await session(tx, older.holder),
          older.trip,
          'CLEANING',
          a['cleaning']!,
          [older.inner],
        );
        expect(o['outcome']).toBe('SUBMITTED');
        out['older'] = String(o['invoice_id']);
        await now(tx, J0);
        for (const [name, x] of [
          ['none', none],
          ['deposit', deposit],
        ] as const) {
          const r = await submit(
            tx,
            await session(tx, x.holder),
            x.trip,
            'CLEANING',
            a['cleaning']!,
            [x.inner],
          );
          expect(r['outcome']).toBe('SUBMITTED');
          out[name] = String(r['invoice_id']);
          out[`${name}Trip`] = x.trip;
        }
        return out;
      }),
    );
    await asPayments(DUE, async (tx) => {
      // file à UNE place, filtrée dans la requête : la demande ciblée, jamais la plus ancienne
      const one =
        'SELECT invoice_id::text AS id FROM core.claim_incidental_invoices_due(1, $1::uuid[])';
      expect((await tx.query<{ id: string }>(one, [[ids['deposit']]])).rows).toEqual([
        { id: ids['deposit'] },
      ]);
      expect((await tx.query<{ id: string }>(one, [[ids['older'], ids['deposit']]])).rows).toEqual([
        { id: ids['older'] },
      ]);
      for (const name of ['none', 'deposit']) {
        expect((await tx.query<Row>(CHARGE, [ids[name], uuid()])).rows[0]).toEqual({
          outcome: 'BLOCKED',
          code: 'NO_CARD_TENDER',
        });
        expect(await charges(tx, ids[name]!)).toEqual([]);
        const inv = (await invoices(tx, ids[`${name}Trip`]!))[0]!;
        expect(inv).toMatchObject({ status: 'AWAITING_GUEST', execution_code: 'NO_CARD_TENDER' });
        expect((inv['next_check_at'] as Date).toISOString()).toBe(at(DUE, 24 * HOUR));
        // relu dans 24 h : hors de la file d'ici là
        expect((await tx.query<{ id: string }>(DUE_LIST, [[ids[name]]])).rows).toEqual([]);
      }
      expect(
        (
          await tx.query<{ n: number }>('SELECT test_fixture.us706_trip_charges($1) AS n', [
            ids['depositTrip'],
          ])
        ).rows[0]!.n,
      ).toBe(0);
    });
    // report plafonné (revue code delta) : 11 reports ⇒ DEFERRED ; le 12e ⇒ REVIEW_REQUIRED, hors de
    // la file pour de bon, jamais débité par le travailleur ; un report de plus ⇒ NOT_DUE
    await withRole('app_worker', (w) =>
      payTx(w, { worker: 'payment_command', virtualNow: DUE, commit: true }, async (tx) => {
        const DEFER = 'SELECT core.claim_cmd_defer_incidental($1::uuid, $2) AS r';
        const id = ids['none']!;
        for (let n = 1; n <= 11; n += 1) {
          expect((await tx.query<{ r: string }>(DEFER, [id, 'NOT_FOUND'])).rows[0]!.r).toBe(
            'DEFERRED',
          );
        }
        expect((await tx.query<{ r: string }>(DEFER, [id, 'EXECUTION_FAILED'])).rows[0]!.r).toBe(
          'REVIEW_REQUIRED',
        );
        const inv = (await invoices(tx, ids['noneTrip']!))[0]!;
        expect(inv).toMatchObject({
          status: 'AWAITING_GUEST',
          defer_count: 12,
          execution_code: 'EXECUTION_FAILED',
        });
        expect((inv['review_required_at'] as Date).toISOString()).toBe(DUE);
        expect((await tx.query<{ r: string }>(DEFER, [id, 'NOT_FOUND'])).rows[0]!.r).toBe(
          'NOT_DUE',
        );
        expect((await tx.query<Row>(CHARGE, [id, uuid()])).rows[0]).toEqual({
          outcome: 'BLOCKED',
          code: 'REVIEW_REQUIRED',
        });
        expect(await charges(tx, id)).toEqual([]);
        // jamais relue par la file, même 30 jours plus tard
        await now(tx, at(DUE, 30 * 24 * HOUR));
        expect((await tx.query<{ id: string }>(DUE_LIST, [[id]])).rows).toEqual([]);
      }),
    );
    // vue de la console (revue argent delta 2 n° 7) : l'ops du pays la retrouve ; l'ops d'un
    // autre pays ne la voit pas ; un agent partie au trip non plus (ADR-122)
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: at(DUE, HOUR) }, async (tx) => {
        const REVIEW =
          'SELECT outcome, body FROM core.support_staff_incidental_review($1, $2::uuid)';
        const list = async (who: Staff): Promise<Row> =>
          (await tx.query<Row>(REVIEW, [await elevated(tx, who), uuid()])).rows[0]!;
        const mine = await list(await staff(tx, 'OPS_AGENT', [c.country]));
        expect(mine['outcome']).toBe('OK');
        const found = ((mine['body'] as Row)['invoices'] as Row[]).filter(
          (x) => x['id'] === ids['none'],
        );
        expect(found).toEqual([
          {
            id: ids['none'],
            tripId: ids['noneTrip'],
            country: c.country,
            currency: c.currency,
            feeType: 'CLEANING',
            amountMinor: a['cleaning']!.toString(),
            status: 'AWAITING_GUEST',
            executionCode: 'EXECUTION_FAILED',
            deferCount: 12,
            reviewRequiredAt: DUE,
          },
        ]);
        const other = COUNTRIES.find((x) => x.country !== c.country)!;
        const theirs = await list(await staff(tx, 'OPS_AGENT', [other.country]));
        expect(((theirs['body'] as Row)['invoices'] as Row[]).map((x) => x['id'])).not.toContain(
          ids['none'],
        );
      });
    });
  });

  it('garde claim_incidental_forbidden (revue qa n° 6) : une commande dont l’UPDATE ne touche aucune ligne lève une erreur, jamais un succès sans écriture (payer, contester, annuler, décider)', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const admin = await staff(tx, 'ADMIN', [c.country]);
        const w = await world(tx, c);
        const d = await world(tx, c);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        const k = await submit(
          tx,
          await session(tx, d.holder),
          d.trip,
          'CLEANING',
          a['cleaning']!,
          [d.inner],
        );
        await now(tx, at(J0, HOUR));
        expect(
          (
            await tx.query<{ r: string }>(DISPUTE, [
              await session(tx, d.guest),
              k['invoice_id'],
              DISPUTE_REASON,
              [d.guestInner],
            ])
          ).rows[0]!.r,
        ).toBe('DISPUTED');
        // transaction ANNULÉE : la politique UPDATE ne voit plus aucune ligne
        await tx.query('SELECT test_fixture.us706_forbid_updates()');
        const forbidden = { code: '42501', constraint: 'claim_incidental_forbidden' };
        const g = await session(tx, w.guest);
        expect(await caught(tx, () => tx.query(ACCEPT, [g, r['invoice_id']]))).toMatchObject(
          forbidden,
        );
        expect(
          await caught(tx, () =>
            tx.query(DISPUTE, [g, r['invoice_id'], DISPUTE_REASON, [w.guestInner]]),
          ),
        ).toMatchObject(forbidden);
        const hw = await session(tx, w.holder);
        expect(await caught(tx, () => tx.query(CANCEL, [hw, r['invoice_id']]))).toMatchObject(
          forbidden,
        );
        expect(
          await caught(tx, () => decide(tx, admin, String(k['invoice_id']), 'CHARGE')),
        ).toMatchObject(forbidden);
        expect((await invoices(tx, w.trip))[0]).toMatchObject({ status: 'AWAITING_GUEST' });
        expect((await invoices(tx, d.trip))[0]).toMatchObject({
          status: 'DISPUTED',
          decided_role: null,
        });
      });
    });
  });

  it('RLS et garde : aucun droit applicatif sur la table ; montant figé, réouverture et suppression refusées ; commandes du travailleur et de la décision réservées', async () => {
    await withRole('app_api', async (api) => {
      await withTestTransaction(api, { virtualNow: START }, async (tx) => {
        const w = await world(tx, c);
        await now(tx, J0);
        const r = await submit(
          tx,
          await session(tx, w.holder),
          w.trip,
          'CLEANING',
          a['cleaning']!,
          [w.inner],
        );
        const id = String(r['invoice_id']);
        for (const sql of [
          'SELECT 1 FROM core.claim_incidental_invoice',
          `UPDATE core.claim_incidental_invoice SET status = 'CHARGED'`,
          'DELETE FROM core.claim_incidental_invoice',
        ]) {
          expect((await caught(tx, () => tx.query(sql)))?.code).toBe('42501');
        }
        for (const what of ['AMOUNT', 'DELETE']) {
          const e = await caught(tx, () =>
            tx.query('SELECT test_fixture.us706_try_write($1, $2)', [what, id]),
          );
          expect(e).toMatchObject({ code: '23000', constraint: 'claim_incidental_immutable' });
        }
        // sous app_api : ni le débit ni la file du travailleur ni la décision sans la porte
        for (const sql of [
          'SELECT * FROM core.claim_cmd_charge_incidental($1::uuid, $1::uuid)',
          'SELECT * FROM core.claim_cmd_decide_incidental($1::uuid, $1::uuid, $$ADMIN$$, $1::uuid, $$CHARGE$$, $$x$$)',
        ]) {
          expect((await caught(tx, () => tx.query(sql, [id])))?.code).toBe('42501');
        }
      });
    });
    await asPayments(DUE, async (tx) => {
      // le travailleur ne lit ni n'écrit la table directement
      expect(
        (await caught(tx, () => tx.query('SELECT 1 FROM core.claim_incidental_invoice')))?.code,
      ).toBe('42501');
    });
  });
});

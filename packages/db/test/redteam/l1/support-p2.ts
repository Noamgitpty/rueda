/**
 * Aides de la red team du lot 1, passe n° 2 (US-122, branche `story/US-122-redteam-l1-b`) : droits
 * des personnes, téléversements, hôte défaillant, doublon d'identité, entrées de console hors de la
 * garde `support_actor_conflict`. Mêmes règles que `support.ts` : rôles de production seulement
 * (assertion L0-05 par `withRole`), vraies commandes, aucune constante de pays.
 */
import { randomBytes } from 'node:crypto';
import { expect } from 'vitest';
import { elevateAs, person, staff as kycStaff } from '../../support/kyc.ts';
import { ALL, countryRules, uuid, vehicleOf } from './support.ts';
import type { CountryCase, Host, Tx } from './support.ts';
import { first } from './support-host.ts';

export const PURPOSE = 'Contrôle du dossier pour une décision de l’ops';

/** Issue de la console pour un sujet qui concerne l'agent (garde ADR-122). */
export const SELF = { outcome: 'REFUSED', detail: 'SELF_FORBIDDEN' } as const;

/** Co-hôte ACTIVE du compte `org` (fixture d'US-011). */
export const cohost = (tx: Tx, user: string, org: string) =>
  tx.query(`SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', '{}'::uuid[], $4)`, [
    uuid(),
    user,
    org,
    'ACTIVE',
  ]);

/** Personne (nouveau compte) élevée par TOTP au rôle `role` du pays. */
export async function staffPerson(tx: Tx, country: string, role: string) {
  const p = await person(tx, country);
  return elevateAs(tx, p.userId, role, [country]);
}

export interface LinkOutcome {
  readonly outcome: string;
  readonly link_id: string | null;
}

/** Constat de l'ops (US-127) entre deux comptes, par `who` (ou, par défaut, un agent sans lien). */
export async function decideLink(
  tx: Tx,
  who: { readonly hash: Buffer } | null,
  a: string,
  b: string,
  decision: 'LINKED' | 'NOT_LINKED',
  signal = 'SAME_DEVICE',
): Promise<LinkOutcome> {
  const decider = who ?? (await kycStaff(tx, 'OPS_AGENT', ALL, ALL[0] ?? ''));
  return first<LinkOutcome>(
    tx,
    'SELECT * FROM core.risk_staff_decide_account_link($1, $2, $3, $4, $5, $6)',
    [decider.hash, uuid(), a, b, decision, signal],
  );
}

/** Dossier de support d'une personne (fixture d'US-111). */
export const supportCase = async (tx: Tx, country: string, requester: string): Promise<string> =>
  (
    await first<{ id: string }>(tx, 'SELECT test_fixture.us111_support_case($1, $2) AS id', [
      country,
      requester,
    ])
  ).id;

/**
 * Véhicule soumis à la revue de l'ops (pièce TITLE exigée par le pays), élément de file LISTING :
 * même parcours que rt-l1-08. La clé de sujet de l'hôte est posée d'abord (pièce C2 chiffrée).
 */
export async function vehicleInReview(tx: Tx, h: Host, cc: CountryCase): Promise<string> {
  await tx.query('SELECT test_fixture.us109_subject_key($1)', [h.userId]);
  await countryRules(tx, cc.country, false);
  await tx.query('SELECT test_fixture.us124_param_version($1, $2, $3::jsonb)', [
    'elig_doc_title',
    cc.country,
    'true',
  ]);
  const v = await vehicleOf(tx, h, cc);
  const id = v.id ?? '';
  const dec = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_declare_vehicle($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, id, 'HOST', false, 42_000, true, true, null],
  );
  expect(dec.outcome).toBe('DONE');
  const doc = await first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, id, uuid(), 'TITLE', 'application/pdf', 54_321, randomBytes(32), null],
  );
  expect(doc.outcome).toBe('DONE');
  const sub = await first<{ outcome: string; item_id: string | null }>(
    tx,
    'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1, $2, $3)',
    [h.hash, h.org, id],
  );
  expect(sub.outcome).toBe('DONE');
  return sub.item_id ?? '';
}

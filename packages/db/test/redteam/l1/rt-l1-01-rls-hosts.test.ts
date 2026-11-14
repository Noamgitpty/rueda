/**
 * US-122 — red team du lot 1, axe RLS hôte / voyageur / pays (RT-L1-R01, R02, R04, R05, R06) :
 * IDOR entre hôtes du même pays, entre pays et entre voyageur et hôte, sur les commandes et les
 * lectures du lot 1 (comptes d'hôte, véhicules, annonces, calendrier, pièces, contestations, KYC
 * de l'hôte, CGU), puis accès direct aux tables sensibles. Rôles de production seulement
 * (assertion L0-05 par withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 19 US-107, US-115, US-119, US-123, US-124 ; 16 HST (« un hôte ne voit que
 * ses objets »), ACC-014 ; 17 §2.3 (RLS-1, RLS-2, RLS-9, RLS-11 : aucun oracle d'existence) ;
 * pré-mortem L1-PM-11 (risque critique n° 1). Un identifiant d'objet d'autrui doit recevoir
 * EXACTEMENT la réponse d'un identifiant qui n'existe pas (témoin) et ne rien changer chez la
 * victime.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { setSessionContext } from '../../../src/index.ts';
import { withRole } from '../../../src/testing/index.ts';
import { person } from '../../support/kyc.ts';
import { byCountry, hostOf, otherOf, rolledBack, targetOf, uuid, vin } from './support.ts';
import type { CountryCase, Host, Target, Tx } from './support.ts';

interface Ids {
  readonly org: string;
  readonly vehicle: string;
  readonly listing: string;
  readonly location: string;
}
type Call = readonly [name: string, sql: string, params: readonly unknown[]];

/** Une instruction isolée par un point de sauvegarde : l'erreur est rendue, la transaction survit. */
async function run(tx: Tx, sql: string, params: readonly unknown[]): Promise<string> {
  await tx.query('SAVEPOINT rt');
  try {
    const r = await tx.query<Record<string, unknown>>(sql, [...params]);
    await tx.query('RELEASE SAVEPOINT rt');
    const first = r.rows[0];
    if (first === undefined) return 'ROWS:0';
    return typeof first['outcome'] === 'string' ? first['outcome'] : `ROWS:${r.rows.length}`;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT rt');
    return `ERR:${(error as { code?: string }).code ?? '?'}`;
  }
}

/** Commandes d'écriture du lot 1, appelées avec le jeton `t`, le compte `o` et les objets `i`. */
function commands(cc: CountryCase, t: Buffer, o: string, i: Ids): Call[] {
  const price = 41 * cc.priceStepMinor;
  return [
    [
      'update_listing_pricing',
      'SELECT * FROM core.catalog_cmd_update_listing_pricing($1,$2,$3,$4,$5,$6,$7)',
      [t, o, i.listing, price, 'UNLIMITED', null, null],
    ],
    [
      'submit_listing',
      'SELECT * FROM core.catalog_cmd_submit_listing($1,$2,$3)',
      [t, o, i.listing],
    ],
    [
      'unlist_listing',
      'SELECT * FROM core.catalog_cmd_unlist_listing($1,$2,$3)',
      [t, o, i.listing],
    ],
    [
      'delete_listing',
      'SELECT * FROM core.catalog_cmd_delete_listing($1,$2,$3)',
      [t, o, i.listing],
    ],
    [
      'add_listing_photo',
      'SELECT * FROM core.catalog_cmd_add_listing_photo($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, o, i.listing, uuid(), uuid(), 'image/jpeg', 123_456, randomBytes(32)],
    ],
    [
      'create_listing_on_vehicle',
      `SELECT * FROM core.catalog_cmd_create_listing($1,$2,$3,$4,'UNLIMITED',NULL,NULL,NULL)`,
      [t, o, i.vehicle, price],
    ],
    [
      'place_host_block',
      'SELECT * FROM core.catalog_cmd_place_host_block($1,$2,$3,$4::timestamp,$5::timestamp)',
      [t, o, i.vehicle, '2046-03-01 10:00', '2046-03-02 10:00'],
    ],
    [
      'add_vehicle_document',
      'SELECT * FROM core.catalog_cmd_add_vehicle_document($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, o, i.vehicle, uuid(), 'TITLE', 'application/pdf', 54_321, randomBytes(32), null],
    ],
    [
      'declare_vehicle',
      'SELECT * FROM core.catalog_cmd_declare_vehicle($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, o, i.vehicle, 'HOST', false, 1000, true, true, null],
    ],
    [
      'submit_vehicle_eligibility',
      'SELECT * FROM core.catalog_cmd_submit_vehicle_eligibility($1,$2,$3)',
      [t, o, i.vehicle],
    ],
    [
      'set_location_notice',
      'SELECT * FROM core.catalog_cmd_set_location_notice($1,$2,$3,$4)',
      [t, o, i.location, 180],
    ],
    [
      'create_vehicle_at_location',
      `SELECT * FROM core.catalog_cmd_create_vehicle($1,$2,$3,$4,$5,NULL,'Marca','Modelo',$6,NULL,
                                                      'MANUAL',5::smallint,'GASOLINE',NULL,false,false)`,
      [t, o, i.location, `Z${randomBytes(4).toString('hex').toUpperCase()}`, vin(), 2021],
    ],
  ];
}

/** Lectures d'un OBJET du compte (véhicule) : refusées même dans le compte propre de l'attaquant. */
function objectReads(t: Buffer, o: string, i: Ids): Call[] {
  return [
    ['calendar', 'SELECT * FROM core.catalog_host_vehicle_calendar($1,$2,$3)', [t, o, i.vehicle]],
    [
      'occupancies',
      'SELECT * FROM core.catalog_host_vehicle_occupancies($1,$2,$3)',
      [t, o, i.vehicle],
    ],
  ];
}

/** Lectures et commandes de NIVEAU COMPTE : sans effet sur autrui seulement avec le compte d'autrui. */
function reads(t: Buffer, o: string, i: Ids): Call[] {
  return [
    ...objectReads(t, o, i),
    ['host_vehicles', 'SELECT * FROM core.catalog_host_vehicles($1,$2)', [t, o]],
    ['host_listings', 'SELECT * FROM core.catalog_host_listings($1,$2)', [t, o]],
    ['host_locations', 'SELECT * FROM core.catalog_host_locations($1,$2)', [t, o]],
    ['host_vehicle_claims', 'SELECT * FROM core.catalog_host_vehicle_claims($1,$2)', [t, o]],
    ['host_additions', 'SELECT * FROM core.catalog_host_addition_requests($1,$2)', [t, o]],
    ['host_eligibility', 'SELECT * FROM core.catalog_host_vehicle_eligibility($1,$2)', [t, o]],
    ['kyc_host_state', 'SELECT * FROM core.kyc_host_state($1,$2)', [t, o]],
    ['host_terms', `SELECT * FROM core.ctr_host_terms($1,$2,'es')`, [t, o]],
    [
      'tax_profile_save',
      'SELECT * FROM core.kyc_cmd_host_save_tax_profile($1,$2,$3,$4,$5,$6)',
      [t, o, 'KIND', randomBytes(40), null, 'INDIVIDUAL'],
    ],
    ['host_submit', 'SELECT * FROM core.kyc_cmd_host_submit($1,$2)', [t, o]],
  ];
}

const fresh = (): Ids => ({ org: uuid(), vehicle: uuid(), listing: uuid(), location: uuid() });
const idsOf = (x: Target): Ids => ({
  org: x.host.org,
  vehicle: x.vehicle,
  listing: x.listing,
  location: x.host.location,
});

/** État des objets de la victime, lu par la victime elle-même (rien ne doit bouger). */
async function snapshot(tx: Tx, x: Target): Promise<string> {
  const out: unknown[] = [];
  for (const fn of [
    'catalog_host_vehicles',
    'catalog_host_listings',
    'catalog_host_locations',
    'catalog_host_vehicle_eligibility',
    'catalog_host_vehicle_claims',
  ]) {
    const r = await tx.query(`SELECT * FROM core.${fn}($1,$2)`, [x.host.hash, x.host.org]);
    out.push(r.rows);
  }
  return JSON.stringify(out);
}

/**
 * Joue toutes les attaques de `actorToken` contre `victim` dans deux configurations : le compte
 * propre de l'attaquant (`ownOrg`) avec les objets de la victime, puis le compte de la victime.
 * Chaque réponse doit être celle du témoin (identifiants inexistants) et jamais DONE / OK.
 */
async function assertBlocked(
  tx: Tx,
  cc: CountryCase,
  actorToken: Buffer,
  ownOrg: string,
  victim: Target,
  label: string,
): Promise<void> {
  const before = await snapshot(tx, victim);
  const configs: readonly (readonly [string, string, Ids, string, Ids])[] = [
    // objets de la victime posés dans le compte de l'attaquant
    ['objets d’autrui, compte propre', ownOrg, idsOf(victim), ownOrg, fresh()],
    // compte de la victime (identifiant forgé), avec ou sans ses objets
    ['compte d’autrui', victim.host.org, idsOf(victim), uuid(), fresh()],
  ];
  for (const [what, attackOrg, attackIds, witnessOrg, witnessIds] of configs) {
    // dans le compte propre, seules les opérations sur un objet d'autrui sont des attaques
    const reading = what.includes('compte propre') ? objectReads : reads;
    const attack = [
      ...commands(cc, actorToken, attackOrg, attackIds),
      ...reading(actorToken, attackOrg, attackIds),
    ];
    const witness = [
      ...commands(cc, actorToken, witnessOrg, witnessIds),
      ...reading(actorToken, witnessOrg, witnessIds),
    ];
    for (const [i, [name, sql, params]] of attack.entries()) {
      const got = await run(tx, sql, params);
      const control = await run(tx, witness[i]?.[1] ?? sql, witness[i]?.[2] ?? params);
      const tag = `${label} · ${what} · ${name}`;
      // jamais un succès
      expect(
        ['DONE', 'OK', 'SENT', 'REQUESTED', 'ELIGIBLE', 'SAVED', 'SUBMITTED'],
        tag,
      ).not.toContain(got);
      // aucun oracle : exactement la réponse d'un identifiant inexistant
      expect(got, tag).toBe(control);
    }
  }
  // aucun effet chez la victime
  expect(await snapshot(tx, victim), `${label} · état de la victime`).toBe(before);
}

describe.each(byCountry)('RT-L1-R01 — IDOR entre hôtes (%s)', (country, _currency, cc) => {
  it('hôte A contre hôte B du même pays et contre l’hôte X de l’autre pays : refus, réponse du témoin, aucun effet', async () => {
    await rolledBack(async (tx) => {
      const a: Host = await hostOf(tx, country);
      const b = await targetOf(tx, cc);
      const x = await targetOf(tx, otherOf(cc));
      // témoin positif : la victime lit bien ses propres objets (le test n’est pas vide)
      const own = await tx.query('SELECT * FROM core.catalog_host_vehicles($1,$2)', [
        b.host.hash,
        b.host.org,
      ]);
      expect(own.rows).toHaveLength(1);
      await assertBlocked(tx, cc, a.hash, a.org, b, 'même pays');
      await assertBlocked(tx, cc, a.hash, a.org, x, 'autre pays');
    });
  });

  it('hôte A de l’autre pays contre B : la matrice inverse est bloquée aussi', async () => {
    await rolledBack(async (tx) => {
      const oc = otherOf(cc);
      const a = await hostOf(tx, oc.country);
      const b = await targetOf(tx, cc);
      await assertBlocked(tx, oc, a.hash, a.org, b, 'pays croisé');
    });
  });
});

describe.each(byCountry)(
  'RT-L1-R02 — voyageur et co-hôte contre un hôte (%s)',
  (country, _c, cc) => {
    it('voyageur sans compte d’hôte : aucune commande ni lecture ne rend un objet ou un état d’hôte', async () => {
      await rolledBack(async (tx) => {
        const guest = await person(tx, country);
        const victim = await targetOf(tx, cc);
        await assertBlocked(tx, cc, guest.token, uuid(), victim, 'voyageur');
      });
    });

    it('membre CO_HOST actif du compte de la victime (portée de véhicule vide) : mêmes refus', async () => {
      await rolledBack(async (tx) => {
        const co = await person(tx, country);
        const victim = await targetOf(tx, cc);
        await tx.query(
          `SELECT test_fixture.iam_insert_membership($1, $2, $3, 'CO_HOST', '{}'::uuid[], 'ACTIVE')`,
          [uuid(), co.userId, victim.host.org],
        );
        await assertBlocked(tx, cc, co.token, uuid(), victim, 'co-hôte');
      });
    });

    it('session absente ou jeton forgé : AUTH_REQUIRED, jamais un état', async () => {
      await rolledBack(async (tx) => {
        const victim = await targetOf(tx, cc);
        for (const token of [randomBytes(32), Buffer.alloc(32, 0)]) {
          for (const [name, sql, params] of [
            ...commands(cc, token, victim.host.org, idsOf(victim)),
            ...reads(token, victim.host.org, idsOf(victim)),
          ]) {
            const got = await run(tx, sql, params);
            expect(['AUTH_REQUIRED', 'ROWS:0'].includes(got) || got.startsWith('ERR:'), name).toBe(
              true,
            );
          }
        }
      });
    });
  },
);

// Tables du lot 1 qui portent un C2 / C3 (identité, pièces, sanctions, fiscal, risque, notes,
// demandes de personnes) : aucun droit applicatif, tout passe par une commande SECURITY DEFINER.
const SENSITIVE = [
  'kyc_identity_subject',
  'kyc_identity_document',
  'kyc_identity_verification',
  'kyc_liveness_check',
  'kyc_provider_event',
  'kyc_webhook_rejection',
  'kyc_erasure_request',
  'kyc_host_verification',
  'kyc_host_tax_profile',
  'kyc_sanctions_screening',
  'catalog_vehicle_document',
  'catalog_vehicle_claim',
  'catalog_vehicle_eligibility_check',
  'catalog_vehicle_attestation',
  'risk_account_link',
  'risk_assessment',
  'support_internal_note',
  'audit_data_subject_request',
  'config_go_live_switch_request',
] as const;

describe('RT-L1-R04 — tables sensibles : aucun accès direct d’un rôle applicatif', () => {
  it.each(['app_api', 'app_worker', 'app_anon'] as const)(
    '%s : aucun droit de lecture ni d’écriture sur les tables du lot 1 qui portent un C2 / C3 (la table existe, RLS ENABLE + FORCE)',
    async (role) => {
      await withRole('app_api', async (client) => {
        for (const table of SENSITIVE) {
          const r = await client.query<{
            exists: boolean;
            priv: boolean | null;
            rls: boolean | null;
            force: boolean | null;
          }>(
            `SELECT c.oid IS NOT NULL AS exists,
                    pg_catalog.has_any_column_privilege($1::name, c.oid, 'SELECT, INSERT, UPDATE, REFERENCES') AS priv,
                    c.relrowsecurity AS rls, c.relforcerowsecurity AS force
               FROM (SELECT 1) AS x
               LEFT JOIN pg_catalog.pg_class AS c
                 ON c.relname = $2 AND c.relnamespace = 'core'::regnamespace`,
            [role, table],
          );
          expect(r.rows[0]?.exists, `${table} absente`).toBe(true);
          expect(r.rows[0]?.priv, `${role} a un droit sur ${table}`).toBe(false);
          expect(r.rows[0]?.rls, `${table} sans RLS`).toBe(true);
          expect(r.rows[0]?.force, `${table} sans FORCE`).toBe(true);
        }
      });
    },
  );

  it.each(byCountry)(
    '%s : lecture et écriture directes sous un contexte HOST forgé, GUEST ou sans contexte : 42501, jamais une ligne',
    async (country, _c, cc) => {
      await rolledBack(async (tx) => {
        const victim = await targetOf(tx, cc);
        const guest = await person(tx, country);
        const contexts = [
          { kind: 'HOST', actorId: victim.host.userId, orgId: victim.host.org },
          { kind: 'GUEST', actorId: guest.userId },
          { kind: 'HOST', actorId: guest.userId, orgId: victim.host.org },
        ] as const;
        for (const ctx of contexts) {
          await setSessionContext(tx, ctx);
          for (const table of SENSITIVE) {
            for (const sql of [
              `SELECT count(*) FROM core.${table}`,
              `DELETE FROM core.${table}`,
              `TRUNCATE core.${table}`,
            ]) {
              await tx.query('SAVEPOINT s');
              await expect(tx.query(sql), `${ctx.kind} ${sql}`).rejects.toMatchObject({
                code: '42501',
              });
              await tx.query('ROLLBACK TO SAVEPOINT s');
            }
          }
        }
      });
    },
  );
});

describe('RT-L1-R05 — pays croisé : acteur, hôte ou staff d’un pays sur une donnée de l’autre', () => {
  it.each(byCountry)(
    '%s : un hôte ne lit jamais, par une table ouverte aux rôles applicatifs, le compte ni le membre d’un hôte de l’autre pays (RLS-2)',
    async (country, _c, cc) => {
      await rolledBack(async (tx) => {
        const mine = await hostOf(tx, country);
        const theirs = await hostOf(tx, otherOf(cc).country);
        for (const [org, expected] of [
          [mine.org, 1],
          [theirs.org, 0],
        ] as const) {
          await setSessionContext(tx, { kind: 'HOST', actorId: mine.userId, orgId: org });
          const orgs = await tx.query('SELECT id FROM core.iam_organization');
          expect(orgs.rows).toHaveLength(expected);
          const members = await tx.query('SELECT user_id FROM core.iam_membership');
          expect(members.rows).toHaveLength(expected);
        }
      });
    },
  );

  it('aucune des fonctions SECURITY DEFINER du lot 1 n’est exécutable par app_anon (EXECUTE refusé)', async () => {
    await withRole('app_anon', async (client) => {
      const names = [
        'catalog_host_vehicles(bytea, uuid)',
        'catalog_host_listings(bytea, uuid)',
        'kyc_host_state(bytea, uuid)',
        'kyc_cmd_host_submit(bytea, uuid)',
        'kyc_cmd_host_save_tax_profile(bytea, uuid, text, bytea, text, text)',
        'catalog_cmd_open_vehicle_claim(bytea, uuid, text, text, uuid, text, bigint, bytea)',
        'support_staff_host_dossier(bytea, uuid, uuid, text)',
        'support_staff_kyc_dossier(bytea, uuid, uuid, text)',
        'support_staff_profile(bytea, uuid, uuid, text)',
        'config_cmd_request_go_live_switch(bytea, uuid, text, text, boolean, text)',
        'iam_staff_cmd_manual_action(bytea, uuid, text, uuid, text, jsonb, uuid[])',
      ];
      for (const n of names) {
        const r = await client.query<{ ok: boolean }>(
          `SELECT pg_catalog.has_function_privilege('app_anon', ('core.' || $1)::regprocedure, 'EXECUTE') AS ok`,
          [n],
        );
        expect(r.rows[0]?.ok, n).toBe(false);
      }
    });
  });
});

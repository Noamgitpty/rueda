/**
 * US-313 — red team du lot 3, suite : données, messagerie, inventaire (RT-L3-H08, D01, D02, D05, D06 ;
 * risques L3-PM-11, L3-PM-45, L3-PM-46, L3-PM-49, L3-PM-51). Rôles de PRODUCTION seulement
 * (`withRole` : assertion L0-05 en tête de chaque test), USD (PA) et PYG sans décimale (PY),
 * transactions ANNULÉES. TESTS SEULEMENT : aucun correctif, aucune migration, aucune fixture. Rapport :
 * docs/team/redteam/L3-donnees-sinistres.md. Horloge virtuelle 2074 (aucune autre preuve ne
 * l'utilise). D04 (avis) : défense déjà prouvée par `l0-us317-reviews` (mêmes cinq chemins de lecture,
 * même scénario), renvoyée au rapport.
 *
 * Règles de jeu : un test vert prouve que l'attaque est BLOQUÉE. Un défaut est prouvé par un
 * `it.fails` nommé par son constat (`F-L3-DON-nn`), doublé d'un test vert « observation » qui affirme
 * que l'attaque a bien eu lieu. Les limites de détection DOCUMENTÉES par ADR-181 (homoglyphes, chiffres
 * en lettres françaises, image d'un numéro) sont jugées par une observation seulement.
 *
 * Attendus (jamais le code testé) : 19 US-316 critère 1 (« il voit le prénom de l'autre et jamais son
 * téléphone, son e-mail, son numéro de permis ni l'image d'une pièce ») ; 19 US-316 critère 2 (« hôte B
 * ⇒ 0 ligne ») ; 16 MSG-007 (masquage des téléphones, e-mails, identifiants et liens) ; pré-mortem
 * L3-PM-49 (corpus de contournement : lettres, espaces, homoglyphes, emoji, lien raccourci, pt-BR,
 * guaraní) ; 17 §2.3 et RLS-21 / RLS-22 (aucune écriture directe des tables du lot, aucune lecture pour
 * app_anon) ; 17 §2.3 : `host_guest_v` = prénom, âge, note, statut de vérification, rien d'autre.
 */
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, setSessionContext } from '../../../src/index.ts';
import { withRole, withTestTransaction } from '../../../src/testing/index.ts';
import { COUNTRIES } from '../../support/avl.ts';
import type { CountryCase } from '../../support/avl.ts';
import { openSession } from '../../support/iam.ts';
import { failure, plus, uuid, VIEW_INSPECTION } from './support-l3.ts';
import type { Row, Tx } from './support-l3.ts';

const READ = 'SELECT * FROM core.messaging_thread_read($1, $2::uuid, $3)';
const POST = 'SELECT * FROM core.messaging_cmd_post_message($1, $2::uuid, $3::uuid, $4)';
const T0 = '2074-05-02T09:00:00.000Z';
const START = '2074-06-10T15:00:00.000Z';
const END = '2074-06-13T15:00:00.000Z';
const MASK = '•••';
/** Numéros FICTIFS de test, au format de chaque pays (ordre de `COUNTRIES`). */
const PHONES: readonly string[] = ['+507 6123-4567', '+595 981 123 456'];

interface Trip {
  readonly trip: string;
  readonly org: string;
  readonly vehicle: string;
  readonly holder: string;
  readonly guest: string;
  readonly g: Buffer;
  readonly h: Buffer;
}

/** Trip de la fixture 9926 (voyageur « Ana Pérez », hôte « María Gómez »), sessions des deux parties. */
async function tripOf(tx: Tx, c: CountryCase): Promise<Trip> {
  const guest = uuid();
  const r = (
    await tx.query<{ trip_id: string; org_id: string; vehicle_id: string; holder_id: string }>(
      `SELECT * FROM test_fixture.us525_trip($1, NULL::uuid, $2::uuid, 'Ana', 'María José', $3, $4)`,
      [c.country, guest, START, END],
    )
  ).rows[0]!;
  return {
    trip: r.trip_id,
    org: r.org_id,
    vehicle: r.vehicle_id,
    holder: r.holder_id,
    guest,
    g: (await openSession(tx, guest)).hash,
    h: (await openSession(tx, r.holder_id)).hash,
  };
}

const read = async (tx: Tx, hash: Buffer, trip: string): Promise<Row[]> =>
  (await tx.query<Row>(READ, [hash, trip, 200])).rows;
let minute = 0;
async function post(tx: Tx, hash: Buffer, trip: string, body: string): Promise<Row> {
  minute += 1;
  await tx.query(`SELECT pg_catalog.set_config('app.virtual_now', $1, true)`, [
    plus(T0, minute * 60),
  ]);
  return (await tx.query<Row>(POST, [hash, trip, uuid(), body])).rows[0]!;
}

const asApi = (body: (tx: Tx) => Promise<void>): Promise<void> =>
  withRole('app_api', (api) => withTestTransaction(api, { virtualNow: T0 }, body));

describe.each(COUNTRIES)('RT-L3 données et messagerie ($country, $currency)', (c) => {
  const phone = PHONES[COUNTRIES.indexOf(c)]!;
  const EMAIL = 'ana.perez@correo.com';

  it('RT-L3-H08 / D01 (L3-PM-11, L3-PM-45) : l’hôte lit le voyageur par host_guest_v et par le fil — prénom seulement ; ni nom de famille, ni courriel, ni identifiant de personne, ni date de naissance ; le téléphone et le courriel écrits par le voyageur sont servis masqués', async () => {
    await asApi(async (tx) => {
      const t = await tripOf(tx, c);
      const m = await post(tx, t.g, t.trip, `Llámame al ${phone} o escríbeme a ${EMAIL}`);
      expect(m['outcome']).toBe('DONE');
      expect(m['masked']).toBe(true);
      // fil lu par l'hôte : en-tête et messages
      const hostRows = await read(tx, t.h, t.trip);
      const served = JSON.stringify(hostRows);
      for (const leak of [
        'Pérez',
        'fixture.test',
        EMAIL,
        phone,
        phone.replace(/\D/g, ''),
        t.guest,
      ]) {
        expect(served, `fil lu par l’hôte : ${leak}`).not.toContain(leak);
      }
      expect(hostRows[0]).toMatchObject({
        outcome: 'DONE',
        viewer_role: 'HOST',
        counterpart_name: 'Ana',
      });
      expect(hostRows.map((r) => r['body']).filter((b) => b !== null)).toEqual([
        `Llámame al ${MASK} o escríbeme a ${MASK}`,
      ]);
      // le voyageur lit le fil : prénom de l'hôte seulement
      const guestRows = await read(tx, t.g, t.trip);
      expect(JSON.stringify(guestRows)).not.toContain('Gómez');
      expect(guestRows[0]).toMatchObject({ viewer_role: 'GUEST', counterpart_name: 'María' });
      // host_guest_v : exactement cinq colonnes, ni nom de famille, ni courriel, ni identifiant
      await setSessionContext(tx, { kind: 'HOST', actorId: t.holder, orgId: t.org });
      const view = await tx.query<Row>(
        'SELECT * FROM core.booking_host_guest_v WHERE trip_id = $1',
        [t.trip],
      );
      expect(view.rows).toHaveLength(1);
      expect(Object.keys(view.rows[0]!).sort()).toEqual(
        ['age_years', 'first_name', 'rating', 'trip_id', 'verification_status'].sort(),
      );
      expect(view.rows[0]).toMatchObject({ first_name: 'Ana' });
      const joined = JSON.stringify(view.rows);
      for (const leak of ['Pérez', '@', 'fixture', t.guest]) {
        expect(joined, `host_guest_v : ${leak}`).not.toContain(leak);
      }
      // le compte du voyageur : aucune ligne pour l'hôte ; la colonne qui le nomme : refusée
      expect(
        (await tx.query('SELECT id FROM core.iam_user_account WHERE id = $1', [t.guest])).rowCount,
      ).toBe(0);
      expect(await failure(tx, 'SELECT guest_user_id FROM core.booking_trip')).toMatchObject({
        code: '42501',
      });
    });
  });

  it('RT-L3-D02 (L3-PM-46) : le fil, l’envoi et la série de photos d’un trip se ferment à tout tiers — hôte et voyageur d’un autre trip, visiteur sans trip, jeton inconnu ; un identifiant de message d’un autre trip est refusé à son propre auteur ; aucun message n’est ajouté', async () => {
    await asApi(async (tx) => {
      const t = await tripOf(tx, c);
      const other = await tripOf(tx, c);
      const stranger = (
        await tx.query<{ id: string }>('SELECT test_fixture.us525_person($1) AS id', ['Intruso'])
      ).rows[0]!.id;
      const strangerHash = (await openSession(tx, stranger)).hash;
      const own = await post(tx, t.g, t.trip, 'Hola, ¿a qué hora nos vemos?');
      expect(own['outcome']).toBe('DONE');
      const before = (await read(tx, t.g, t.trip)).length;
      for (const [label, hash] of [
        ['hôte d’un autre trip', other.h],
        ['voyageur d’un autre trip', other.g],
        ['visiteur sans trip', strangerHash],
      ] as const) {
        const rows = await read(tx, hash, t.trip);
        expect(rows, label).toHaveLength(1);
        expect(rows[0]?.['outcome'], label).toBe('NOT_FOUND');
        expect(rows[0]?.['body'], label).toBeNull();
        expect((await post(tx, hash, t.trip, 'Intento ajeno'))['outcome'], label).toBe('NOT_FOUND');
        // série de photos : même issue qu'un trip inconnu
        const insp = (await tx.query<{ v: Row }>(VIEW_INSPECTION, [hash, t.trip, 'CHECKIN']))
          .rows[0]!.v;
        expect(insp, label).toEqual({ outcome: 'NOT_FOUND' });
      }
      // jeton inconnu : authentification requise, aucune donnée
      const anon = await read(tx, randomBytes(32), t.trip);
      expect(anon[0]?.['outcome']).toBe('AUTH_REQUIRED');
      expect((await post(tx, randomBytes(32), t.trip, 'Hola'))['outcome']).toBe('AUTH_REQUIRED');
      // le voyageur de l'AUTRE trip réutilise l'identifiant d'un message de ce trip, sur son trip
      expect(
        (
          await tx.query<Row>(POST, [
            other.g,
            other.trip,
            own['message_id'],
            'Reprise de l’identifiant',
          ])
        ).rows[0]!['outcome'],
      ).toBe('REQUEST_INVALID');
      // témoin : le fil du trip n'a pas bougé et son auteur le lit
      expect((await read(tx, t.g, t.trip)).length).toBe(before);
      expect((await read(tx, t.h, t.trip))[0]).toMatchObject({
        outcome: 'DONE',
        viewer_role: 'HOST',
      });
    });
  });

  // -----------------------------------------------------------------------------------------
  // RT-L3-D05 — corpus de contournement, au-delà de celui de `l0-us525-messaging`
  /** Doivent être masqués (défenses), [texte, secret qui ne doit pas être servi]. */
  const MUST_MASK: readonly (readonly [string, string])[] = [
    ['escríbeme: ana @ correo . com', 'correo'],
    ['ANA ARROBA CORREO PUNTO COM', 'CORREO'],
    ['seis-uno-dos-tres-cuatro-cinco-seis', 'cuatro'],
    ['llámame 0981.123.456 por favor', '981'],
  ];
  /** Soupçonnés de passer (F-L3-DON-01) : courriel en mots anglais, chiffres en guaraní, chiffres arabes. */
  const SUSPECT: readonly (readonly [string, string])[] = [
    ['escríbeme: ana at correo dot com', 'correo'],
    ['mi número: peteĩ mokõi mbohapy irundy po poteĩ poapy', 'mbohapy'],
    ['llámame al ٦١٢٣٤٥٦٧', '٦١٢٣٤٥٦٧'],
  ];
  /** Limites DOCUMENTÉES (ADR-181) : chiffres en lettres françaises, homoglyphes, numéro scindé. */
  const DOCUMENTED: readonly (readonly [string, string])[] = [
    ['mon numéro: six un deux trois quatre cinq six sept', 'quatre'],
    ['cel 6l23 45o7', '45o7'],
  ];

  async function served(tx: Tx, t: Trip, text: string): Promise<Row> {
    const m = await post(tx, t.g, t.trip, text);
    expect(m['outcome'], text).toBe('DONE');
    return m;
  }

  it('RT-L3-D05 (L3-PM-49) : défenses du corpus — courriel espacé ou en lettres (es), numéro en lettres avec tirets, numéro à points : masqués (drapeau masked) ; faux positif de contrôle non masqué', async () => {
    await asApi(async (tx) => {
      const t = await tripOf(tx, c);
      for (const [text, secret] of MUST_MASK) {
        const m = await served(tx, t, text);
        expect(m['masked'], text).toBe(true);
        expect(String(m['body']), text).not.toContain(secret);
        expect(String(m['body']), text).toContain(MASK);
      }
      // faux positif de contrôle : un montant et une heure ne sont jamais masqués
      const ok = await served(tx, t, 'El total fue $ 1,250.00 y llego a las 10:30');
      expect(ok['masked']).toBe(false);
      expect(ok['body']).toBe('El total fue $ 1,250.00 y llego a las 10:30');
    });
  });

  it('RT-L3-D05 (L3-PM-49) — observation F-L3-DON-01 : un courriel écrit « at … dot », un numéro en guaraní et un numéro en chiffres arabes sont servis EN CLAIR et le drapeau masked reste faux', async () => {
    await asApi(async (tx) => {
      const t = await tripOf(tx, c);
      for (const [text, secret] of SUSPECT) {
        const m = await served(tx, t, text);
        expect(m['masked'], text).toBe(false);
        expect(String(m['body']), text).toContain(secret);
      }
    });
  });

  // CONSTAT F-L3-DON-01 → suite (US-525) : ces contournements (non listés parmi les limites d'ADR-181)
  // sont masqués (drapeau masked, secret absent) ; le corpus guaraní est exigé par le pré-mortem du lot 3 (L3-PM-49)
  it.fails(
    'RT-L3-D05 — CONSTAT F-L3-DON-01 : les contournements « at / dot », guaraní et chiffres arabes sont masqués',
    async () => {
      await asApi(async (tx) => {
        const t = await tripOf(tx, c);
        for (const [text, secret] of SUSPECT) {
          const m = await served(tx, t, text);
          expect(m['masked'], text).toBe(true);
          expect(String(m['body']), text).not.toContain(secret);
        }
      });
    },
  );

  it('RT-L3-D05 (L3-PM-49) — observation (limites d’ADR-181) : chiffres en lettres françaises et homoglyphes ne sont pas détectés ; un numéro scindé sur deux messages non plus', async () => {
    await asApi(async (tx) => {
      const t = await tripOf(tx, c);
      for (const [text, secret] of DOCUMENTED) {
        const m = await served(tx, t, text);
        expect(m['masked'], text).toBe(false);
        expect(String(m['body']), text).toContain(secret);
      }
      // numéro scindé : chaque moitié (quatre chiffres) reste sous le seuil de sept chiffres
      const first = await served(tx, t, 'mi número empieza con 6123');
      const second = await served(tx, t, 'y termina con 4567');
      expect([first['masked'], second['masked']]).toEqual([false, false]);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// RT-L3-D06 — inventaire des tables nouvelles du lot 3 (0158 à 0178), base de PRODUCTION
const LOT3_TABLES: readonly string[] = [
  'trip_ops_photo_slot',
  'trip_ops_inspection',
  'trip_ops_photo_capture',
  'trip_ops_inspection_photo',
  'payout_payout_account',
  'messaging_message_thread',
  'messaging_message',
  'messaging_message_flag',
  'trip_ops_identity_check',
  'trip_ops_handover_validation',
  'trip_ops_key_handover',
  'claim_evidence_bundle',
  'payout_payout_batch',
  'payout_payout_item',
  'payout_prepare_deferral',
  'messaging_meeting_proposal',
  'settlement_chargeback_imputation',
  'settlement_host_ledger_state',
  'trip_ops_overdue_case',
  'payment_payment_instrument',
  'payment_mit_consent',
  'payment_mit_consent_reminder',
  'payment_mit_network_rule',
  'payment_post_trip_charge',
  'payment_post_trip_charge_attempt',
  'payment_debt_balance',
  'payment_debt_collection',
  'review_submission',
  'trip_ops_overdue_escalation',
  'finance_reconciliation_run',
  'finance_reconciliation_item',
  'claim_damage_claim',
  'claim_decision',
  'claim_insurer_declaration',
  'claim_incidental_invoice',
  'claim_incidental_host_file',
  'claim_theft_case',
  'claim_incident_report',
  'claim_traffic_charge',
];
/** Seules lectures accordées aux rôles applicatifs (0167 : FINANCE et ADMIN du pays, par politique). */
const READABLE_BY_API = ['settlement_chargeback_imputation', 'settlement_host_ledger_state'];
const ROLES = ['app_anon', 'app_api', 'app_worker'] as const;

/** Fonctions `core.*` créées ou remplacées par les migrations 0158 à 0178 (lues dans les fichiers). */
const LOT3_FUNCTIONS: readonly string[] = (() => {
  const dir = join(PACKAGE_ROOT, 'migrations');
  const names = new Set<string>();
  for (const f of readdirSync(dir)) {
    const n = Number(/^(d{4})_/.exec(f)?.[1] ?? '-1');
    if (n < 158 || n > 178) continue;
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/^CREATE (?:OR REPLACE )?FUNCTION core.([a-z0-9_]+)/gm)) {
      names.add(m[1]!);
    }
  }
  return [...names].sort();
})();

describe('RT-L3-D06 (L3-PM-51) — inventaire des tables et commandes nouvelles du lot 3 (base de production)', () => {
  it('chaque table nouvelle : ENABLE + FORCE ; aucun rôle applicatif n’y écrit (INSERT, UPDATE, DELETE, TRUNCATE) ; app_anon et app_worker n’y lisent rien ; app_api ne lit que les deux vues d’état documentées', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const rls = await client.query<{ relname: string; r: boolean; f: boolean }>(
          `SELECT c.relname::text AS relname, c.relrowsecurity AS r, c.relforcerowsecurity AS f
             FROM pg_catalog.pg_class AS c
             JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
            WHERE n.nspname = 'core' AND c.relkind IN ('r', 'p') AND c.relname = ANY($1::text[])
            ORDER BY c.relname`,
          [[...LOT3_TABLES]],
        );
        // aucune table de la liste ne manque (une table renommée ferait échouer l'inventaire)
        expect(rls.rows.map((r) => r.relname).sort()).toEqual([...LOT3_TABLES].sort());
        expect(rls.rows.filter((r) => !r.r || !r.f).map((r) => r.relname)).toEqual([]);

        const privileges = await client.query<{ k: string }>(
          `SELECT r || ':' || t || ':' || p AS k
             FROM unnest($1::text[]) AS r, unnest($2::text[]) AS t,
                  unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) AS p
            WHERE CASE WHEN p IN ('INSERT', 'UPDATE')
                       THEN pg_catalog.has_any_column_privilege(r, ('core.' || t)::regclass, p)
                       ELSE pg_catalog.has_table_privilege(r, ('core.' || t)::regclass, p) END
            ORDER BY 1`,
          [[...ROLES], [...LOT3_TABLES]],
        );
        expect(privileges.rows.map((r) => r.k)).toEqual([]);

        const reads = await client.query<{ k: string }>(
          `SELECT r || ':' || t AS k
             FROM unnest($1::text[]) AS r, unnest($2::text[]) AS t
            WHERE pg_catalog.has_any_column_privilege(r, ('core.' || t)::regclass, 'SELECT')
            ORDER BY 1`,
          [[...ROLES], [...LOT3_TABLES]],
        );
        expect(reads.rows.map((r) => r.k).sort()).toEqual(
          READABLE_BY_API.map((t) => `app_api:${t}`).sort(),
        );
      },
      { database: 'production' },
    );
  });

  it('aucune fonction créée par les migrations 0158 à 0178 (noms lus dans les fichiers, toutes familles) n’est exécutable par app_anon ni par PUBLIC ; les commandes de travailleur (files …_due, débits, exécutions, vol présumé, lots de versement) ne le sont pas par app_api', async () => {
    await withRole(
      'app_api',
      async (client) => {
        const anon = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig
             FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core'
              AND p.proname = ANY($1::text[])
              AND (pg_catalog.has_function_privilege('app_anon', p.oid, 'EXECUTE')
                   OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(
                                COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS a
                               WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'))
            ORDER BY 1`,
          [[...LOT3_FUNCTIONS]],
        );
        expect(anon.rows.map((r) => r.sig)).toEqual([]);
        // témoin de population : la liste couvre bien les familles payment_, settlement_, finance_, review_
        for (const family of [
          'payment_',
          'settlement_',
          'finance_',
          'review_',
          'claim_',
          'messaging_',
        ]) {
          expect(
            LOT3_FUNCTIONS.some((n) => n.startsWith(family)),
            family,
          ).toBe(true);
        }
        const present = await client.query<{ n: number }>(
          `SELECT pg_catalog.count(*)::int AS n FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core' AND p.proname = ANY($1::text[])`,
          [[...LOT3_FUNCTIONS]],
        );
        expect(present.rows[0]!.n).toBeGreaterThan(100);
        const api = await client.query<{ sig: string }>(
          `SELECT p.oid::regprocedure::text AS sig
             FROM pg_catalog.pg_proc AS p
             JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
            WHERE n.nspname = 'core'
              AND (p.proname IN ('payout_cmd_prepare_trip', 'payout_cmd_initiate_batch',
                                 'payout_cmd_net_batch', 'payout_cmd_record_payout_result',
                                 'payout_cmd_adjustment', 'payout_cmd_record_adjustment')
                   OR p.proname ~ '^claim_(cmd_(charge_|execute_|open_theft|close_theft|lock_theft|record_theft|defer_)|incidental_invoices_due|theft_|traffic_charges_due)')
              AND pg_catalog.has_function_privilege('app_api', p.oid, 'EXECUTE')
            ORDER BY 1`,
        );
        expect(api.rows.map((r) => r.sig)).toEqual([]);
      },
      { database: 'production' },
    );
  });
});

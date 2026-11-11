/**
 * Graines réalistes et fictives du test des migrations (US-046, ADR-081 ; 19 §1.8 « migrations :
 * montée sur les graines PA et PY » ; 17 §11 RLS-19).
 *
 * Chaque bloc est posé sous `migrator` JUSTE APRÈS la migration `after` (la première où toutes ses
 * tables ont leur forme), dans une transaction : les migrations suivantes s'appliquent donc sur une
 * base peuplée. Les tables qu'une migration historique exigeait vides (dérogation
 * `populated: false` de `expand-contract-allowlist.json`) ne sont peuplées qu'après elle.
 * `rows` = lignes insérées par table : le test vérifie que `migrator`, sous RLS FORCÉE, voit
 * exactement ces lignes (RLS-19), puis qu'aucune migration suivante ne les perd ni ne les altère.
 *
 * Personnes, adresses et numéros FICTIFS : domaine réservé `example.test` (RFC 6761), IP de
 * documentation (RFC 5737), numéros `+1 555 01xx` réservés à la fiction. Les pays, devises et fuseaux
 * viennent des données de test des deux pays de premier rang (support/avl.ts), jamais du code.
 */
import { COUNTRIES } from './avl.ts';

export interface MigrationSeed {
  readonly id: string;
  /** Version (`NNNN`) après laquelle le bloc est posé. */
  readonly after: string;
  readonly rows: Readonly<Record<string, number>>;
  readonly sql: readonly string[];
}

/** UUID déterministe et lisible : `46000000-0000-4000-8000-<kind><k><n>`. */
const id = (kind: number, k: number, n = 0): string =>
  `46000000-0000-4000-8000-${String(kind).padStart(4, '0')}${String(k).padStart(4, '0')}${String(n).padStart(4, '0')}`;

const PHC =
  '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0c2FsdA$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYXNoaGFzaGhhc2g';

/** Personnes fictives, une paire (hôte, voyageur) par pays. */
const PEOPLE = [
  {
    host: ['Ana', 'Castillo', 'Ana C.', '1986-04-12', 'ana.castillo'],
    guest: ['Lucía', 'Fernández', 'Lucía', '1994-09-03', 'lucia.fernandez'],
  },
  {
    host: ['Rodrigo', 'Giménez', 'Rodrigo G.', '1979-11-27', 'rodrigo.gimenez'],
    guest: ['Diego', 'Benítez', 'Diego', '1991-02-18', 'diego.benitez'],
  },
] as const;

export const STAFF_ID = id(9, 0);

export interface SeedCountry {
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly host: string;
  readonly guest: string;
  readonly org: string;
  readonly vehicle: string;
  readonly trip: string;
  readonly hold: string;
}

export const SEED_COUNTRIES: readonly SeedCountry[] = COUNTRIES.map((c, k) => ({
  country: c.country,
  currency: c.currency,
  timezone: c.timezone,
  host: id(1, k),
  guest: id(2, k),
  org: id(3, k),
  vehicle: id(4, k),
  trip: id(5, k),
  hold: id(6, k),
}));

const lit = (s: string): string => `'${s.replace(/'/g, "''")}'`;

const per = (fn: (c: SeedCountry, k: number) => string): string[] => SEED_COUNTRIES.map(fn);
const n = SEED_COUNTRIES.length;

export const MIGRATION_SEEDS: readonly MigrationSeed[] = [
  {
    id: 'IAM : comptes, comptes d’hôte, appartenances, sessions',
    after: '0010',
    rows: {
      'core.iam_user_account': 2 * n + 1,
      'core.iam_organization': n,
      'core.iam_membership': n,
      'core.iam_session': n,
    },
    sql: [
      `INSERT INTO core.iam_user_account
         (id, email, email_verified_at, phone_e164, phone_verified_at, password_hash,
          legal_first_name, legal_last_name, display_name, date_of_birth, preferred_locale,
          residence_country, status)
       VALUES (${lit(STAFF_ID)}, 'operaciones.qa@example.test', platform.now(), NULL, NULL, ${lit(PHC)},
               'Equipo', 'Operaciones', 'Ops', NULL, 'es', NULL, 'ACTIVE')`,
      ...per((c, k) => {
        const p = PEOPLE[k % PEOPLE.length] ?? PEOPLE[0];
        const row = (uid: string, who: readonly string[], phone: string): string =>
          `(${lit(uid)}, ${lit(`${who[4]}${k}@example.test`)}, platform.now(), ${lit(phone)},
            platform.now(), ${lit(PHC)}, ${lit(who[0] as string)}, ${lit(who[1] as string)},
            ${lit(who[2] as string)}, ${lit(who[3] as string)}::date, 'es', ${lit(c.country)}, 'ACTIVE')`;
        return `INSERT INTO core.iam_user_account
                  (id, email, email_verified_at, phone_e164, phone_verified_at, password_hash,
                   legal_first_name, legal_last_name, display_name, date_of_birth, preferred_locale,
                   residence_country, status)
                VALUES ${row(c.host, p.host, `+1555010${String(2 * k + 1).padStart(4, '0')}`)},
                       ${row(c.guest, p.guest, `+1555010${String(2 * k + 2).padStart(4, '0')}`)}`;
      }),
      ...per(
        (c, k) =>
          `INSERT INTO core.iam_organization (id, holder_user_id, country_code, display_name, tax_id, status)
           VALUES (${lit(c.org)}, ${lit(c.host)}, ${lit(c.country)}, ${lit(`Autos de ${PEOPLE[k % 2]?.host[0]}`)},
                   ${lit(`8-${700 + k}-${1234 + k}`)}, 'ONBOARDING')`,
      ),
      ...per(
        (c, k) =>
          `INSERT INTO core.iam_membership (id, user_id, org_id, role, status)
           VALUES (${lit(id(7, k))}, ${lit(c.host)}, ${lit(c.org)}, 'P2P_HOST', 'ACTIVE')`,
      ),
      ...per(
        (c, k) =>
          `INSERT INTO core.iam_session (id, user_id, token_hash, expires_at, ip, user_agent)
           VALUES (${lit(id(8, k))}, ${lit(c.guest)},
                   decode(md5('session-${k}-a') || md5('session-${k}-b'), 'hex'),
                   platform.now() + interval '14 days', '198.51.100.${10 + k}'::inet,
                   'Mozilla/5.0 (Linux; Android 14) Mobile')`,
      ),
    ],
  },
  {
    id: 'BUS : événements de l’outbox',
    after: '0014',
    rows: { 'core.outbox_outbox_event': n },
    sql: per(
      (c, k) =>
        `INSERT INTO core.outbox_outbox_event
           (type, schema_version, aggregate_type, aggregate_id, aggregate_version, country_code,
            actor_user_id, actor_role, correlation_id, payload, partition_key)
         VALUES ('iam.user.registered', 1, 'user_account', ${lit(c.guest)}, 1, ${lit(c.country)},
                 ${lit(c.guest)}, 'GUEST', ${lit(id(10, k))},
                 jsonb_build_object('user_id', ${lit(c.guest)}::text), ${lit(`user:${c.guest}`)})`,
    ),
  },
  {
    id: 'AUD : clés de sujet, journal d’audit chaîné, journal d’accès, fichier chiffré',
    after: '0019',
    rows: {
      'core.audit_subject_key': n,
      'core.audit_audit_log': n,
      'core.audit_data_access_log': n,
      'core.audit_file_asset': n,
    },
    sql: [
      ...per(
        (c, k) =>
          `INSERT INTO core.audit_subject_key (subject_type, subject_id, wrapped_dek, kms_key_id)
           VALUES ('USER', ${lit(c.guest)}, decode(repeat(md5('dek-${k}'), 2), 'hex'), 'fake-kms:key/us046')`,
      ),
      ...per(
        (c, k) =>
          `INSERT INTO core.audit_audit_log
             (actor_user_id, actor_role, action_code, subject_type, subject_id, after, reason,
              ip_enc, ip_key_subject_type, ip_key_subject_id, request_id)
           VALUES (${lit(c.guest)}, 'GUEST', 'ACCOUNT_LOGIN', 'USER_ACCOUNT', ${lit(c.guest)},
                   '{"status":"ACTIVE"}'::jsonb, 'connexion',
                   decode('01' || md5('ip-${k}') || md5('ip-${k}-tag'), 'hex'), 'USER', ${lit(c.guest)},
                   ${lit(id(11, k))})`,
      ),
      ...per(
        (c, k) =>
          `INSERT INTO core.audit_data_access_log
             (id, actor_user_id, actor_role, subject_type, subject_id, field_or_file, purpose,
              access_kind, case_ref, request_id)
           VALUES (${lit(id(12, k))}, ${lit(STAFF_ID)}, 'SUPPORT_AGENT', 'USER', ${lit(c.guest)},
                   'iam_user_account.phone_e164', 'vérification demandée par le voyageur',
                   'READ_C2_SUPPORT', ${lit(`CASE-${k}-0001`)}, ${lit(id(13, k))})`,
      ),
      ...per(
        (c, k) =>
          `INSERT INTO core.audit_file_asset
             (id, bucket, storage_key, mime, bytes, sha256, uploader_user_id, source, classification,
              retention_class, enc_subject_type, enc_subject_id)
           VALUES (${lit(id(14, k))}, 'PRIVATE_EVIDENCE', ${lit(`evidence/us046/${k}/checkin-front.jpg.enc`)},
                   'image/jpeg', 245760, decode(md5('file-${k}') || md5('file-${k}-2'), 'hex'),
                   ${lit(c.guest)}, 'IN_APP_CAMERA', 'C2', 'TRIP_EVIDENCE', 'USER', ${lit(c.guest)})`,
      ),
    ],
  },
  {
    id: 'SUP : dossiers de support',
    after: '0024',
    rows: { 'core.support_support_case': n },
    sql: per(
      (c, k) =>
        `INSERT INTO core.support_support_case
           (id, requester_user_id, country_code, channel, category, priority, status, reason)
         VALUES (${lit(id(15, k))}, ${lit(c.guest)}, ${lit(c.country)}, 'WHATSAPP', 'ACCOUNT', 'NORMAL',
                 'OPEN', 'changement du numéro de téléphone du compte')`,
    ),
  },
  {
    id: 'NTF : envois de notifications en file',
    after: '0031',
    rows: { 'core.ntf_notification_dispatch': n },
    sql: per(
      (c, k) =>
        `INSERT INTO core.ntf_notification_dispatch
           (event_id, event_type, country_code, correlation_id, recipient_user_id, recipient_role,
            channel, template_key, template_version, variables, status, locale)
         VALUES (${lit(id(16, k))}, 'iam.user.registered', ${lit(c.country)}, ${lit(id(10, k))},
                 ${lit(c.guest)}, 'GUEST', 'EMAIL', 'EVT_USER_REGISTERED', 1,
                 '{"first_name_ref":"user_account"}'::jsonb, 'QUEUED', 'es')`,
    ),
  },
  {
    // après 0032 : la table d'occupation exigeait d'être vide (dérogation populated: false) ;
    // depuis US-115 (0066), après 0066 : une occupation, un hold ou un trip exige son véhicule au
    // catalogue (clé étrangère (vehicle_id, org_id, country_code) vers catalog_vehicle, N-03)
    id: 'CAT et AVL : lieu, véhicule et annonce de l’hôte ; occupations, trip réservé et hold actif par pays',
    after: '0066',
    rows: {
      'core.catalog_location': n,
      'core.catalog_vehicle': n,
      'core.catalog_listing': n,
      'core.booking_vehicle_occupancy': 2 * n,
      'core.booking_trip': n,
      'core.booking_guest_occupancy': n,
      'core.booking_checkout_hold': n,
    },
    sql: per((c, k) => {
      const start = `timestamptz '2031-03-${String(10 + 4 * k).padStart(2, '0')} 15:00:00+00'`;
      const end = `timestamptz '2031-03-${String(13 + 4 * k).padStart(2, '0')} 15:00:00+00'`;
      const hStart = `timestamptz '2031-04-${String(10 + 4 * k).padStart(2, '0')} 15:00:00+00'`;
      const hEnd = `timestamptz '2031-04-${String(12 + 4 * k).padStart(2, '0')} 15:00:00+00'`;
      return `
        INSERT INTO core.catalog_location
          (id, org_id, country_code, kind, place_label, address_line, city, area_label, geo, timezone,
           created_by)
        VALUES (${lit(id(20, k))}, ${lit(c.org)}, ${lit(c.country)}, 'HOME', 'Casa', ${lit(`Calle Ficticia ${k + 1}`)},
                'Ciudad Ficticia', 'Barrio Ficticio', point(${-79.5 + k}, ${8.95 + k}), ${lit(c.timezone)},
                ${lit(c.host)});
        INSERT INTO core.catalog_vehicle
          (id, org_id, country_code, home_location_id, timezone, plate, make_text, model_text, year,
           transmission, seats, fuel_type, created_by)
        VALUES (${lit(c.vehicle)}, ${lit(c.org)}, ${lit(c.country)}, ${lit(id(20, k))}, ${lit(c.timezone)},
                ${lit(`K46F${k}0`)}, 'Ficticia', 'Modelo', 2022, 'AUTOMATIC', 5, 'GASOLINE', ${lit(c.host)});
        INSERT INTO core.catalog_listing
          (id, vehicle_id, org_id, country_code, status, daily_price_minor, currency, mileage_mode,
           created_by)
        VALUES (${lit(id(21, k))}, ${lit(c.vehicle)}, ${lit(c.org)}, ${lit(c.country)}, 'DRAFT', 250000,
                ${lit(c.currency)}, 'UNLIMITED', ${lit(c.host)});
        INSERT INTO core.booking_vehicle_occupancy
          (id, vehicle_id, org_id, country_code, kind, source, period, active, ref_type, ref_id)
        VALUES (${lit(id(17, k))}, ${lit(c.vehicle)}, ${lit(c.org)}, ${lit(c.country)}, 'TRIP', 'CHECKOUT',
                tstzrange(${start}, ${end}, '[)'), true, 'TRIP', ${lit(c.trip)});
        INSERT INTO core.booking_trip
          (id, public_ref, guest_user_id, org_id, vehicle_id, country_code, currency, timezone,
           scheduled_start, scheduled_end, status)
        VALUES (${lit(c.trip)}, ${lit(`K46-${k}-0001`)}, ${lit(c.guest)}, ${lit(c.org)}, ${lit(c.vehicle)},
                ${lit(c.country)}, ${lit(c.currency)}, ${lit(c.timezone)}, ${start}, ${end}, 'BOOKED');
        INSERT INTO core.booking_guest_occupancy (id, guest_user_id, period, active, trip_id)
        VALUES (${lit(id(18, k))}, ${lit(c.guest)}, tstzrange(${start}, ${end}, '[)'), true, ${lit(c.trip)});
        INSERT INTO core.booking_vehicle_occupancy
          (id, vehicle_id, org_id, country_code, kind, source, period, active, expires_at, ref_type, ref_id)
        VALUES (${lit(id(19, k))}, ${lit(c.vehicle)}, ${lit(c.org)}, ${lit(c.country)}, 'HOLD', 'CHECKOUT',
                tstzrange(${hStart}, ${hEnd}, '[)'), true, platform.now() + interval '1 day', 'HOLD', ${lit(c.hold)});
        INSERT INTO core.booking_checkout_hold
          (id, guest_user_id, vehicle_id, org_id, country_code, occupancy_id, kind, status, expires_at)
        VALUES (${lit(c.hold)}, ${lit(c.guest)}, ${lit(c.vehicle)}, ${lit(c.org)}, ${lit(c.country)},
                ${lit(id(19, k))}, 'CHECKOUT', 'ACTIVE', platform.now() + interval '1 day')`;
    }),
  },
];

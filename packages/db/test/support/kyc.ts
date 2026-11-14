/**
 * Aides des preuves de la décision KYC de l'ops (US-106, migration 0076 ; fixtures 9984) : une
 * personne amenée en `MANUAL_REVIEW` par les VRAIES commandes d'US-105 (inscription avec
 * consentements, vérification d'e-mail, session, consentement biométrique, ouverture, session
 * hébergée, rappel du fournisseur), puis un membre du staff élevé par TOTP (mêmes étapes que
 * `support/staff.ts`). Toutes les requêtes passent par une connexion sous un rôle de PRODUCTION
 * (`withRole` : assertion L0-05 en tête). Le téléphone vérifié est posé par la fixture 9996
 * (raison : passation US-105, purge à +31 jours de l0-us104).
 *
 * Les valeurs attendues des tests viennent de 19 US-106, 16 et 17, jamais de ce fichier.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { newToken, phcArgon2id, SESSION_TTL_S } from './iam.ts';
import { elevate, login, stepNow } from './staff.ts';

export const PROVIDER = 'FAKE';
const DOCS = '[{"kind":"TOS_GUEST","version":1},{"kind":"PRIVACY","version":1}]';
const DAY_MS = 86_400_000;

const cfg = (file: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../../../../apps/api/src/modules/cfg/data/${file}`, import.meta.url),
      'utf8',
    ),
  );

interface CountryData {
  readonly code: string;
  readonly phone: { callingCode: string; nationalLength: number; mobilePrefixes: string[] };
  readonly timeZoneChecks: { offsetMinutes: number }[];
}
const COUNTRY_DATA = new Map(
  (cfg('countries.json') as { countries: CountryData[] }).countries.map((c) => [c.code, c]),
);

/**
 * Décalage UTC courant du pays, en minutes : dernier contrôle tzdata des données CFG (17 §1.3,
 * ADR-019). Oracle de l'heure locale, indépendant du SQL testé.
 */
export function utcOffsetMinutes(country: string): number {
  const c = COUNTRY_DATA.get(country);
  if (c === undefined) throw new Error(`pays inconnu des données CFG : ${country}`);
  return c.timeZoneChecks.at(-1)?.offsetMinutes ?? 0;
}

function phoneOf(country: string): string {
  const p = COUNTRY_DATA.get(country)?.phone;
  if (p === undefined) throw new Error(`pays sans plan de numérotation : ${country}`);
  const prefix = p.mobilePrefixes[0] ?? '';
  let rest = '';
  while (rest.length < p.nationalLength - prefix.length) rest += String(randomInt(10));
  return `+${p.callingCode}${prefix}${rest}`;
}

export const uuid = (): string => randomUUID();

/** Date ISO (AAAA-MM-JJ) à `days` jours d'aujourd'hui (UTC). */
export const isoDay = (days: number): string =>
  new Date(Date.now() + days * DAY_MS).toISOString().slice(0, 10);

export interface Person {
  readonly userId: string;
  readonly token: Buffer;
}

export async function one<T extends pg.QueryResultRow>(
  client: pg.ClientBase,
  sql: string,
  params: unknown[],
): Promise<T> {
  const { rows } = await client.query<T>(sql, params);
  return rows[0] as T;
}

/** Nom légal déclaré à l'inscription (US-103 : « tal como aparece en su licencia »). */
export interface LegalName {
  readonly first: string;
  readonly last: string;
}

/**
 * Personne inscrite dans `country` (nom légal `names`, « Ana Pérez » par défaut), e-mail et
 * téléphone vérifiés, session ouverte.
 */
export async function person(
  client: pg.ClientBase,
  country: string,
  names: LegalName = { first: 'Ana', last: 'Pérez' },
): Promise<Person> {
  const userId = uuid();
  const verification = newToken();
  const r = await client.query<{ ok: boolean }>(
    `SELECT core.iam_cmd_register_with_consents($1, $2, $3, $8, $9, 'es', $4, $5, 86400,
                                                NULL, $6, $7::jsonb, false) AS ok`,
    [
      userId,
      `kyc106-${userId}@example.test`,
      phcArgon2id(),
      uuid(),
      verification.hash,
      country,
      DOCS,
      names.first,
      names.last,
    ],
  );
  if (r.rows[0]?.ok !== true) throw new Error('inscription de test refusée');
  const v = await client.query<{ ok: boolean }>('SELECT core.iam_cmd_verify_email($1) AS ok', [
    verification.hash,
  ]);
  if (v.rows[0]?.ok !== true) throw new Error('vérification d’e-mail refusée');
  const t = newToken();
  const s = await client.query<{ expires_at: Date | null }>(
    `SELECT core.iam_cmd_open_session($1, $2, $3, $4, 'NONE', NULL, 'vitest') AS expires_at`,
    [uuid(), userId, t.hash, SESSION_TTL_S],
  );
  if (!s.rows[0]?.expires_at) throw new Error('session refusée');
  await client.query('SELECT test_fixture.us105_verify_phone($1, $2)', [userId, phoneOf(country)]);
  return { userId, token: t.hash };
}

/** Champs minimaux d'un permis de conduire définitif rendus par le fournisseur (port, ADR-102). */
export const licence = (
  country: string,
  expiresOn: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  kind: 'DRIVER_LICENSE',
  country,
  expiresOn,
  licenseClass: 'B',
  isPermanent: true,
  providerDocumentRef: `doc_${randomBytes(4).toString('hex')}`,
  // nom lu sur le permis (US-103, ADR-117) : concorde avec « Ana Pérez » et « Ana María Pérez Gómez »
  holderGivenNames: 'Ana María',
  holderSurnames: 'Pérez Gómez',
  ...extra,
});

/** Personne consentante dont la vérification courante est ouverte (`PHONE_VERIFIED`, tentative 1). */
export async function opened(
  client: pg.ClientBase,
  country: string,
): Promise<Person & { readonly verificationId: string }> {
  const p = await person(client, country);
  const c = await one<{ outcome: string }>(
    client,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, 1, true],
  );
  if (c.outcome !== 'RECORDED') throw new Error(`consentement refusé : ${c.outcome}`);
  const o = await one<{ outcome: string; verification_id: string }>(
    client,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  if (o.outcome !== 'READY') throw new Error(`ouverture refusée : ${o.outcome}`);
  return { ...p, verificationId: o.verification_id };
}

export interface Reviewed extends Person {
  readonly verificationId: string;
  readonly sessionRef: string;
}

/**
 * Personne dont le dossier est en `MANUAL_REVIEW` : consentement, ouverture, session hébergée,
 * puis rappel du fournisseur `decision` (REVIEW par défaut ⇒ motif PROVIDER_REVIEW) avec le
 * document donné (permis définitif valable un an par défaut). `sessionExpiresAt` : fin de la
 * session hébergée (horloge virtuelle : la passer au-delà de l'instant virtuel).
 */
export async function toReview(
  client: pg.ClientBase,
  country: string,
  options: {
    readonly decision?: string;
    readonly document?: Record<string, unknown> | null;
    readonly sessionExpiresAt?: string;
    /** Nom légal déclaré (US-103) ; « Ana Pérez » par défaut. */
    readonly names?: LegalName;
  } = {},
): Promise<Reviewed> {
  const p = await person(client, country, options.names);
  const c = await one<{ outcome: string }>(
    client,
    'SELECT * FROM core.kyc_cmd_biometric_consent($1, $2, $3, $4)',
    [p.token, country, 1, true],
  );
  if (c.outcome !== 'RECORDED') throw new Error(`consentement refusé : ${c.outcome}`);
  const o = await one<{ outcome: string; verification_id: string; attempt: number }>(
    client,
    'SELECT * FROM core.kyc_cmd_open_verification($1, $2, $3)',
    [p.token, country, PROVIDER],
  );
  if (o.outcome !== 'READY') throw new Error(`ouverture refusée : ${o.outcome}`);
  const sessionRef = `fk_idv_${randomBytes(6).toString('hex')}`;
  const s = await one<{ outcome: string }>(
    client,
    'SELECT * FROM core.kyc_cmd_record_session($1, $2, $3, $4, $5, $6, $7)',
    [
      p.token,
      o.verification_id,
      o.attempt,
      PROVIDER,
      sessionRef,
      `https://identity.fake.invalid/session/${sessionRef}`,
      options.sessionExpiresAt ?? new Date(Date.now() + 30 * 60_000).toISOString(),
    ],
  );
  if (s.outcome !== 'RECORDED') throw new Error(`session refusée : ${s.outcome}`);
  const document =
    options.document === undefined ? licence(country, isoDay(400)) : options.document;
  const d = await one<{ outcome: string; status: string }>(
    client,
    'SELECT * FROM core.kyc_cmd_apply_decision($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    [
      PROVIDER,
      `evt_${randomBytes(6).toString('hex')}`,
      sessionRef,
      o.verification_id,
      options.decision ?? 'REVIEW',
      0.4211,
      0.8875,
      document === null ? null : JSON.stringify(document),
    ],
  );
  if (d.outcome !== 'APPLIED') throw new Error(`rappel refusé : ${d.outcome}`);
  return { ...p, verificationId: o.verification_id, sessionRef };
}

export interface Staff {
  readonly userId: string;
  readonly hash: Buffer;
}

/**
 * Élève par TOTP (vraies commandes) le compte `userId` auquel un rôle du staff est accordé dans
 * `scope` : rôle, facteur en attente, session, enrôlement, preuve du pas courant.
 */
export async function elevateAs(
  client: pg.ClientBase,
  userId: string,
  role: string,
  scope: readonly string[],
): Promise<Staff> {
  await client.query(
    `SELECT test_fixture.iam_grant_staff_role($1, $2, $3, $4::text[], NULL, NULL)`,
    [uuid(), userId, role, scope],
  );
  const factorId = uuid();
  const code = randomBytes(9).toString('base64url');
  const codeHash = createHash('sha256').update(code, 'utf8').digest();
  await client.query(
    `SELECT test_fixture.iam_insert_pending_totp($1, $2, 'fake-vault:test-secret', $3, 86400)`,
    [factorId, userId, codeHash],
  );
  const hash = await login(client, userId);
  const reveal = await one<{ outcome: string }>(
    client,
    'SELECT outcome FROM core.iam_staff_cmd_enroll_reveal($1, $2)',
    [hash, codeHash],
  );
  if (reveal.outcome !== 'OK') throw new Error('enrôlement refusé');
  if ((await elevate(client, hash, factorId, stepNow())) !== 'ENROLLED') {
    throw new Error('élévation refusée');
  }
  return { userId, hash };
}

/** Membre du staff (compte inscrit dans `country`, son pays de compte) élevé par TOTP. */
export async function staff(
  client: pg.ClientBase,
  role: string,
  scope: readonly string[],
  country: string,
): Promise<Staff> {
  const p = await person(client, country);
  return elevateAs(client, p.userId, role, scope);
}

/** Élément vivant (ou le dernier) de la file KYC de la personne (fixture 9984). */
export interface QueueItem {
  readonly id: string;
  readonly status: string;
  readonly decision: string | null;
  readonly assignee_id: string | null;
  readonly country_code: string;
  readonly sla_minutes: number;
  readonly breached: boolean;
}

export async function itemsOf(client: pg.ClientBase, userId: string): Promise<QueueItem[]> {
  const { rows } = await client.query<QueueItem>('SELECT * FROM test_fixture.us106_items($1)', [
    userId,
  ]);
  return rows;
}

export const claim = (client: pg.ClientBase, s: Staff, itemId: string) =>
  one<{ outcome: string }>(client, 'SELECT * FROM core.support_staff_claim_item($1, $2, $3)', [
    s.hash,
    uuid(),
    itemId,
  ]);

export interface ActionResult {
  readonly outcome: string;
  readonly action_id: string | null;
  readonly domain_ref: string | null;
  readonly detail: string | null;
}

/** Action de console `KYC_DECISION` (cadre d'US-101), forme à pièces, sans pièce. */
export const decide = (
  client: pg.ClientBase,
  s: Staff,
  verificationId: string,
  input: Record<string, string>,
  reason = 'Contrôles faits dans le portail du fournisseur',
  requestId = uuid(),
) =>
  one<ActionResult>(
    client,
    'SELECT * FROM core.iam_staff_cmd_manual_action($1, $2, $3, $4, $5, $6::jsonb, $7::uuid[])',
    [s.hash, requestId, 'KYC_DECISION', verificationId, reason, JSON.stringify(input), []],
  );

/** Les quatre contrôles cochés (19 US-106), tous réussis sauf ceux donnés. */
export const checks = (
  decision: string,
  failed: readonly (
    'livenessCheck' | 'idDocumentCheck' | 'licenseListCheck' | 'duplicateCheck'
  )[] = [],
): Record<string, string> => ({
  decision,
  livenessCheck: failed.includes('livenessCheck') ? 'FAILED' : 'PASSED',
  idDocumentCheck: failed.includes('idDocumentCheck') ? 'FAILED' : 'PASSED',
  licenseListCheck: failed.includes('licenseListCheck') ? 'FAILED' : 'PASSED',
  duplicateCheck: failed.includes('duplicateCheck') ? 'FAILED' : 'PASSED',
});

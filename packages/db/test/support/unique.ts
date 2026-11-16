/**
 * Valeurs de test UNIQUES PAR CONSTRUCTION pour les colonnes soumises à une contrainte d'unicité ou
 * d'exclusion (BOARD N-186, US-122) : téléphone vérifié (ACC-014, `user_account_phone_verified_unique`),
 * plaque par pays et VIN partout (`catalog_vehicle_plate_unique`, `catalog_vehicle_vin_unique`),
 * modèle du catalogue (`catalog_vehicle_model_make_slug_key`), fenêtres virtuelles lointaines.
 *
 * Un tirage au hasard n'est PAS sûr ici : la base d'une exécution est partagée par tous les fichiers
 * (projets l0, l0-concurrence, l0-redteam) et garde des milliers de lignes validées. Avec 10^7
 * numéros PA (préfixe `6` puis 7 chiffres), quelques milliers de comptes à téléphone vérifié
 * suffisent à rendre probable une collision d'anniversaire : 23505 sur
 * `user_account_phone_verified_unique` au run 43877229339 (rt-l1-03, RT-L1-A10 PA), alors que le
 * diff ne touchait que `docs/team/`.
 *
 * Source : `test_fixture.next_unique_serial()` (test-migrations/9999), une séquence de la base,
 * seul compteur commun à tous les travailleurs et à tous les fichiers (un compteur en mémoire
 * repartirait de zéro à chaque fichier). Chaque entier n'est rendu qu'une fois par base, même dans
 * une transaction annulée. Chaque générateur encode cet entier dans le format exigé, à largeur fixe
 * (deux entiers distincts donnent deux textes distincts) et lève une erreur plutôt que de tronquer.
 *
 * Les valeurs restent valides pour les contrôles de format : plan de numérotation du pays lu dans
 * les données CFG (indicatif, longueur nationale, préfixe mobile ; jamais une constante du code),
 * plaque `^[A-Z0-9]{2,12}$`, VIN ISO 3779 `^[A-HJ-NPR-Z0-9]{17}$` (0067 / 0083).
 */
import { readFileSync } from 'node:fs';
import type pg from 'pg';

/** Entier jamais rendu dans cette base (séquence de test 9999). */
export async function uniqueSerial(client: pg.ClientBase): Promise<bigint> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT test_fixture.next_unique_serial()::text AS n',
  );
  const n = rows[0]?.n;
  if (n === undefined) throw new Error('compteur unique de test indisponible (fixture 9999)');
  return BigInt(n);
}

/** `serial` en base `alphabet`, sur exactement `width` caractères ; erreur s'il ne tient pas. */
export function encodeFixed(serial: bigint, alphabet: string, width: number): string {
  const base = BigInt(alphabet.length);
  let rest = serial;
  let out = '';
  for (let i = 0; i < width; i++) {
    out = (alphabet[Number(rest % base)] as string) + out;
    rest /= base;
  }
  if (rest !== 0n) {
    throw new Error(`compteur unique ${String(serial)} hors de ${String(width)} caractères`);
  }
  return out;
}

const DIGITS = '0123456789';
const HEX = '0123456789ABCDEF';
/** Alphabet du VIN ISO 3779 (ni I, ni O, ni Q). */
const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';

/** `width` chiffres décimaux uniques (zéros en tête). */
export async function uniqueDigits(client: pg.ClientBase, width: number): Promise<string> {
  return encodeFixed(await uniqueSerial(client), DIGITS, width);
}

/** `width` chiffres hexadécimaux majuscules uniques. */
export async function uniqueHex(client: pg.ClientBase, width: number): Promise<string> {
  return encodeFixed(await uniqueSerial(client), HEX, width);
}

interface DialPlan {
  readonly callingCode: string;
  readonly nationalLength: number;
  readonly mobilePrefixes: string[];
}
const DIAL_PLANS = new Map(
  (
    JSON.parse(
      readFileSync(
        new URL('../../../../apps/api/src/modules/cfg/data/countries.json', import.meta.url),
        'utf8',
      ),
    ) as { countries: { code: string; phone: DialPlan }[] }
  ).countries.map((c) => [c.code, c.phone]),
);

/**
 * Numéro mobile E.164 unique du pays : `+<indicatif><préfixe mobile><chiffres du compteur>`, à la
 * longueur nationale du plan (PA : `+5076` + 7 chiffres ; PY : `+5959` + 8 chiffres). Le même
 * compteur sert aux deux pays : un numéro n'est jamais rendu deux fois.
 */
export async function uniquePhone(client: pg.ClientBase, country: string): Promise<string> {
  const p = DIAL_PLANS.get(country);
  if (p === undefined) throw new Error(`pays sans plan de numérotation : ${country}`);
  const prefix = p.mobilePrefixes[0] ?? '';
  const digits = await uniqueDigits(client, p.nationalLength - prefix.length);
  return `+${p.callingCode}${prefix}${digits}`;
}

/** Plaque unique : `letter` puis 8 chiffres hexadécimaux (`R0000002A`), comme l'ancien tirage. */
export async function uniquePlate(client: pg.ClientBase, letter: string): Promise<string> {
  return `${letter}${await uniqueHex(client, 8)}`;
}

/** VIN ISO 3779 unique (17 caractères, sans I, O ni Q). */
export async function uniqueVin(client: pg.ClientBase): Promise<string> {
  return encodeFixed(await uniqueSerial(client), VIN_ALPHABET, 17);
}

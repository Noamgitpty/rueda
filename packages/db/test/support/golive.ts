/**
 * Aides des preuves des interrupteurs de mise en service (US-125, migration 0073 ; 17 §0.1, §2.3,
 * RLS-27) : appel des VRAIES commandes à deux personnes `core.config_cmd_request_go_live_switch`
 * et `core.config_cmd_approve_go_live_switch` sous app_api, contexte STAFF posé par la vraie couche
 * (`setSessionContext`) ; l'identité vient de la session désignée par l'empreinte du jeton.
 *
 * Règle : un interrupteur ne passe à true que dans une transaction ANNULÉE ou, sur la base de
 * TEST seulement, dans une fenêtre d'horloge virtuelle lointaine refermée par la même procédure
 * (`openSwitchWindow`). Aucun pays en constante : les pays viennent de `COUNTRIES`.
 *
 * Ordre de verrouillage (interblocage du run 44013812687) : chaque écriture d'audit tient la
 * ligne unique `core.audit_chain_head` jusqu'à la fin de la transaction, et les commandes d'US-125
 * prennent le verrou consultatif `config.go_live:<clé>:<pays>` avant leur audit. Une preuve qui
 * a déjà audité (premier interrupteur ouvert, véhicule déclaré…) demande donc le consultatif en
 * tenant la tête, alors qu'une transaction neuve tient le consultatif et attend la tête : deux
 * fichiers qui ouvrent le même interrupteur du même pays en même temps s'interbloquent (40P01).
 * Les aides ci-dessous prennent la tête AVANT chaque commande (`lockAuditChainHead`, fixture
 * 9957), si bien que toute preuve suit le même ordre : tête, puis consultatif. La fixture prend
 * auparavant le verrou de table ROW EXCLUSIVE du journal (`core.audit_audit_log`), comme tout
 * INSERT d'audit et comme `test_fixture.lock_audit_log` (9150, ACCESS EXCLUSIVE avant la tête) :
 * ordre unique table, tête, consultatif (interblocage du run 44059396848 avec
 * l0-aud-01-audit-chain).
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { setSessionContext } from '../../src/index.ts';
import { withTestTransaction } from '../../src/testing/index.ts';
import { uniqueSerial } from './unique.ts';

/** Les quatre interrupteurs de mise en service (CLAUDE.md point 7 ; 17 §0.1). */
export const SWITCHES = [
  'p2p_private_hosts_enabled',
  'insurer_contract_active',
  'funds_holding_enabled',
  'payouts_enabled',
] as const;
export type SwitchKey = (typeof SWITCHES)[number];

/** Référence d'une décision écrite du fondateur (forme de docs/team/DECISIONS.md). */
export const DECISION = 'DEC-FONDATEUR-15';

export const REQUEST_SQL =
  'SELECT outcome, request_id FROM core.config_cmd_request_go_live_switch($1, $2, $3, $4, $5, $6)';
export const APPROVE_SQL =
  'SELECT outcome, request_id FROM core.config_cmd_approve_go_live_switch($1, $2)';
export const CANCEL_SQL =
  'SELECT outcome, request_id FROM core.config_cmd_cancel_go_live_switch($1, $2)';

/** Verrou de la tête de chaîne d'audit dans la transaction courante (fixture 9957, app_api). */
export const AUDIT_CHAIN_HEAD_LOCK_SQL = 'SELECT test_fixture.audit_chain_head_lock()';

/**
 * Options d'ordre de verrouillage des commandes d'US-125. `chainFirst` (défaut `true`) : la tête
 * de chaîne d'audit est prise AVANT la commande, ordre commun à toutes les preuves. `false` est
 * réservé aux courses qui éprouvent la sérialisation des commandes elles-mêmes (RT-CONC-25, 26) :
 * prendre la tête avant la commande les sérialiserait avant même la lecture de la demande et
 * rendrait la preuve vide.
 */
export interface LockOrder {
  readonly chainFirst?: boolean;
}

/** Prend la tête de chaîne d'audit (verrou de transaction, jamais de session). */
export async function lockAuditChainHead(tx: pg.ClientBase): Promise<void> {
  await tx.query(AUDIT_CHAIN_HEAD_LOCK_SQL);
}

/** Membre du staff : identifiant, empreinte de session (élevée sauf mention), portée pays. */
export interface StaffActor {
  readonly userId: string;
  readonly hash: Buffer;
  readonly scope: readonly string[];
}

export interface Outcome {
  readonly outcome: string;
  readonly request_id: string | null;
}

/** Empreinte d'un nouveau jeton (SHA-256), comme la base la reçoit. */
export const newHash = (): Buffer => createHash('sha256').update(randomBytes(32)).digest();

/** Pose le contexte STAFF de `who` (ou un acteur forgé `actorId`) dans la transaction courante. */
export async function asStaff(
  tx: pg.ClientBase,
  who: StaffActor,
  actorId: string = who.userId,
): Promise<void> {
  await setSessionContext(tx, {
    kind: 'STAFF',
    actorId,
    countryScope: who.scope,
    sessionTokenHash: who.hash.toString('hex'),
  });
}

/** Demande, dans la transaction courante, sous le contexte de `who`. */
export async function requestSwitch(
  tx: pg.ClientBase,
  who: StaffActor,
  key: string,
  country: string,
  value: boolean,
  options: {
    readonly id?: string;
    readonly decision?: string;
    readonly actorId?: string;
  } & LockOrder = {},
): Promise<Outcome> {
  if (options.chainFirst !== false) await lockAuditChainHead(tx);
  await asStaff(tx, who, options.actorId);
  const { rows } = await tx.query<Outcome>(REQUEST_SQL, [
    who.hash,
    options.id ?? randomUUID(),
    key,
    country,
    value,
    options.decision ?? DECISION,
  ]);
  return rows[0] ?? { outcome: '', request_id: null };
}

/** Approbation, dans la transaction courante, sous le contexte de `who`. */
/** Annulation d'une demande en attente, sous le contexte de `who`. */
export async function cancelSwitch(
  tx: pg.ClientBase,
  who: StaffActor,
  requestId: string,
  order: LockOrder = {},
): Promise<Outcome> {
  if (order.chainFirst !== false) await lockAuditChainHead(tx);
  await asStaff(tx, who);
  const { rows } = await tx.query<Outcome>(CANCEL_SQL, [who.hash, requestId]);
  return rows[0] ?? { outcome: '', request_id: null };
}

export async function approveSwitch(
  tx: pg.ClientBase,
  who: StaffActor,
  requestId: string,
  actorId?: string,
  order: LockOrder = {},
): Promise<Outcome> {
  if (order.chainFirst !== false) await lockAuditChainHead(tx);
  await asStaff(tx, who, actorId);
  const { rows } = await tx.query<Outcome>(APPROVE_SQL, [who.hash, requestId]);
  return rows[0] ?? { outcome: '', request_id: null };
}

export async function goLive(tx: pg.ClientBase, key: string, country: string): Promise<boolean> {
  const { rows } = await tx.query<{ on: boolean }>('SELECT core.config_go_live($1, $2) AS "on"', [
    key,
    country,
  ]);
  return rows[0]?.on === true;
}

/** Session élevée (TOTP) neuve de `userId`, ouverte à l'instant (virtuel) de la transaction. */
export async function freshSession(tx: pg.ClientBase, who: StaffActor): Promise<StaffActor> {
  const hash = newHash();
  await tx.query('SELECT test_fixture.iam_open_elevated_session($1, $2)', [who.userId, hash]);
  return { ...who, hash };
}

/**
 * Base de TEST seulement : ouvre `key` à true dans `country` à l'instant virtuel `from` (demande de
 * `requester`, approbation de `approver`, validées), puis le referme à false à `to` par la même
 * procédure à deux personnes. Rend la fenêtre [from, to) ; hors de cette fenêtre, la valeur reste
 * false pour tout lecteur. `from` doit être loin de toute date lue par les autres preuves.
 *
 * Pourquoi pas une transaction annulée : le cas passant S-04 lit l'interrupteur sous app_worker
 * (`payment_command`) alors que les commandes à deux personnes ne s'exécutent que sous app_api ;
 * une valeur non validée d'une connexion est invisible de l'autre. La fermeture à false est
 * TOUJOURS tentée (`finally`), même si l'ouverture échoue, AVANT que l'appelant ne lise la
 * fenêtre : un échec du test qui suit ne peut donc pas laisser l'interrupteur ouvert. Si la
 * fermeture échoue, la fonction lève (le test échoue) au lieu de continuer.
 */
export async function openSwitchWindow(
  api: pg.ClientBase,
  requester: StaffActor,
  approver: StaffActor,
  key: SwitchKey,
  country: string,
  from: string,
  to: string,
): Promise<void> {
  const twoPeople = (at: string, value: boolean): Promise<void> =>
    withTestTransaction(api, { virtualNow: at, commit: true }, async (tx) => {
      const req = await freshSession(tx, requester);
      const app = await freshSession(tx, approver);
      const r = await requestSwitch(tx, req, key, country, value);
      // fermeture d'une fenêtre qui ne s'est pas ouverte : rien à refermer (NO_CHANGE)
      if (!value && r.outcome === 'NO_CHANGE') return;
      if (r.outcome !== 'REQUESTED' || r.request_id === null) {
        throw new Error(`demande d'interrupteur : ${r.outcome}`);
      }
      const a = await approveSwitch(tx, app, r.request_id);
      if (a.outcome !== 'APPLIED') throw new Error(`approbation d'interrupteur : ${a.outcome}`);
    });
  let opening: unknown = null;
  try {
    await twoPeople(from, true);
  } catch (error) {
    opening = error;
  }
  // fermeture à false par la même procédure, quoi qu'il arrive à l'ouverture
  await twoPeople(to, false);
  const closed = await withTestTransaction(api, { virtualNow: to }, (tx) =>
    goLive(tx, key, country),
  );
  if (closed) throw new Error(`interrupteur ${key} resté ouvert à ${to}`);
  if (opening !== null) throw opening;
}

/**
 * Base de TEST seulement : referme `key` à false dans `country` à l'instant virtuel `at` par la
 * procédure à deux personnes, quel que soit l'état laissé par une course (déjà false : rien ;
 * fermeture en attente : approuvée par une personne autre que son demandeur). Vérifie ensuite que
 * la valeur vaut false à `at` ; lève sinon.
 */
export async function ensureClosed(
  api: pg.ClientBase,
  a: StaffActor,
  b: StaffActor,
  key: SwitchKey,
  country: string,
  at: string,
): Promise<void> {
  await withTestTransaction(api, { virtualNow: at, commit: true }, async (tx) => {
    const sa = await freshSession(tx, a);
    const sb = await freshSession(tx, b);
    const r = await requestSwitch(tx, sa, key, country, false);
    if (r.outcome === 'NO_CHANGE') return;
    if (r.request_id === null) throw new Error(`fermeture : ${r.outcome}`);
    // REQUESTED (la nôtre, demandée par a) ou ALREADY_PENDING (une fermeture d'un tiers)
    let applied = (await approveSwitch(tx, sb, r.request_id)).outcome;
    if (applied === 'SELF_APPROVAL') applied = (await approveSwitch(tx, sa, r.request_id)).outcome;
    if (applied !== 'APPLIED') throw new Error(`fermeture : ${r.outcome} puis ${applied}`);
  });
  const open = await withTestTransaction(api, { virtualNow: at }, (tx) => goLive(tx, key, country));
  if (open) throw new Error(`interrupteur ${key} resté ouvert à ${at}`);
}

/** Jours de la plage des instants lointains (années 2500 à 2900). */
const FAR_DAYS = 400 * 365;

/**
 * Instant virtuel lointain (années 2500 à 2900) : minuit UTC d'un jour JAMAIS rendu à une autre
 * série de cette base (compteur unique de test, N-186). Les fenêtres posées depuis cet instant
 * (deux heures au plus) ne chevauchent donc jamais celle d'une autre série, par construction (le
 * tirage au hasard d'un jour sur 146 000 ne l'excluait pas).
 */
export async function farInstant(client: pg.ClientBase, offsetMinutes = 0): Promise<string> {
  const day = await uniqueSerial(client);
  if (day >= BigInt(FAR_DAYS)) throw new Error(`compteur unique ${String(day)} hors des 400 ans`);
  const base = Date.UTC(2500, 0, 1) + Number(day) * 86_400_000;
  return new Date(base + offsetMinutes * 60_000).toISOString();
}

/** `iso` décalé de `minutes`. */
export const plusMinutes = (iso: string, minutes: number): string =>
  new Date(Date.parse(iso) + minutes * 60_000).toISOString();

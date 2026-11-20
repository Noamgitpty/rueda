/**
 * T1 sur le compte marchand FAKE du pays, sans course entre fichiers de test (constat C-1 de la
 * passation US-221).
 *
 * T1 (`booking_cmd_checkout_pay`, 0116) retient le premier compte marchand ACTIVE du pays, dans
 * l'ordre `(environment = 'LIVE') DESC, provider, id`. Les scènes de
 * `concurrence-webhook.int.test.ts`, exécuté en parallèle, VALIDENT le temps d'un test un compte
 * ACTIVE BAC ou EBANX du même pays, puis le suspendent. Ces noms passent avant FAKE, et ces
 * fournisseurs n'ont aucune capacité validée : T1 y rendrait HOST_PAYOUT_RAIL_UNAVAILABLE. C'est une
 * course entre fichiers de test, pas un défaut du produit.
 */
import type pg from 'pg';

/**
 * Empreinte des comptes marchands du pays, lue sur `worker` (connexion app_worker distincte de la
 * transaction de l'essai, donc données validées seulement). Vaut `null` si aucun compte FAKE n'est
 * ACTIVE ou si un compte ACTIVE d'un autre fournisseur est ouvert. Sinon : identifiant, statut et
 * `xmin` de chaque compte NON FAKE du pays.
 *
 * Les comptes ne sont jamais supprimés (aucun DELETE accordé aux rôles applicatifs) : toute création
 * ou mise à jour validée d'un compte non FAKE change cette empreinte (nouvel identifiant ou nouveau
 * `xmin`), même si son statut revient ensuite à SUSPENDED.
 */
export async function onlyFakeActive(
  worker: pg.ClientBase,
  country: string,
): Promise<string | null> {
  const { rows } = await worker.query<{ id: string; provider: string; status: string; v: string }>(
    `SELECT id, provider, status, xmin::text AS v FROM core.payment_psp_account
      WHERE country_code = $1 ORDER BY id`,
    [country],
  );
  const active = rows.filter((r) => r.status === 'ACTIVE');
  if (!active.some((r) => r.provider === 'FAKE')) return null;
  if (active.some((r) => r.provider !== 'FAKE')) return null;
  return rows
    .filter((r) => r.provider !== 'FAKE')
    .map((r) => `${r.id}:${r.status}:${r.v}`)
    .join(',');
}

export interface FakeAccountAttempt<T> {
  /** Transaction de l'essai (annulée ou validée par l'appelant après l'essai retenu). */
  readonly tx: pg.ClientBase;
  /** Connexion app_worker de lecture des comptes, distincte de `tx`. */
  readonly worker: pg.ClientBase;
  readonly country: string;
  /** Ordres reçus par le PSP FAKE : ceux d'un essai annulé en sont retirés. */
  readonly orders: unknown[];
  /** Nom du point de sauvegarde de l'essai. */
  readonly savepoint: string;
  readonly attempt: () => Promise<T>;
  /** Diagnostic ajouté au message si le compte FAKE ne reste jamais seul actif. */
  readonly diagnostic?: () => Promise<string>;
}

/**
 * Essai de T1 retenu (réussite OU refus) seulement si l'empreinte `onlyFakeActive`, lue JUSTE AVANT
 * lui, n'est pas nulle et que, lue JUSTE APRÈS lui, elle est IDENTIQUE. Aucun compte non FAKE n'a
 * alors été créé, ouvert ni modifié pendant l'essai : la lecture des comptes de T1, faite entre les
 * deux, n'a vu que FAKE comme compte ACTIVE.
 *
 * Une vérification « avant » seule laisse passer un compte ouvert entre elle et T1. Comparer
 * seulement le fournisseur en tête laisse passer un compte ouvert PUIS suspendu pendant l'essai.
 *
 * Sinon l'essai est annulé par son point de sauvegarde et rejoué (au plus 60 s). Un essai annulé
 * retire aussi du PSP FAKE les ordres qu'il lui a envoyés : rejoué depuis le point de sauvegarde, il
 * renvoie le MÊME ordre (même clé d'idempotence), qu'un PSP réel dédoublonne. Le résultat retenu est
 * affirmé tel quel par l'appelant.
 */
export async function onFakeAccount<T>(
  o: FakeAccountAttempt<T>,
): Promise<{ ok: true; value: T } | { ok: false; error: unknown }> {
  for (let i = 0; i < 240; i++) {
    const before = await onlyFakeActive(o.worker, o.country);
    if (before !== null) {
      await o.tx.query(`SAVEPOINT ${o.savepoint}`);
      const sent = o.orders.length;
      let out: { ok: true; value: T } | { ok: false; error: unknown };
      try {
        out = { ok: true, value: await o.attempt() };
      } catch (error) {
        out = { ok: false, error };
      }
      if ((await onlyFakeActive(o.worker, o.country)) === before) {
        await o.tx.query(
          out.ok ? `RELEASE SAVEPOINT ${o.savepoint}` : `ROLLBACK TO SAVEPOINT ${o.savepoint}`,
        );
        return out;
      }
      await o.tx.query(`ROLLBACK TO SAVEPOINT ${o.savepoint}`);
      o.orders.splice(sent);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const why = o.diagnostic === undefined ? '' : ` : ${await o.diagnostic()}`;
  throw new Error(`le compte FAKE n'est jamais resté seul actif${why}`);
}

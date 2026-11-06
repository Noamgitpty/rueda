lot: L0
module: Argent (red team)

- Ajouté : tests d'attaque de la red team « argent » de la porte du lot 0, joués sous les rôles de production en USD et en PYG (`packages/db/test/l0/redteam-argent-*.test.ts`) : arrondis PYG, débordement bigint, devise croisée, Money forgé, règlement rejoué ou concurrent (EC-54), supersession, jambes falsifiées, clé d'idempotence réutilisée, remboursement hors règlement, versement avant la fin du trajet, détention de fonds et FAKE en production ; un test rouge est une faille, consignée dans `docs/team/redteam/L0-argent.md` (US-049)

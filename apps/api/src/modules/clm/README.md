# CLM — Claims & Disputes (`apps/api/src/modules/clm`)

**CLM — Claims & Disputes** : dommages et incidents, factures annexes, litiges, dossiers de preuve, décisions. Dépendances autorisées : TRP, STL, PAY, AUD (socle implicite : CFG, AUD, BUS ; source : 17 §2.2 ; §2.1 CLM --> TRP, STL).

## Responsabilité

CLM traite ce qui arrive pendant ou après un trip : déclarations de dommage et d'incident (SM-4), factures annexes (SM-5), débits de dommage conformes aux réseaux et leurs jambes (08 BR-PAY-09 bis), litiges (SM-7), dossiers de preuve exportables, décisions motivées (17 §2.2, §3.2.11). Une partie est manuelle en Bêta.

CLM ne calcule pas le règlement (STL, nouvelle version sur décision) et n'exécute aucun débit (PAY).

État réel : **squelette** : rien d'implémenté. `ClmModule` est vide et `internal/` est vide (US-001). Le dossier de preuve arrive avec US-308, les dommages, incidents et décisions avec US-309 et US-528, les sinistres entre particuliers avec US-318, les débits post-trip avec US-703.

## Entités

Toutes les entités de 17 §3.2.11 sont **cibles 17, pas encore créées** : `claim`, `incident_report`, `incidental_invoice`, `damage_charge`, `dispute`, `decision`, `evidence_bundle`.

## Événements

Émis (cible 17 §4.5) : `claim.status_changed`, `invoice.status_changed`, `dispute.opened` / `.decided`, `evidence.bundle.generated`. **Aucun n'est émis aujourd'hui.**

Consommés (cible 17 §4.5) : `settlement.computed` (STL), `payment.chargeback.opened` / `.closed` et `deposit.decision.executed` (PAY), `trip.checkin.validated` (TRP, photos de départ). Aucun consommateur n'est branché.

## Ports

Aucun port. `index.ts` n'exporte que `ClmModule`.

## Commandes de test

- Unitaires : aucun test du module pour l'instant. Commande : `pnpm --filter @rueda/api exec vitest run --passWithNoTests src/modules/clm`.
- Intégration et preuves L0 : aucun test du module, faute de table.

`test:int` et `test:l0` demanderont PostgreSQL : guide `docs/ops/INSTALL.md` (compose de dev) ou `RUEDA_PG_TESTCONTAINERS=1` (Docker) ; variables dans `packages/db/README.md`, section « Commandes ».

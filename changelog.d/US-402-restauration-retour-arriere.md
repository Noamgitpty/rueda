lot: L4
module: Exploitation et reprise

- Ajouté : garde de reprise en base (migration 0185, ADR-206 PROPOSÉ) ; une base restaurée est détectée par le changement de ligne de temps de PostgreSQL, ou par une garde posée à la main ; tant que la garde est active, aucune tâche n'est réclamée et rien n'est réémis (débits, remboursements, débits MIT, versements, avis, files périodiques) (US-402)
- Ajouté : levée de la garde par l'exploitation (`release-cli.ts`, sous `migrator`) seulement après un rapprochement attesté avec le PSP, et dans la fenêtre d'idempotence du PSP (hypothèse H-IDEM, 24 h PROPOSÉE) ; au-delà, un relevé complet du PSP depuis l'instant restauré est exigé (US-402)
- Ajouté : la vérification d'une base restaurée affiche l'état de la garde et l'inventaire de ce qui attend d'être émis (comptes seulement) (US-402)
- Ajouté : répétition du retour arrière à travers de vraies migrations ; l'image N−1 est resservie sur le schéma N sans migration descendante (US-402)
- Ajouté : rapport de restauration `docs/ops/RESTORE_REPORT.md` (environnement mesuré, six mesures RPO / RTO comparées à la référence, ce qui reste en attente du fondateur) (US-402)
- Sécurité : aucun rôle applicatif ne lève la garde ni ne lit ses tables ; gardes en ajout seul (US-402)

lot: L0
module: Exploitation (sauvegarde, restauration, secrets)

- Ajouté : exercice de restauration chronométré en CI (job `restauration`) : sauvegarde de base, restauration à un instant donné et après la perte de l'instance, vérification de la base restaurée (`packages/db/src/restore`), bascule de l'application ; RTO et RPO mesurés et comparés à la référence (US-051)
- Ajouté : rotation des secrets sans coupure, répétée en CI sur l'image de production (job `rotation-secrets`) : mots de passe des rôles (`RUEDA_PGPASSWORD_NEXT`), clé de débit (`RUEDA_RATE_LIMIT_KEY_PREVIOUS`), clé de preuve MFA ; runbooks `BACKUP_RESTORE.md` et `SECRET_ROTATION.md` (US-051)

lot: L0
module: IAM

- Sécurité : clé de preuve d'élévation MFA à deux emplacements le temps d'une rotation, l'ancienne refusée après `PROMOTE` ou 24 h au plus ; gestes sous `migrator` seulement (migration 0053) (US-051)

lot: L0
module: Anti-abus

- Modifié : pendant une rotation de `RUEDA_RATE_LIMIT_KEY`, chaque événement est compté sous l'ancienne et la nouvelle empreinte : aucune limite n'est remise à zéro (US-051)

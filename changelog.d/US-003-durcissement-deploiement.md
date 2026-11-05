lot: L0
module: Déploiement

- Sécurité : la porte de déploiement en production est imposée par le code (`scripts/deploy/production-gate.mjs`, `deploy.yml`, ADR-084) ; bundle de certificats RDS dans l'image de production et droits IAM resserrés (US-003)
- Modifié : `ecs.sh` et `image-checks.sh` appliquent les contrôles de la porte avant tout déploiement ; tests OpenTofu et tests des scripts de déploiement ajoutés (US-003)

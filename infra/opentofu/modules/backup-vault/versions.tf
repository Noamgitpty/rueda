# Module « coffre de copie » (US-004, ADR-080) : le coffre AWS Backup qui reçoit, dans un compte
# DÉDIÉ aux sauvegardes et une AUTRE région, la copie quotidienne de chaque environnement (17 §6.4,
# NN10 « sauvegarde dans un autre compte »). Décrit en code, JAMAIS appliqué par un agent : le
# fondateur l'applique dans le compte de sauvegarde (docs/ops/BACKUP_RESTORE.md).
#
# Un environnement compromis ne peut ni lire, ni supprimer, ni raccourcir les copies : il n'a que
# le droit de COPIER dans ce coffre (politique du coffre) ; les points de restauration sont
# verrouillés (min_retention_days) et leur suppression refusée à tous (politique du coffre).
terraform {
  required_version = ">= 1.13.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "= 6.66.0"
    }
  }
}

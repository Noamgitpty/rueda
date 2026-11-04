#!/usr/bin/env bash
# Sauvegarde de BASE d'une instance PostgreSQL de la préproduction locale (US-051, ADR-082 ;
# runbook docs/ops/BACKUP_RESTORE.md, « Exercice de restauration »). Équivalent local de
# l'instantané quotidien du service géré : copie physique de l'instance (toutes les bases, rôles
# et droits compris) par `pg_basebackup`, journaux de transactions inclus (-X stream), manifeste
# SHA-256 vérifié par `pg_verifybackup`. Les journaux suivants sont archivés en continu par
# l'instance elle-même (`archive_command` vers le volume d'archive) : ensemble, ils permettent la
# restauration à un instant donné (scripts/ops/pg-restore.sh).
#
#   bash scripts/ops/pg-backup.sh <conteneur> <étiquette>
#
# La sauvegarde est écrite dans /backups/<étiquette> du conteneur (volume des sauvegardes). Aucun
# secret : connexion locale de l'instance (socket Unix, utilisateur `postgres` du conteneur).
set -euo pipefail

container="${1:?conteneur PostgreSQL attendu}"
label="${2:?étiquette de sauvegarde attendue}"
[[ "$label" =~ ^[a-z0-9][a-z0-9-]{0,62}$ ]] || {
  echo "[sauvegarde] étiquette invalide : $label" >&2
  exit 1
}

started=$(date +%s)
if docker exec -u postgres "$container" test -e "/backups/$label"; then
  echo "[sauvegarde] /backups/$label existe déjà : une sauvegarde n'est jamais écrasée" >&2
  exit 1
fi
docker exec -u postgres "$container" pg_basebackup -h /var/run/postgresql -U postgres \
  -D "/backups/$label" -Fp -X stream -c fast --manifest-checksums=SHA256 -l "$label"
docker exec -u postgres "$container" pg_verifybackup "/backups/$label"
echo "[sauvegarde] $label vérifiée en $(($(date +%s) - started)) s"

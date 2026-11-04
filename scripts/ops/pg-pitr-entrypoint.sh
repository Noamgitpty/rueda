#!/usr/bin/env bash
# Point d'entrée d'une instance RESTAURÉE (US-051, ADR-082) : lancé par scripts/ops/pg-restore.sh
# dans un conteneur postgres:16 NEUF (volume de données vide). Copie la sauvegarde de base, pose la
# récupération (journaux archivés, instant cible ou « au plus récent »), puis démarre PostgreSQL
# par le point d'entrée officiel de l'image (la base n'est pas réinitialisée : PG_VERSION existe).
#
# Variables : RUEDA_BACKUP_LABEL (sauvegarde de base), RUEDA_RESTORE_TARGET_TIME (instant UTC,
# vide = au plus récent). Volumes : /backups et /wal-archive, en lecture seule.
set -euo pipefail

label="${RUEDA_BACKUP_LABEL:?}"
target="${RUEDA_RESTORE_TARGET_TIME:-}"
data="${PGDATA:-/var/lib/postgresql/data}"

if [ ! -s "$data/PG_VERSION" ]; then
  if [ ! -s "/backups/$label/PG_VERSION" ]; then
    echo "[restauration] sauvegarde absente : /backups/$label" >&2
    exit 1
  fi
  cp -a "/backups/$label/." "$data/"
  rm -f "$data/backup_manifest" "$data/postmaster.pid"
  {
    echo "# US-051 : restauration depuis la sauvegarde $label et les journaux archivés"
    echo "restore_command = 'cp /wal-archive/%f %p'"
    echo "recovery_target_action = 'promote'"
    echo "archive_mode = 'off'"
    if [ -n "$target" ]; then
      echo "recovery_target_time = '$target'"
      echo "recovery_target_inclusive = 'true'"
    fi
  } >>"$data/postgresql.auto.conf"
  touch "$data/recovery.signal"
  chown -R postgres:postgres "$data"
  chmod 0700 "$data"
fi
exec docker-entrypoint.sh postgres "$@"

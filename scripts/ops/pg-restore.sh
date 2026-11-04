#!/usr/bin/env bash
# Restauration dans une NOUVELLE instance (US-051, ADR-082 ; runbook docs/ops/BACKUP_RESTORE.md) :
# jamais par-dessus l'instance en service. Équivalent local de « restaurer l'instance à cet instant
# sous un nouvel identifiant » du service géré : sauvegarde de base + journaux archivés, rejoués
# jusqu'à l'instant cible (ou jusqu'au dernier journal archivé), puis promotion.
#
#   bash scripts/ops/pg-restore.sh <étiquette> <nouveau-conteneur> <port> [instant UTC]
#
# Volumes : RUEDA_BACKUP_VOLUME (sauvegardes) et RUEDA_WAL_VOLUME (journaux archivés), montés en
# LECTURE SEULE. La nouvelle instance publie son port sur 127.0.0.1 seulement. Code 0 quand elle
# est promue et accepte les connexions ; sinon les dernières lignes de son journal (celui du
# serveur, sans secret) sont affichées et le code est 1 (par exemple : instant cible au-delà des
# journaux archivés).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
label="${1:?étiquette de sauvegarde attendue}"
name="${2:?nom du nouveau conteneur attendu}"
port="${3:?port attendu}"
target="${4:-}"
backups="${RUEDA_BACKUP_VOLUME:?RUEDA_BACKUP_VOLUME attendue}"
wal="${RUEDA_WAL_VOLUME:?RUEDA_WAL_VOLUME attendue}"
timeout_s="${RUEDA_RESTORE_TIMEOUT_S:-600}"

if docker container inspect "$name" >/dev/null 2>&1; then
  echo "[restauration] le conteneur $name existe déjà : toujours une NOUVELLE instance" >&2
  exit 1
fi
started=$(date +%s)
docker run -d --name "$name" -p "127.0.0.1:$port:5432" \
  -v "$backups:/backups:ro" -v "$wal:/wal-archive:ro" -v "$name-data:/var/lib/postgresql/data" \
  -v "$ROOT/scripts/ops/pg-pitr-entrypoint.sh:/opt/rueda/pitr-entrypoint.sh:ro" \
  -e RUEDA_BACKUP_LABEL="$label" -e RUEDA_RESTORE_TARGET_TIME="$target" \
  --entrypoint bash postgres:16 /opt/rueda/pitr-entrypoint.sh \
  -c track_commit_timestamp=on >/dev/null

while :; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then
    docker logs "$name" 2>&1 | tail -n 40 >&2
    echo "[restauration] ÉCHEC : l'instance $name s'est arrêtée" >&2
    exit 1
  fi
  state="$(docker exec -u postgres "$name" psql -h /var/run/postgresql -U postgres -Atc \
    'SELECT pg_is_in_recovery()' 2>/dev/null || true)"
  [ "$state" = f ] && break
  if [ $(($(date +%s) - started)) -ge "$timeout_s" ]; then
    docker logs "$name" 2>&1 | tail -n 40 >&2
    echo "[restauration] ÉCHEC : instance non promue après ${timeout_s} s" >&2
    exit 1
  fi
  sleep 1
done
echo "[restauration] $name promue (${target:-au plus récent}) en $(($(date +%s) - started)) s, port $port"

#!/usr/bin/env bash
# EXERCICE DE RESTAURATION chronométré (US-051, ADR-082 ; 19 US-051 critères 1, 2 et 4 ; 17 §6.4).
# Job CI « reprise » ; rejouable sur un poste avec Docker, bash, curl, Node et pnpm (dépendances
# installées, `pnpm --filter @rueda/api... build` fait pour la bascule).
#
#   1. instance source PostgreSQL 16 en conteneur, journaux de transactions ARCHIVÉS en continu
#      (archive_command vers un volume, archive_timeout 30 s : l'équivalent local des sauvegardes
#      automatiques et des journaux du service géré) ; sauvegardes dans un second volume ;
#   2. `pnpm --filter @rueda/db test:drill` : préproduction peuplée (PA, PY), puis les étapes de
#      docs/ops/BACKUP_RESTORE.md exécutées TELLES QU'ÉCRITES (sauvegarde, restauration à
#      l'instant T puis au plus récent après la perte de l'instance, vérification, bascule de
#      l'application), chronométrées ; RTO et RPO mesurés (packages/db/test/drill/) ;
#   3. rapport JSON dans $RUEDA_DRILL_REPORT (artefact de la CI) ; tout est détruit à la fin ;
#   4. exercice de portabilité (US-036, ADR-120) : scripts/ops/portability-drill.sh, ses propres
#      instances source et cible, détruites à la fin (aucun artefact).
#
# Secrets : mot de passe d'administration TIRÉ AU HASARD pour l'exercice, dans un dossier 0700 et
# un volume Docker ; mots de passe des rôles tirés par l'exercice ; rien n'est affiché.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PREFIX="${RUEDA_DRILL_PREFIX:-rueda-drill}"
SOURCE="$PREFIX-source"
BACKUPS="$PREFIX-backups"
WAL="$PREFIX-wal"
SECRETS="$PREFIX-secrets"
PORT="${RUEDA_DRILL_PG_PORT:-55432}"
REPORT="${RUEDA_DRILL_REPORT:-$ROOT/infra/local/.journal/restore-drill.json}"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
mkdir -m 700 "$WORK/secrets" "$WORK/serve"

say() { printf '\n[exercice] %s\n' "$*"; }
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    for c in "$SOURCE" "$PREFIX-restore-a" "$PREFIX-restore-b"; do
      docker logs --tail 40 "$c" >&2 2>&1 || true
    done
    tail -n 40 "$WORK/serve/api.log" "$WORK/serve/worker.log" >&2 2>/dev/null || true
  fi
  RUEDA_SECRETS_DIR="$WORK/secrets" RUEDA_SERVE_DIR="$WORK/serve" \
    bash scripts/ops/serve-local.sh stop >/dev/null 2>&1 || true
  for c in "$SOURCE" "$PREFIX-restore-a" "$PREFIX-restore-b"; do
    docker rm -f -v "$c" >/dev/null 2>&1 || true
  done
  docker volume rm -f "$BACKUPS" "$WAL" "$SECRETS" "$PREFIX-restore-a-data" \
    "$PREFIX-restore-b-data" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup_prior() {
  for c in "$SOURCE" "$PREFIX-restore-a" "$PREFIX-restore-b"; do
    docker rm -f -v "$c" >/dev/null 2>&1 || true
  done
  docker volume rm -f "$BACKUPS" "$WAL" "$SECRETS" "$PREFIX-restore-a-data" \
    "$PREFIX-restore-b-data" >/dev/null 2>&1 || true
}

say '1. instance source (journaux archivés en continu)'
cleanup_prior
(
  umask 077
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WORK/secrets/postgres"
)
docker volume create "$BACKUPS" >/dev/null
docker volume create "$WAL" >/dev/null
docker volume create "$SECRETS" >/dev/null
docker run --rm -i -v "$BACKUPS:/backups" -v "$WAL:/wal-archive" -v "$SECRETS:/run/rueda-secrets" \
  postgres:16 sh -c 'cat > /run/rueda-secrets/postgres && chown postgres:postgres \
    /run/rueda-secrets/postgres /backups /wal-archive && chmod 0400 /run/rueda-secrets/postgres' \
  <"$WORK/secrets/postgres"
docker run -d --name "$SOURCE" -p "127.0.0.1:$PORT:5432" \
  -e POSTGRES_DB=rueda -e POSTGRES_PASSWORD_FILE=/run/rueda-secrets/postgres \
  -v "$SECRETS:/run/rueda-secrets:ro" -v "$BACKUPS:/backups" -v "$WAL:/wal-archive" \
  postgres:16 -c wal_level=replica -c archive_mode=on -c archive_timeout=30 \
  -c 'archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f' >/dev/null
for i in $(seq 1 60); do
  docker exec -u postgres "$SOURCE" pg_isready -h 127.0.0.1 -d rueda >/dev/null 2>&1 && break
  [ "$i" -lt 60 ] || {
    docker logs "$SOURCE" 2>&1 | tail -n 30 >&2
    exit 1
  }
  sleep 1
done

say '2. exercice (runbook docs/ops/BACKUP_RESTORE.md, exécuté tel quel)'
RUEDA_DRILL_WORK="$WORK" RUEDA_DRILL_PG_PORT="$PORT" RUEDA_DRILL_PREFIX="$PREFIX" \
  RUEDA_PG_CONTAINER="$SOURCE" RUEDA_BACKUP_VOLUME="$BACKUPS" RUEDA_WAL_VOLUME="$WAL" \
  pnpm --filter @rueda/db test:drill

say '3. rapport'
mkdir -p "$(dirname "$REPORT")"
cp "$WORK/report.json" "$REPORT"
cat "$REPORT"
say 'exercice de restauration vert'

say '4. exercice de portabilité (US-036 : changement d’hébergeur, docs/ops/PORTABILITY.md)'
bash scripts/ops/portability-drill.sh

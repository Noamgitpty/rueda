#!/usr/bin/env bash
# Bascule de l'application sur une instance (US-051 ; runbook docs/ops/BACKUP_RESTORE.md, étape
# « Basculer ») : démarre l'API et le travailleur COMPILÉS (apps/api/dist, `pnpm build`) sur
# l'instance désignée par PGHOST / PGPORT / PGDATABASE, sous leurs rôles de production, puis attend
# que l'API réponde et que le travailleur ait démarré. Équivalent local de la nouvelle révision des
# tâches avec PGHOST changé (docs/ops/DEPLOY.md, scripts/deploy/ecs.sh).
#
#   bash scripts/ops/serve-local.sh start
#   bash scripts/ops/serve-local.sh stop
#
# Mots de passe lus dans RUEDA_SECRETS_DIR/<rôle> (fichiers 0600, jamais affichés). PID et
# journaux dans RUEDA_SERVE_DIR. Port de l'API : RUEDA_SERVE_PORT (défaut 3310).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
secrets="${RUEDA_SECRETS_DIR:?RUEDA_SECRETS_DIR attendue}"
dir="${RUEDA_SERVE_DIR:?RUEDA_SERVE_DIR attendue}"
port="${RUEDA_SERVE_PORT:-3310}"
timeout_s="${RUEDA_SERVE_TIMEOUT_S:-120}"

stop() {
  for p in api worker; do
    if [ -s "$dir/$p.pid" ]; then
      kill "$(cat "$dir/$p.pid")" 2>/dev/null || true
      rm -f "$dir/$p.pid"
    fi
  done
}

alive() { kill -0 "$(cat "$dir/$1.pid")" 2>/dev/null; }

healthy() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/brand/content?locale=es")" = 200 ] &&
    grep -q '"event":"worker.started"' "$dir/worker.log"
}

start() {
  stop
  : "${PGHOST:?PGHOST attendue}" "${PGPORT:?PGPORT attendue}" "${PGDATABASE:?PGDATABASE attendue}"
  mkdir -p "$dir"
  (
    cd "$ROOT"
    PGUSER=app_api PGPASSWORD="$(cat "$secrets/app_api")" RUEDA_ENV=preproduction PORT="$port" \
      nohup node apps/api/dist/main.js >"$dir/api.log" 2>&1 &
    echo $! >"$dir/api.pid"
    PGUSER=app_worker PGPASSWORD="$(cat "$secrets/app_worker")" RUEDA_ENV=preproduction \
      RUEDA_BRAND_NAME="${RUEDA_BRAND_NAME:-Kmino}" \
      nohup node apps/api/dist/worker.js >"$dir/worker.log" 2>&1 &
    echo $! >"$dir/worker.pid"
  )
  local waited=0
  until healthy; do
    for p in api worker; do
      if ! alive "$p"; then
        tail -n 30 "$dir/$p.log" >&2
        echo "[bascule] ÉCHEC : $p arrêté" >&2
        exit 1
      fi
    done
    if [ "$waited" -ge "$timeout_s" ]; then
      tail -n 30 "$dir/api.log" "$dir/worker.log" >&2
      echo "[bascule] ÉCHEC : application non prête après ${timeout_s} s" >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "[bascule] API saine (port $port) et travailleur démarré sur $PGHOST:$PGPORT/$PGDATABASE"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  *)
    echo 'usage : serve-local.sh start | stop' >&2
    exit 1
    ;;
esac

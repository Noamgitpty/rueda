#!/usr/bin/env bash
# Redéploiement PAR VAGUES de la préproduction locale, MÊME IMAGE (US-051, ADR-082 ; runbook
# docs/ops/SECRET_ROTATION.md, étape « Redéployer ») : chaque instance relit ses secrets au
# démarrage. Équivalent local du déploiement continu du service cloud (deux tâches derrière le
# répartiteur, 100 % de tâches saines gardées) :
#
#   pour api puis api-b : retrait de la cible (le répartiteur — scripts/ops/probe.mjs — ne lui
#   envoie plus rien), redémarrage, attente de la santé, remise en service ; puis le travailleur
#   (aucun trafic : ses tâches reprennent au démarrage, ADR-050).
#
#   bash scripts/ops/roll-local.sh
#
# Variables : RUEDA_IMAGE (image servie, rueda-local:<empreinte>), RUEDA_PROBE_TARGETS (fichier
# des cibles en service), RUEDA_LOCAL_API_PORT / RUEDA_LOCAL_API_B_PORT. Aucun secret lu ici.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/infra/local/compose.yaml" --profile rotation)
targets="${RUEDA_PROBE_TARGETS:?RUEDA_PROBE_TARGETS attendue}"
: "${RUEDA_IMAGE:?RUEDA_IMAGE attendue}"
timeout_s="${RUEDA_DEPLOY_TIMEOUT_S:-120}"
declare -A PORT=([api]="${RUEDA_LOCAL_API_PORT:-3300}" [api-b]="${RUEDA_LOCAL_API_B_PORT:-3301}")

say() { printf '[vagues] %s\n' "$*"; }
url() { printf 'http://127.0.0.1:%s' "${PORT[$1]}"; }

set_targets() {
  local tmp="$targets.tmp"
  printf '%s\n' "$@" >"$tmp"
  mv "$tmp" "$targets"
}

healthy() {
  local id
  id="$("${COMPOSE[@]}" ps -q "$1")"
  [ -n "$id" ] && [ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")" = healthy ]
}

wait_healthy() {
  local waited=0
  until healthy "$1"; do
    [ "$waited" -lt "$timeout_s" ] || {
      "${COMPOSE[@]}" logs --no-color --tail 30 "$1" >&2
      say "ÉCHEC : $1 non saine après ${timeout_s} s"
      exit 1
    }
    sleep 2
    waited=$((waited + 2))
  done
}

for svc in api api-b; do
  other=api
  [ "$svc" = api ] && other=api-b
  set_targets "$(url "$other")"
  say "$svc retirée du service ($other sert seule)"
  sleep 1 # requêtes en vol terminées
  "${COMPOSE[@]}" up -d --no-deps --force-recreate "$svc" >/dev/null
  wait_healthy "$svc"
  set_targets "$(url api)" "$(url api-b)"
  say "$svc redémarrée, saine, remise en service"
done
"${COMPOSE[@]}" up -d --no-deps --force-recreate worker >/dev/null
# travailleur sain : le NOUVEAU conteneur a journalisé son démarrage (rôle vérifié, garde C19,
# files déclarées : worker.started) et tourne toujours (un redémarrage en boucle échoue)
id="$("${COMPOSE[@]}" ps -q worker)"
waited=0
until docker logs "$id" 2>&1 | grep -cF '"event":"worker.started"' >/dev/null; do
  if [ "$(docker inspect -f '{{.State.Running}}' "$id")" != true ] || [ "$waited" -ge "$timeout_s" ]; then
    docker logs --tail 30 "$id" >&2
    say 'ÉCHEC : travailleur non démarré'
    exit 1
  fi
  sleep 1
  waited=$((waited + 1))
done
[ "$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$id")" = 'true 0' ] || {
  docker logs --tail 30 "$id" >&2
  say 'ÉCHEC : travailleur arrêté après son démarrage'
  exit 1
}
say 'travailleur redémarré et démarré (worker.started)'

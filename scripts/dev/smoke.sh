#!/usr/bin/env bash
# Fumée de la pile de développement local (US-035, docs/ops/INSTALL.md étape 3).
# Prérequis : `docker compose up --build -d` lancé depuis la racine du dépôt. Docker et bash
# seulement (curl n'est pas requis : les requêtes HTTP partent du conteneur de l'API).
#
# Vérifie :
#  1. secrets-init et db-setup terminés avec le code 0 ;
#  2. graines PA / PY lisibles sous app_api et app_worker, base « development » (db-setup --verify-only) ;
#  3. API en bonne santé : GET /brand/content?locale=es => 200, GET /auth/session sans cookie => 401 ;
#  4. travailleur en marche (boucles branchées par US-003) : démarrage journalisé depuis le dernier
#     (re)démarrage du conteneur, toujours actif ;
#  5. FAKE : chacun démarre sous development et refuse production, préproduction, RUEDA_ENV absent ;
#  6. C19 : la même API lancée avec RUEDA_ENV=production refuse de démarrer.
# Aucun secret n'est lu ni affiché par ce script.
set -euo pipefail

TIMEOUT_S="${RUEDA_SMOKE_TIMEOUT_S:-300}"

say() { printf '[fumée] %s\n' "$*"; }
fail() {
  printf '[fumée] ÉCHEC : %s\n' "$*" >&2
  exit 1
}

container_of() { docker compose ps -aq "$1" | head -n 1; }

# Attend la fin d'un service ponctuel et exige le code 0.
wait_exit_zero() {
  local service="$1" id state code waited=0
  while :; do
    id="$(container_of "$service")"
    [ -n "$id" ] || fail "$service : aucun conteneur (docker compose up lancé ?)"
    state="$(docker inspect -f '{{.State.Status}}' "$id")"
    if [ "$state" = exited ]; then
      code="$(docker inspect -f '{{.State.ExitCode}}' "$id")"
      [ "$code" = 0 ] || fail "$service terminé avec le code $code (docker compose logs $service)"
      say "$service : terminé, code 0"
      return 0
    fi
    [ "$waited" -lt "$TIMEOUT_S" ] || fail "$service : toujours « $state » après ${TIMEOUT_S} s"
    sleep 2
    waited=$((waited + 2))
  done
}

wait_healthy() {
  local service="$1" id health waited=0
  while :; do
    id="$(container_of "$service")"
    [ -n "$id" ] || fail "$service : aucun conteneur"
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")"
    [ "$health" = healthy ] && {
      say "$service : en bonne santé"
      return 0
    }
    [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] ||
      fail "$service s'est arrêté (docker compose logs $service)"
    [ "$waited" -lt "$TIMEOUT_S" ] || fail "$service : « $health » après ${TIMEOUT_S} s"
    sleep 2
    waited=$((waited + 2))
  done
}

# Statut HTTP d'une requête faite depuis le conteneur de l'API (Node 26 : fetch intégré).
http_status() {
  docker compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000' + process.argv[1]).then((r) => console.log(r.status), () => console.log('erreur'))" \
    "$1"
}

# Travailleur (US-003) : démarrage journalisé (`worker.started`), puis toujours en marche.
wait_worker_running() {
  local id waited=0
  while :; do
    id="$(container_of worker)"
    [ -n "$id" ] || fail 'worker : aucun conteneur'
    [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] ||
      fail "worker arrêté (code $(docker inspect -f '{{.State.ExitCode}}' "$id"), docker compose logs worker)"
    # Journal depuis le dernier démarrage du conteneur seulement : après `docker compose start`
    # (INSTALL.md §4), un `worker.started` d'un lancement précédent ne compte pas.
    started_at="$(docker inspect -f '{{.State.StartedAt}}' "$id")"
    if docker compose logs --no-color --no-log-prefix --since "$started_at" worker |
      grep -q '"event":"worker.started"'; then
      sleep 10
      [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] ||
        fail 'worker arrêté après son démarrage (docker compose logs worker)'
      say 'worker : démarré, toujours en marche'
      return 0
    fi
    [ "$waited" -lt "$TIMEOUT_S" ] || fail "worker : démarrage non journalisé après ${TIMEOUT_S} s"
    sleep 2
    waited=$((waited + 2))
  done
}

expect_status() {
  local path="$1" expected="$2" got
  got="$(http_status "$path")"
  [ "$got" = "$expected" ] || fail "GET $path => $got (attendu $expected)"
  say "GET $path => $got"
}

wait_exit_zero secrets-init
wait_exit_zero db-setup
docker compose run --rm --no-deps db-setup node packages/db/src/dev/cli.ts --verify-only
wait_healthy api
expect_status '/brand/content?locale=es' 200
expect_status '/auth/session' 401
wait_worker_running
wait_exit_zero fakes
fakes_log="$(docker compose logs --no-color --no-log-prefix fakes)"
grep -q '"check":"bilan","ok":true' <<<"$fakes_log" ||
  fail 'fakes : bilan absent ou en échec'
say 'fakes : bilan vert'

# C19 : application « production » sur la base de développement => refus de démarrer.
# Un refus sort vite avec un code non nul ; un dépassement du délai (124) veut dire « démarrée ».
set +e
out="$(timeout 120 docker compose run --rm --no-deps -e RUEDA_ENV=production api 2>&1)"
code=$?
set -e
case "$code" in
  0 | 124 | 137) fail "API sous RUEDA_ENV=production : non refusée (code $code)" ;;
esac
# Le refus doit venir de la garde C19 (application « production », base « development »).
grep -q 'démarrage refusé (C19)' <<<"$out" ||
  fail "API sous RUEDA_ENV=production : arrêt (code $code) sans le refus C19 attendu"
say "C19 : API refusée sous RUEDA_ENV=production (code $code)"

say 'pile de développement : tout est vert'

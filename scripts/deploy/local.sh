#!/usr/bin/env bash
# Déploiement et retour arrière sur la PRÉPRODUCTION LOCALE (US-003, ADR-078 ; docs/ops/DEPLOY.md).
# Même stratégie que le pipeline cloud (.github/workflows/deploy.yml), sur infra/local/compose.yaml :
#
#   deploy <image>   job de base (migrations expand / contract, déclaration) avec la NOUVELLE image,
#                    puis bascule de l'API et du travailleur ; si l'API n'est pas en bonne santé ou si
#                    le travailleur s'arrête dans le délai, RETOUR ARRIÈRE AUTOMATIQUE sur l'image
#                    servie auparavant. Code 0 seulement si la nouvelle image est servie.
#   rollback         ressert l'image servie avant l'image courante (journal), sans migration
#                    descendante (les migrations sont compatibles avec la version N − 1).
#   status           image et version servies, d'après les conteneurs.
#   destroy          supprime l'environnement (conteneurs, base, secrets) ; le journal est gardé.
#
# Chaque étape est journalisée (scripts/deploy/journal.mjs) dans $RUEDA_DEPLOY_JOURNAL.
# <image> : identifiant immuable (sha256:…) d'une image construite par docker/prod/Dockerfile.
# Prérequis : Docker, bash, Node (journal). Aucun secret n'est lu ni affiché par ce script.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="$ROOT/infra/local/compose.yaml"
JOURNAL="${RUEDA_DEPLOY_JOURNAL:-$ROOT/infra/local/.journal/deployments.jsonl}"
ENVIRONMENT="preproduction-local"
TIMEOUT_S="${RUEDA_DEPLOY_TIMEOUT_S:-120}"
# Le travailleur doit tenir ce délai sans s'arrêter (aucune sonde HTTP : sortie = échec).
WORKER_SETTLE_S="${RUEDA_WORKER_SETTLE_S:-15}"

say() { printf '[déploiement] %s\n' "$*"; }
fail() {
  printf '[déploiement] ÉCHEC : %s\n' "$*" >&2
  exit 1
}

# Compose ne désigne pas une image par son identifiant : étiquette locale DÉRIVÉE de l'identifiant
# (rueda-local:<64 hex>), donc immuable de fait ; jamais tirée d'un registre (pull_policy: never).
compose() {
  local ref="rueda-local:${IMAGE#sha256:}"
  if [ "$IMAGE" != "$NO_IMAGE" ] && ! docker image inspect "$ref" >/dev/null 2>&1; then
    docker tag "$IMAGE" "$ref"
  fi
  RUEDA_IMAGE="$ref" docker compose -f "$COMPOSE_FILE" "$@"
}

journal() { node "$ROOT/scripts/deploy/journal.mjs" "$@" --journal "$JOURNAL"; }

record() {
  local action="$1" outcome="$2" image="$3" release="$4"
  shift 4
  journal record --environment "$ENVIRONMENT" --action "$action" --outcome "$outcome" \
    --image "$image" --release "$release" "$@" >/dev/null
  say "journal : $action $outcome $release ($image)"
}

image_id() {
  local id
  id="$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null)" || fail "image introuvable : $1"
  [[ "$id" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "identifiant d'image inattendu : $id"
  printf '%s' "$id"
}

release_of() {
  docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" |
    sed -n 's/^RUEDA_RELEASE=//p' | head -n 1 | tr -c 'A-Za-z0-9._\n-' '_'
}

container_of() { compose ps -aq "$1" | head -n 1; }

wait_api_healthy() {
  local id health waited=0
  while :; do
    id="$(container_of api)"
    if [ -n "$id" ]; then
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$id")"
      [ "$health" = healthy ] && return 0
      [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ] || return 1
    fi
    [ "$waited" -lt "$TIMEOUT_S" ] || return 1
    sleep 2
    waited=$((waited + 2))
  done
}

worker_holds() {
  local id
  sleep "$WORKER_SETTLE_S"
  id="$(container_of worker)"
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Status}}' "$id")" = running ]
}

# Bascule de l'API et du travailleur sur $IMAGE ; 0 si la version est saine.
switch_to() {
  compose up -d --no-deps --force-recreate api worker >/dev/null 2>&1 || return 1
  wait_api_healthy || return 1
  worker_holds || return 1
}

run_db_job() {
  compose up -d secrets-init postgres >/dev/null 2>&1
  compose --profile job run --rm migrate
}

cmd_deploy() {
  [ $# -eq 1 ] || fail 'usage : local.sh deploy <image>'
  IMAGE="$(image_id "$1")"
  local release previous_image previous_release
  release="$(release_of "$IMAGE")"
  previous_image=''
  previous_release=''
  if read -r previous_image previous_release < <(journal current --environment "$ENVIRONMENT"); then :; fi
  record DEPLOY STARTED "$IMAGE" "$release" ${previous_image:+--from "$previous_image"}
  if ! run_db_job; then
    record DEPLOY FAILED "$IMAGE" "$release" --reason 'job de base en échec : version servie inchangée'
    fail "job de base en échec : $release non déployée, version servie inchangée"
  fi
  if switch_to; then
    record DEPLOY SUCCEEDED "$IMAGE" "$release" ${previous_image:+--from "$previous_image"}
    say "servie : $release"
    return 0
  fi
  compose logs --no-color --tail 40 api worker >&2 || true
  record DEPLOY FAILED "$IMAGE" "$release" --reason 'API non saine ou travailleur arrêté'
  if [ -z "$previous_image" ]; then
    fail "$release en échec et aucune version antérieure à resservir"
  fi
  local failed_image="$IMAGE"
  IMAGE="$previous_image"
  record ROLLBACK STARTED "$IMAGE" "$previous_release" --from "$failed_image" --reason automatique
  if switch_to; then
    record ROLLBACK SUCCEEDED "$IMAGE" "$previous_release" --from "$failed_image" --reason automatique
    fail "$release en échec : retour arrière automatique sur $previous_release (servie)"
  fi
  record ROLLBACK FAILED "$IMAGE" "$previous_release" --from "$failed_image" --reason automatique
  fail "retour arrière automatique en échec : incident (runbook docs/ops/DEPLOY.md)"
}

cmd_rollback() {
  local current_image current_release target_image target_release
  read -r current_image current_release < <(journal current --environment "$ENVIRONMENT") ||
    fail 'aucune version servie : rien à retirer'
  read -r target_image target_release < <(journal previous --environment "$ENVIRONMENT") ||
    fail 'aucune version antérieure dans le journal'
  IMAGE="$target_image"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || fail "image antérieure absente : $IMAGE"
  record ROLLBACK STARTED "$IMAGE" "$target_release" --from "$current_image" --reason manuel
  if switch_to; then
    record ROLLBACK SUCCEEDED "$IMAGE" "$target_release" --from "$current_image" --reason manuel
    say "retour arrière : $current_release ⇒ $target_release (servie)"
    return 0
  fi
  record ROLLBACK FAILED "$IMAGE" "$target_release" --from "$current_image" --reason manuel
  fail 'retour arrière en échec : incident (runbook docs/ops/DEPLOY.md)'
}

cmd_status() {
  local id
  for service in api worker; do
    id="$(container_of "$service")"
    [ -n "$id" ] || {
      echo "$service absent"
      continue
    }
    printf '%s %s %s\n' "$service" "$(docker inspect -f '{{.Image}} {{.State.Status}}' "$id")" \
      "$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$id" | sed -n 's/^RUEDA_RELEASE=//p')"
  done
}

cmd_destroy() {
  compose --profile job down -v --remove-orphans
  say 'environnement détruit (conteneurs, base, secrets) ; journal conservé'
}

NO_IMAGE="sha256:$(printf '0%.0s' $(seq 1 64))"
IMAGE="$NO_IMAGE"
command="${1:-}"
shift || true
case "$command" in
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  status) cmd_status ;;
  destroy) cmd_destroy ;;
  *) fail 'usage : local.sh deploy <image> | rollback | status | destroy' ;;
esac

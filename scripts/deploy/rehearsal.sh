#!/usr/bin/env bash
# Répétition complète du déploiement réversible (US-003, critères 1 à 3 ; ADR-078) sur la
# préproduction locale (infra/local/compose.yaml), avec l'IMAGE DE PRODUCTION. Job CI
# « déploiement local » ; rejouable sur un poste avec Docker, bash, Node et curl.
#
#   1. construit l'image A (docker/prod/Dockerfile) et la contrôle (image-checks.sh : sans FAKE) ;
#      dérive B (même code, autre version) et D (version défectueuse : API et travailleur sortent
#      en erreur au démarrage) ;
#   2. déploie A : base amorcée, migrée et déclarée « preproduction » ; API saine, travailleur
#      en marche ; route de webhook FAKE absente (404) ; C19 : l'API « production » refuse de
#      démarrer sur cette base, et avec une variable *_ADAPTER=FAKE ; la base ne se redéclare pas ;
#   3. déploie D : échec ⇒ retour arrière AUTOMATIQUE, A est servie, le journal le dit ;
#   4. déploie B puis retour arrière MANUEL : A est servie, le journal le dit ;
#   5. détruit l'environnement (base et secrets compris) puis le recrée depuis le dépôt : A servie,
#      sans autre action que le tirage des secrets ;
#   6. US-402 (L4-PM-17) : image N−1 (docs/ops/rollback-reference.json, construite depuis son commit)
#      déployée, puis N (migrations en plus), puis retour arrière manuel : N−1 saine sur le schéma N,
#      sans migration descendante ; N redéployée.
# Le journal (JSON Lines) est laissé dans $RUEDA_DEPLOY_JOURNAL (artefact de la CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
export RUEDA_DEPLOY_JOURNAL="${RUEDA_DEPLOY_JOURNAL:-$ROOT/infra/local/.journal/deployments.jsonl}"
PORT="${RUEDA_LOCAL_API_PORT:-3300}"
export RUEDA_LOCAL_API_PORT="$PORT"
LOCAL="$ROOT/scripts/deploy/local.sh"

say() { printf '\n[répétition] %s\n' "$*"; }
fail() {
  printf '[répétition] ÉCHEC : %s\n' "$*" >&2
  exit 1
}
id_of() { docker image inspect -f '{{.Id}}' "$1"; }
served() { docker inspect -f '{{.Image}}' "$(RUEDA_IMAGE=x docker compose -f infra/local/compose.yaml ps -q api)"; }
expect_served() {
  local got
  got="$(served)"
  [ "$got" = "$1" ] || fail "image servie $got, attendue $1 ($2)"
  say "servie : $2"
}
journal_has() {
  grep -F "\"action\":\"$1\"" "$RUEDA_DEPLOY_JOURNAL" | grep -F "\"image\":\"$2\"" |
    grep -F "\"outcome\":\"$3\"" | grep -qF "$4" || fail "journal : $1 $3 $2 $4 absent"
}
http() {
  curl -s -o /dev/null -w '%{http_code}' -X "$1" -H 'content-type: application/json' \
    ${3:+--data "$3"} "http://127.0.0.1:$PORT$2"
}
local_compose() { RUEDA_IMAGE="rueda-local:${A#sha256:}" docker compose -f infra/local/compose.yaml "$@"; }

trap 'RUEDA_IMAGE=x docker compose -f infra/local/compose.yaml --profile job down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
rm -f "$RUEDA_DEPLOY_JOURNAL"

say '1. images A (contrôlée), B (autre version), D (défectueuse)'
release="$(git rev-parse --short=12 HEAD 2>/dev/null || echo local)"
docker build -f docker/prod/Dockerfile --build-arg RUEDA_RELEASE="$release" -t rueda-api:rehearsal-a .
A="$(id_of rueda-api:rehearsal-a)"
bash scripts/deploy/image-checks.sh "$A"
printf 'FROM rueda-api:rehearsal-a\nENV RUEDA_RELEASE=%s-b\nLABEL org.opencontainers.image.revision=%s-b\n' \
  "$release" "$release" | docker build -t rueda-api:rehearsal-b -
B="$(id_of rueda-api:rehearsal-b)"
printf 'FROM rueda-api:rehearsal-a\nUSER root\nRUN echo "process.exit(3)" > apps/api/dist/main.js && cp apps/api/dist/main.js apps/api/dist/worker.js\nUSER node\nENV RUEDA_RELEASE=%s-defect\n' \
  "$release" | docker build -t rueda-api:rehearsal-d -
D="$(id_of rueda-api:rehearsal-d)"

say '2. déploiement de A sur un environnement vierge'
bash "$LOCAL" deploy "$A"
expect_served "$A" "A ($release)"
journal_has DEPLOY "$A" SUCCEEDED '"environment":"preproduction-local"'
[ "$(http GET '/brand/content?locale=es')" = 200 ] || fail 'API : GET /brand/content ≠ 200'
code="$(http POST "/webhooks/fake/wh_$(printf '%024d' 0)" '{}')"
[ "$code" = 404 ] || fail "route de webhook FAKE : $code (404 attendu, C19)"
say 'API saine ; route de webhook FAKE absente (404)'
# US-122 (ci-stable-3) : journaux lus UNE fois, puis cherchés dans la variable. Avec
# `set -o pipefail`, `logs | grep -q` peut échouer au hasard : grep -q sort au premier motif
# trouvé, docker compose écrit encore et meurt de SIGPIPE, le tube rend non nul (cause probable
# du run 44115264327, journaux du travailleur non conservés).
worker_logs="$(local_compose logs --no-color worker)"
grep -q '"event":"worker.started"' <<<"$worker_logs" ||
  fail 'travailleur : démarrage non journalisé'
grep -q '"queues":\["booking_contract","booking_conversion","booking_oracle","bordereau","claim_decision_executor","deposit_timer","disposition_sweeper","hold_expiry","iam_otp_pruner","iam_otp_sender","incidental_invoice_executor","kyc_score_pruner","mit_charge_scheduler","ntf_dispatcher","ntf_sender","ops_monitor","payout_scheduler","privacy_request","reconciliation","refund_scheduler","review_publisher","review_sla_watch","risk_pruner","security_incident_watch","trip_lifecycle","trip_overdue","trip_overdue_alert","webhook_ingest"\]' <<<"$worker_logs" || {
  # diagnostic : la ligne de démarrage (version et noms des files seulement, aucun secret)
  grep -F '"event":"worker.started"' <<<"$worker_logs" | tail -n 3 >&2 || true
  fail 'travailleur : files attendues absentes'
}
say 'travailleur en marche, dix-huit files déclarées (dont booking_contract, US-211, booking_conversion et webhook_ingest, US-223, ops_monitor, US-004, reconciliation, US-047, iam_otp_sender, iam_otp_pruner, US-104, kyc_score_pruner, US-105, review_sla_watch, US-106, et privacy_request, US-111)'

refuse() {
  local why="$1" pattern="$2" out code
  shift 2
  set +e
  out="$(timeout 120 bash -c "$(printf '%q ' "$@")" 2>&1)"
  code=$?
  set -e
  case "$code" in 0 | 124 | 137) fail "$why : non refusé (code $code)" ;; esac
  grep -q "$pattern" <<<"$out" || {
    printf '%s\n' "$out" | tail -n 20 >&2
    fail "$why : arrêt (code $code) sans le refus attendu"
  }
  say "$why : refusé (code $code)"
}
refuse 'API « production » sur la base de préproduction' 'démarrage refusé (C19)' \
  env RUEDA_IMAGE="rueda-local:${A#sha256:}" docker compose -f infra/local/compose.yaml \
  run --rm --no-deps -e RUEDA_ENV=production api
refuse 'API « production » avec PSP_ADAPTER=FAKE' 'démarrage refusé (C19)' \
  env RUEDA_IMAGE="rueda-local:${A#sha256:}" docker compose -f infra/local/compose.yaml \
  run --rm --no-deps -e RUEDA_ENV=production -e PSP_ADAPTER=FAKE api
refuse 'redéclaration de la base en « production »' 'environment_declared_once\|already declared' \
  env RUEDA_IMAGE="rueda-local:${A#sha256:}" RUEDA_LOCAL_ENV=production docker compose \
  -f infra/local/compose.yaml --profile job run --rm migrate

say '3. version défectueuse D : retour arrière automatique'
if bash "$LOCAL" deploy "$D"; then fail 'D déployée sans échec'; fi
expect_served "$A" 'A après échec de D'
journal_has DEPLOY "$D" FAILED '"release"'
journal_has ROLLBACK "$A" SUCCEEDED '"reason":"automatique"'

say '4. B puis retour arrière manuel'
bash "$LOCAL" deploy "$B"
expect_served "$B" 'B'
bash "$LOCAL" rollback
expect_served "$A" 'A après retour arrière manuel'
journal_has ROLLBACK "$A" SUCCEEDED "\"from\":\"$B\""

say '5. destruction puis reconstruction depuis le dépôt'
bash "$LOCAL" destroy
bash "$LOCAL" deploy "$A"
expect_served "$A" 'A sur l’environnement reconstruit'
[ "$(http GET '/brand/content?locale=es')" = 200 ] || fail 'API reconstruite : GET /brand/content ≠ 200'

say '6. image N−1 sur le schéma N (US-402, L4-PM-17) : retour arrière à travers de vraies migrations'
PREV="${RUEDA_ROLLBACK_PREVIOUS_SHA:-$(node -e "process.stdout.write(require('./docs/ops/rollback-reference.json').previousRelease)")}"
[[ "$PREV" =~ ^[0-9a-f]{40}$ ]] || fail "référence N−1 invalide : $PREV"
PREV_TREE="$(mktemp -d)"
trap 'git worktree remove --force "$PREV_TREE" >/dev/null 2>&1 || true; RUEDA_IMAGE=x docker compose -f infra/local/compose.yaml --profile job down -v --remove-orphans >/dev/null 2>&1 || true' EXIT
git fetch --quiet --depth=1 origin "$PREV"
git worktree add --quiet --detach "$PREV_TREE" FETCH_HEAD
newer="$(comm -13 <(ls "$PREV_TREE/packages/db/migrations" | grep '\.sql$' | sort) \
  <(ls packages/db/migrations | grep '\.sql$' | sort) | tr '\n' ' ')"
[ -n "${newer// /}" ] || fail "N−1 ($PREV) a déjà toutes les migrations de N : avancer docs/ops/rollback-reference.json"
say "migrations de N absentes de N−1 : $newer"
docker build -f "$PREV_TREE/docker/prod/Dockerfile" --build-arg RUEDA_RELEASE="n-1-${PREV:0:12}" \
  -t rueda-api:rehearsal-p "$PREV_TREE"
P="$(id_of rueda-api:rehearsal-p)"
bash "$LOCAL" destroy
bash "$LOCAL" deploy "$P"
expect_served "$P" "N−1 (${PREV:0:12}) sur un environnement vierge"
bash "$LOCAL" deploy "$A"
expect_served "$A" 'N (migrations de N appliquées)'
bash "$LOCAL" rollback
expect_served "$P" 'N−1 servie sur le schéma N (retour arrière manuel, sans migration descendante)'
journal_has ROLLBACK "$P" SUCCEEDED "\"from\":\"$A\""
[ "$(http GET '/brand/content?locale=es')" = 200 ] || fail 'N−1 sur le schéma N : GET /brand/content ≠ 200'
# le schéma reste N : le job de base de N, rejoué, n'a rien à appliquer et réussit
local_compose --profile job run --rm migrate >/dev/null
bash "$LOCAL" deploy "$A"
expect_served "$A" 'N redéployée après le retour arrière'
git worktree remove --force "$PREV_TREE"

say 'journal des déploiements'
cat "$RUEDA_DEPLOY_JOURNAL"
say 'répétition verte : déploiement, retour arrière automatique et manuel, reconstruction, N−1 sur le schéma N'

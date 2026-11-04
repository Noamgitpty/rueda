#!/usr/bin/env bash
# Pipeline de déploiement CLOUD (US-003, ADR-078 ; .github/workflows/deploy.yml ; docs/ops/DEPLOY.md).
# Même stratégie que la préproduction locale (scripts/deploy/local.sh, prouvée en CI), sur ECS :
#
#   build                    construit l'image de production, la pousse (étiquette = sha git,
#                            immuable) et écrit son empreinte dans $GITHUB_OUTPUT (digest=sha256:…).
#   deploy <empreinte>       [production : copie l'image depuis le registre de préproduction, même
#                            empreinte] ; enregistre les définitions de tâches sur cette empreinte ;
#                            lance le job de base (migrations, déclaration) et exige le code 0 ;
#                            bascule l'API et le travailleur ; attend la stabilité. Le coupe-circuit
#                            d'ECS fait le retour arrière automatique : s'il a joué, le déploiement
#                            est journalisé en échec et le script sort en 1.
#   rollback                 ressert l'empreinte servie avant la courante (journal), sans migration
#                            descendante (expand / contract).
#
# Journal : une ligne JSON par étape (scripts/deploy/journal.mjs), écrite dans le compartiment des
# preuves (`ops/deployments/<env>/…`, verrouillage d'objet) et dans le résumé du run.
# Variables (environnement GitHub, sans secret ; sorties d'infra/opentofu) : RUEDA_ENVIRONMENT,
# RUEDA_AWS_REGION, RUEDA_CLUSTER, RUEDA_REPOSITORY_URL, RUEDA_SUBNETS (virgules),
# RUEDA_APP_SECURITY_GROUP, RUEDA_EVIDENCE_BUCKET, RUEDA_SOURCE_REPOSITORY_URL (production).
# Identifiants : OIDC à durée courte (aucune clé longue durée). Aucun secret n'est lu ni affiché ici.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
say() { printf '[ecs] %s\n' "$*"; }
fail() {
  printf '::error title=déploiement::%s\n' "$*" >&2
  exit 1
}
need() { [ -n "${!1:-}" ] || fail "$1 absente (variables de l'environnement GitHub)"; }

for v in RUEDA_ENVIRONMENT RUEDA_AWS_REGION RUEDA_CLUSTER RUEDA_REPOSITORY_URL RUEDA_SUBNETS \
  RUEDA_APP_SECURITY_GROUP RUEDA_EVIDENCE_BUCKET; do need "$v"; done
case "$RUEDA_ENVIRONMENT" in preproduction | production) ;; *) fail 'RUEDA_ENVIRONMENT inconnu' ;; esac
export AWS_REGION="$RUEDA_AWS_REGION"
PREFIX="rueda-$RUEDA_ENVIRONMENT"
JOURNAL="$(mktemp -d)/deployments.jsonl"

# Journal : relu depuis le compartiment (une ligne par objet), complété, recopié.
sync_journal() {
  local dir
  dir="$(mktemp -d)"
  aws s3 cp --recursive --only-show-errors "s3://$RUEDA_EVIDENCE_BUCKET/ops/deployments/$RUEDA_ENVIRONMENT/" "$dir/" || true
  find "$dir" -name '*.json' -type f | sort | xargs -r cat >"$JOURNAL"
}
record() {
  local action="$1" outcome="$2" image="$3" release="$4" line key
  shift 4
  line="$(node "$ROOT/scripts/deploy/journal.mjs" record --journal "$JOURNAL" \
    --environment "$RUEDA_ENVIRONMENT" --action "$action" --outcome "$outcome" \
    --image "$image" --release "$release" "$@")"
  key="ops/deployments/$RUEDA_ENVIRONMENT/$(date -u +%Y%m%dT%H%M%S%N)-$action-$outcome.json"
  printf '%s\n' "$line" | aws s3 cp --only-show-errors - "s3://$RUEDA_EVIDENCE_BUCKET/$key"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf -- '- `%s`\n' "$line" >>"$GITHUB_STEP_SUMMARY"
  say "journal : $action $outcome $release"
}

registry_login() {
  aws ecr get-login-password | docker login --username AWS --password-stdin "${1%%/*}" >/dev/null
}

# Révision d'une définition de tâche sur l'empreinte $1 (et RUEDA_RELEASE=$2) ; écrit son ARN.
register() {
  local family="$PREFIX-$1" digest="$2" release="$3"
  aws ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json |
    jq --arg image "$RUEDA_REPOSITORY_URL@$digest" --arg release "$release" '
      .containerDefinitions |= map(
        .image = $image
        | .environment = ((.environment // []) | map(if .name == "RUEDA_RELEASE" then .value = $release else . end)))
      | {family, taskRoleArn, executionRoleArn, networkMode, containerDefinitions, volumes,
         requiresCompatibilities, cpu, memory, runtimePlatform}
      | with_entries(select(.value != null))' >"$RUNNER_TEMP/$1.json"
  aws ecs register-task-definition --cli-input-json "file://$RUNNER_TEMP/$1.json" \
    --query taskDefinition.taskDefinitionArn --output text
}

# Version (sha git) d'une empreinte : l'étiquette posée par `build` dans le registre de préproduction.
release_of_digest() {
  local repo="${RUEDA_SOURCE_REPOSITORY_URL:-$RUEDA_REPOSITORY_URL}" tag
  tag="$(aws ecr describe-images --repository-name "${repo#*/}" --image-ids "imageDigest=$1" \
    --query 'imageDetails[0].imageTags' --output text 2>/dev/null | tr '\t' '\n' | grep -v '^promoted-' | head -n 1 || true)"
  if [[ "$tag" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then printf '%s' "$tag"; else printf '%s' "${1:7:12}"; fi
}

present_in() {
  aws ecr describe-images --repository-name "${1#*/}" --image-ids "imageDigest=$2" >/dev/null 2>&1
}

run_db_job() {
  local arn="$1" task code
  task="$(aws ecs run-task --cluster "$RUEDA_CLUSTER" --task-definition "$arn" --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$RUEDA_SUBNETS],securityGroups=[$RUEDA_APP_SECURITY_GROUP],assignPublicIp=DISABLED}" \
    --query 'tasks[0].taskArn' --output text)"
  aws ecs wait tasks-stopped --cluster "$RUEDA_CLUSTER" --tasks "$task"
  code="$(aws ecs describe-tasks --cluster "$RUEDA_CLUSTER" --tasks "$task" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  [ "$code" = 0 ]
}

# Bascule ; 0 si les deux services sont stables SUR les nouvelles révisions (sinon : retour arrière
# automatique du coupe-circuit, ou délai dépassé).
switch_to() {
  local api_arn="$1" worker_arn="$2" s current
  aws ecs update-service --cluster "$RUEDA_CLUSTER" --service "$PREFIX-api" --task-definition "$api_arn" >/dev/null
  aws ecs update-service --cluster "$RUEDA_CLUSTER" --service "$PREFIX-worker" --task-definition "$worker_arn" >/dev/null
  aws ecs wait services-stable --cluster "$RUEDA_CLUSTER" --services "$PREFIX-api" "$PREFIX-worker" || return 1
  for s in "api:$api_arn" "worker:$worker_arn"; do
    current="$(aws ecs describe-services --cluster "$RUEDA_CLUSTER" --services "$PREFIX-${s%%:*}" \
      --query 'services[0].taskDefinition' --output text)"
    [ "$current" = "${s#*:}" ] || return 1
  done
}

cmd_build() {
  need GITHUB_SHA
  local tag="$RUEDA_REPOSITORY_URL:$GITHUB_SHA" digest
  registry_login "$RUEDA_REPOSITORY_URL"
  docker build -f "$ROOT/docker/prod/Dockerfile" --build-arg RUEDA_RELEASE="$GITHUB_SHA" -t "$tag" "$ROOT"
  bash "$ROOT/scripts/deploy/image-checks.sh" "$tag"
  docker push --quiet "$tag" >/dev/null
  digest="$(docker image inspect -f '{{index .RepoDigests 0}}' "$tag")"
  digest="${digest#*@}"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "empreinte illisible : $digest"
  say "image poussée : $tag ($digest)"
  [ -z "${GITHUB_OUTPUT:-}" ] || echo "digest=$digest" >>"$GITHUB_OUTPUT"
}

cmd_deploy() {
  local digest="${1:-}" release api worker migrate previous
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'deploy : empreinte sha256:<64 hex> attendue'
  sync_journal
  if [ "$RUEDA_ENVIRONMENT" = production ]; then
    need RUEDA_SOURCE_REPOSITORY_URL
    registry_login "$RUEDA_SOURCE_REPOSITORY_URL"
    registry_login "$RUEDA_REPOSITORY_URL"
    # copie octet pour octet du manifeste : même empreinte qu'en préproduction
    if ! present_in "$RUEDA_REPOSITORY_URL" "$digest"; then
      docker buildx imagetools create --tag "$RUEDA_REPOSITORY_URL:promoted-${digest#sha256:}" \
        "$RUEDA_SOURCE_REPOSITORY_URL@$digest"
    fi
  fi
  present_in "$RUEDA_REPOSITORY_URL" "$digest" || fail "empreinte absente du registre : $digest"
  release="$(release_of_digest "$digest")"
  previous="$(node "$ROOT/scripts/deploy/journal.mjs" current --journal "$JOURNAL" --environment "$RUEDA_ENVIRONMENT" | cut -d' ' -f1 || true)"
  record DEPLOY STARTED "$digest" "$release" ${previous:+--from "$previous"}
  api="$(register api "$digest" "$release")"
  worker="$(register worker "$digest" "$release")"
  migrate="$(register migrate "$digest" "$release")"
  if ! run_db_job "$migrate"; then
    record DEPLOY FAILED "$digest" "$release" --reason 'job de base en échec : version servie inchangée'
    fail 'job de base en échec : version servie inchangée'
  fi
  if switch_to "$api" "$worker"; then
    record DEPLOY SUCCEEDED "$digest" "$release" ${previous:+--from "$previous"}
    return 0
  fi
  record DEPLOY FAILED "$digest" "$release" --reason 'services non stables : coupe-circuit'
  if [ -n "$previous" ]; then
    record ROLLBACK SUCCEEDED "$previous" "$(release_of_digest "$previous")" --from "$digest" --reason automatique
  fi
  fail "déploiement en échec : retour arrière automatique du coupe-circuit (journal)"
}

cmd_rollback() {
  local current target release api worker
  sync_journal
  current="$(node "$ROOT/scripts/deploy/journal.mjs" current --journal "$JOURNAL" --environment "$RUEDA_ENVIRONMENT" | cut -d' ' -f1)" ||
    fail 'aucune version servie'
  target="$(node "$ROOT/scripts/deploy/journal.mjs" previous --journal "$JOURNAL" --environment "$RUEDA_ENVIRONMENT" | cut -d' ' -f1)" ||
    fail 'aucune version antérieure dans le journal'
  release="$(release_of_digest "$target")"
  record ROLLBACK STARTED "$target" "$release" --from "$current" --reason manuel
  api="$(register api "$target" "$release")"
  worker="$(register worker "$target" "$release")"
  if switch_to "$api" "$worker"; then
    record ROLLBACK SUCCEEDED "$target" "$release" --from "$current" --reason manuel
    return 0
  fi
  record ROLLBACK FAILED "$target" "$release" --from "$current" --reason manuel
  fail 'retour arrière en échec : incident (docs/ops/DEPLOY.md)'
}

command="${1:-}"
shift || true
case "$command" in
  build) cmd_build ;;
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  *) fail 'usage : ecs.sh build | deploy <empreinte> | rollback' ;;
esac

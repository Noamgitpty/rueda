#!/usr/bin/env bash
# RÉPÉTITION DE ROTATION DES SECRETS sans coupure (US-051, ADR-082 ; 19 US-051 critère 3) sur la
# préproduction locale (infra/local/compose.yaml) avec l'IMAGE DE PRODUCTION. Job CI « reprise » ;
# rejouable sur un poste avec Docker, bash, Node et curl.
#
#   1. construit l'image (docker/prod/Dockerfile) et la déploie (scripts/deploy/local.sh), puis
#      démarre la seconde instance de l'API (profil `rotation`) et la SONDE (scripts/ops/probe.mjs :
#      répartiteur et client, une requête toutes les 250 ms, tout code autre que 200 compte) ;
#   2. exécute TELLES QU'ÉCRITES les étapes de docs/ops/SECRET_ROTATION.md § 4 : mots de passe des
#      rôles (dont un redéploiement de contrôle après « appliquer » : chaque instance redémarrée
#      doit basculer sur la valeur suivante), clé de débit, clé de preuve MFA ;
#   3. exige zéro échec de la sonde, la bascule `db.password.switched` de l'API (deux instances) et
#      du travailleur, et le refus de chaque ancien mot de passe (étape « vérifier » du runbook).
#
# Secrets : tirés au hasard dans des volumes Docker (infra/local/init-secrets.sh,
# rotate-secrets.sh), jamais affichés. Tout est détruit à la fin. Rapport de la sonde dans
# $RUEDA_ROTATION_REPORT (artefact de la CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
WORK="$(mktemp -d)"
export RUEDA_DEPLOY_JOURNAL="${RUEDA_DEPLOY_JOURNAL:-$WORK/deployments.jsonl}"
export RUEDA_PROBE_TARGETS="$WORK/targets"
export RUEDA_LOCAL_API_PORT="${RUEDA_LOCAL_API_PORT:-3300}"
export RUEDA_LOCAL_API_B_PORT="${RUEDA_LOCAL_API_B_PORT:-3301}"
REPORT="${RUEDA_ROTATION_REPORT:-$ROOT/infra/local/.journal/rotation-probe.json}"
PROBE_PID=''

say() { printf '\n[rotation] %s\n' "$*"; }
fail() {
  printf '[rotation] ÉCHEC : %s\n' "$*" >&2
  exit 1
}
compose() { docker compose -f infra/local/compose.yaml --profile job --profile rotation "$@"; }
cleanup() {
  local code=$?
  [ -z "$PROBE_PID" ] || kill "$PROBE_PID" 2>/dev/null || true
  if [ "$code" -ne 0 ]; then
    [ ! -s "$WORK/probe.json" ] || cat "$WORK/probe.json" >&2
    RUEDA_IMAGE="${RUEDA_IMAGE:-x}" compose logs --no-color --tail 60 >&2 || true
  fi
  RUEDA_IMAGE="${RUEDA_IMAGE:-x}" compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
step() {
  say "runbook : $1"
  node scripts/ops/runbook.mjs docs/ops/SECRET_ROTATION.md "$1"
}
switched() {
  # instances (conteneurs actuels) qui ont basculé sur la valeur suivante
  local n=0 svc
  for svc in api api-b worker; do
    # grep -c lit tout (grep -q fermerait le tube : SIGPIPE, faux négatif sous pipefail)
    if compose logs --no-color "$svc" 2>/dev/null | grep -cF '"event":"db.password.switched"' >/dev/null; then
      n=$((n + 1))
    fi
  done
  printf '%s' "$n"
}

say '1. image de production, déploiement, seconde instance, sonde'
release="$(git rev-parse --short=12 HEAD 2>/dev/null || echo local)"
docker build -f docker/prod/Dockerfile --build-arg RUEDA_RELEASE="$release" -t rueda-api:rotation .
A="$(docker image inspect -f '{{.Id}}' rueda-api:rotation)"
RUEDA_IMAGE=x compose down -v --remove-orphans >/dev/null 2>&1 || true
bash scripts/deploy/local.sh deploy "$A"
export RUEDA_IMAGE="rueda-local:${A#sha256:}"
compose up -d --no-deps api-b >/dev/null
for i in $(seq 1 60); do
  id="$(compose ps -q api-b)"
  [ -n "$id" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] && break
  [ "$i" -lt 60 ] || fail 'api-b non saine'
  sleep 2
done
printf 'http://127.0.0.1:%s\nhttp://127.0.0.1:%s\n' "$RUEDA_LOCAL_API_PORT" "$RUEDA_LOCAL_API_B_PORT" \
  >"$RUEDA_PROBE_TARGETS"
node scripts/ops/probe.mjs "$RUEDA_PROBE_TARGETS" "$WORK/probe.json" 250 &
PROBE_PID=$!
sleep 3

say '2a. mots de passe des rôles (migrator, app_api, app_worker, app_anon)'
step rotation-bdd-preparer
step rotation-redeployer
[ "$(switched)" = 0 ] || fail 'bascule avant la pose de la valeur suivante'
step rotation-bdd-appliquer
# contrôle de l'exercice : des instances qui (re)démarrent après « appliquer » se connectent par
# la valeur suivante, sans coupure
step rotation-redeployer
for i in $(seq 1 30); do
  n="$(switched)"
  [ "$n" = 3 ] && break
  [ "$i" -lt 30 ] || fail "bascule sur la valeur suivante : $n instance(s) sur 3"
  sleep 1
done
say 'api, api-b et travailleur connectés par la valeur suivante (db.password.switched)'
step rotation-bdd-promouvoir
step rotation-redeployer
[ "$(switched)" = 0 ] || fail 'instances encore en bascule après la promotion'
step rotation-bdd-verifier

say '2b. clé de débit'
step rotation-debit-preparer
step rotation-redeployer
step rotation-debit-retirer
step rotation-redeployer

say '2c. clé de preuve MFA'
step rotation-mfa-installer
step rotation-mfa-preparer
step rotation-mfa-promouvoir-coffre
step rotation-redeployer
step rotation-mfa-promouvoir-base

say '3. sonde'
sleep 2
kill "$PROBE_PID"
wait "$PROBE_PID" || true
PROBE_PID=''
mkdir -p "$(dirname "$REPORT")"
cp "$WORK/probe.json" "$REPORT"
cat "$REPORT"
node -e '
  const r = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (r.requests < 100) { console.error(`[rotation] ÉCHEC : ${r.requests} requêtes seulement`); process.exit(1); }
  if (r.failures !== 0) { console.error(`[rotation] ÉCHEC : ${r.failures} réponse(s) autre(s) que 200`); process.exit(1); }
  console.log(`[rotation] ${r.requests} requêtes, aucune interruption visible`);
' "$REPORT"
say 'rotation verte : aucun échec, anciennes valeurs refusées'

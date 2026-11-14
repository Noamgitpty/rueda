#!/usr/bin/env bash
# EXERCICE DE PORTABILITÉ (US-036 critère 2, ADR-120 ; runbook docs/ops/PORTABILITY.md).
# Lancé à la fin de scripts/ops/restore-drill.sh (job CI « reprise ») ; rejouable sur un poste
# avec Docker, bash, Node et pnpm (dépendances installées).
#
#   1. deux instances PostgreSQL 16 en conteneur : l'ancien hébergeur (source) et le nouveau
#      (cible, vide), chacune avec son propre mot de passe d'administration tiré au hasard ;
#   2. `pnpm --filter @rueda/db test:portability` : préproduction peuplée (PA, PY : trips,
#      règlements, audit, fichiers chiffrés par sujet), puis les étapes de PORTABILITY.md
#      exécutées TELLES QU'ÉCRITES (export base + clés + fichiers, import sur la cible,
#      vérification), et l'aller-retour comparé sous les rôles de production ;
#   3. tout est détruit à la fin (conteneurs, dossier de travail, clés et séquestre de l'exercice).
#
# Secrets : mots de passe, clés maîtresses locales et clé de séquestre TIRÉS AU HASARD pour
# l'exercice, dans un dossier 0700 détruit à la fin ; rien n'est affiché ni publié en artefact.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
PREFIX="${RUEDA_PORTABILITY_PREFIX:-rueda-portability}"
SOURCE="$PREFIX-source"
TARGET="$PREFIX-target"
PORT="${RUEDA_PORTABILITY_SOURCE_PORT:-55441}"
TARGET_PORT="${RUEDA_PORTABILITY_TARGET_PORT:-55442}"
WORK="$(mktemp -d)"
chmod 700 "$WORK"
mkdir -m 700 "$WORK/secrets" "$WORK/secrets/target"

say() { printf '\n[portabilite] %s\n' "$*"; }
cleanup() {
  local code=$?
  if [ "$code" -ne 0 ]; then
    for c in "$SOURCE" "$TARGET"; do docker logs --tail 40 "$c" >&2 2>&1 || true; done
  fi
  for c in "$SOURCE" "$TARGET"; do docker rm -f -v "$c" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
trap cleanup EXIT

start() { # <conteneur> <port> <fichier du mot de passe d'administration>
  docker rm -f -v "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" -p "127.0.0.1:$2:5432" -e POSTGRES_DB=rueda \
    -e POSTGRES_PASSWORD_FILE=/run/rueda-admin -v "$3:/run/rueda-admin:ro" postgres:16 >/dev/null
  for i in $(seq 1 60); do
    # prêt = serveur définitif (après le redémarrage de l'initialisation)
    docker exec -u postgres "$1" pg_isready -h 127.0.0.1 -d rueda >/dev/null 2>&1 && break
    [ "$i" -lt 60 ] || {
      docker logs "$1" 2>&1 | tail -n 30 >&2
      exit 1
    }
    sleep 1
  done
}

say '1. ancien hébergeur (source) et nouvel hébergeur (cible, vide)'
(
  umask 077
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WORK/secrets/postgres"
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' >"$WORK/secrets/target/postgres"
)
# l'utilisateur du conteneur doit lire le fichier monté : lecture pour tous sur le FICHIER, le
# dossier de travail restant 0700 (aucun autre compte du poste n'y entre)
chmod 0644 "$WORK/secrets/postgres" "$WORK/secrets/target/postgres"
start "$SOURCE" "$PORT" "$WORK/secrets/postgres"
start "$TARGET" "$TARGET_PORT" "$WORK/secrets/target/postgres"

say '2. exercice (runbook docs/ops/PORTABILITY.md, exécuté tel quel)'
RUEDA_DRILL_WORK="$WORK" RUEDA_DRILL_PG_PORT="$PORT" RUEDA_PORTABILITY_TARGET_PORT="$TARGET_PORT" \
  pnpm --filter @rueda/db test:portability

say 'exercice de portabilité vert'

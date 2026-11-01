#!/usr/bin/env bash
# Fumée du banc PostgreSQL de CI (US-002, ADR-043) : vérifie que le runner peut démarrer
# un PostgreSQL 16 réel (image postgres:16) avec btree_gist, en connexion directe sans pooler.
# Ce n'est pas un test applicatif : les tests d'intégration et L0 viennent d'US-005 à US-007.
# Mot de passe aléatoire, jamais affiché ; conteneur supprimé même en cas d'échec.
set -euo pipefail

name="rueda-pg-smoke-$$"
password="$(openssl rand -hex 24)"
echo "::add-mask::${password}"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT

docker version --format 'Docker {{.Server.Version}}'
docker run -d --name "$name" -e POSTGRES_PASSWORD="$password" postgres:16 >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U postgres -q; then break; fi
  sleep 1
done
docker exec "$name" pg_isready -h 127.0.0.1 -U postgres

psql() { docker exec -i "$name" psql -h 127.0.0.1 -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }

major="$(psql -c 'SHOW server_version_num' | cut -c1-2)"
echo "server_version : $(psql -c 'SHOW server_version')"
if [ "$major" -lt 16 ]; then
  echo "::error::PostgreSQL ${major} < 16"
  exit 1
fi
psql -c 'CREATE EXTENSION btree_gist' >/dev/null
echo "btree_gist : $(psql -c "SELECT extversion FROM pg_extension WHERE extname = 'btree_gist'")"
echo "RÉSULTAT : OK (PostgreSQL ${major}, btree_gist, connexion directe)"

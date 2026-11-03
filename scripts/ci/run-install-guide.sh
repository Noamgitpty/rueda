#!/usr/bin/env bash
# Preuve du guide d'installation (US-035, ADR-070) : exécute, dans l'ordre, chaque bloc
# « ```bash guide » de docs/ops/INSTALL.md, depuis la racine du dépôt, avec `set -euo pipefail`.
# Utilisé par le job CI « guide d'installation » (runner vierge : Docker, bash, git seulement).
# Usage : bash scripts/ci/run-install-guide.sh [docs/ops/INSTALL.md]
set -euo pipefail

guide="${1:-docs/ops/INSTALL.md}"
[ -f "$guide" ] || {
  echo "::error title=guide::$guide introuvable"
  exit 1
}

script="$(mktemp)"
trap 'rm -f "$script"' EXIT
{
  echo 'set -euo pipefail'
  awk '
    /^```bash guide[[:space:]]*$/ { inside = 1; n++; printf "echo \"::group::bloc %d du guide\"\n", n; next }
    /^```/ && inside { inside = 0; print "echo \"::endgroup::\""; next }
    inside { print }
  ' "$guide"
} >"$script"

blocks="$(grep -c '^```bash guide' "$guide" || true)"
[ "$blocks" -ge 3 ] || {
  echo "::error title=guide::$guide : $blocks bloc(s) « bash guide », 3 au moins attendus"
  exit 1
}
echo "guide : $blocks bloc(s) exécuté(s) depuis $guide"
bash -x "$script"

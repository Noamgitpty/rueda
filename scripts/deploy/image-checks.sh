#!/usr/bin/env bash
# Contrôles de l'IMAGE DE PRODUCTION (US-003, ADR-078 ; 17 §6.5 point 2, C19) :
#   1. utilisateur non root, RUEDA_ENV absente (absente ⇒ production, fail-closed), version posée ;
#   2. AUCUN adaptateur FAKE : ni paquet @rueda/fake-adapters, ni import dans l'API compilée ;
#   3. rien de ce qui sert aux tests ou au poste local : testing/, test-migrations/, dev-overlay/,
#      src/dev/, fichiers *.test.*, outils de développement (vitest, typescript, eslint, testcontainers) ;
#   4. les paquets TypeScript de l'espace de travail sont HORS de node_modules (report d'US-021 :
#      Node 26 n'efface pas les types sous node_modules) ; l'API compilée se charge (import à blanc).
# Usage : bash scripts/deploy/image-checks.sh <image>
set -euo pipefail

image="${1:?usage : image-checks.sh <image>}"
say() { printf '[image] %s\n' "$*"; }
fail() {
  printf '[image] ÉCHEC : %s\n' "$*" >&2
  exit 1
}
in_image() { docker run --rm --network none --entrypoint sh "$image" -c "$1"; }

user="$(docker image inspect -f '{{.Config.User}}' "$image")"
[ "$user" = node ] || fail "utilisateur « $user » (node attendu, jamais root)"
env_list="$(docker image inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$image")"
if grep -q '^RUEDA_ENV=' <<<"$env_list"; then fail 'RUEDA_ENV posée dans l’image'; fi
grep -q '^NODE_ENV=production$' <<<"$env_list" || fail 'NODE_ENV=production attendue'
release="$(sed -n 's/^RUEDA_RELEASE=//p' <<<"$env_list")"
[ -n "$release" ] && [ "$release" != unknown ] || fail 'RUEDA_RELEASE absente'
label="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")"
[ "$label" = "$release" ] || fail "étiquette de révision « $label » ≠ version « $release »"
if grep -Eiq '(PASSWORD|SECRET|TOKEN|_KEY)=' <<<"$env_list"; then fail 'secret dans l’environnement de l’image'; fi
say "utilisateur node, RUEDA_ENV absente, version $release, aucun secret dans l'image"

found="$(in_image 'find / -xdev \( -path /proc -o -path /sys \) -prune -o -iname "*fake-adapters*" -print 2>/dev/null; grep -rl "@rueda/fake-adapters" /app/apps/api/dist || true')"
[ -z "$found" ] || fail "adaptateur FAKE présent : $found"
say 'aucun adaptateur FAKE (paquet absent, aucun import dans l’API compilée)'

found="$(in_image 'find /app/apps /app/packages \( -name node_modules -prune \) -o \( -name testing -o -name test -o -name test-migrations -o -name dev-overlay -o -name "*.test.*" -o -name "*.test-support.*" \) -print; ls -d /app/packages/db/src/dev /app/packages/fake-adapters 2>/dev/null || true')"
[ -z "$found" ] || fail "fichiers de test ou de développement présents : $found"
found="$(in_image 'ls /app/node_modules/.pnpm' | grep -E '^(@?vitest|typescript|eslint|prettier|testcontainers|@testcontainers|turbo|@rueda\+)' || true)"
[ -z "$found" ] || fail "dépendances de développement présentes : $found"
say 'aucun test, harnais, surcouche de développement ni outil de développement'

in_image 'for p in i18n design-tokens; do r="$(readlink -f /app/apps/api/node_modules/@rueda/$p)"; case "$r" in */node_modules/*) echo "$p sous node_modules : $r"; exit 1;; esac; done' ||
  fail 'paquet TypeScript de l’espace de travail sous node_modules'
in_image 'cd /app/apps/api && node --input-type=module -e "await import(\"@rueda/i18n\"); await import(\"@rueda/design-tokens\"); await import(\"./dist/app.module.js\"); console.log(\"chargé\")"' |
  grep -q '^chargé$' || fail 'l’API compilée ne se charge pas'
say 'paquets TypeScript hors de node_modules ; API compilée chargée'
say "image conforme : $image"

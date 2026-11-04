# Image de PRÉPRODUCTION et de PRODUCTION (US-003, ADR-078) : une seule image, trois commandes.
#   API          node apps/api/dist/main.js            (défaut)
#   travailleur  node apps/api/dist/worker.js
#   job de base  node packages/db/src/deploy/cli.ts    (amorçage, migrations, déclaration d'environnement)
#
# Construction (racine du dépôt) :
#   docker build -f docker/prod/Dockerfile --build-arg RUEDA_RELEASE=<sha git> -t rueda-api:<sha> .
# L'image est ensuite désignée par son EMPREINTE (sha256) dans l'IaC et le pipeline, jamais par une
# étiquette mobile : le retour arrière ressert exactement les octets de la version précédente.
#
# Garanties (prouvées par scripts/deploy/image-checks.sh, job CI « déploiement local ») :
#   - AUCUN adaptateur FAKE (C19 point 2, 17 §6.5) : @rueda/fake-adapters est une dépendance de
#     développement, jamais installée ici ; ni `testing/`, ni test, ni migration de test, ni
#     surcouche de développement ne sont copiés ;
#   - dépendances de production seulement (pnpm --prod), installation figée par le lockfile ;
#   - processus non root (utilisateur node), aucun secret (injectés au lancement par le coffre) ;
#   - RUEDA_ENV n'est PAS posée : absente ⇒ production (fail-closed) ; l'IaC la pose explicitement.
#   - @rueda/i18n et @rueda/design-tokens exportent du TypeScript : Node 26 n'efface pas les types
#     sous node_modules (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, report d'US-021). L'image garde
#     donc la disposition de l'espace de travail : les paquets sont sous /app/packages et
#     node_modules n'en contient que des liens ; la fumée de l'image démarre l'API pour le prouver.

# node:26.13.0-slim, épinglée par empreinte (index multi-architecture) ; montée de version :
# relever l'empreinte du nouvel index et changer les deux lignes FROM ensemble.
ARG NODE_IMAGE=node:26.13.0-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39

FROM ${NODE_IMAGE} AS build
RUN npm install --global --ignore-scripts --no-audit --no-fund pnpm@10.34.9 \
  && mkdir /repo && chown node:node /repo
USER node
WORKDIR /repo
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @rueda/api build
# Dépendances de PRODUCTION seulement, de l'API et du job de base (pg) : les dépendances de
# développement (dont @rueda/fake-adapters) disparaissent de node_modules.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
  && pnpm install --frozen-lockfile --prod --ignore-scripts \
       --filter @rueda/api... --filter @rueda/db...   && find node_modules/.pnpm/node_modules/@rueda -mindepth 1 -maxdepth 1        ! -name i18n ! -name design-tokens -exec rm -rf {} +
# (le magasin de pnpm « remonte » un lien vers CHAQUE paquet de l'espace de travail, dont
#  @rueda/fake-adapters : seuls les deux paquets lus par l'API sont gardés, liste blanche)

FROM ${NODE_IMAGE} AS runtime
ARG RUEDA_RELEASE=unknown
LABEL org.opencontainers.image.title="rueda-api" \
      org.opencontainers.image.revision="${RUEDA_RELEASE}" \
      org.opencontainers.image.description="API, travailleur et job de base (US-003). Sans FAKE."
ENV NODE_ENV=production \
    RUEDA_RELEASE=${RUEDA_RELEASE}
WORKDIR /app
# Liste blanche de ce qui part en production (rien d'autre) :
COPY --from=build --chown=root:root /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=build --chown=root:root /repo/node_modules ./node_modules
COPY --from=build --chown=root:root /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=root:root /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=root:root /repo/apps/api/dist ./apps/api/dist
COPY --from=build --chown=root:root /repo/packages/i18n/package.json ./packages/i18n/package.json
COPY --from=build --chown=root:root /repo/packages/i18n/src ./packages/i18n/src
COPY --from=build --chown=root:root /repo/packages/i18n/config ./packages/i18n/config
COPY --from=build --chown=root:root /repo/packages/design-tokens/package.json ./packages/design-tokens/package.json
COPY --from=build --chown=root:root /repo/packages/design-tokens/src ./packages/design-tokens/src
COPY --from=build --chown=root:root /repo/packages/design-tokens/config ./packages/design-tokens/config
COPY --from=build --chown=root:root /repo/packages/design-tokens/rules ./packages/design-tokens/rules
COPY --from=build --chown=root:root /repo/packages/design-tokens/foundation.tokens.json ./packages/design-tokens/foundation.tokens.json
# palettes du registre US-028, importées par @rueda/design-tokens (report d'US-034)
COPY --from=build --chown=root:root /repo/docs/design/US-028/*.json ./docs/design/US-028/
COPY --from=build --chown=root:root /repo/packages/db/package.json ./packages/db/package.json
COPY --from=build --chown=root:root /repo/packages/db/node_modules ./packages/db/node_modules
COPY --from=build --chown=root:root /repo/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=root:root /repo/packages/db/bootstrap ./packages/db/bootstrap
COPY --from=build --chown=root:root /repo/packages/db/src ./packages/db/src
# Hors production : harnais de tests, préparation du poste local, tests et sources de test.
RUN rm -rf packages/db/src/testing packages/db/src/dev \
  && find apps packages -type d \( -name testing -o -name test -o -name __tests__ \) -prune -exec rm -rf {} + \
  && find apps packages -type f \( -name '*.test.ts' -o -name '*.test.js' -o -name '*.test-support.*' -o -name '*.map' \) -delete
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]

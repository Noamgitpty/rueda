lot: L0
module: Équipe et CI

- Sécurité : GHSA-fc5q-39xc-vjpf (picomatch <= 4.0.7, élevée, sans version corrigée publiée) sort de l'arbre de production : `@eslint/js`, `globals` et `typescript-eslint` de `@rueda/config`, paquet d'outillage jamais livré, passent en `devDependencies` ; porte « dépendances » et liste d'exceptions inchangées (US-001, US-002)

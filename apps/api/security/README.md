# apps/api/security — matrice d'autorisations des routes et tests de sécurité de l'API

Livré par US-043 (ADR-077). Complète la matrice de la base (`packages/db/authorization-matrix.json`).

## Responsabilité

Décrire, pour CHAQUE route d'un contrôleur Nest, qui peut l'appeler, et le prouver sur l'API réelle. Une route ajoutée sans entrée fait échouer la CI.

## Contenu

| Chemin                                    | Rôle                                                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `route-matrix.json`                       | Une entrée par route : `public`, `session` ou `staff` ; pour `staff`, permission de 17 §2.3, rôles autorisés, portée (`pays` : IDOR entre pays éprouvé ; `plateforme`), description de l'IDOR. Modifier une entrée = revue sécurité. |
| `../src/http-hardening.ts`                | Durcissement appliqué par `main.ts` : en-têtes de sécurité, corps bornés à 100 Kio, aucun CORS, erreurs sans écho de la requête (`ErrorHygieneFilter`).                                                                              |
| `../src/testing/route-matrix.test.ts`     | `test:unit` sur l'`ApiModule` réel (adaptateurs en mémoire) : complétude, authentification requise, cookie forgé, forçage d'`org_id` et de pays, en-têtes, taille des corps, CORS, aucune donnée personnelle dans les erreurs.       |
| `../src/testing/route-matrix.int.test.ts` | `test:int` sur PostgreSQL (app_api) : chaque route × chaque acteur (anonyme, voyageur, hôte, co-hôte, staff sans TOTP, chaque rôle interne dans chaque pays), puis le sujet de l'autre pays (IDOR).                                  |
| `../src/testing/api-harness.ts`           | Application de test : `ApiModule` + durcissement, sessions par cookie, magasins qui refusent tout appel imprévu.                                                                                                                     |

## Commandes de test

```bash
pnpm --filter @rueda/api test:unit   # matrice des routes, en-têtes, corps, CORS, erreurs
pnpm --filter @rueda/api test:int    # matrice des routes sur PostgreSQL (la CI fait foi)
```

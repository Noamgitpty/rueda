lot: L1
module: Marque et contenus (CFG)

- Ajouté : blocs de contenu éditables sans déploiement, sur l'accueil (12 textes), par un registre en liste blanche partagé par l'API et le site ; corps assaini côté serveur en un arbre fermé (paragraphes, listes, gras, italique, liens internes), jamais de HTML ; repli sur le texte livré dans la langue de la page (US-121, ADR-095)
- Ajouté : signalement au back-office des blocs publiés sans une langue ou hors règles (`GET /console/content/gaps`, bandeau de la console) (US-121)
- Sécurité : textes juridiques (CGU, contrat, politique d'annulation…) refusés comme blocs, par l'API et par la base, tentative journalisée (migration 0060) ; CSP et en-têtes de sécurité sur toutes les routes du site (US-121)

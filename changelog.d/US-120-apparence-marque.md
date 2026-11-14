lot: L1
module: Marque et contenus (CFG)

- Ajouté : écran « Apparence et marque » du back-office (`/brand`, ADMIN avec session TOTP) : historique des versions, publication d'un brouillon, retour arrière en un clic, nouveau brouillon (palette ou version de départ, nom, couleurs, polices, logo SVG), aperçu en direct de S01, S03, S05, A02 et d'un e-mail, en clair ou sombre, mobile ou bureau, sans toucher la production ; contraste AA vérifié avant publication et paires refusées affichées ; images de marque ; textes de l'accueil dans les quatre langues (US-120, ADR-116)
- Ajouté : `previewStyleSheet` (variables d'un thème portées par un attribut) et `logoProblem` / `logoProblems` (logo SVG borné) dans `@rueda/design-tokens` (US-120)
- Modifié : l'écran d'édition des textes cite le mot qui fait refuser un texte juridique et explique le refus des émojis composés (ZWJ), en es, en, fr et pt (US-120, BOARD N-46)
- Sécurité : les images de marque passent par l'antivirus avant tout dépôt, fail-closed (503 si indisponible, 422 si infectées ; indisponible en production tant que l'adaptateur ClamAV n'est pas livré) ; logo SVG avec script, lien ou ressource externe refusé par l'API (US-120, DEC-FONDATEUR-20)

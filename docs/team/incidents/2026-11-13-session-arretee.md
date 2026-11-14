# Incident 2026-11-13 — arrêt de la session, 22 h sans avancement

- **Quoi** : la session de l'orchestrateur s'est arrêtée ; tous les agents se sont arrêtés avec elle. Rien n'a avancé entre 00:53 et 22:39 UTC alors qu'une PR attendait avec une CI verte.
- **Cause** : arrêt de l'application ou mise en veille du poste ; le maintien en éveil ne tient que tant que la session tourne.
- **Mesure** : à chaque reprise, état complet des PR (mergeable, dernière CI) et relance immédiate ; maintien en éveil redemandé. Le fondateur est informé qu'un poste allumé avec l'application ouverte est nécessaire pour un travail continu.
- **Leçon associée (2026-11-12)** : une PR en conflit avec `main` ne déclenche aucune CI ; vérifier `mergeable` de toutes les PR ouvertes après chaque fusion.

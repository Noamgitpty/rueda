lot: L1
module: Catalogue et annonces

- Ajouté : import au catalogue de référence des marques et modèles déclarés à la douane du Paraguay (données ouvertes de la DNIT, licence d'usage de l'information publique citée sur chaque ligne) : 52 marques et 642 modèles nouveaux, 680 variantes sans fiche du marché de la source, sans doublon de la graine v1 (US-113, ADR-109)
- Ajouté : source `DNIT_ADUANAS_PY` ; carrosserie, places, portes, boîte, carburant et transmission facultatifs pour cette seule source, exigés de toute autre (migration 0078) (US-113)
- Modifié : le préremplissage rend `null` et `specsComplete: false` pour une variante sans fiche, sans valeur devinée ; les listes de marques et de modèles de l'hôte ne montrent que ceux qui ont une variante de son marché (US-113)
- Ajouté : « fiche technique à compléter » dans la console de l'ops pour une variante candidate sans fiche, en es, en, fr et pt-BR (catalogue i18n v27) (US-113)

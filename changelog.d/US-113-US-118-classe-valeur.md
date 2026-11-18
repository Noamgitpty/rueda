lot: L1
module: Catalogue et annonces

- Ajouté : à la publication, un véhicule sans classe de valeur (variante de la douane, graine du catalogue, hors catalogue) reçoit une classe : celle de la variante, sinon une règle de marque ou de modèle (marques et modèles de valeur haute en PREMIUM ou LUXE, jamais en STANDARD), sinon le défaut du pays ; provenance et règle gardées sur le véhicule (migration 0135, ADR-159) (US-113, US-118)
- Ajouté : paramètre `vehicle_default_value_class` par pays, STANDARD PROPOSÉ au Panama et au Paraguay ; absent : aucune classe, véhicule jamais couvert (migration 0134) (US-113)
- Modifié : un véhicule hors catalogue déjà classé et rattaché par l'ops à une variante garde une classe, recalculée avec la variante (US-113)

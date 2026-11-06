lot: L0
module: Réservation

- Sécurité : un hôte ne pose ni ne lève plus de blocage de calendrier que sur un véhicule de son compte et de son pays selon le catalogue ; un véhicule inconnu est refusé (F-RLS-01, US-049)
- Sécurité : un co-hôte ou un membre invité du compte d'hôte ne réserve plus le véhicule de ce compte (SELF_BOOKING_FORBIDDEN, F-RLS-02, US-049)
- Sécurité : un hold ou un blocage à borne infinie est refusé, et un hold ne dépasse plus max_trip_days jours du pays (INVALID_PERIOD, RT-CONC-02, US-049)
  lot: L0
  module: Base de données
- Sécurité : l'amorçage retire à PUBLIC les fonctions de pg_catalog à effet de bord hors RLS (pg_logical_emit_message, grands objets, pg_cancel_backend, pg_terminate_backend) (F-RLS-04, US-049)
  lot: L0
  module: Équipe et CI
- Ajouté : règle de lint rueda/no-dynamic-sql, aucune requête construite à partir de données dans le code applicatif (17 §2.3 RLS-18, F-RLS-03, US-049)
- Corrigé : la matrice d'autorisations publie elle-même son actif de marque, sans dépendre de l'ordre des fichiers de test (F-RLS-05, US-049)

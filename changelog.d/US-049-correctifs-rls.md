lot: L0
module: Réservation

- Sécurité : un hôte ne pose ni ne lève plus de blocage de calendrier que sur un véhicule de son compte et de son pays selon le catalogue ; un véhicule inconnu est refusé (F-RLS-01, US-049)
- Sécurité : un co-hôte ou un membre invité du compte d'hôte ne réserve plus le véhicule de ce compte (SELF_BOOKING_FORBIDDEN, F-RLS-02, US-049)
- Sécurité : un hold ou un blocage à borne infinie est refusé, et un hold ne dépasse plus max_trip_days jours du pays (INVALID_PERIOD, RT-CONC-02, US-049)
  lot: L0
  module: Base de données
- Sécurité : sous app_worker, les clés de sujet ne sont plus lues ni créées que par les travailleurs qui chiffrent ou déchiffrent (evidence_ingest, evidence_verifier, privacy_request), et les journaux d'audit ne sont plus écrits que par les travailleurs de la matrice (F-RLS-06, US-049)
- Sécurité : l'amorçage retire à PUBLIC les fonctions de pg_catalog à effet de bord hors RLS (pg_logical_emit_message, grands objets, pg_cancel_backend, pg_terminate_backend) (F-RLS-04, US-049)
- Sécurité : `pg_notify` est retirée à PUBLIC et le job de déploiement échoue si une de ces fonctions reste exécutable par un rôle applicatif (F-RLS-04, US-049)
  lot: L0
  module: Équipe et CI
- Ajouté : règle de lint rueda/no-dynamic-sql, aucune requête construite à partir de données dans le code applicatif (17 §2.3 RLS-18, F-RLS-03, US-049)
- Modifié : rueda/no-dynamic-sql couvre l'accès calculé, `.call` / `.apply`, les alias de `query` et les étiquettes de gabarit inconnues ; l'exception unique est contrôlée par un test (US-049)
- Corrigé : la matrice d'autorisations publie elle-même son actif de marque, sans dépendre de l'ordre des fichiers de test (F-RLS-05, US-049)

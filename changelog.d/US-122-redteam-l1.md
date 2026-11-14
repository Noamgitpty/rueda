lot: L1
module: Équipe et CI

- Ajouté : red team du lot 1, première PR (RLS hôte / voyageur / pays, console et actions manuelles, KYC, auto-réservation, OTP, véhicules et annonces, interrupteurs à deux personnes, contenus éditables et logo) : tests d'attaque sous `packages/db/test/redteam/l1/` et `packages/i18n/test/`, rapport `docs/team/redteam/L1-rls-abus.md`, aucun correctif (US-122)

lot: L1
module: Console interne

- Corrigé : séparation des tâches unique dans la base (`core.support_actor_conflict`, ADR-122) : un membre du staff ne traite plus aucun sujet qui le concerne (son compte d'hôte, son dossier KYC, son véhicule, son annonce, sa contestation, sa demande, ou ceux d'un compte lié), pour toutes les actions de console et les files LISTING et CATALOG_ADDITION ; refus `SELF_FORBIDDEN` journalisé, 403 `STAFF_SELF_FORBIDDEN` (constats F-L1-C-01 à C-03, US-122)

lot: L1
module: Catalogue et annonces

- Corrigé : plafond de contestations de plaque ouvertes par compte d'hôte (`plate_claims_open_per_host`, 5 en PA et en PY, PROPOSÉ ; `CLAIM_LIMIT_REACHED`) et filtre de contact élargi (chiffres en lettres, ponctuation entre chiffres, « arroba », « punto com », lettres espacées, messageries abrégées) (constats F-L1-V-01, F-L1-F-01, US-122)

lot: L1
module: Réservation

- Corrigé : auto-réservation par un second compte de la même personne dont le permis découpe le nom autrement : signal `SAME_IDENTITY` par sac de mots et inclusion, même date de naissance (constat F-L1-S-01, US-122)

lot: L1
module: Marque et contenus (CFG)

- Corrigé : logo SVG contrôlé par analyse XML et liste blanche d'éléments et d'attributs, à l'enregistrement et à la lecture par le site (constat F-L1-B-01, US-122)

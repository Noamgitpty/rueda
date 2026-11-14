lot: L1
module: Qualité et CI

- Ajouté : performance de fumée par chemin critique (pose C1 en autocommit et en forme transactionnelle, conversion gardée, lecture du calendrier de l'hôte, publication d'une annonce), en PA et en PY, publiée à chaque passage de la CI dans l'artefact `perf-fumee` ; historique des p95 par commit de `main` avec attribution de chaque franchissement de cible (`scripts/qa/perf-history.mjs`) ; aucun seuil relâché (US-045, ADR-119)
- Ajouté : famille « Résilience et performance de fumée » obligatoire au tableau de bord QA de la nuit : rapport exigé, alerte S2 pour toute série au-dessus de sa cible de 17 §6.7 (US-045)
- Ajouté : FAKE hostiles au niveau des consommateurs (PSP, KYC, SMS et OTP, antivirus des photos et des documents) : lent, en panne, délai dépassé avant ou après l'effet, doublons, rappels hors d'ordre, tardifs ou perdus ; chaque chemin reste fail-closed, idempotent et sans double effet (US-045)
- Ajouté : passe de C2, C5 et C15 sans horloge virtuelle (L0-06, suite N-17), fixture de test 9962 (US-045)
- Modifié : 17 §2.5, révision ouverte de C1 en forme transactionnelle (suite N-16), seuil de 300 ms inchangé (US-045)

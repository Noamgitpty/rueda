# Procédure d'incident de sécurité et de violation de données (US-112)

Décision : [ADR-121](../adr/ADR-121-reprise-et-registre-des-incidents.md) (PROPOSÉ). Registre : `core.audit_security_incident` (migration 0094). Délais : paramètres `security_incident_authority_notice_hours` et `security_incident_subjects_notice_hours` (graine 0093, **72 h PA et PY, À DÉCIDER**, OQ-MK-09). Gabarits juridiques : [`docs/legal/notificacion-violacion-datos-borrador.md`](../legal/notificacion-violacion-datos-borrador.md) (**BROUILLONS**). Reprise technique : [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md). Registre Ley 81 (traitements, sous-traitants) : US-111, ADR-118.

> **Statut juridique** : délai, autorité, forme et contenu des notifications sont **à confirmer par l'avocat** au Panama (Ley 81 de 2019 et son règlement) et au Paraguay (OQ-MK-09). En attendant, on applique le défaut prudent : **72 h depuis la détection**, pour l'autorité **et** pour les personnes, dès que des données personnelles sont ou peuvent être touchées. La mise en service réelle est refusée tant que ces délais sont À DÉCIDER (GO_LIVE_CHECKLIST GL-14) et tant que cette procédure et ses gabarits ne sont pas validés (GL-16).

## 1. Ce qui est un incident

Tout événement qui atteint ou peut atteindre la confidentialité, l'intégrité ou la disponibilité des données ou du service. Natures du registre : `DATA_BREACH` (données personnelles lues, copiées, modifiées ou perdues par erreur ou par un tiers), `CREDENTIAL_LEAK` (secret, jeton, mot de passe exposé), `PSP_CREDENTIAL_COMPROMISE` (identifiants du compte marchand de Kmino), `AVAILABILITY` (indisponibilité, perte de données sans tiers), `OTHER`. **Dans le doute, on déclare** : une déclaration superflue se clôt sans notification ; une déclaration tardive peut faire manquer le délai légal.

## 2. Rôles et canaux

| Rôle                                | Qui                                                      | Canal                                                                                     |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Détection, déclaration, confinement | agent d'exploitation (agent orchestrateur), ou OPS_AGENT | alertes (`MONITORING.md`), journaux, signalement d'un utilisateur au support              |
| Responsable des données, décision   | **fondateur** (ADMIN ou SUPERADMIN, TOTP)                | courriel du sujet des alertes (`SECURITY_INCIDENT_OPENED`, P1) ; SMS en attente (Q-008 e) |
| Avis juridique                      | avocat PA, avocat PY (contrat du fondateur)              | courriel du fondateur ; jamais une donnée personnelle hors du strict nécessaire           |
| Sous-traitants concernés            | hébergeur, PSP, fournisseur KYC (registre US-111)        | canal de sécurité de leur contrat, par le fondateur                                       |
| Relecture du post-mortem            | agent de revue sécurité                                  | PR de la note d'incident                                                                  |

Astreinte (19 US-112, 17 §6.4) : agent orchestrateur + fondateur, contact humain unique. Heures couvertes : plage du support ; hors plage, la déclaration est faite par l'agent ou l'ops, le fondateur est alerté et répond au mieux. **Le délai légal court quand même** : c'est pourquoi l'alerte d'ouverture part dans les 5 minutes, et l'alerte de retard une fois l'échéance passée.

Aucun canal ne transporte de donnée personnelle : alertes et notes d'incident ne portent que des comptes, des codes et des identifiants d'incident.

## 3. Étapes

Commandes de la console du staff (sous `app_api`, session du staff, TOTP) ; l'écran viendra au lot 5, d'ici là l'agent prépare l'appel avec le fondateur. Chaque étape est datée par la base et journalisée (audit chaîné).

| #   | Étape                  | Qui (permission)                                           | Commande                                                                                                                                              | Délai                                   |
| --- | ---------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Déclarer               | OPS_AGENT, ADMIN, SUPERADMIN (`security.incident_declare`) | `core.security_incident_cmd_open(jeton, demande, pays, nature, gravité, données_personnelles, estimation, détection)` : **une ligne par pays touché** | dès la détection                        |
| 2   | Contenir               | idem                                                       | `core.security_incident_cmd_step(…, 'CONTAIN', NULL)` après le confinement (secret tourné, accès coupé, faille fermée)                                | au plus vite                            |
| 3   | Qualifier              | ADMIN, SUPERADMIN (`security.incident_manage`)             | `CONFIRM_PERSONAL_DATA` ou `NO_PERSONAL_DATA` (refusé après une notification)                                                                         | avant l'échéance                        |
| 4   | Notifier l'autorité    | idem                                                       | envoi du gabarit § A (avocat), puis `NOTIFY_AUTHORITY`                                                                                                | **échéance autorité** (72 h PROPOSÉES)  |
| 5   | Notifier les personnes | idem                                                       | envoi du gabarit § B, puis `NOTIFY_SUBJECTS`                                                                                                          | **échéance personnes** (72 h PROPOSÉES) |
| 6   | Clore                  | idem                                                       | post-mortem versé au magasin de preuves, puis `CLOSE` avec son identifiant                                                                            | après confinement et notifications      |

Règles tenues par la base (fail-closed) :

- **Échéance = détection + délai du pays**, posée à la déclaration, immuable ; détection saisie par le déclarant (jamais future), sinon l'instant de la déclaration. Délai du pays absent : échéance immédiate.
- **Données personnelles inconnues = touchées** : les échéances s'appliquent tant que l'incident n'est pas qualifié « sans donnée personnelle ».
- Clôture refusée sans confinement (`NOT_CONTAINED`), sans les deux notifications si des données personnelles sont ou peuvent être touchées (`NOTIFICATION_PENDING`), sans post-mortem dans un seau de preuves (`POSTMORTEM_REQUIRED`).
- Le registre est en ajout seul : ni suppression, ni réécriture d'une échéance ou d'un fait daté, ni modification d'une ligne close, quel que soit le rôle.
- Le travailleur `security_incident_watch` signale une fois chaque déclaration (`SECURITY_INCIDENT_OPENED`) et une fois chaque échéance dépassée sans notification (`SECURITY_INCIDENT_NOTICE_OVERDUE`, étiquette `notice` = `AUTHORITY` ou `SUBJECTS`).

## 4. Chronologie type (72 h PROPOSÉES)

| Depuis la détection | Geste                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 0 à 1 h             | déclarer (étape 1), confiner (étape 2), préserver les preuves (journaux, empreintes ; ne rien effacer), alerter le fondateur |
| 1 à 24 h            | qualifier : nature, données et personnes touchées, pays, sous-traitants ; premier avis de l'avocat                           |
| 24 à 48 h           | préparer les notifications (gabarits § A et § B) avec l'avocat                                                               |
| avant 72 h          | notifier l'autorité de chaque pays touché, puis les personnes ; enregistrer les étapes 4 et 5                                |
| après               | correctifs, post-mortem, clôture (étape 6) ; actions en stories                                                              |

Si une information manque à l'échéance, on notifie **ce qui est su** et on complète ensuite (gabarit § A, « notification complémentaire »).

## 5. Preuves et post-mortem

Ne rien effacer : journaux de l'hébergeur, journal d'audit chaîné, journal d'accès aux données (`data_access_log`). Le post-mortem (chronologie UTC, cause, données et personnes touchées, notifications envoyées, correctifs, actions) est versé au magasin de preuves (seau `PRIVATE_EVIDENCE` ou `DOCUMENTS`) ; son identifiant clôt l'incident. Une note sans donnée personnelle va dans `docs/team/incidents/AAAA-MM-JJ-<code>.md`.

## 6. Cas particuliers

- **Secret exposé** (dépôt public, journal) : tourner aussitôt (SECRET_ROTATION.md), déclarer `CREDENTIAL_LEAK` ; données personnelles touchées seulement si le secret y donnait accès.
- **Identifiants du PSP** : prévenir le PSP par son canal de sécurité, déclarer `PSP_CREDENTIAL_COMPROMISE`.
- **Fournisseur KYC ou autre sous-traitant** : il doit nous prévenir (clause de sous-traitance, US-111) ; le délai court depuis **notre** connaissance de la violation.
- **Indisponibilité sans tiers** : `AVAILABILITY`, `NO_PERSONAL_DATA` une fois établi ; reprise par DISASTER_RECOVERY.md.

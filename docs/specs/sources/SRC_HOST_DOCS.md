# SRC_HOST_DOCS — Turo côté hôte & opérations marketplace (rétro-ingénierie fonctionnelle, sources publiques)

> **Date de collecte :** 30 octobre 2026. **Périmètre :** côté hôte (US en priorité, différences UK / Canada / Australie / France signalées).
> **Méthode :** le centre d'aide `help.turo.com` expose une version Markdown de chaque article (`<url>.md`) et un sitemap public. Les 732 articles `en_us` ont été lus par des agents via ces versions publiques ; seuls des résumés paraphrasés sont conservés, aucune copie brute dans le projet (vérifié le 2026-10-30) ; lecture en masse = zone grise au regard des CGU, signalée à l'avocat (02 « Constat A24-04 / A24-05 », F-21, OQ-MK-10). Chaque article indique une date « Last updated », reprise ci-dessous comme date « as of ». Les pages marketing `turo.com` (list-your-car, host-tools, all-star-host, insurance, blog, carculator) renvoient **HTTP 403** aux outils automatisés et **n'ont pas été lues**. Seuls des extraits de moteur de recherche ont servi, marqués comme tels. Le prospectus S-1/A n°12 (SEC, 14/11/2024) a été lu en entier, illustrations comprises.
> **Statuts :** **DOC** = DOCUMENTÉ (source officielle Turo, y compris dépôts SEC) · **DOC-2** = DOCUMENTÉ-SECONDAIRE (tiers / presse / extrait de recherche) · **INF** = INFÉRÉ (déduction, justifiée).
> **Références :** chaque affirmation renvoie à un identifiant (H.., S.., P.., W..). Le tableau **§12** donne pour chacun l'URL complète, la date « as of » et la lisibilité. Tout le texte est paraphrasé, sans citation longue.
> **Devises :** « $ » = USD sauf mention contraire. Turo applique les mêmes montants nominaux en A$, CA$, € et £ dans les autres pays, sauf exception signalée (H109).

---

## 1. Éligibilité hôte et onboarding

### 1.1 Exigences hôte
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Âge minimum pour lister aux **US : 21 ans**. Un compte Turo est requis au préalable. | H02 | DOC | 2026-04-16 |
| Âge minimum : **Australie 21 ans**, **UK 18 ans**, **France 18 ans**. | H19, H17, H20 | DOC | 2026 |
| Conditions US : véhicule éligible, assurance auto valide, respect des règles légales et d'assurance locales, acceptation de la politique de tracking, et **webinaire d'orientation obligatoire** avant toute mise en ligne. | H02 | DOC | 2026-04-16 |
| Assurance personnelle ou commerciale **nommant le véhicule précis** obligatoire. Turo conseille de vérifier avec l'assureur que l'autopartage est permis. L'Australie exige en plus l'assurance CTP (« green slip »). | H11 | DOC | 2026-10-08 |
| Véhicule en leasing ou financé : l'hôte doit vérifier que son contrat autorise l'autopartage. | H02 | DOC | 2026-04-16 |
| Le véhicule doit être immatriculé au nom de l'hôte **ou** d'un propriétaire qui l'autorise à le lister. | H01 | DOC | 2026-07-13 |
| UK : police d'assurance active visible sur la Motor Insurance Database ; véhicule immatriculé au UK au nom de l'hôte ou d'une société britannique. | H17 | DOC | 2026-04-28 |
| Paiements : un compte **Stripe** est créé avec vérification d'identité lors de la première annonce. La vérification prend en général moins d'une minute, avec documents supplémentaires possibles. | H48 | DOC | 2026-05-04 |
| Après le webinaire, Turo examine si l'annonce est prête et la met en ligne **sous 24 à 48 h**. | H12 | DOC | 2026-04-16 |
| Les hôtes reçoivent une formation et l'accès aux règles d'hébergement avant leur premier véhicule. | H107 | DOC | 2026-09-11 |

### 1.2 Éligibilité véhicule — US
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Véhicule situé aux US et conforme aux règles de l'État. Plaques permanentes, temporaires ou équivalentes acceptées. **Plaques concessionnaire / « trader » interdites.** | H01 | DOC | 2026-07-13 |
| **Âge ≤ 12 ans**, sauf véhicules classiques ou de spécialité. | H01 | DOC | 2026-07-13 |
| **Kilométrage < 130 000 miles à la mise en ligne.** Un véhicule déjà listé qui dépasse ce seuil peut rester s'il est en excellent état et conforme. | H01 | DOC | 2026-07-13 |
| **Valeur de marché ≤ 200 000 $.** Turo couvre l'ACV jusqu'à 200 000 $. La valeur est fixée par des fournisseurs tiers à la mise en ligne. Au-delà, il faut contacter le support. | H01 | DOC | 2026-07-13 |
| Compteur kilométrique fonctionnel et non trafiqué. | H01 | DOC | 2026-07-13 |
| Titre « clean » : ni « branded » ni « salvage ». Le véhicule ne doit **jamais** avoir été déclaré perte totale. L'hôte doit connaître l'historique du titre (rapport Carfax suggéré). | H01, H04 | DOC | 2026 |
| Titres interdits : salvage, written-off, lemon/buyback, junk, reconstructed/rebuilt, odometer rollback, dommages inondation/eau/feu/grêle, véhicule **avec financement en cours** (formulation de H04), titre « washed » (réimmatriculé dans un autre État pour effacer la mention), historique Carfax non propre, mauvais résultat HPI (UK). Sanctions : retrait, annulation de la protection, suspension possible. | H04 | DOC | 2026-04-28 |
| **Types non éligibles :** limousines, tout-terrain, motos, camping-cars, dépanneuses, la plupart des 3-roues, véhicules exigeant un permis commercial, véhicules de **16 places ou plus** (soit 15 passagers + conducteur maximum). En **Californie : 10 places maximum**. La liste n'est pas exhaustive. | H01 | DOC | 2026-07-13 |
| **Camions-caisses (box trucks)** : autorisés dans tous les États sauf l'**Oregon**, sans freins pneumatiques. Poids total ≤ **10 000 lb** (NY et Caroline du Sud) ou ≤ **14 000 lb** ailleurs. Revue automatique de chaque annonce. | H05 | DOC | 2026-04-21 |
| New York : vignette d'inspection valide au moins jusqu'au mois suivant. Photo de la vignette et de l'immatriculation exigée. | H01, H08 | DOC | 2026 |
| **Véhicules classiques** : ≥ 25 ans, excellent état, valeur ≤ **85 000 $** (couverture plafonnée à 85 000 $). Une inspection peut être demandée. | H03 | DOC | 2026-04-21 |
| **Véhicules de spécialité** : 12 à 25 ans, revue approfondie, inspection de sécurité obligatoire, valeur ≤ 200 000 $. Critères : « luxueux », « unique » ou « rare ». Importés possibles sur demande. Turo peut refuser n'importe quel véhicule. | H03 | DOC | 2026-04-21 |
| Classes de valeur : **Deluxe = 45 000 à 85 000 $**, **Super Deluxe > 85 000 $** (US). Conditions côté guest : 25 ans minimum (Deluxe), 30 ans minimum (Super Deluxe), caution, contrôles renforcés. | H16 | DOC | 2026-10-27 |
| Seuils Deluxe / Super Deluxe hors US : AU A$60–99k / ≥A$100k ; CA CA$40–85k / >CA$85k ; FR 30–60 k€ / >60 k€ ; UK £30–60k / >£60k. En France, le guest doit avoir 7 ans de permis (Deluxe) ou 12 ans (Super Deluxe). | H16 | DOC | 2026-10-27 |

### 1.3 Éligibilité véhicule — autres pays
| Pays | Règles clés | Réf. | Statut | As of |
|---|---|---|---|---|
| UK | ≤ 12 ans ; valeur ≤ **£70 000** ; < 130 000 miles ; MOT et taxe routière valides ; **aucune modification** (sauf adaptation handicap) ; **≤ 9 places**. Exclus : haute performance, kit cars, conduite à gauche, classiques, spécialité, utilitaires (box/dropside/Luton/tipper vans). Vans combi/panel < 3,5 t admis. Toutes catégories Cat A/B/C/D/N/S/X interdites, contrôle HPI obligatoire. Boîtier tiers d'accès ou de données interdit, sauf OEM ou exigé par l'assureur. | H17 | DOC | 2026-04-28 |
| Canada | Provinces : AB, BC, NB, NL, NS, ON, PE, QC + Yukon. ≤ 12 ans ; **< 200 000 km** ; valeur ≤ **CA$150 000** ; ≤ 9 places ; plaques permanentes uniquement. Box trucks et Cybertruck en **Colombie-Britannique uniquement** (≤ 5 000 kg, < 26 pieds). | H18, H05 | DOC | 2026-04-28 |
| Australie | ≤ 12 ans ; < 200 000 km ; valeur ≤ **A$200 000** ; plaques permanentes, temporaires ou « P » (à retirer pendant le trajet) ; > 15 places et box trucks exclus. Spécialité : 12–25 ans avec entretien dans l'année ; classique : > 25 ans. Véhicules UHPV en Australie-Méridionale à déclarer. | H19 | DOC | 2026-05-04 |
| France | ≤ 12 ans à la mise en ligne ; **depuis le 6 janvier 2026, ≤ 18 ans pour rester** sur la plateforme (sauf véhicules de collection) ; valeur neuve ≤ **150 000 €** ; < **300 000 km** ; ≤ 9 places ; plaques WW interdites ; box trucks et haute performance exclus. | H20 | DOC | 2026-01-13 |

### 1.4 Informations requises, photos et qualité de l'annonce
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Informations saisies : **plaque d'immatriculation**, marque, modèle, année, photos, équipements. Ensuite : prix, plan, disponibilités, préférences, et en option remises, livraison et Extras. | H02 | DOC | 2026-04-16 |
| Le **VIN** sert à vérifier les rappels de sécurité à la mise en ligne, puis en continu. | H06 | DOC | 2026-04-21 |
| Le kilométrage ne doit pas dépasser les seuils (sinon c'est une fausse déclaration). La saisie du compteur à l'onboarding est **INF** : elle découle du contrôle des 130 000 miles. | H119, H01 | DOC / INF | 2026 |
| Équipements **ajoutés automatiquement selon la finition** (trim), sans possibilité de les supprimer. Champs « Additional options » et « Custom features » en texte libre, ces derniers seulement après la mise en ligne. Turo retire toute mention suggérant une conduite autonome sans surveillance. | H14 | DOC | 2026-10-28 |
| Photos : **au moins 1** obligatoire ; **10 recommandées** (extérieur sous tous les angles + intérieur). Recadrage automatique d'environ 20 %. **Interdits** : images générées ou retouchées par IA, photos de stock, texte en surimpression, publicités (y compris d'autres plateformes), remorquage, contenu indécent ou haineux. Masquer la plaque est autorisé. | H13, H02 | DOC | 2026-04-30 |
| Le classement en recherche (score ML) s'améliore avec plus de photos (≥ 10 conseillées). Une mise à jour est prise en compte en environ 5 minutes. | H111 | DOC | 2026-04-28 |
| Interdit dans l'annonce : téléphone, adresse, réseaux sociaux, mention de frais, cautions ou restrictions non prévus par les CGU. | H02 | DOC | 2026-04-16 |
| Recherche de rappels par VIN : **impossible de finaliser l'annonce** si un rappel est ouvert. | H06 | DOC | 2026-04-21 |
| Le processus d'approbation est hybride. Automatique pour l'éligibilité (VIN, valeur via fournisseur tiers, rappels, box trucks), manuel pour classiques, spécialité, importés, >200 000 $ et certains trackers (Ontario). Revue de l'annonce après le webinaire. | H01, H03, H05, H12, H15 | INF (assemblage de sources DOC) | 2026 |

### 1.5 Rappels de sécurité, inspections, entretien
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Après un avis de rappel, l'hôte doit retirer le véhicule **au plus tard 72 h** après notification. Sinon, le plan est annulé pour les trajets effectués. Turo envoie e-mail et SMS et **restreint** le véhicule. En **Californie et à Hawaï**, Turo annule sans pénalité les trajets 7 jours avant leur début, ou immédiatement s'ils commencent dans les 7 jours. | H06 | DOC | 2026-04-21 |
| La levée de la restriction est automatique dès que la base **NHTSA** montre la réparation. Sinon, l'hôte fournit le justificatif du concessionnaire (nom, date, rappel traité, VIN). | H07 | DOC | 2026-04-21 |
| Annulation pour rappel (US) **sans pénalité**. | H83, H87 | DOC | 2026 |
| **Inspection de sécurité annuelle** (US et Canada) par un mécanicien qualifié, à soumettre **sous 14 jours**. US exemptés : DE, HI, LA, ME, MD, MA, MO, NE, NH, NC, PA, RI, TX, VT, VA, WV. Pas d'inspection en Australie ni en France. UK : entretien annuel + MOT. | H08 | DOC | 2026-04-21 |
| Échéances : 12 mois (fin de mois) après la précédente inspection. Nouvelle annonce d'un modèle de l'année N-1 ou plus récent : 12 mois. **Autres nouvelles annonces : 6 mois.** Échéance manquée : retrait de la recherche. NY : restriction, puis annulation des trajets. Inspection virtuelle possible (test batterie 12 V). | H08 | DOC | 2026-04-21 |
| Standards d'entretien : batterie ≤ 5 ans (sinon test 12,1 V) ; plaquettes ≥ 3 mm ; pneus ≥ 4/32" (3,175 mm), sans craquelures, **< 6 ans** (US et CA) ; aucun voyant d'alerte ; impacts de pare-brise < 1" ; carrosserie : dégâts < 3" ; climatisation et chauffage fonctionnels. | H10 | DOC | 2026-10-08 |
| UK : véhicule de plus de 12 ans ou 130 000 miles = révision complète annuelle obligatoire. | H09 | DOC | 2026-04-21 |
| Remise en ligne après restriction : formulaire dédié + inspection complète (US/CA) ou facture de garage payée (AU/FR/UK). Partenariat **Discount Tire** (inspection gratuite des 4 pneus). | H134 | DOC | 2026-06-11 |

---

## 2. Création de l'annonce et paramètres

| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Book Instantly est désormais la norme** : le système accepte automatiquement toute réservation compatible avec les jours, heures et lieux disponibles. L'hôte doit honorer chaque trajet accepté. Le flux « demande puis acceptation par l'hôte » a disparu pour les réservations. | H21 | DOC | 2026-09-04 |
| Annonce blog Turo : Book Instantly devient le standard (rollout annoncé pour le S1 2024). Communiqué du 26/06/2024 : Book Instantly standard pour tous les trajets. | W1, P1 | DOC-2 (extrait de recherche / communiqué) | 2023–2024 |
| **Préavis (advance notice)** : délai minimum avant le début d'un trajet, réglable par lieu (domicile, livraison, personnalisé). **UK : véhicule > £15 000 → préavis d'au moins 1 jour obligatoire**, sinon le plan est annulé pour ce trajet. | H22, H109 | DOC | 2026 |
| **Tampon entre trajets (trip buffer)** : nombre d'heures à bloquer entre deux trajets. | H22 | DOC | 2026-04-28 |
| **Durée min/max** en jours. US et AU : si l'hôte accepte une prolongation au-delà du max, le guest peut ensuite le dépasser à nouveau. Durées maximales imposées en FR, UK et CA. | H22, H85 | DOC | 2026 |
| Heures de prise et de retour par défaut : **7h–22h en semaine, 7h–19h le week-end**, modifiables par lieu. | H23 | DOC | 2026-05-04 |
| Blocage du calendrier en mode journalier ou horaire, sur un ou plusieurs véhicules. « **Snooze** » (date de remise en ligne automatique) ou « **Unlist** » (durée illimitée). La suppression est définitive, et une annonce **ne peut pas être transférée** à un autre hôte. | H23, H132, H133 | DOC | 2026 |
| **Livraison** : gratuite, ou frais jusqu'à un maximum fixé par lieu. Jusqu'à **10 points d'intérêt** (aéroports, hôtels, gares) + livraison personnalisée dans un rayon à vol d'oiseau. Livraison gratuite possible au-delà d'une durée minimale. Groupes de véhicules par lieu. | H27, H110 | DOC | 2026-10-19 |
| Interdits en livraison : facturer le carburant de livraison ou le parking de récupération après le trajet, encaisser hors Turo, demander au guest de raccompagner l'hôte, livrer sur un aéroport sous restriction, ou placer le domicile du véhicule sur un aéroport (Turo facture alors des frais aéroport s'il a un permis). | H27, H120 | DOC | 2026 |
| Aéroports : Turo détient des **permis de livraison** dans certains aéroports (US et CA) et facture au guest des frais fixés par l'aéroport, sans marge. Amende de **100 $** (stationnement) ou **250 $** (activité interdite) pour l'hôte. Fonction de localisation guidée in-app. Exemple LAX : parking Budget Lot, **lockbox interdite**, déverrouillage constructeur obligatoire. | H124, H109, H27, H135, H93 | DOC | 2026 |
| Parking payant au lieu de prise : à signaler par **message programmé juste après la réservation**, sinon remboursement au guest prélevé sur l'hôte. Lien de paiement vers un service tiers interdit. L'hôte qui utilise « Park My Share » (LAX) paie lui-même. | H70 | DOC | 2026-06-24 |
| **Extras** : catégories « Conveniences » (recharge prépayée, kilométrage illimité, frais animal…) et « Gear » (siège enfant, vélos, kayak…). Liste fermée de **plus de 50 items**. Le **refuel prépayé est activé par défaut**. Interdits : caution ou frais déguisés, FSD Tesla, alcool, nourriture, armes, logement, remorquage, Extra obligatoire. Le guest ajoute ou retire un Extra sans accord avant le départ. Perte ou casse d'un Extra : à régler hors Turo. | H26 | DOC | 2026-10-28 |
| **Kilométrage inclus** : minimum journalier imposé selon valeur et pays. **US/UK : 200 mi standard, 100 mi Deluxe, 75 mi Super Deluxe** ; FR 200/150/100 km ; AU/CA 300/200/100 km. L'hôte peut augmenter ou offrir l'illimité, jamais descendre sous le minimum. Aucune restriction géographique possible. | H25 | DOC | 2026-06-29 |
| Distance hebdomadaire : remise ≥ 15 % → minimum local de **1 050 mi/sem (US/UK)** ; sinon journalier × 7. Mensuelle : remise ≥ 45 % → **3 300 mi/mois (US standard)** ou 1 800 mi (Deluxe et Super Deluxe) ; AU/CA 2 700 km ; FR/UK 1 800 km. | H25 | DOC | 2026-06-29 |
| Où les guests peuvent rouler : partout dans le pays d'origine du trajet. L'hôte ne peut pas interdire de passer d'un État ou d'une province à l'autre. | H128 | DOC | 2026-04-16 |
| Description, règles du véhicule et instructions : passent par les messages programmés (carburant, recharge VE, fonctions). La liste complète des champs n'est pas publiée. | H97, H70 | DOC (partiel) / INF | 2026 |
| Documents à garder dans le véhicule (US) : carte grise, preuve d'assurance personnelle, **Incident Information Card** Turo (version NY à part). Manquement : 100 $. | H131 | DOC | 2026-04-21 |
| Véhicule Tesla : compte Tesla liable (factures de recharge automatiques). Essai FSD gratuit d'1 mois pour les hôtes éligibles du 16/11 au 31/12/2026. Filtre « Self-driving » côté guest. | H65, H130, H139 | DOC | 2026-10-28 |

---

## 3. Tarification

### 3.1 Prix journalier, tarification dynamique, prix personnalisés
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Turo applique la tarification dynamique à toutes les annonces.** Facteurs : marque, modèle, valeur de marché ; recherches en temps réel ; prix réservés et utilisation passés (du véhicule et de véhicules similaires) ; prévisions d'offre et de demande locales (journalières et saisonnières) ; **coûts de l'hôte** ; facteurs propriétaires. | H28 | DOC | 2026-07-15 |
| Modifier les prix exige d'abord un **tutoriel obligatoire** sur la tarification dynamique. Prix réglables par date, plage ou ensemble de dates, sur un ou plusieurs véhicules. | H28, H24 | DOC | 2026 |
| **Alerte** si le prix est ≥ 20 % au-dessus du prix recommandé : jours surlignés en jaune, avec risque de moindre visibilité. | H28 | DOC | 2026-07-15 |
| Graphique « Future prices » : recommandations sur **90 jours**, mises à jour quotidiennement. Bannières mensuelles et notifications push. | H28 | DOC | 2026-07-15 |
| **Last-minute boost** : +5 % par défaut sur les réservations du jour même si le préavis est < 24 h. Ajustable. | H28 | DOC | 2026-07-15 |
| Prix recommandés par défaut (dynamic pricing) pour US, Canada et UK. | H24 | DOC | 2026-05-04 |
| Un prix proche de la recommandation améliore le score de recherche. | H111 | DOC | 2026-04-28 |
| Le nom historique « Automatic pricing » apparaît encore dans le Carculator (prix journalier issu du modèle « Turo Automatic Pricing »). Le centre d'aide parle désormais de « dynamic pricing ». | W4 | DOC-2 (extrait) | n.d. |
| Prix du trajet = somme des prix journaliers, remises appliquées. Unité minimale facturée : **1 jour**. | H29 | DOC | 2026-04-16 |

### 3.2 Remises
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Remises de durée activées d'office** : 3 jours, 1 semaine, 2 semaines, 3 semaines, mois. **Minimums imposés : 3 %, 5 %, 10 %, 15 %, 20 %.** Elles doivent croître avec la durée. Pour sortir d'une remise, l'hôte réduit la durée max (ex. 29 jours pour exclure le mensuel, qui démarre à 30 jours). | H30 | DOC | 2026-06-29 |
| Remise hebdo ≥ 15 % = droit de baisser la distance hebdo. Remise mensuelle ≥ 45 % = droit de baisser la distance mensuelle. | H30, H25 | DOC | 2026-06-29 |
| **Remise « non remboursable » de 10 %** pour les réservations faites **4 jours ou plus à l'avance**. Fixe : l'hôte ne peut ni la modifier ni s'en retirer. L'hôte garde ses gains si le guest annule. | H30, H29 | DOC | 2026-06-29 |
| Cumul séquentiel : remise de durée d'abord, puis non-remboursable. La page guest présente un exemple additif (10 % + 5 % = 15 %) : incohérence à noter (§11). | H30, H29 | DOC | 2026 |
| Trajets > 30 jours : « Pay as you go » (30 jours payés à la réservation, puis par tranches de 30 jours débitées 30 jours à l'avance). Si annulation après le délai de grâce de 24 h, l'hôte garde les 30 premiers jours. | H30 | DOC | 2026-06-29 |
| **Codes promo post-trajet** de 5, 10 ou 15 %, plafonnés à 100 $, valables 90 jours, usage unique, sur tous les véhicules de l'hôte, cumulables. Proposés au moment de noter le guest. | H30 | DOC | 2026-06-29 |
| Une remise de durée n'est pas réappliquée aux jours de prolongation d'un trajet payé (les jours ajoutés peuvent avoir leur propre remise). Si un raccourcissement fait passer sous un seuil, le guest paie le complément. | H30, H86 | DOC | 2026 |
| Remise mensuelle recommandée abaissée de 60–70 % à **45 %** (+36 % de gain moyen, environ 736 $/mois selon Turo). Frais de trajet supprimés au-delà de 30 jours. Protection guest −50 %. | P2 | DOC-2 | 2025–2026 |

### 3.3 Frais divers (côté guest, impact hôte)
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Kilomètre supplémentaire** = prix journalier ÷ distance journalière, calculé à la réservation, remises incluses. Exemple : 3 jours × 100 $ et 200 mi/jour → 0,50 $/mi. L'hôte touche ce montant × sa part hôte. | H25, H63 | DOC | 2026 |
| **Frais jeune conducteur** : moins de 25 ans (US, AU, UK), moins de 26 ans (FR), aucun au Canada. Conducteur principal uniquement, non remboursable, revient à Turo. | H124 | DOC | 2026-10-28 |
| Fourchette des frais jeune conducteur : 30 à 50 $/jour. | P2 | DOC-2 | 2025 |
| Conducteur additionnel : **5 $/jour, plafonné à 25 $** par trajet. | H124 | DOC | 2026-10-28 |
| **Frais de trajet (trip fee)** côté guest : pourcentage variable du prix (valeur du véhicule, préavis, durée, risque). Plus élevé à NY. Non remboursable. | H124 | DOC | 2026-10-28 |
| Fourchette des trip fees : 2,5 % à 100 % du prix de location. | P2 | DOC-2 | 2025 |
| **Cautions US** : 750 $ (Deluxe, moins de 30 ans), 750 $ (Super Deluxe), 500 $ (NY), 250 $ (San Fernando Valley), 200 $ (choix du système de sécurité). −250 $ avec assurance personnelle. Remboursée **80 h** après la fin du trajet s'il n'y a ni dommage, ni facture impayée, ni dépannage. | H125 | DOC | 2026-04-21 |
| Retard : 0–29 min gratuit ; 30 min–1h59 = ½ jour moyen ; ≥ 2 h = 1 jour + **20 $**. Plus 50 $ de frais de retour non conforme, 3 % de frais admin, et frais aéroport le cas échéant. | H69 | DOC | 2026-07-09 |

### 3.4 Estimation des gains (Carculator)
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Le Carculator® estime les gains par marque, modèle et région à partir de données de trajets réels et du prix « Automatic Pricing ». Estimation mensuelle × 12. Classement par « ROI annualisé » = gains annuels ÷ mensualités de prêt (hypothèse UK : 10 % d'apport, 8,5 % d'APR, 60 mois). Coûts de possession non déduits. | W4 | DOC-2 (extrait ; pages 403 ou 404) | n.d. |
| Page « earn » : **10 489 $/an par voiture en moyenne** (moyenne mensuelle 2025 des hôtes US × 12). | W3 | DOC-2 (extrait) | 2025 |
| S-1 : exemple d'économie d'un hôte. Voiture de 27 000 $ achetée avec 10 % d'apport, prêt 60 mois à 7,5 %. Revenu hôte de 10 658 $/an ; assurance et franchises 1 106 $/an ; entretien 2 223 à 3 203 $/an ; mensualités 6 256 $/an. Profit cumulé de **7 123 $ sur 3 ans** (2,7×, TRI de 65 %). | S1, S3 | DOC | 2024-11-14 |

---

## 4. Plans de protection hôte (« Earnings plans »)

### 4.1 Historique des noms
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Avant le 7 janvier 2026 (US)** : 5 plans nommés **60, 75, 80, 85 et 90** (part hôte en %). **Franchises : 0 $ / 250 $ / 750 $ / 1 625 $ / 2 500 $.** RC de 750 000 $ (1 250 000 $ à NY). L'usure extérieure n'était couverte que sur le plan 60. | H35 | DOC | PDF Turo |
| **Depuis le 7 janvier 2026** : 3 plans ; les « protection plans » deviennent des « **earnings plans** » le 31/03/2026 ; part hôte variable dans certains marchés à partir du 02/04/2026. | H31 (date du 7/1) ; W2, P2 (dates de mars et avril) | DOC / DOC-2 | 2026 |
| Plan attribué par défaut à toute nouvelle annonce : **US « More peace of mind »**, AU et CA idem, **France plan 85**, **UK « Balanced »**. Modifiable à tout moment, par véhicule ou pour toute la flotte. Effet sur les nouveaux trajets seulement. Un plan est **obligatoire pour chaque véhicule**. | H34 | DOC | 2026-05-13 |

### 4.2 Plans US actuels
| Plan | Part hôte | Responsabilité dommages (par sinistre) | RC tiers | Délai factures carburant, recharge, km | Newsletter | Réf. | Statut |
|---|---|---|---|---|---|---|---|
| More peace of mind | **70 %** | **250 $** | jusqu'à 750 000 $ (300 000 $ à NY) | **5 jours (120 h)** | trimestrielle | H31, H32 | DOC (2026-08-18) |
| Balanced | **80 %** | **1 500 $** | 750 000 $ (minimums légaux à NY) | **4 jours (96 h)** | semestrielle | H31, H32 | DOC |
| More earnings | **90 %** | **2 750 $** | 750 000 $ (minimums légaux à NY) | **3 jours (72 h)** | annuelle | H31, H32 | DOC |

| Détail | Réf. | Statut | As of |
|---|---|---|---|
| **Part hôte variable** à Austin, Dallas, Detroit, Las Vegas, Maui, Philadelphie, Phoenix, San Diego et Seattle, selon l'antériorité de la réservation. **28 jours et plus : 80 / 90 / 100 %** ; **14–27 j : 75 / 85 / 95 %** ; **3–13 j : 70 / 80 / 90 %** ; **0–2 j : 65 / 75 / 85 %** (Peace / Balanced / Earnings). S'applique aussi aux km supplémentaires, à l'usage additionnel et aux retards. Figée à la réservation. Conservée en cas d'échange de véhicule. | H33 | DOC | 2026-10-19 |
| **Assiette** : la part hôte s'applique au prix du trajet. Aux US et au Canada, aussi aux **Extras et à la livraison** (trajets réservés depuis le 08/10/2026 ; France depuis le 19/10/2026). **AU et UK : 90 %** des Extras et de la livraison. Reversés à **100 %** : carburant, recharge, PV, péages, frais de nettoyage et tabac. | H33, H26, H27 | DOC | 2026-10 |
| Les « frais Turo » sur le reçu hôte couvrent la plateforme **et** le coût du plan. | H33 | DOC | 2026-10-19 |
| Les dommages physiques sont un **remboursement contractuel de Turo, pas une assurance** (US et UK). Remboursement au-delà de la responsabilité de l'hôte, au choix de Turo : coût de réparation, ou **ACV plafonnée à 200 000 $** en cas de perte totale. Dans l'État de Washington, une assurance achetée par Turo couvre ces dommages. | H31, H11 | DOC | 2026-08-18 |
| La responsabilité de l'hôte s'applique à **tous** les dommages : extérieur, intérieur, pneus, vitrage, mécanique. Elle n'est jamais remboursée à l'hôte, et l'hôte ne peut pas récupérer ce montant auprès du guest après un dossier confié à Turo. | H31 | DOC | 2026-08-18 |
| **RC** : police **Travelers Excess and Surplus Lines** ; sinistres gérés par **Constitution State Services**. PIP et UM/UIM aux minimums légaux ou écartés quand c'est permis. NY : minimums légaux depuis le 17/06/2026 (1 250 000 $ avant). Plus de couverture exigée dans certains États et aéroports. Turo Insurance Agency : (415) 508-0283. | H31 | DOC | 2026-08-18 |
| Période couverte = **période de réservation**. Livraison : RC seulement, aucun remboursement de dommages physiques. Le retour vers l'hôte n'est pas couvert. | H31, H27 | DOC | 2026 |
| **Exclusions** : dommages préexistants ; usure intérieure ; **usure extérieure ≤ 3"** (tous plans, même cumulée) ; détérioration (rouille, décoloration, pneus, courroies…) ; pannes mécaniques (sauf faute du guest ; embrayage traité à part) ; tout dommage pendant ou après une violation des CGU ; objets personnels ; **pneus < 4/32", sous-gonflés ou de 6 ans ou plus** ; dessous de pare-chocs et soubassement ; intérieur des bennes et fourgons ; toits Jeep non peints < 3". | H31 | DOC | 2026-08-18 |
| **Pas de perte de revenus ni de véhicule de remplacement** aux US. **Pas de moins-value.** Aucune garantie sur la qualité des réparations, sauf dans le réseau « Turo-trusted ». | H31, H41, H42 | DOC | 2026 |
| Frais de gardiennage : raisonnables, **plafond de 2 500 $** sauf retard imputable à Turo. Californie : garage membre du BAR obligatoire. Prestataire préféré (vitrage, clés) : remboursement plafonné au tarif de ce prestataire. Profit et frais généraux exclus si le garage appartient à l'hôte. | H31, H72 | DOC | 2026 |
| **Garages exclus** depuis le 18/08/2026 (liste d'environ 47 garages, quasi tous en Californie du Sud, pour « problèmes de facturation documentés »). | H43, H31 | DOC | 2026-08-27 |
| Véhicule valant **125 000 $ ou plus** sans tracker OEM actif, ou si l'hôte ne fournit pas la localisation : retenue **jusqu'à 20 %** des dommages couverts. | H31, H15 | DOC | 2026 |
| Perte totale : cession du titre (et livraison du véhicule si demandé) **ou** ACV diminuée de la valeur de l'épave (meilleure offre tierce obtenue par Turo). Pas d'assurance GAP. | H31, H40 | DOC | 2026 |
| Pièces : véhicule de 2 ans ou moins **et** < 24 000 mi → pièces OEM ; sinon, la moins chère entre aftermarket, LKQ et OEM. Clés couvertes (sauf France). Accessoires fixes couverts (jantes, covering) ; galeries et Extras exclus. Équipements PMR couverts. | H44 | DOC | 2026-05-12 |
| Embrayage : remboursement **au prorata** de la durée de vie restante (base 75 000 mi), moins la franchise. Exige un certificat ASE de mauvais usage. | H45 | DOC | 2026-04-28 |
| Fraude présumée : Turo peut passer en **« reimbursement-only »** (factures détaillées, preuves de paiement ; reçus en espèces insuffisants). Inspection diagnostique ou réinspection possible aux frais de Turo. Recherche bancaire : jusqu'à 50 $ de frais. | H31 | DOC | 2026-08-18 |

### 4.3 Autres pays
| Pays | Plans (part hôte / responsabilité) | Particularités | Réf. | Statut | As of |
|---|---|---|---|---|---|
| UK | Peace of mind **60 % / £0** ; Balanced **70 % / £250** ; More earnings **80 % / £1 750**. Plafond ACV £70 000. | Peace of mind seulement : véhicule de courtoisie (un seul véhicule listé, réparation > 3 jours, max **£350**) et perte de revenus (max **£300**, 1 jour par tranche de 4 h de main-d'œuvre, base 60 jours, plafond 30 jours, minimum £25). Garages agréés payés TTC ; sinon versement HT. Tracker obligatoire au-dessus de £25 000. Dépôt d'expertise jusqu'à £300. | H36, H41, H109 | DOC | 2026-06-15 |
| Canada | Earnings **85 % / CA$2 000** ; Balanced **75 % / CA$250** ; Peace of mind **65 % / CA$0** (+ véhicule de remplacement jusqu'à CA$500). RC **CA$2 000 000**. Plafond CA$150 000. | Assurance réelle : Economical (8 provinces) et ICBC (C.-B.). Couvre aussi la période de livraison (sauf C.-B.). Traversée vers les US permise ; Mexique interdit. | H37, H11, H27 | DOC | 2026-09-28 |
| Australie | Peace of mind **65 % / A$100** (indisponible pour les vans) ; Balanced **75 % / A$750** ; More earnings **85 % / A$2 500**. RC **A$20 M**. Plafond A$200 000. | Produit **Turo Travels Mutual** (mutuelle) distribué via l'AFSL de Picnic Licensing. CTP obligatoire. Réseau de réparateurs imposé. Épave propriété de Turo. Plans en vigueur depuis le 31/03/2026. | H38 | DOC | 2026-05-25 |
| France | **Plan 80 : 0 € de franchise** ; **85 : 500 €** ; **90 : 1 000 €**. RC corporelle illimitée, matérielle 100 M€, incendie 2 M€. Plafond 150 000 €. | Assureur **Baloise Assurances Luxembourg** (LPS). Franchise de **25 000 €** si la politique tracker n'est pas respectée (vol ou retard). Turo peut restreindre l'accès aux plans 80 et 85 selon la sinistralité. Aucune couverture pendant la livraison. | H39, H40, H27 | DOC | 2026-09-25 |

### 4.4 Plans guest (contexte)
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Plans guest US : **Premier (0 $)**, **Standard (500 $)**, **Minimum (3 000 $)** de reste à charge sur les dommages physiques. RC aux minimums légaux, secondaire (primaire à NY). Premier exclu pour les moins de 21 ans et certains véhicules (> 25 000 $ ou > 60 000 $). Pas d'assurance : contrat avec Turo. Aucun plan n'est obligatoire. | H126, H124 | DOC | 2026-10-21 |
| Plan hôte et plan guest sont **indépendants**. L'hôte et le guest peuvent tous deux payer une part sur un même sinistre. | H32, H72 | DOC | 2026 |

---

## 5. Paiements, fiscalité, remboursements et sinistres

### 5.1 Versements
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Seul moyen : virement bancaire via Stripe** (numéro de compte + routing). Aucune mention de PayPal dans le centre d'aide actuel. Les versements de sinistres se font par **Visa Debit ou chèque via Stripe**, parfois directement au garage. | H46, H49, H31 | DOC | 2026 |
| US : **1er trajet → versement initié environ 3 jours ouvrés** après la fin. **Trajets suivants → 3 heures** après la fin. **Trajets de plus d'une semaine → versement partiel tous les 7 jours.** Une seule opération par jour (regroupements possibles). La banque met ensuite **3 à 5 jours ouvrés**. | H46 | DOC | 2026-05-04 |
| Hors US : environ 3 jours ouvrés de traitement Stripe, puis 3 à 5 jours bancaires. Partiels aux jours 7, 14… Versement en devise locale. | H47 | DOC | 2026-04-28 |
| Premier versement après saisie des coordonnées bancaires : délai possible de **14 jours**. Versements suspendus si une nouvelle vérification Stripe est nécessaire. | H49, H51 | DOC | 2026 |
| Gains affichés **hors TVA et taxe de vente** (depuis le 15/12/2023). Export CSV. Historique des transactions. Section fiscale. | H50 | DOC | 2026-05-04 |
| Écarts de versement : changement de plan, frais d'annulation ou de violation, remboursements accordés, versements partiels, livraison gratuite ou remises. | H51 | DOC | 2026-06-24 |
| Compte fermé par Turo : versements par virement, récapitulatif fiscal par année envoyé par e-mail. Aucun trajet possible ensuite en tant que guest. | H107 | DOC | 2026-09-11 |

### 5.2 Fiscalité
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **1099-K** (US) : formulaire fiscal soumis à temps, personne US, **20 000 $ brut ET 200 transactions** (ou seuil plus bas selon l'État). Envoi électronique avant le 31 janvier. Copie papier sur demande avant le 31/12. | H52 | DOC | 2026-04-16 |
| Formulaire W-9/W-8 in-app, validé **en temps réel auprès de l'IRS** (SSN ou EIN). Classification « Individual » (y compris LLC à associé unique) ou « Business ». LLC ajoutable uniquement sur le web. Prénom préféré ou nom commercial affichable. | H53, H58, H136 | DOC | 2026 |
| Canada : déclaration annuelle à l'ARC (règles plateformes numériques) avant le 31/01. Les entreprises doivent avoir un BN et un compte TPS/TVH, vérifiés par Stripe. | H54 | DOC | 2026-04-08 |
| Australie : régime SERR, déclarations à l'ATO avant le 31/07 et le 31/01, validation en temps réel. | H55 | DOC | 2026-04-21 |
| **Taxe de vente** : Turo collecte en tant que « marketplace facilitator » ou sous les lois P2P dans **tous les États sauf le Delaware**. Hawaï : GET + RMVST. **Texas** : taxe prélevée sur les gains de l'hôte. Taxes spécifiques (ex. Anchorage 8 %, Arizona, Floride avec surtaxe journalière, Indiana). | H57, H56, H127 | DOC | 2026 |
| AU : GST sur les frais Turo et sur les gains de l'hôte. CA : TPS, TVH et TVQ sur les frais Turo. FR : TVA sur les frais Turo. UK : TVA uniquement sur les services Turo aux hôtes. | H56 | DOC | 2026-04-16 |
| Lois P2P listées pour 26 États (AK, AZ, CA, CO, CT, DE, FL, GA, HI, IL, IN, KS, KY, LA, ME, MD, NV, NY, OH, OK, OR, TN, TX, VA, WA, WV). En Californie, l'assureur ne peut pas résilier un hôte pour cause d'autopartage. | H127 | DOC | 2026-05-04 |

### 5.3 Remboursements (« reimbursement invoices »)
| Type | Délai pour facturer | Preuves exigées | Montant | Réf. | Statut |
|---|---|---|---|---|---|
| Carburant | **72 h** (H59) ; selon le plan US, 72 / 96 / 120 h (H31) | photos de la jauge avant et après (métadonnées), ticket ≤ 72 h après le trajet | carburant manquant + **10 $** | H59, H62, H31 | DOC |
| Recharge VE (en cours ou après le trajet) | 72 h (ou fenêtre du plan) | facture auto si compte Tesla lié ; sinon photos batterie et compteur (captures de l'app Tesla refusées) | calcul auto | H65 | DOC |
| Km supplémentaires | 72 h (ou fenêtre du plan) | compteur pré-rempli, sinon photos | prix/mi × part hôte | H63 | DOC |
| Péages | **90 jours** ; tardifs : sous 30 jours après l'avis et dans les **180 jours** | facture auto **7 jours** après le trajet si compte péage lié ; sinon photo (date, lieu, plaque ou VIN) | 100 % | H61, H71 | DOC |
| PV / amendes | 90 jours ; AU/CA jusqu'à 365 jours pour certains | photo du PV + reçu payé | 100 % (+ frais admin) ; refusé pour PV liés au véhicule | H64 | DOC |
| Nettoyage | 72 h | photos | **150 $** facturé au guest (+3 % pour Turo) ; FR 50 € | H66, H59 | DOC |
| Tabac | 72 h | preuves (aveu, cendre, brûlures, mégot) | **150 $** (+3 %) ; FR 50 € | H67 | DOC |
| Retard / usage additionnel | signalement après **30 min**, **sous 24 h** ; facturation sous 72 h | — | barème §3.3 | H68, H69, H59 | DOC |

| Règle | Réf. | Statut | As of |
|---|---|---|---|
| Le guest a **48 h** pour payer ou contester. En cas de contestation, l'hôte a **72 h** pour annuler, réviser ou escalader. Sans réponse : escalade automatique au support. | H59 | DOC | 2026-09-21 |
| Trajets de 60 jours ou plus : facturation possible en cours de trajet (recharge, péages, PV), une facture ouverte à la fois. | H59, H61 | DOC | 2026 |
| Facture inéligible : **50 $ / 200 $ / 500 $** (1re, 2e, puis chaque récidive) + reprise du remboursement. Factures interdites : usure, préexistant, parking de récupération, doublons, montant non justifié, véhicule en perte totale. | H60 | DOC | 2026-05-06 |
| Rien n'est ajouté automatiquement : l'hôte doit envoyer la facture. Motif de refus le plus fréquent : photos hors délai. | H51 | DOC | 2026-06-24 |
| Extras « refuel prépayé », « recharge prépayée » et « km illimités » : pas de facturation ensuite. | H26 | DOC | 2026-10-28 |

### 5.4 Sinistres (damage claims)
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Déclarer le dommage **au plus tard 24 h après la fin du trajet**. Photos avant le trajet prises dans les **24 h avant le départ** et téléversées **jusqu'à 24 h après le départ**. Photos après le trajet prises et téléversées **sous 24 h**. **Métadonnées date, heure et géolocalisation obligatoires.** Dispense pour panne mécanique, remorquage ou fourrière. | H73, H80, H31 | DOC | 2026 |
| Toutes les pièces justificatives **dans les 15 jours** suivant la déclaration. | H73 | DOC | 2026-07-23 |
| Choix du parcours : l'hôte saisit un devis ; Turo affiche ce qu'il toucherait **en direct avec le guest** et **via un dossier Turo**. | H73, H78 | DOC | 2026 |
| En direct : devis **sous 72 h**. Le montant demandé est plafonné au reste à charge du plan du guest (sauf assurance personnelle du guest), caution incluse. Escalade possible **sous 20 jours** (ou plus si l'assureur du guest traite le dossier). Facture impayée après 20 jours et supérieure à la responsabilité de l'hôte : escalade automatique. | H78, H74 | DOC | 2026-10-12 |
| Dossier Turo : contact sous 24 h ouvrées (H72) ou 2 à 3 jours ouvrés (H75). **Éligibilité tranchée en 3 jours ouvrés max.** Expertise photo par un **expert tiers**, souvent en moins d'un jour ; sur place, **5 à 7 jours**. Paiement par lien électronique, reçu en environ **4 jours ouvrés**. | H72, H75 | DOC | 2026 |
| Vol : enquête avec la police, **jusqu'à 30 jours** après le rapport. | H72 | DOC | 2026-10-12 |
| **Supplément** (dommages découverts en cours de réparation) : déposé **par le garage** sous **45 jours** après le premier paiement, avec le véhicule au garage. Impossible si l'hôte a été payé par le guest. | H76 | DOC | 2026-04-28 |
| Dommage préexistant : Turo verse la **différence** entre les devis avant et après (> 3", et tout dégât de vitrage). | H77 | DOC | 2026-04-28 |
| Diagnostic mécanique sur papier à en-tête requis (un devis ne suffit pas). | H72 | DOC | 2026-10-12 |
| Pneus : responsabilité de l'hôte si défaut, flanc, usure, mauvais gonflage, < 4/32", craquelures, **plus de 6 ans**. | H79 | DOC | 2026-08-21 |
| Équipe sinistres US : claims@turo.com, du lundi au samedi de 5h à 17h PT, +1 (415) 965-4525, réponse sous 2 jours ouvrés. | H75 | DOC | 2026-05-21 |
| Pénalités hôte : sinistre sans photos valides **25 $** ; sinistre abusif **50 $** ; fausse déclaration **200 à 2 000 $**. | H109, H121 | DOC | 2026 |
| Côté guest : échéancier de paiement sans frais (≤ 5 000 $ : 2, 4 ou 8 mois ; > 5 000 $ : 4, 6 ou 8 mois), puis recouvrement. | H82 | DOC | 2026-04-21 |
| Vendeurs partenaires : Safelite (compte Turo 566544), Gerber, Caliber, Discount Tire, lockboxes Olympus Lock (−20 % / −33 %). | H78, H31, H134, H93 | DOC | 2026 |

---

## 6. Gestion des réservations

| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Pas d'acceptation ni de refus des réservations** (Book Instantly universel). Le délai de réponse aux demandes de réservation n'existe donc plus en pratique. Il subsiste pour les **demandes de modification** envoyées à l'hôte. | H21, H85 | DOC / INF | 2026 |
| Modifications **automatiques** si elles respectent la disponibilité et les réglages : dates, heures, prolongation, fin anticipée, lieu. Sinon, l'hôte confirme ou refuse ; une demande expirée vaut refus. **Un accord oral ou par message ne vaut rien** et peut faire perdre la protection. | H85, H86 | DOC | 2026-04-16 |
| Prolongation demandable **jusqu'à 24 h après la fin**. Fin anticipée de moins de 3 h : accord par message. Départ jusqu'à **1 h plus tôt** : accord informel. | H86, H68 | DOC | 2026-04-16 |
| **Annulation par l'hôte** : **25 $** si plus de 24 h avant le départ, **50 $** si moins. **Avis automatique** sur l'annonce, baisse en recherche, impact sur le statut All-Star. Hôte All-Star : frais annulés, réponse possible à l'avis. | H83 | DOC | 2026-09-11 |
| **20 trajets ou moins** : 1re annulation → annonces retirées jusqu'au **webinaire « annulations »** ; 2e → retrait 3 jours ; 3e → procédure de fermeture du compte. | H83 | DOC | 2026-09-11 |
| **Plus de 20 trajets** (US/CA/UK) : taux > **5 %** → retrait **7 jours** + webinaire ; > **10 %** → fermeture. AU : > 5 % → 7 jours ; > 10 % → fermeture. FR : > 5 % → 7 jours + webinaire ; > 10 % → 7 jours ; > 15 % → fermeture. | H83 | DOC | 2026-09-11 |
| Remise en ligne **24 à 48 h** après le webinaire. | H88 | DOC | 2026-05-19 |
| Annulation excusée possible : dommage ou retard du trajet précédent ; le guest réserve à nouveau sous 24 h ; **première annulation sur les 10 derniers trajets** ; sécurité ou malaise documenté ; catastrophe naturelle ; blessure grave ou décès ; rappel (US). | H87 | DOC | 2026-04-28 |
| « Profiteering » (annuler pour revendre plus cher) : **250 $** ou l'écart de gains. Demander au guest d'annuler à sa place = annulation hôte. | H109, H83 | DOC | 2026 |
| **Hôte absent** : véhicule ou hôte absent **30 min** après l'heure de départ → traité comme une annulation hôte + **150 $** (FR : 100 €). | H83, H89, H109 | DOC | 2026 |
| **Guest absent** : attente de **2 h** (US/CA/UK) ou **30 min** (AU/FR), délai de réponse de 15 min au premier message. Signalement **sous 72 h** obligatoire, sinon aucun gain. Gains : trajet de 2 jours ou moins → part hôte de **75 % d'une journée** ; plus long → **2 journées** ; + ½ livraison. Ne pas déclarer une absence = gains retirés. | H90, H91, H109 | DOC | 2026-09-15 |
| Annulation par le guest : trajet non remboursable annulé plus de 24 h après la réservation → **gains complets**. Remboursable annulé dans les 24 h avant le départ → part de ½ journée (2 jours ou moins) ou d'une journée (plus) + ½ livraison. Annulation gratuite si 24 h ou plus avant le départ. Compte fermé par Turo → aucun gain. | H84 | DOC | 2026-09-11 |
| **Check-in** : vérifier le permis **avant le départ** (6 points : nom, date de naissance, photo, validité, aucune restriction, permis temporaire avec photo). Option de vérification manuelle 1 h avant. Aucun upload du guest 1 h avant et pas de rencontre possible → annuler (= absence du guest). Permis refusés : numérique, apprenti, photocopie, IDP seul. Seul le conducteur principal est vérifié. | H92, H94 | DOC | 2026 |
| Photos avant et après le trajet : intérieur, extérieur, compteur, carburant ou charge (métadonnées). Le guest est invité à faire **15 photos extérieures et 8 intérieures** + clé, lockbox et portes verrouillées au retour. | H92, H81 | DOC | 2026 |
| **Accès à distance** : déverrouillage via les apps constructeur (Mercedes, FordPass, Hyundai, Kia, Tesla, Toyota, Honda, Mazda, BMW, Chevrolet…) **avec clé physique obligatoire** dans une pochette anti-RF ; ou **lockbox** avec **code changé à chaque trajet**, communiqué par message seulement après vérification. Cachettes interdites (roue, trappe à carburant, pare-brise, extérieur, paillasson) : vol non couvert. AU : lockbox de vitre interdite. UK : lockbox dans le véhicule obligatoire. | H93, H92 | DOC | 2026-10-02 |
| « **Turo Go** » (déverrouillage par Bluetooth ou réseau mobile depuis l'app Turo) cité dans le S-1. **Absent du centre d'aide actuel** : remplacé par les apps constructeur. | S1, H93 | DOC / INF | 2024 / 2026 |
| **Échange de véhicule** avant le départ (une seule fois) : mêmes réglages (livraison, Extras, km, plan, boîte), classe égale ou inférieure, gains inchangés ; refus du guest = annulation. Pendant le trajet : via le support (US +1 415-849-3398), alignement de prix attendu. | H95 | DOC | 2026-04-16 |
| **Retour non conforme** (clé, lockbox, lieu, non-réponse **sous 2 h**) signalable. Faux signalement : 50 $. | H96 | DOC | 2026-08-24 |
| **Assistance routière US** 24/7 : +1 (415) 965-4525. Déplacement payé par Turo. Intervention sur place due à l'entretien : **60 $**. Remorquage pour entretien ou usure : **350 $** + éventuellement 100 $. Remorquage de plus de 75 mi demandé : 350 $. Véhicule absent à l'arrivée : **40 $**. Sans réponse sous 24 h : gardiennage à la charge de l'hôte. | H97 | DOC | 2026-08-20 |
| Assistance UK : **Allianz** (£250 de déplacement, £120 de remorquage, jusqu'à £500). FR : **Mutuaide** (remorquage pris en charge jusqu'à 200 €). CA : remorqueur tiers « NSD ». | H98, H99, H100 | DOC | 2026 |

---

## 7. Performance de l'hôte

| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **All-Star Host** (évaluation trimestrielle sur 365 jours, sans candidature) : compte sans violation active ; **20 trajets ou plus** (annonces supprimées comprises) **ou 80 jours de location sur 5 trajets** ; **taux de 5 étoiles ≥ 85 %** ; **entretien ≥ 80 %** ; **propreté ≥ 80 %** (trajets non notés inclus) ; **annulations ≤ 3 %**. | H101 | DOC | 2026-04-21 |
| Avantages All-Star : badge, bannière et filtre de recherche ; frais d'annulation annulés ; **code de 100 $** après 4 trimestres consécutifs (envoyé le 15 du dernier mois du trimestre, valable 180 jours). Statut conservé tout le trimestre. | H101 | DOC | 2026-04-21 |
| Depuis le 08/10/2024 : un 5 étoiles global sans note d'entretien ou de propreté compte comme 5 étoiles sur ces deux critères. | H101 | DOC | 2026-04-21 |
| **Le taux de réponse n'est plus un critère All-Star.** | H101 | INF (absent de la liste) | 2026 |
| **Power Host US** (sur invitation) : critères All-Star + **4 véhicules ou plus** avec au moins un trajet sur 365 jours + au moins 1 véhicule listé + **36 000 $ ou plus de gains sur 365 jours**. UK : 3 véhicules, **£10 000**. CA : 3 véhicules, **CA$20 000**. AU : 4 véhicules, **A$15 000** (seuils tenus 3 mois). | H102, H103, H104, H105 | DOC | 2026 |
| Avantages Power Host US : équipe « Host Success » (conseil business : assurance, parking, financement) ; support dédié **7j/7 de 6h à 20h PT** (powerhostsupport@turo.com) ; sinistres revus en 2 à 3 jours ouvrés ; **vitrage jusqu'à 100 $ et pneus jusqu'à 200 $ sans franchise** ; financement (prêts, lignes de crédit, leasing TRAC) ; accès anticipé aux nouveautés. | H102 | DOC | 2026-08-27 |
| **Standards qualité** : taux de 5 étoiles sur 90 jours. **65 % au 14/09/2026, 67,5 % au 04/01/2027, 70 % au 26/04/2027.** En dessous : **fermeture du compte**. Taux d'entretien sur les **10 derniers trajets** : doit dépasser **50 %** (depuis le 14/09/2026, contre 30 % avant) puis **60 %** (04/01/2027), sinon blocage automatique jusqu'à une inspection physique. | H10 | DOC | 2026-10-08 |
| Note de l'hôte vers le guest : **3 étoiles ou moins → le guest ne peut plus réserver chez cet hôte**. Les guests régulièrement mal notés sont exclus. | H106 | DOC | 2026-09-04 |
| **Fermeture du compte** (discrimination, annonce trompeuse, marché gris, annulations, qualité) : préavis de **30 jours** (ou **90 jours après le dernier trajet** s'il en reste). Fermeture immédiate en cas de fraude. Trajets prévus à plus de 72 h annulés sans gains. Délais de facturation après fermeture : péages et PV 90 jours, autres 72 h. Appel possible au UK et en FR. | H107 | DOC | 2026-09-11 |
| Barème de pénalités complet (H109) : avertissement formel puis **500 $ / 1 000 $** ; marché gris **150 $ + 5 500 $ de dommages forfaitaires** ; fausse déclaration sur le véhicule 100 $ (+200 $ si dépannage) ; lieu 100 $ ; nettoyage (annulation) 50 $ ; entretien US 100 $ + 350 $. | H109, H118, H119, H120 | DOC | 2026-06-04 |
| Tableau de bord hôte : Trajets (réservés, historique, calendrier) ; Messagerie ; Véhicules (annonces, sinistres, réglages) ; **Business (gains, performance et statut All-Star, avis)** ; Lieux (POI, groupes) ; « Recent updates ». | H110, H137 | DOC | 2026-04-21 |
| Classement en recherche : modèle ML (photos, prix, livraison aéroport, moyenne des notes, activité, réactivité aux modifications). | H111 | DOC | 2026-04-28 |
| L'hôte peut répondre publiquement aux avis et demander le retrait d'une note. | Index H141 (articles « respond to reviews » / « request removal ») | DOC (titres seulement) | 2026-09 |

---

## 8. Hôtes professionnels et flottes

| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| **Hosting teams** : nombre d'équipes illimité ; chacune doit avoir au moins 1 co-hôte vérifié, 1 véhicule et 1 permission. Invitation valable **30 jours**. Le co-hôte crée et vérifie son propre compte. **L'hôte principal reste responsable** des actes de ses co-hôtes. Le « custodian » historique doit être réinvité comme co-hôte. | H112, H115 | DOC | 2026-04-23 |
| Permissions en **2 lots non séparables**. « **Trip management** » (par défaut) : photos, check-in et check-out (app uniquement), support, messages, proposition d'échange, notifications, réponses aux demandes, facturation des frais, consultation des trajets. « **Pricing & availability** » : prix, remises, disponibilités, calendrier. | H114 | DOC | 2025-11-12 |
| Interdit aux co-hôtes : déclarer un sinistre, programmer des messages, voir les réglages, les données business et de performance, les reçus, les gains et la fiscalité. Les factures sont émises au nom de l'hôte principal. | H114, H113 | DOC | 2026 |
| Outils multi-véhicules : calendrier multi-véhicules (tri par prix, plaque, jours réservés) ; prix et blocages en masse ; distances et remises en masse ; groupes de véhicules par lieu ; changement de plan pour toute la flotte ; liaison péage et Tesla par véhicule. | H24, H23, H25, H27, H34, H71 | DOC | 2026 |
| S-1 : en 2023, **84 % des hôtes actifs** étaient des particuliers avec **2 véhicules ou moins**. Les petites entreprises et pros ont souvent commencé comme particuliers. | S1 | DOC | 2024-11-14 |
| « **Turo Host Services** » (financement, assurance hors trajet), équipes améliorées, programme de « **revenu passif** » qui associe des propriétaires sans temps disponible à des hôtes expérimentés (annonce du 26/06/2024). | P1, H117, S1 | DOC (communiqué) | 2024-06-26 |
| **Pas d'API publique** pour les gestionnaires de flotte : accès tiers coupé en **avril 2023** ; partenaires stratégiques sous contrat privé ; les hôtes passent par des exports CSV et iCal. Outils tiers : VEVS (iCal + e-mails), Fleetwire (automatisations touchées), FleetSync et FleetOS (extensions Chrome), Standard Fleet (−15 %). | P6, P7, P8 | DOC-2 | 2023–2026 |
| Smartcar a mené un pilote de location sans clé au Canada (2021). Statut actuel inconnu. | P10 | DOC-2 | 2021 |
| **« Commercial host / Bring your own insurance »** : des sources tierces anciennes décrivent un hôte qui refuse la protection Turo, déclare sa police commerciale et laisse **7,5 %** à Turo. Le centre d'aide actuel exige qu'**un earnings plan soit attaché à chaque véhicule** et qu'il soit choisi parmi l'offre Turo. **Ce programme n'est donc plus documenté et semble supprimé.** | W6 ; H34, H11 | DOC-2 vs DOC → INF | 2026 |
| Aucun programme d'usage commercial côté guest (usages nécessitant un permis commercial interdits). Usage **professionnel** (Uber, Lyft, DoorDash, Amazon Flex) autorisé aux US **sauf CA, MN, NY et OR**, interdit hors US. | H122, H123 | DOC | 2026 |
| Parrainage d'hôtes (13 marchés US) : **300 $** chacun après 3 trajets ou 15 jours sans annulation, en 6 mois, sans plafond. | H116 | DOC | 2026-06-10 |

---

## 9. Modèle économique et opérations

### 9.1 Chiffres SEC (S-1/A n°12, 14/11/2024)
| Affirmation | Réf. | Statut |
|---|---|---|
| Au 30/09/2024 : **environ 150 000 hôtes actifs, 350 000 véhicules actifs, 3,5 M guests actifs**, plus de 16 000 villes. « Actif » = au moins 1 trajet sur 12 mois glissants. | S1 | DOC |
| GBV : 351,6 M$ (2019) ; 335,9 M$ (2020) ; 1 256,4 M$ (2021) ; 2 061,0 M$ (2022) ; **2 409,7 M$ (2023)** ; 1 980,3 M$ (9 mois 2024). Jours réservés : 24,4 M (2023). | S1 | DOC |
| CA net : 469,0 M$ (2021, +213 %) ; 746,6 M$ (2022, +59 %) ; **879,7 M$ (2023, +18 %)** ; 722,0 M$ (9 mois 2024, +8 %). Résultat net : 154,7 M$ (2022), 14,7 M$ (2023), 19,4 M$ (9 mois 2024). | S1 | DOC |
| Marge brute : 54,3 % (2022), 51,4 % (2023), 46,3 % (9 mois 2024). Marge de contribution : 25,4 % (2023). Coût du CA en hausse à cause du programme de protection hôte. | S1 | DOC |
| **Exemple de réservation d'1 jour** (GBV de 100 $) : prix du véhicule 60 $ → **hôte 51 $ (85 %)**, Turo 4,50 $ (frais marketplace hôte 7,5 %) + 4,50 $ (services hôte 7,5 %). Guest : 15 $ de services et protection + 12 $ de frais marketplace (fixés par le Turo Risk Score), **100 % pour Turo**. Remboursements 7 $ (100 % hôte). Taxes 6 $. **Hôte 58 % du GBV, Turo 36 %.** | S2 | DOC |
| Revenus = « Marketplace Fees » + « Value-Added Services Fees » (protection, livraison, Extras), comptabilisés **en net** (Turo est agent). | S1 | DOC |
| Hausse du take rate hôte en **juillet 2021**. | S1 | DOC |
| **Turo Risk Score** (IA et ML) depuis **avril 2020 aux US** et **juin 2023 au Canada** : fixe les frais guest en temps réel et filtre au paiement. | S1 | DOC |
| 2023 : **34 %** des jours sur des réservations de 7 à 29 jours, **7 %** sur 30 jours ou plus ; **89 %** de trafic organique ; **57 %** des jours venant de guests récurrents. | S1 | DOC |
| Risques couverts par une combinaison d'assurance tierce, de rétention propre, d'un **assureur captif**, de produits financiers régulés et de réserves. Washington : protection dommages adossée à une police captive. | S1 | DOC |
| Support : **24/7 aux US, au Canada et en Australie** ; support (horaires non précisés) au UK et en FR. **973 employés** (30/09/2024), dont 104 en opérations et support. Acquisition de **OuiCar** (France) en mai 2022. | S1 | DOC |
| Concurrents cités : Getaround, Avail, Hiyacar ; loueurs traditionnels ; Zipcar, Enterprise CarShare, Gig, Communauto. | S1 | DOC |
| Retrait de l'IPO : formulaire RW du **13/02/2025** (12 amendements S-1/A entre 2022 et 2024). | S4 | DOC |

### 9.2 Après le S-1
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| CA 2024 estimé à **958 M$** (+9 %), GBV 2024 de 2,5 Md$, 1,5 Md$ versés aux hôtes en 2024, objectif de 1 Md$ de CA en 2025. Environ 140 000 hôtes et 340 000 véhicules. Environ 15 % des effectifs licenciés en 2025. Getaround a quitté les US début 2025. Intégration **Uber Rent** active en mai 2025. Actifs de **Kyte** rachetés en juillet 2025. Commission hôte moyenne d'environ 25 % (15–45 %), **chiffre d'avant 2026**. | P2 | DOC-2 (estimations Sacra) | 2025–2026 |
| Plus de **4 Md$** cumulés versés aux hôtes (juin 2024). | P1 | DOC (communiqué) | 2024-06-26 |
| Réservation Turo **depuis l'app Uber** (US, sauf NY, OR et WA). | H129 | DOC | 2026-04-21 |
| Partenariat Uber annoncé le 05/09/2024, multi-pays. | P4 | DOC-2 | 2024 |
| Kyte : annonce du 17/07/2025, montant non communiqué. | P3 | DOC-2 | 2025 |

### 9.3 Confiance, sécurité, support, présence géographique
| Affirmation | Réf. | Statut | As of |
|---|---|---|---|
| Vérification : profil, téléphone, permis ; le guest est filtré au paiement ; la caution est déclenchée par le système de sécurité. L'hôte confirme le permis au check-in. | S1, H125, H94, H115 | DOC | 2026 |
| Fraude côté hôte : réinspections, mode « reimbursement-only », métadonnées photo obligatoires, liste noire de garages, pénalités pour fausse déclaration. | H31, H43, H121 | DOC | 2026 |
| AirTags interdits comme traqueurs. Caméra intérieure ou audio seulement avec **accord écrit du guest par message**. Données des trackers utilisées pour récupérer un véhicule, juger une conduite dangereuse ou être transmises aux assureurs et à la police. Seuils tracker : US ≥ 125 000 $ (OEM) ; AU ≥ A$75 000 ; Ontario ≥ CA$60 000 (TAG ou KYCS, sinon jusqu'à CA$30 000 retenus) ; reste du Canada ≥ CA$105 000 ; FR : moins de 10 ans ou ≥ 25 000 €. | H15 | DOC | 2026-10-12 |
| Paiements hors plateforme interdits (Bitcoin, espèces, PayPal, Venmo…). Exceptions : parking en espèces, Extra endommagé, dommage réglé hors Turo. | H118 | DOC | 2026-04-21 |
| Support : assistant IA « Ask Turo » / « Get help » puis agent ; libre-service in-app (factures, signalements). | H102 | DOC | 2026-08-27 |
| Pays : **US, Australie, France, UK, Canada** (ON, QC, BC, AB, NS, PE, NB, NL + Yukon ; Manitoba, Saskatchewan, NWT, Nunavut non couverts). | H128 | DOC | 2026-04-16 |
| Advocacy : site **OpenRoad** (taxes, aéroports, assurance, sécurité ; campagne 2026). Aucune donnée chiffrée. | P9 | DOC | 2026 |
| Aéroport John Wayne : licence de 5 ans à 10 % des recettes brutes. | P2 | DOC-2 | 2025 |

---

## 10. Autres fonctionnalités hôte (même mineures)
- **Messages programmés** (instructions, parking) ; **messagerie** avec historique. (H70, H97 — DOC)
- **Liaison aux agences de péage** (transpondeur prioritaire sur la plaque ; option « Don't track ») et facturation automatique. (H71 — DOC, 2026-04-28)
- **Liaison au compte Tesla** : factures de Supercharge (y compris frais d'attente et de congestion) ; essai FSD. (H65, H130 — DOC)
- **Restriction automatique** du véhicule si un dommage le rend dangereux ; levée sur preuve de réparation. (H73 — DOC)
- **Fourrière**, **récupération par l'hôte lui-même** (US/CA) : articles dédiés. (Index H141 — DOC, titres)
- **Véhicules accessibles en fauteuil roulant** : équipements couverts. (H44 — DOC)
- **Pneus neige** : uniquement avec le symbole 3PMSF ; les chaînes ne comptent pas comme équipement. (H119 — DOC)
- **Inspection pré-trajet en Tasmanie** ; frais de déplacement UK (zones à péage, congestion) ; voyage UE depuis le UK. (Index H141 — DOC, titres)
- **Webinaires** : orientation (obligatoire) et annulations (pour remise en ligne). (H12, H88 — DOC)
- **Avis IA** : Turo intègre un connecteur dans Claude et une app dans ChatGPT côté guest (titres d'articles). (Index H141 — DOC, titres)
- **Paiement fractionné** côté guest (Affirm, Afterpay, Klarna). (Index H141 — DOC, titre)

---

## 11. Questions ouvertes et contradictions
1. **Commercial hosting / « bring your own insurance »** : décrit par des sources tierces (7,5 % pour Turo), mais le centre d'aide actuel impose un earnings plan pour chaque véhicule. À vérifier : existe-t-il encore un canal hors plan pour les grandes flottes ?
2. **Date exacte de Book Instantly obligatoire** : rollout annoncé pour le S1 2024, mais aucune date précise trouvée. Pourtant H113 et H114 mentionnent encore « accepter les réservations » : vocabulaire hérité ?
3. **Délais de facturation carburant et km** : 72 h dans H59, mais 3, 4 ou 5 jours selon le plan dans H31 et H32. Le plan semble l'emporter (INF).
4. **Cumul des remises** : séquentiel dans H30, additif dans l'exemple de H29.
5. **Ordre des remises de durée** : H30 dit « égale ou supérieure », puis « strictement inférieure ».
6. **Gains en cas d'annulation guest ou d'absence** : 50 % ou 100 % d'une journée (annulation, H84) contre 75 % ou 200 % d'une journée (absence, H90). Logique différente pour deux situations proches.
7. **Délais de contact sinistres** : 24 h ouvrées (H72) contre 2 à 3 jours ouvrés (H75).
8. **Frais de dépannage en France** : 90 € par intervention (H109) contre 200 € de frais administratifs (H09).
9. **1099-K** : dates contradictoires (soumission le 12 ou le 15 janvier 2026 ; H53 cite encore 2025).
10. **H107** affiche « Last update : 2026-11-9 », une date future : anomalie éditoriale.
11. **Nombre d'hôtes actifs** : 165 000 (30/06/2024, extrait secondaire) puis 150 000 (30/09/2024, S-1/A n°12), et environ 140 000 selon Sacra. Baisse probable.
12. **Commission moyenne** de Sacra (25 %, 15–45 %) : basée sur l'ancienne grille (60–90 %). La grille actuelle va de 10 à 30 %, et jusqu'à 0 % en part variable.
13. **Taux de réponse** : jadis métrique hôte, absent de toute la documentation actuelle (conséquence probable de Book Instantly, INF).
14. **Turo Go** : marque citée dans le S-1, absente du centre d'aide de 2026. Abandonnée ou renommée ?
15. **PayPal** : jamais mentionné comme mode de versement. Seul Stripe est documenté.
16. **Liste complète des champs d'annonce** (description, règles) : non publiée dans le centre d'aide ; il faudrait l'app.
17. Le contenu des pages marketing Host Hub et Carculator (statistiques, ROI par modèle) n'a pas pu être vérifié directement (403).

---

## 12. Sources consultées (ID → URL → date « as of » → lisibilité)
**Centre d'aide** — base `https://help.turo.com/en_us/` + slug. Lu via la variante `.md` officielle, lisibilité **complète** (sauf mention).

| ID | Slug | As of |
|---|---|---|
| H01 | vehicles-we-accept-rylmrNl45 | 2026-07-13 |
| H02 | listing-a-vehicle-us-ryVXrEeVq | 2026-04-16 |
| H03 | classic-and-specialty-vehicles-us-Sy8WuBHZC | 2026-04-21 |
| H04 | ineligible-vehicle-titles-B1DvLEe49 | 2026-04-28 |
| H05 | box-trucks-hosts-Sk111wtlkl | 2026-04-21 |
| H06 | safety-recall-regulations-B1DELEgE5 | 2026-04-21 |
| H07 | safety-recalls-HyU48VgE5 | 2026-04-21 |
| H08 | annual-vehicle-safety-inspections-ByJmUVg4c | 2026-04-21 |
| H09 | maintenance-requirements-ryNmIVxNc | 2026-04-21 |
| H10 | quality-standards-SJ10p9JEJl | 2026-10-08 |
| H11 | insurance-and-earnings-plan-requirements-hosts-S1TvINxVq | 2026-10-08 |
| H12 | orientation-webinar-us-hosts-rkmw4DTnWe | 2026-04-16 |
| H13 | listing-photos-guide-rJBHuRQSh | 2026-04-30 |
| H14 | vehicle-features-us-canada-hosts-Bk3q4JHo1g | 2026-10-28 |
| H15 | tracking-and-technology-devices-SkF48Nl49 | 2026-10-12 |
| H16 | deluxe-class-and-super-deluxe-class-eligibility-Syv7H4lV5 | 2026-10-27 |
| H17 | meeting-vehicle-requirements-or-uk-Syu3iEgv9 | 2026-04-28 |
| H18 | meeting-vehicle-requirements-or-canada-ryYjTRW8c | 2026-04-28 |
| H19 | vehicle-eligibility-au-Hy7rf1yBi | 2026-05-04 |
| H20 | vehicle-eligibility-france-r1nVktcan | 2026-01-13 |
| H21 | using-book-instantly-BJvHz8yIq | 2026-09-04 |
| H22 | setting-trip-duration-BJZpGUJIc | 2026-04-28 |
| H23 | setting-your-car's-availability-BkpBSVxVq | 2026-05-04 |
| H24 | setting-custom-prices-HJmHSVgNc | 2026-05-04 |
| H25 | distance-limits-and-additional-distance-SkWUrEgVc | 2026-06-29 |
| H26 | how-extras-work-hosts-rkKLHExEc | 2026-10-28 |
| H27 | how-vehicle-delivery-works-hosts-B1HUH4eVq | 2026-10-19 |
| H28 | setting-your-vehicle-price-S12VrVlVc | 2026-07-15 |
| H29 | trip-pricing-ByXmVNgN5 | 2026-04-16 |
| H30 | offering-discounts-rJJHrVxVq | 2026-06-29 |
| H31 | earnings-plans-in-detail-us-hosts-ByMOIVxEc | 2026-08-18 |
| H32 | earnings-plans-in-brief-us-hosts-ryy_U4gE9 | 2026-05-21 |
| H33 | earnings-and-host-share-r1zDrNlNc | 2026-10-19 |
| H34 | updating-a-vehicle-earnings-plan-rJS2S4eNq | 2026-05-13 |
| H36 | earnings-plans-in-brief-uk-hosts-ByiuUNl4c | 2026-06-15 |
| H37 | earnings-plans-in-brief-canada-hosts-HyN_U4eVc | 2026-09-28 |
| H38 | earnings-plans-au-hosts-rkPsWGdHi | 2026-05-25 |
| H39 | protection-plans-in-brief-france-hosts-rJiEbwZa2 | 2026-09-25 |
| H40 | vehicle-actual-cash-value-(acv):-calculation-and-limits-ryJFLVxNc | 2026-04-28 |
| H41 | loss-of-hosting-income-ByfqLEgV5 | 2026-04-28 |
| H42 | vehicle-diminution-after-damage-BJP_9wu89 | 2026-04-28 |
| H43 | repair-facilities-ineligible-for-reimbursement-B1qpzq8Gl | 2026-08-27 |
| H44 | use-and-coverage-of-aftermarket-parts-BkKPU4eV9 | 2026-05-12 |
| H45 | clutch-repair-reimbursement-SJfvUNlEc | 2026-04-28 |
| H46 | getting-paid-SyALrVeN9 | 2026-05-04 |
| H47 | getting-paid-hosts-outside-the-us-H1tQqvban | 2026-04-28 |
| H48 | setting-up-an-account-to-get-paid-HJVvHNeNq | 2026-05-04 |
| H49 | setting-up-or-changing-direct-deposit-HkDwB4xE5 | 2026-05-04 |
| H50 | viewing-your-earnings-HyFwSVeNq | 2026-05-04 |
| H51 | wrong-or-missing-earnings-Bk2Pr4eV5 | 2026-06-24 |
| H52 | receiving-a-1099-k-form-r1cFHEl4q | 2026-04-16 |
| H53 | completing-w-8-and-w-9-tax-forms-S1uFHVgV5 | 2026-05-06 |
| H54 | completing-the-tax-information-form-canada-hosts-SygVb0Vmyx | 2026-04-08 |
| H55 | completing-the-tax-information-form-australia-hosts-HyQlfRV7yl | 2026-04-21 |
| H56 | sales-tax-or-hosts-B12KBExN5 | 2026-04-16 |
| H57 | sales-tax-or-guests-B1AEVNeE9 | 2026-10-01 |
| H58 | add-llc-to-an-account-BywFNnYNo | 2026-05-04 |
| H59 | reimbursement-invoice-guidelines-hosts-SyCDS4eVc | 2026-09-21 |
| H60 | ineligible-reimbursement-invoices-and-damage-reports-SJ4FBNlV5 | 2026-05-06 |
| H61 | how-to-charge-guests-for-tolls-hosts-SkCOrNlE9 | 2026-07-29 |
| H62 | how-to-charge-guests-for-vehicle-refueling-hosts-S1d_r4xV5 | 2026-07-29 |
| H63 | how-to-charge-guests-for-additional-distance-hosts-Hy5uBEeE5 | 2026-07-29 |
| H64 | how-to-charge-guests-for-tickets-hosts-SJhuBVx45 | 2026-07-31 |
| H65 | how-to-charge-guests-for-ev-costs-hosts-HklyFMHSfx | 2026-07-29 |
| H66 | cleaning-and-disinfection-policy-or-hosts-B1PrUNe49 | 2026-04-21 |
| H67 | no-smoking-policy-or-hosts-BJkUINg4q | 2026-04-21 |
| H68 | reporting-a-late-return-H15iBExV5 | 2026-04-16 |
| H69 | additional-usage-policy-or-hosts-HkVwLNxE9 | 2026-07-09 |
| H70 | charging-guests-for-parking-HkevHNgNq | 2026-06-24 |
| H71 | linking-your-account-to-a-toll-agency-us-hosts-S1iUt10d6 | 2026-04-28 |
| H72 | reporting-and-resolving-damage-or-us-hosts-SymY8VlN5 | 2026-10-12 |
| H73 | reporting-damage-Bk7aIWhHi | 2026-07-23 |
| H74 | viewing-and-managing-claims-dashboard-S1FAwXad5 | 2026-04-28 |
| H75 | contacting-claims-or-hosts-rya5IVlN5 | 2026-05-21 |
| H76 | damage-supplement-us-and-canada-hosts-B14qINl4c | 2026-04-28 |
| H77 | claims-with-prior-damage-rkv98EeNc | 2026-04-28 |
| H78 | resolving-damage-directly-with-your-guest-rJjYLNe4q | 2026-10-12 |
| H79 | flat-tire-damage-or-hosts-ByZ78NlNq | 2026-08-21 |
| H80 | taking-damage-photos-Hk6tLVlN5 | 2026-06-22 |
| H81 | trip-photos-guide-or-guests-HytcE4g49 | 2026-08-21 |
| H82 | payment-plans-for-damage-claims-r1O2jEmykl | 2026-04-21 |
| H83 | canceling-a-trip-with-your-guest-hosts-HkkzLVlE5 | 2026-09-11 |
| H84 | trips-canceled-by-guests-or-turo-hosts-BkGMU4gV9 | 2026-09-11 |
| H85 | responding-to-trip-requests-and-changes-HyfsHVlE9 | 2026-04-16 |
| H86 | managing-requests-to-extend-or-shorten-a-trip-BJDjrVg45 | 2026-04-16 |
| H87 | excusing-host-cancellation-fee-rk1bAtBB9 | 2026-04-28 |
| H88 | completing-the-cancellations-webinar-SyvSJaP0Ze | 2026-05-19 |
| H89 | host-no-shows-HyejENeNc | 2026-04-21 |
| H90 | how-to-manage-a-guest-no-show-SkNzL4g4q | 2026-09-15 |
| H91 | guest-trip-start-failures-HJUfENeVq | 2026-09-15 |
| H92 | checking-in-a-guest-H1gsHEg4c | 2026-06-22 |
| H93 | how-to-grant-remote-vehicle-access-to-guests-hosts-BycSSE_cn | 2026-10-02 |
| H94 | confirming-a-license-us-hosts-SJQejiJto | 2026-04-17 |
| H95 | vehicle-swaps-hosts-r13srEe4c | 2026-04-16 |
| H96 | how-to-report-an-improper-return-hosts-ByOtsfUDMg | 2026-08-24 |
| H97 | roadside-assistance-us-hosts-r1V8NgVc | 2026-08-20 |
| H98 | roadside-assistance-or-uk-hosts-rJNEI4l49 | 2026-08-21 |
| H99 | roadside-assistance-france-hosts-SJSSrn5ah | 2026-06-30 |
| H100 | roadside-assistance-canada-hosts-HyrTdKWQA | 2026-06-16 |
| H101 | all-star-host-program-r18TBExV5 | 2026-04-21 |
| H102 | power-host-program-or-us-ry1laC6Nc | 2026-08-27 |
| H103 | power-host-program-or-uk-BypWE7JSc | 2026-06-09 |
| H104 | power-host-program-rkzbtKnN5 (Canada) | 2026-06-09 |
| H105 | power-host-program-australia-BJhwqCxK2 | 2026-06-09 |
| H106 | impacts-of-rating-and-reviewing-guests-hosts-S1cS7K_Ofg | 2026-09-04 |
| H107 | turo-initiated-account-closures-hosts-H1VFT5tQp | 2026-09-11 |
| H108 | policy-violations-r1X6NVgV5 | 2026-04-28 |
| H109 | host-fees-r1aIIExV5 (Violation fees) | 2026-06-04 |
| H110 | navigating-host-tools-and-metrics-H1pSVlEq | 2026-04-21 |
| H111 | improving-vehicle-visibility-in-search-B1Bqn8iF2 | 2026-04-28 |
| H112 | create-a-hosting-team-rk_2ODtop | 2026-04-23 |
| H113 | managing-a-hosting-team-HkjUugs33 | 2026-04-28 |
| H114 | permissions-for-hosting-teams-Sklzc59oT | 2025-11-12 |
| H115 | becoming-a-co-host-B1Acvgj3h | 2026-04-28 |
| H116 | faqs-host-referral-program-us-BkFI1rLbMl | 2026-06-10 |
| H117 | vehicle-financing-and-off-trip-insurance-us-hosts-r1KLqKuU0 | 2026-04-21 |
| H118 | gray-market-transaction-policy-or-guests-ryrrN4eV9 | 2026-04-21 |
| H119 | vehicle-misrepresentation-SkLQ84eNc | 2026-04-21 |
| H120 | vehicle-location-misrepresentation-rytBLNxN5 | 2026-04-21 |
| H121 | material-misrepresentation-BkKQ84xE9 | 2026-06-22 |
| H122 | commercial-uses-policy-BkCR4VlN9 | 2026-04-28 |
| H123 | professional-uses-policy-HJmiAoQfyg | 2026-04-21 |
| H124 | trip-costs-Syxm4NeNq | 2026-10-28 |
| H125 | security-deposits-us-HkbE44lE9 | 2026-04-21 |
| H126 | summary-and-cost-of-protection-plans-or-us-guests-BJSgBNgVq | 2026-10-21 |
| H127 | car-sharing-regulations-SJTQH4lV5 (lecture partielle, début) | 2026-05-04 |
| H128 | available-cars-HJZZVNgE9 (Where Turo operates) | 2026-04-16 |
| H129 | trips-booked-on-uber-us-guests-H1MMdGxyel | 2026-04-21 |
| H130 | new-and-upcoming-on-turo-Hyt3_dZja | 2026-10-28 |
| H131 | incident-information-card-SJJELVe4c | 2026-04-21 |
| H132 | unlisting-or-snoozing-a-vehicle-listing-ryotlwkUq | 2026-04-28 |
| H133 | deleting-a-vehicle-BkhtqwPpC | 2026-04-21 |
| H134 | relisting-a-vehicle-after-a-maintenance-issue-SyX3SVx4c | 2026-06-11 |
| H135 | los-angeles-international-lax-hosts-HkhoQMgi3 (partielle) | 2026-10-29 |
| H136 | updating-to-a-preferred-first-name-or-business-name-on-your-account-hosts-SydkYAAJeg | 2026-04-21 |
| H137 | recent-updates-hosts-SkgOpqkg | 2026-04-21 |
| H139 | tesla-full-self-driving-supervised-us-guests-SJ7uCk19zx | 2026-10-28 |
| H141 | Index : `https://help.turo.com/sitemap.xml` (8 sitemaps d'articles, 1 297 URL dont 732 en_us ; seuls les titres ont été exploités pour les articles non listés ci-dessus) | 2026-10-30 |

**Autres sources officielles**
| ID | URL | As of | Lisibilité |
|---|---|---|---|
| H35 | https://support-resources.turo.com/protection/us-host-protection-plans-available-before-1726.pdf | plans antérieurs au 07/01/2026 | complète (extraction texte du PDF) |
| S1 | https://www.sec.gov/Archives/edgar/data/1514587/000162828024047889/turoinc-sx1a12.htm (S-1/A n°12) | 2024-11-14 | complète |
| S2 | https://www.sec.gov/Archives/edgar/data/1514587/000162828024047889/mda1da.jpg (« Anatomy of a booking ») | 2024-11-14 | complète (image) |
| S3 | https://www.sec.gov/Archives/edgar/data/1514587/000162828024047889/hosting-economics_072524a.jpg | 2024-11-14 | complète (image) |
| S4 | https://data.sec.gov/submissions/CIK0001514587.json (liste des dépôts, RW du 13/02/2025) | 2026-10-30 | complète |
| S5 | https://www.sec.gov/Archives/edgar/data/1514587/000119312522005696/d145731ds1.htm (S-1 initial) | 2022-01-10 | non lu (référencé seulement) |
| P1 | https://prnewswire.com/news-releases/turo-announced-over-70-key-product-updates-to-reinvent-the-outdated-rental-car-experience-and-turbocharge-entrepreneurship-302182448.html | 2024-06-26 | lu via outil de fetch (résumé) |
| P9 | https://openroad.turo.com/ | 2026 | lu (résumé) |
| W1 | https://turo.com/blog/news/book-instantly-will-be-the-standard-for-all-bookings/ | 2023-11 | **403**, extrait de recherche seulement |
| W2 | https://turo.com/blog/news/introducing-earnings-plans/ ; https://turo.com/blog/news/2026-marketplace-updates/ ; https://turo.com/us/en/car-rental/united-states/host-hub/updates/a-new-era-of-turo-winning-together-in-2026-and-beyond ; .../fall-2025-host-release | 2025–2026 | **403**, extraits seulement |
| W3 | https://turo.com/earn | 2025 | **403**, extrait seulement |
| W4 | https://turo.com/blog/news/introducing-the-carculator ; https://turo.com/us/en/carculator ; https://turo.com/gb/en/carculator | n.d. | **403 / 404**, extraits seulement |
| W5 | https://turo.com/us/en/car-rental/united-states/list-your-car ; .../host-tools ; .../all-star-host ; .../insurance ; https://turo.com/us/en/policies/terms | — | **403**, non lus |

**Sources secondaires**
| ID | URL | As of | Lisibilité |
|---|---|---|---|
| P2 | https://sacra.com/c/turo | 2025–2026 | lu (résumé ; estimations) |
| P3 | https://www.phocuswire.com/turo-acquires-select-assets-kyte | 2025-07-17 | extrait de recherche |
| P4 | https://www.iphoneincanada.ca/2024/09/06/turo-and-uber-partnership-turo-vehicles-uber-rent/ | 2024-09-06 | extrait |
| P5 | https://www.renaissancecapital.com/IPO-Center/News/109393/car-sharing-platform-turo-withdraws-estimated-300-million-ipo | 2025-02 | extrait |
| P6 | https://supergood.ai/api-report-card/turo | n.d. | extrait |
| P7 | https://www.standardfleet.com/turo | n.d. | extrait (vendeur) |
| P8 | https://www.vevs.com/turo.php ; https://help.fleetwire.io/en/article/automations-us0ofc | n.d. | extraits (vendeurs) |
| P10 | https://www.autorentalnews.com/news/smartcar-launches-in-canada-partners-with-turo | 2021 | extrait |
| W6 | https://www.ridester.com/?p=617856 ; https://www.nerdwallet.com/insurance/auto/learn/turo-car-insurance (hôte commercial) | n.d. | extraits ; certains autres résultats étaient du spam et ont été écartés |
| — | https://techcrunch.com/2022/01/10/peer-to-peer-car-sharing-company-turo-files-ipo-to-go-public ; https://couchpotato.beehiiv.com/p/turo ; https://thinkinsights.net/commercial-excellence/turos-car-sharing-business-model | 2022–2024 | résultats de recherche seulement, non utilisés pour les chiffres |

# 09 — Tarification, paiements et reversements

> Statut : EN COURS. Consolidera SRC_GUEST_DOCS / SRC_HOST_DOCS.

## 1. Composantes du prix payé par le locataire (OBSERVÉ au checkout, US, 2026-10-30 — voir 05 G-BOOK-02)
```
prix_jour_hôte × nb_jours                         (fixé par l'hôte, ou tarification automatique)
− remise de durée (ex. « 3 jours ou plus »)        (paramètre hôte)
+ frais jeune conducteur (mesuré sur 3 jours : 18–20 : 150 $ ; 21–24 : 60 $ ; 25+ : 0 — barème variable selon la durée, non publié)   (plateforme)
+ frais de voyage / Trip fee (≈ 23,6 % sur l'exemple)   (plateforme ; formule exacte à documenter)
+ protection guest (Premier / Standard / Minimum, par jour = 65 % / 40 % / 25 % du prix journalier net sur VEH-B — vérifié au centime VERIF_01-V09 sur ce seul véhicule ; généralisation INFÉRÉE)   (optionnel)
+ assistance routière améliorée (2,99 $/j)          (optionnel)
+ extras (par trip, quantité)                       (hôte)
+ livraison (si choisie)                            (hôte)
= Sous-total
+ taxes locales (Floride : 7 % × (sous-total trip fee compris + surtaxe P2P 1 $/j) + surtaxe 1 $/j — vérifié au centime, VERIF_01-V04)
= Total
```
- Choix **Non remboursable** (moins cher, ≈ −9 %, annulation gratuite 24 h seulement) vs **Remboursable** (annulation gratuite jusqu'à la veille, paiement différé sans avance possible).
- Choix **payer maintenant / payer en plusieurs fois** (fournisseur BNPL choisi ensuite ; carte enregistrée exigée).
- Code promo au checkout.
- Distance incluse par trip (hôte, au-dessus d'un minimum imposé) ; prix du mile supplémentaire = prix journalier ÷ distance journalière (calculé par Turo).

## 2. Part reversée à l'hôte (DOCUMENTÉ — page insurance)
70 % / 80 % / 90 % du « trip price » (+ livraison + extras) selon le plan ; dynamique 65–100 % selon l'anticipation dans 9 marchés. Le Trip fee guest n'est pas partagé (INFÉRÉ : c'est un revenu plateforme).

### Exemple reconstitué (INFÉRÉ, à valider)
Trip 116,28 $ net hôte (après remise) ; plan Balanced 80 % → hôte ≈ 93,02 $ ; plateforme ≈ 23,26 $ (commission hôte) + 27,40 $ (trip fee guest) ≈ 50,66 $ hors protection = **≈ 35 % du sous-total HT**. Les protections guest s'ajoutent au revenu plateforme (moins le coût du risque).

## 3. Résultats du retest connecté (DIRECTEMENT TESTÉ — voir 05 G-BOOK-06)
- Non remboursable = **−10 % sur le net après remise de durée**, intégré dans la ligne de base (pas de ligne dédiée).
- Trip fee mesuré : 27,40 $ sur 116,28 $ net (23,6 %) sur **un seul trajet** (VEH-B, 3 jours ; retests du même véhicule, EV-0007, EV-0026). La fourchette « ≈ 22–24 % » et la **non-linéarité** sont **INFÉRÉES** : un seul point ne permet pas de déduire une forme de fonction (A24-07). Formule non publiée.
- Taxes Floride : 7 % × (sous-total + 1 $/j) + 1 $/j — confirmé sur 4 points de mesure.
- Paiement : Pay now / **Pay later (débit auto à J−7, sans frais)** / Pay over time (BNPL) ; tarif remboursable requis pour « $0 due now ».

### Formule de prix reconstituée [NOUS — modèle de référence pour notre moteur]
```text
base        = Σ prix_jour(d) pour chaque jour d            (prix hôte ou dynamique)
dur_disc    = base × taux_remise_durée(nb_jours)            (paliers 3/5/10/15/20 % selon SRC_HOST_DOCS)
net         = base − dur_disc
if rate == NON_REFUNDABLE and lead_time >= 4 jours: net = net × 0.90
trip_fee    = f_platform(net, risque, marché)               (23,6 % mesuré sur 1 trajet ; forme INFÉRÉE)
young_fee   = table_âge(âge, nb_jours)                      (18–20, 21–24)
protection  = pct_plan × net / nb_jours × nb_jours           (65/40/25 %)
subtotal    = net + trip_fee + young_fee + protection + extras + livraison
taxes       = règles fiscales du marché (Panama : ITBMS 7 % ; Paraguay : IVA 10 % — à valider)
total       = arrondi(subtotal + taxes, devise)              (PYG sans décimales)
```

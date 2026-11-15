lot: L2
module: Catalogue et recherche

- Ajouté : résultats de la recherche avec le total TTC du séjour (devis provisoire du même moteur que la fiche et le checkout : loyer des jours facturés, trip fee, taxes par ligne), les jours facturés, la caution de la plateforme du pays et de la classe ou une mention générique, et la note ou le badge « Nuevo » (`GET /search`, US-203)
- Ajouté : écran S02 en liste de cartes et sur une carte de marqueurs de prix aux positions approximatives des zones de remise, mêmes annonces et mêmes totaux, en espagnol, anglais, français et portugais ; fond schématique sans fournisseur de tuiles (US-203)
- Sécurité : caution lue par la recherche publique sans exposer la classe du véhicule ; annonce dont le devis est impossible exclue et signalée à l'ops (US-203)
- Ajouté : série de fumée de performance `recherche.sequentielle` (17 §6.7, cible 800 ms, alerte seulement) (US-203)

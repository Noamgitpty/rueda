lot: L2
module: Tarification et devis

- Ajouté : moteur de devis versionné, fonction pure : prix du trip = prix journalier × jours facturables, taxe par ligne puis somme par groupe fiscal, total TTC, jambes de la capture du total (US-202)
- Ajouté : fonction unique des jours facturables, paramétrée par `grace_minutes` du pays (US-202)
- Ajouté : taxe d'un groupe fiscal `third_party` portée à part dans la jambe `TAX_THIRD_PARTY`, par défaut dans `PLATFORM` (US-202)
- Ajouté : devis figé avec empreinte de ses entrées et rejeu identique à l'unité mineure, refus d'un devis altéré (US-202)

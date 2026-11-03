/**
 * Registre des palettes : les fichiers de US-028 sont la **source unique** (ADR-047). Ils sont
 * importés tels quels, sans copie ; ajouter une palette = déposer son fichier dans
 * docs/design/US-028/ puis l'inscrire ici (le test du registre échoue sinon).
 */
import cielo from '../../../docs/design/US-028/tokens-cielo.json' with { type: 'json' };
import istmo from '../../../docs/design/US-028/tokens-istmo.json' with { type: 'json' };
import lagune from '../../../docs/design/US-028/tokens-lagune.json' with { type: 'json' };
import lienzoAzur from '../../../docs/design/US-028/tokens-lienzo-azur.json' with { type: 'json' };
import lienzoGrafito from '../../../docs/design/US-028/tokens-lienzo-grafito.json' with { type: 'json' };
import lienzoTinta from '../../../docs/design/US-028/tokens-lienzo-tinta.json' with { type: 'json' };
import marina from '../../../docs/design/US-028/tokens-marina.json' with { type: 'json' };
import senal from '../../../docs/design/US-028/tokens-senal.json' with { type: 'json' };
import tierraFirme from '../../../docs/design/US-028/tokens-tierra-firme.json' with { type: 'json' };
import voltio from '../../../docs/design/US-028/tokens-voltio.json' with { type: 'json' };

/** Palettes brutes, dans l'ordre alphabétique des fichiers. Validées au chargement (`loadTheme`). */
export const PALETTE_SOURCES: Readonly<Record<string, unknown>> = {
  cielo: cielo,
  istmo: istmo,
  lagune: lagune,
  'lienzo-azur': lienzoAzur,
  'lienzo-grafito': lienzoGrafito,
  'lienzo-tinta': lienzoTinta,
  marina: marina,
  senal: senal,
  'tierra-firme': tierraFirme,
  voltio: voltio,
};

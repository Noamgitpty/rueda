/**
 * Choix explicite de la locale (10b UX-11) : `POST /locale`, champ de formulaire `locale`.
 * Pas de GET : un lien préchargé ne doit pas changer la langue. Le sélecteur visible dans
 * l'en-tête viendra avec la bibliothèque de composants (US-030 / US-033).
 */
import { localeChoiceResponse } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../../locale-config.ts';

export function POST(request: Request): Promise<Response> {
  return localeChoiceResponse(request, LOCALE_CONFIG);
}

/**
 * Caution annoncée sur la fiche S03 avant le checkout (US-701 partie 701c, T70 c ; 10b UX-21 ;
 * ADR-173) : 360 px seulement (durée du job e2e ; la décision est prouvée par PAY avec l'oracle,
 * `deposit-notice.test.ts`, et la lecture par `account/listing-terms.test.ts`).
 *
 * Double de l'API (`e2e/stub-api.mjs`) : la fiche publique rend la mention générique ; la fiche
 * `DEPOSIT_UNAVAILABLE_ID` (classe qui impose une caution dont le montant est À DÉCIDER) rend
 * « caution non disponible », le MÊME texte que S05 rendra au paiement (`web.deposit.unavailableNone`) ;
 * aucun montant inventé, jamais un déclencheur ni la classe à l'écran. Textes attendus : catalogue
 * de la langue (10b §4.3, livrés par US-203 et US-701), jamais le code testé.
 */
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { PUBLIC_ID } from './search-data.ts';

const DEPOSIT_UNAVAILABLE_ID = '70100000-0000-4000-8000-00000000f006';

for (const language of LANGUAGES) {
  test.describe(`caution annoncée sur S03 · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('US-701c (T70 c) : mention générique sans déclencheur du véhicule ; caution non disponible quand la classe l’impose sans montant ; jamais la classe', async ({
      page,
    }) => {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      await page.goto(`/listings/${PUBLIC_ID}`);
      const text = page.locator('[data-testid="s03-deposit-text"]');
      await expect(text).toHaveAttribute('data-deposit-status', 'GENERIC');
      await expect(text).toHaveText(t.t('web.search.deposit.maybe'));

      await page.goto(`/listings/${DEPOSIT_UNAVAILABLE_ID}`);
      await expect(text).toHaveAttribute('data-deposit-status', 'UNAVAILABLE');
      await expect(text).toHaveText(t.t('web.deposit.unavailableNone'));
      await expect(page.locator('[data-testid="s03-deposit"]')).not.toContainText(
        /LUXE|PREMIUM|STANDARD/,
      );
      await expectAccessible(page);
      await expectMobileFriendly(page);
    });
  });
}

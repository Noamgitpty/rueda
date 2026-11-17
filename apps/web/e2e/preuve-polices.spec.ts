/**
 * PREUVE TEMPORAIRE (N-180, à retirer avant la revue) : reproduit à coup sûr l'état « polices
 * créées à l'échelle 1 » de la course et vérifie que `resolveFontsAtCurrentScale` le corrige.
 * La page est mise en page à l'échelle 1 (FontCache::DeviceScaleFactor() = 1, toutes les polices
 * créées à 1), puis l'échelle passe à 2 : les listes de polices du document restent celles de
 * l'échelle 1. Capture A sans re-résolution (écart attendu), capture B après (référence exacte).
 */
import { expect, tagOf, test } from './fixtures.ts';
import { STABLE_CAPTURE_STYLE, resolveFontsAtCurrentScale } from './visual.ts';

const METRICS = { width: 360, height: 780, mobile: true, screenWidth: 360, screenHeight: 780 };

test.describe('preuve polices · es', () => {
  test.use({ locale: tagOf('es') });

  test('accueil créé à l’échelle 1 puis capturé à 2', async ({ page, context }) => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...METRICS, deviceScaleFactor: 1 });
    await page.goto('/');
    await expect(page).toHaveTitle(/\S/);
    await page.waitForLoadState('networkidle');
    await page.emulateMedia({ colorScheme: 'light' });
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...METRICS, deviceScaleFactor: 2 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        }),
    );
    const shot = { fullPage: true, stylePath: STABLE_CAPTURE_STYLE } as const;
    let before = 'identique à la référence';
    try {
      await expect(page).toHaveScreenshot(['accueil', 'es-light.png'], shot);
    } catch (error) {
      before = error instanceof Error ? error.message.split('\n').slice(0, 3).join(' | ') : 'écart';
    }
    console.log(`PREUVE-POLICES A (sans re-résolution) : ${before}`);
    await resolveFontsAtCurrentScale(page);
    await expect(page).toHaveScreenshot(['accueil', 'es-light.png'], shot);
    console.log('PREUVE-POLICES B (après re-résolution) : identique à la référence');
  });
});

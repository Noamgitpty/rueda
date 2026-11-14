/**
 * Balayage des écrans de la console interne (`apps/backoffice`, US-012, US-101, US-109, US-121 ;
 * US-120 : écran « Apparence / Marque », `/brand`, avec l'aperçu du brouillon),
 * US-044 : chaque état d'accès et la console elle-même, dans les quatre langues, en clair puis en
 * sombre, à 360 et 390 px.
 *
 * - axe-core (WCAG 2.2 A / AA) sur la page entière : 0 violation bloquante, contraste dans chaque
 *   thème ; mobile d'abord (aucun défilement horizontal, cibles ≥ 44 px) ; capture selon
 *   `visual.ts`.
 * - Données : la console ne parle qu'à `/api/*` de sa propre origine. Le serveur du back-office est
 *   démarré SANS `RUEDA_API_URL` (aucun mandataire) ; le test intercepte `/api/**` dans le
 *   navigateur et répond des corps fixes et fictifs (pays « ZZ », dates figées). Aucune API ni base
 *   n'est démarrée ; le contrat réel est prouvé par les tests de l'API.
 * - Les comportements de la console (actions, files, fiche 360°) restent prouvés par ses tests
 *   unitaires (apps/backoffice) ; ici, seulement le rendu et l'accessibilité de chaque écran.
 */
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { expectAccessible } from './axe.ts';
import { expect, expectMobileFriendly, LANGUAGES, tagOf, test } from './fixtures.ts';
import { captured, expectScreen } from './visual.ts';

const COUNTRY = 'ZZ';
const AT = '2026-11-03T14:00:00.000Z';

type Body = Readonly<Record<string, unknown>>;
type Api = Readonly<Record<string, { readonly status: number; readonly body: Body }>>;

const me = (state: string, roles: readonly string[] = []) => ({
  status: 200,
  body: { state, roles: roles.map((role) => ({ role, countries: [COUNTRY] })) },
});

const CONSOLE: Api = {
  '/staff/me': me('ELEVATED', ['ADMIN']),
  '/console/queues': {
    status: 200,
    body: {
      queues: [
        { queue: 'KYC', open: 3, overdue: 1 },
        { queue: 'LISTING', open: 2, overdue: 0 },
        { queue: 'HOST_VERIFICATION', open: 1, overdue: 0 },
      ],
      items: [],
    },
  },
  '/staff/audit': {
    status: 200,
    body: {
      entries: [
        {
          id: '04400000-0000-4000-8000-000000000001',
          at: AT,
          actorRole: 'ADMIN',
          actionCode: 'KYC_DECISION',
          subjectType: 'person',
          subjectId: '04400000-0000-4000-8000-0000000000a1',
        },
        {
          id: '04400000-0000-4000-8000-000000000002',
          at: AT,
          actorRole: 'OPS_AGENT',
          actionCode: 'PUBLISH_LISTING',
          subjectType: 'listing',
          subjectId: '04400000-0000-4000-8000-0000000000b2',
        },
      ],
    },
  },
  '/console/content/gaps': {
    status: 200,
    body: {
      gaps: [{ key: 'web.s01.title', country: null, editable: true, missing: ['pt'], invalid: [] }],
    },
  },
  '/console/finance/approvals': {
    status: 200,
    body: {
      approvals: [
        {
          id: '04400000-0000-4000-8000-0000000000c3',
          action: 'WRITE_OFF_RECEIVABLE',
          subjectId: '04400000-0000-4000-8000-0000000000d4',
          country: COUNTRY,
          reason: 'Créance fictive du jeu de test',
          requestedAt: AT,
        },
      ],
    },
  },
};

/**
 * Écran « Apparence / Marque » (US-120) : une version publiée à la palette par défaut (fichier
 * US-028, source unique, lu tel quel) et un brouillon ; aucun texte publié (catalogue livré).
 */
const TINTA = JSON.parse(
  readFileSync(
    new URL('../../../docs/design/US-028/tokens-lienzo-tinta.json', import.meta.url),
    'utf8',
  ),
) as Body;
const BRAND: Api = {
  '/staff/me': me('ELEVATED', ['ADMIN']),
  '/console/brand/versions': {
    status: 200,
    body: {
      versions: [
        {
          id: '01200000-0000-4000-8000-000000000002',
          versionNo: 2,
          status: 'DRAFT',
          brandName: 'Kmino',
          tokens: TINTA,
          createdAt: AT,
          publishedAt: null,
        },
        {
          id: '01200000-0000-4000-8000-000000000001',
          versionNo: 1,
          status: 'PUBLISHED',
          brandName: 'Kmino',
          tokens: TINTA,
          createdAt: AT,
          publishedAt: AT,
        },
      ],
    },
  },
  '/brand/content': { status: 200, body: { locale: 'es', country: null, blocks: [] } },
};

/** Écran, titre qui reçoit le focus (view.tsx, SCREEN_HEADINGS), chemin et réponses de l'API. */
const SCREENS: readonly {
  readonly name: string;
  readonly heading: string;
  readonly api: Api;
  readonly path?: string;
}[] = [
  {
    name: 'console-connexion',
    heading: 'login-heading',
    api: { '/staff/me': { status: 401, body: { code: 'AUTH_REQUIRED' } } },
  },
  {
    name: 'console-enrolement',
    heading: 'enroll-heading',
    api: { '/staff/me': me('ENROLLMENT_REQUIRED') },
  },
  { name: 'console-code-totp', heading: 'totp-heading', api: { '/staff/me': me('MFA_REQUIRED') } },
  {
    name: 'console-refus-non-staff',
    heading: 'denied-heading',
    api: { '/staff/me': me('NOT_STAFF') },
  },
  {
    name: 'console-refus-verrouille',
    heading: 'denied-heading',
    api: { '/staff/me': me('LOCKED') },
  },
  { name: 'console', heading: 'roles-heading', api: CONSOLE },
  { name: 'console-apparence', heading: 'o02-heading', api: BRAND, path: '/brand' },
];

/** Toute requête `/api/*` reçoit le corps fixe de l'écran ; une route inconnue : 404. */
async function serve(page: Page, api: Api): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const found = api[path];
    await route.fulfill({
      status: found?.status ?? 404,
      contentType: 'application/json',
      body: JSON.stringify(found?.body ?? { code: 'NOT_FOUND' }),
    });
  });
}

for (const screen of SCREENS) {
  for (const language of LANGUAGES) {
    test.describe(`écran ${screen.name} · ${language}`, () => {
      test.use({ locale: tagOf(language) });

      test('axe, mobile d’abord et capture', async ({ page }, info) => {
        await serve(page, screen.api);
        await page.goto(screen.path ?? '/');
        await expect(page.locator('html')).toHaveAttribute('lang', tagOf(language));
        // l'écran choisi d'après `GET /staff/me` a remplacé l'état de chargement
        await expect(page.locator(`#${screen.heading}`)).toBeFocused();
        await page.waitForLoadState('networkidle');
        await expectMobileFriendly(page);
        for (const scheme of ['light', 'dark'] as const) {
          await page.emulateMedia({ colorScheme: scheme });
          await expectAccessible(page, { include: null });
          if (captured(info, language, scheme))
            await expectScreen(page, screen.name, language, scheme);
        }
      });
    });
  }
}

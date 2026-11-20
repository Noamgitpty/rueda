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
 * - US-309 : déclaration de dommage enregistrée depuis le dossier de support, puis aperçu du gabarit
 *   de la décision (parts explicites, parking de récupération exclu, voies de recours citées) ;
 *   textes lus dans le catalogue de la langue.
 * - US-215b : parcours d'annulation d'un voyage (demandeur, motif fermé, confirmation, envoi), puis
 *   état RÉEL de la demande lu dans l'API (ici, en revue FINANCE : jamais « C'est fait ») ; textes
 *   lus dans le catalogue de la langue.
 */
import { readFileSync } from 'node:fs';
import type { Page, Route } from '@playwright/test';
import { createTranslator, getProfile } from '@rueda/i18n';
import { LOCALE_CONFIG } from '../locale-config.ts';
import { expectAccessible } from './axe.ts';
import {
  expect,
  expectMobileFriendly,
  LANGUAGES,
  submitAndSettle,
  tagOf,
  test,
} from './fixtures.ts';
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

/**
 * US-215b : annulation d'un voyage par l'ops. La demande est enregistrée (201) ; la lecture de son
 * état rend une demande garée en revue FINANCE (code de 215a) : l'écran montre cet état et la suite
 * à donner, jamais « C'est fait ». Données fictives (pays « ZZ »).
 */
const TRIP = '04400000-0000-4000-8000-0000000000e5';
const CANCEL: Api = {
  ...CONSOLE,
  '/console/actions': {
    status: 201,
    body: {
      code: 'STAFF_ACTION_DONE',
      messageKey: 'common.auth.actionDone',
      actionId: '04400000-0000-4000-8000-0000000000f6',
    },
  },
  [`/console/cancellations/${TRIP}`]: {
    status: 200,
    body: {
      cancellation: {
        cancellationId: '04400000-0000-4000-8000-0000000000f6',
        tripId: TRIP,
        country: COUNTRY,
        action: 'CANCEL_TRIP_PLATFORM',
        requestedReason: 'PLATFORM_TRUST_SAFETY',
        initiator: 'PLATFORM',
        subReason: null,
        status: 'FIN_REVIEW',
        outcomeCode: 'OPERATION_SETTLEMENT_FIN_REVIEW',
        costBearer: null,
        settlementId: null,
        requestedAt: AT,
        decidedAt: AT,
        tripStatus: 'BOOKED',
        settlement: null,
      },
    },
  },
};

for (const language of LANGUAGES) {
  test.describe(`écran console-annulation · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('demandeur, motif fermé, confirmation, état réel ; axe, mobile d’abord et capture', async ({
      page,
    }, info) => {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      await serve(page, CANCEL);
      await page.goto('/');
      await expect(page.locator('#roles-heading')).toBeFocused();
      await expect(page).toHaveTitle(/\S/);
      await page
        .getByRole('button', { name: t.t('backoffice.action.CANCEL_TRIP_PLATFORM'), exact: true })
        .click();
      const form = page.getByTestId('cancel-form');
      await form.locator('#cancel-trip').fill(TRIP);
      await form.locator('#cancel-platform').selectOption('PLATFORM_TRUST_SAFETY');
      await form.locator('#cancel-reason').fill('Ref 4242 zz 0001');
      await page.getByTestId('cancel-review').click();
      const confirm = page.getByTestId('cancel-confirm');
      await expect(confirm).toContainText(t.t('backoffice.cancel.confirmIntro'));
      await expect(confirm).toContainText(t.t('backoffice.cancel.platform.PLATFORM_TRUST_SAFETY'));
      await submitAndSettle(page, page.getByTestId('cancel-send'), undefined, {
        api: /\/api\/console\/actions$/,
        settled: page.getByTestId('cancel-state'),
      });
      await expect(page.getByTestId('cancel-status')).toHaveText(
        t.t('backoffice.cancel.state.FIN_REVIEW'),
      );
      const state = page.getByTestId('cancel-state');
      await expect(state).toContainText(t.t('backoffice.cancel.state.FIN_REVIEWBody'));
      await expect(state).toContainText(
        t.t('backoffice.cancel.outcome.OPERATION_SETTLEMENT_FIN_REVIEW'),
      );
      await expect(page.locator('body')).not.toContainText(t.t('common.auth.actionDone'));
      await page.waitForLoadState('networkidle');
      await expectMobileFriendly(page);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectAccessible(page, { include: null });
        if (captured(info, language, scheme))
          await expectScreen(page, 'console-annulation', language, scheme);
      }
    });
  });
}

/**
 * US-224d : remboursements d'un voyage lus par la console (lecture seule). Une instance planifiée
 * BLOQUÉE (solde de la plateforme inconnu : décision FINANCE à deux personnes) et une instance
 * émise puis confirmée ; parts demandées par le règlement et ordre envoyé (avance), motif expliqué.
 * Montants : −TJ02b (08 E7) dans la devise fictive ; données fictives (pays « ZZ »).
 */
const REFUND_TRIP = '04400000-0000-4000-8000-0000000000e7';
const REFUND_LEGS = { HOST: '8625', INSURER: '2550', TAX_THIRD_PARTY: '0', PLATFORM: '7569' };
const REFUNDS: Api = {
  ...CONSOLE,
  [`/console/refunds/${REFUND_TRIP}`]: {
    status: 200,
    body: {
      tripId: REFUND_TRIP,
      country: COUNTRY,
      exponent: 2,
      refunds: [
        {
          instanceId: '04400000-0000-4000-8000-0000000000f7',
          status: 'PLANNED',
          currency: 'XTS',
          amountMinor: '18744',
          rail: 'NATIVE_PARTIAL',
          attemptNo: 1,
          settlementVersion: 1,
          requestedLegs: REFUND_LEGS,
          orderLegs: { HOST: '0', INSURER: '2550', TAX_THIRD_PARTY: '0', PLATFORM: '16194' },
          orderStatus: 'PENDING',
          blockedReason: 'PLATFORM_BALANCE_UNKNOWN',
          finAlert: 'BLOCKED:PLATFORM_BALANCE_UNKNOWN',
          advance: { status: 'PLANNED', amountMinor: '8625' },
          plannedAt: AT,
          issuedAt: null,
        },
        {
          instanceId: '04400000-0000-4000-8000-0000000000f8',
          status: 'CONFIRMED',
          currency: 'XTS',
          amountMinor: '18744',
          rail: 'NATIVE_PARTIAL',
          attemptNo: 1,
          settlementVersion: 1,
          requestedLegs: REFUND_LEGS,
          orderLegs: REFUND_LEGS,
          orderStatus: 'SUCCEEDED',
          blockedReason: null,
          finAlert: null,
          advance: null,
          plannedAt: AT,
          issuedAt: AT,
        },
      ],
    },
  },
};

for (const language of LANGUAGES) {
  test.describe(`écran console-remboursements · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('identifiant du voyage, lecture, états SM-8, motif de blocage expliqué ; axe, mobile d’abord et capture', async ({
      page,
    }, info) => {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      await serve(page, REFUNDS);
      await page.goto('/');
      await expect(page.locator('#roles-heading')).toBeFocused();
      await expect(page).toHaveTitle(/\S/);
      const heading = page.locator('#refunds-heading');
      await expect(heading).toHaveText(t.t('backoffice.refunds.heading'));
      // identifiant mal formé : expliqué, aucune lecture
      await page.locator('#refunds-trip').fill('pas-un-voyage');
      await page.getByRole('button', { name: t.t('backoffice.refunds.read'), exact: true }).click();
      await expect(page.locator('section[aria-labelledby="refunds-heading"]')).toContainText(
        t.t('backoffice.refunds.tripInvalid'),
      );
      await page.locator('#refunds-trip').fill(REFUND_TRIP);
      const read = page.waitForResponse((r) =>
        r.url().endsWith(`/api/console/refunds/${REFUND_TRIP}`),
      );
      await page.getByRole('button', { name: t.t('backoffice.refunds.read'), exact: true }).click();
      await read;
      const table = page.locator('#refunds-table');
      await expect(table).toContainText(t.t('backoffice.refunds.status.PLANNED'));
      await expect(table).toContainText(t.t('backoffice.refunds.status.CONFIRMED'));
      await expect(table).toContainText(t.t('backoffice.refunds.reason.PLATFORM_BALANCE_UNKNOWN'));
      await expect(table).toContainText(t.t('backoffice.refunds.notIssued'));
      await expect(table).toContainText(
        t.t('backoffice.refunds.advance', {
          amount: t.money({ amountMinor: 8625n, currency: 'XTS', exponent: 2 }),
        }),
      );
      await page.waitForLoadState('networkidle');
      await expectMobileFriendly(page);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectAccessible(page, { include: null });
        if (captured(info, language, scheme))
          await expectScreen(page, 'console-remboursements', language, scheme);
      }
    });
  });
}

/**
 * US-309 : dommages et décisions. La déclaration de l'hôte est enregistrée (201) depuis le dossier
 * de support ; l'aperçu du gabarit (200, rien n'est écrit) montre les parts explicites, le parking
 * de récupération exclu comme non refacturable (08 BR-TT-05) et les voies de recours, jamais une
 * décision « définitive ». Données fictives (pays « ZZ », devise fictive).
 */
const CLAIM_ID = '04400000-0000-4000-8000-0000000000c9';
const CLAIM_TRIP = '04400000-0000-4000-8000-0000000000e9';
const CLAIM_VIEW = {
  claimId: CLAIM_ID,
  tripId: CLAIM_TRIP,
  caseId: '04400000-0000-4000-8000-0000000000ca',
  country: COUNTRY,
  currency: 'XTS',
  exponent: 2,
  declaredBy: 'HOST',
  kind: 'DAMAGE',
  description: 'Ref 4242 zz 0001',
  status: 'REPORTED',
  reportedAt: AT,
  tripEndAt: AT,
  deadlineAt: '2026-11-04T14:00:00.000Z',
  evidence: { checkinPhotos: true, checkoutPhotos: true },
  guestCapMinor: '50000',
  decision: null,
};
const CLAIMS: Api = {
  ...CONSOLE,
  '/console/claims': { status: 201, body: { claim: CLAIM_VIEW } },
  [`/console/claims/${CLAIM_ID}/decision`]: {
    status: 200,
    body: {
      preview: {
        claimId: CLAIM_ID,
        tripId: CLAIM_TRIP,
        currency: 'XTS',
        exponent: 2,
        outcome: 'GUEST_LIABLE',
        covered: true,
        repairCostMinor: '120000',
        amountMinor: '45350',
        legs: { HOST: '40000', INSURER: '0', TAX_THIRD_PARTY: '350', PLATFORM: '5000' },
        lines: [
          { category: 'REPAIR', leg: 'HOST', amountMinor: '40000' },
          { category: 'PROCESSING_FEE', leg: 'PLATFORM', amountMinor: '5000' },
          { category: 'PROCESSING_FEE_TAX', leg: 'TAX_THIRD_PARTY', amountMinor: '350' },
        ],
        excluded: [
          {
            category: 'RECOVERY_PARKING',
            amountMinor: '1500',
            code: 'NOT_RECHARGEABLE',
            rule: 'BR-TT-05',
          },
        ],
        hostDeductibleMinor: '25000',
        guestCapMinor: '50000',
        evidence: { checkinPhotos: true, checkoutPhotos: true, guestAgreement: false },
        adminRequired: true,
      },
    },
  },
};

for (const language of LANGUAGES) {
  test.describe(`écran console-sinistre · ${language}`, () => {
    test.use({ locale: tagOf(language) });

    test('déclaration depuis le dossier, preuves, aperçu du gabarit (parts, exclusion, recours) ; axe, mobile d’abord et capture', async ({
      page,
    }, info) => {
      const t = createTranslator(getProfile(LOCALE_CONFIG, tagOf(language)));
      await serve(page, CLAIMS);
      await page.goto('/');
      await expect(page.locator('#roles-heading')).toBeFocused();
      await expect(page.locator('#claims-heading')).toHaveText(t.t('backoffice.claim.heading'));
      const form = page.getByTestId('claims-record');
      await form.locator('#claims-trip').fill(CLAIM_TRIP);
      await form.locator('#claims-case').fill(CLAIM_VIEW.caseId);
      await form.locator('#claims-declared-by').selectOption('HOST');
      await form.locator('#claims-kind').selectOption('DAMAGE');
      await form.locator('#claims-description').fill('Ref 4242 zz 0001');
      await submitAndSettle(page, page.getByTestId('claims-record-submit'), undefined, {
        api: /\/api\/console\/claims$/,
        settled: page.getByTestId('claims-detail'),
      });
      await expect(page.getByTestId('claims')).toContainText(t.t('backoffice.claim.recorded'));
      await expect(page.getByTestId('claims-evidence')).toContainText(
        t.t('backoffice.claim.evidence.checkout'),
      );
      const decision = page.getByTestId('claims-decision');
      await decision.locator('#claims-outcome').selectOption('GUEST_LIABLE');
      await decision.locator('#claims-covered').check();
      await decision.locator('#claims-repair').fill('1200');
      await decision.locator('#claims-line-REPAIR').fill('400');
      await decision.locator('#claims-line-PROCESSING_FEE').fill('50');
      await decision.locator('#claims-line-PROCESSING_FEE_TAX').fill('3.50');
      await decision.locator('#claims-line-RECOVERY_PARKING').fill('15');
      await decision.locator('#claims-deductible').fill('250');
      await decision.locator('#claims-facts').fill('EXT_01 · EXT_02 · 2026-11-03 14:00');
      await submitAndSettle(page, page.getByTestId('claims-preview'), undefined, {
        api: /\/api\/console\/claims\/[0-9a-f-]+\/decision$/,
        settled: page.getByTestId('claims-template'),
      });
      const template = page.getByTestId('claims-template');
      await expect(template).toContainText(t.t('backoffice.claim.excluded.parking'));
      await expect(template).toContainText(t.t('backoffice.claim.template.recourse'));
      await expect(template).toContainText(
        t.money({ amountMinor: 45350n, currency: 'XTS', exponent: 2 }),
      );
      await page.waitForLoadState('networkidle');
      await expectMobileFriendly(page);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await expectAccessible(page, { include: null });
        if (captured(info, language, scheme))
          await expectScreen(page, 'console-sinistre', language, scheme);
      }
    });
  });
}

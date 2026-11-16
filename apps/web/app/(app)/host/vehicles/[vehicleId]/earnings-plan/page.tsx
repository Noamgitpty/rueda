import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import { callApi } from '../../../../../../account/api-client.ts';
import {
  earningsPlansOf,
  planName,
  planSummary,
} from '../../../../../../account/earnings-plans.ts';
import { hostAccountsOf, vehiclesOf } from '../../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import accountStyles from '../../../../_account/account.module.css';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../host.module.css';
import { PlanForm } from './plan-form.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.a11.plan.title'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A11 — plan de gains d'un véhicule (US-226 partie 226b, ADR-137 ; 10b A10 / A11 ; 16 PRT-007,
 * PRT-008, HST-048, PRT-015 ; 08 BR-PROT-06, BR-PROT-09) :
 *
 * - plan en vigueur, expliqué en une phrase (part du prix de chaque trip reçue par l'hôte) ; plan
 *   par défaut du pays (`ESTÁNDAR` 75 %, OQ-P2P-11) tant que l'hôte n'a rien choisi ;
 * - changement (si le pays vend plus d'un plan) : effet sur les NOUVEAUX trips seulement, les trips
 *   réservés gardent leur plan ; confirmation affichée après l'enregistrement ; `PRO` jamais
 *   proposé ;
 * - couverture : période de la réservation (BR-PROT-09) ; exclusions et franchise de l'hôte tirées
 *   du contrat de l'assureur, affichées mot pour mot dès qu'il est saisi (PRT-015, suite tracée).
 *
 * Aucune part n'est calculée ici : le pourcentage affiché est la fraction `host_share_pct` rendue
 * par l'API. États : sans session (connexion), véhicule inconnu ou d'un autre hôte (404 de l'API),
 * erreur, chargement (`loading.tsx`).
 */
export default async function EarningsPlanPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly vehicleId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [i18n, tag, { vehicleId }, query] = await Promise.all([
    getRequestI18n(),
    getRequestLocaleTag(),
    params,
    searchParams,
  ]);
  const t = i18n.t.bind(i18n);
  const ctx = await clientContext();
  const org = typeof query['org'] === 'string' && UUID.test(query['org']) ? query['org'] : null;
  const shell = (body: ReactNode, intro = true) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={org === null ? '/host' : `/host?org=${org}`}>
          {t('web.calendar.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.a11.plan.title')}</h1>
        {intro && <p className={accountStyles['muted']}>{t('web.a11.plan.intro')}</p>}
      </header>
      {body}
    </main>
  );
  const error = shell(
    <ErrorState
      i18n={i18n}
      message={t('web.host.error')}
      action={<ButtonLink href="/host">{t('web.host.retry')}</ButtonLink>}
    />,
  );
  const login = shell(
    <EmptyState
      icon="car"
      title={t('web.host.loginRequired')}
      action={<ButtonLink href="/login">{t('web.host.login')}</ButtonLink>}
    />,
  );
  if (ctx.sessionToken === null) return login;
  const session = await callApi('GET', '/auth/session', ctx);
  if (session.status === 401) return login;
  const accounts = hostAccountsOf(session);
  if (accounts === null) return error;
  const account = accounts.find((a) => a.orgId === org) ?? accounts[0];
  const notFound = shell(<EmptyState icon="car" title={t('web.calendar.notFound')} />, false);
  if (account === undefined || !UUID.test(vehicleId)) return notFound;
  const base = `/host/accounts/${account.orgId}`;
  const [plansReply, vehReply] = await Promise.all([
    callApi('GET', `${base}/earnings-plans`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
  ]);
  const plans = earningsPlansOf(plansReply);
  const vehicles = vehiclesOf(vehReply);
  if (plans === null || vehicles === null) return error;
  const car = vehicles.find((v) => v.id === vehicleId);
  const mine = plans.vehicles.find((v) => v.vehicleId === vehicleId);
  if (car === undefined || mine === undefined) return notFound;
  const summary = planSummary(i18n, plans, mine.planCode);
  return shell(
    <>
      <p className={accountStyles['text']}>
        <span className={styles['strong']}>
          {[car.makeText, car.modelText].filter(Boolean).join(' ')} {car.year}
        </span>
      </p>
      {query['saved'] === '1' && (
        <Banner tone="success" live="polite" icon="check">
          {t('common.listing.earningsPlanSaved')}
        </Banner>
      )}

      <section className={styles['section']} aria-labelledby="a11-current">
        <h2 id="a11-current" className={accountStyles['h2']}>
          {summary === null
            ? t('web.a11.plan.title')
            : t('web.a11.plan.current', { plan: summary })}
        </h2>
        {summary === null ? (
          // plan du véhicule plus vendu dans le pays (configuration changée) : jamais un plan deviné
          <p className={accountStyles['text']}>{t('common.listing.earningsPlanNotAvailable')}</p>
        ) : (
          <p className={accountStyles['muted']}>
            {mine.chosen ? t('web.a11.plan.chosen') : t('web.a11.plan.default')}
          </p>
        )}
        {plans.offered.length > 1 || summary === null ? (
          <PlanForm
            localeTag={tag}
            orgId={account.orgId}
            vehicleId={vehicleId}
            current={mine.planCode}
            plans={plans.offered.map((p) => ({
              planCode: p.planCode,
              label: planSummary(i18n, plans, p.planCode) ?? planName(i18n, p),
            }))}
          />
        ) : (
          <>
            <p className={accountStyles['text']}>{t('web.a11.plan.only')}</p>
            <p className={accountStyles['muted']}>{t('web.a11.plan.newTripsOnly')}</p>
          </>
        )}
      </section>

      <section className={styles['section']} aria-labelledby="a11-coverage">
        <h2 id="a11-coverage" className={accountStyles['h2']}>
          {t('web.a11.coverage.title')}
        </h2>
        <p className={accountStyles['text']}>{t('web.a11.coverage.period')}</p>
        <p className={accountStyles['muted']}>{t('web.a11.coverage.contract')}</p>
      </section>
    </>,
  );
}

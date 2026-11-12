import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Badge, Banner, ButtonLink, EmptyState, ErrorState } from '@rueda/ui';
import type { BadgeTone } from '@rueda/ui';
import type { MessageKey } from '@rueda/i18n';
import { callApi } from '../../../../../../account/api-client.ts';
import {
  formatPhotoMax,
  hostAccountsOf,
  vehiclesOf,
} from '../../../../../../account/host-listings.ts';
import { clientContext } from '../../../../../../account/request.ts';
import {
  DOCUMENT_TYPES,
  eligibilityOf,
  reasonKey,
} from '../../../../../../account/vehicle-documents.ts';
import type { DocumentView } from '../../../../../../account/vehicle-documents.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../../../i18n.ts';
import accountStyles from '../../../../_account/account.module.css';
import { MAIN_ID } from '../../../../_shell/main-id.ts';
import styles from '../../../host.module.css';
import { DeclarationForm, SubmitForm, UploadForm } from './documents-forms.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.vehicleDocs.title'), robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUS_TONE: Readonly<Record<string, BadgeTone>> = {
  ELIGIBLE: 'success',
  PENDING: 'warning',
  INELIGIBLE: 'danger',
};
const DOC_TONE: Readonly<Record<DocumentView['status'], BadgeTone>> = {
  SUBMITTED: 'warning',
  VALID: 'success',
  REJECTED: 'danger',
};

/**
 * Documents et éligibilité d'un véhicule de l'hôte (US-124 ; 16 HST-019, HST-039 ; écran A10,
 * étape « documents » de 16 HST-002) : statut (« Por revisar », « Aprobado », « No publicable »),
 * motifs d'un refus (« Qué falta »), pièces exigées par le pays et les déclarations, pièces
 * déposées (type, statut, échéance, motif d'un refus — jamais le fichier), déclarations, dépôt
 * d'une pièce (fermé tant que l'antivirus, le coffre et le stockage ne sont pas branchés : annoncé
 * d'emblée), soumission à la revue. Jamais la plaque ni le VIN au-delà du libellé de l'auto de
 * l'hôte lui-même. États : sans session, auto inconnue (404 de l'API, aussi pour l'auto d'un autre
 * hôte), erreur, chargement (`loading.tsx`).
 */
export default async function VehicleDocumentsPage({
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
  const shell = (body: ReactNode) => (
    <main id={MAIN_ID} tabIndex={-1} className={accountStyles['content']}>
      <header className={accountStyles['stackTight']}>
        <a className={styles['link']} href={org === null ? '/host' : `/host?org=${org}`}>
          {t('web.vehicleDocs.back')}
        </a>
        <h1 className={accountStyles['h1']}>{t('web.vehicleDocs.title')}</h1>
        <p className={accountStyles['muted']}>{t('web.vehicleDocs.intro')}</p>
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
  const notFound = shell(<EmptyState icon="car" title={t('web.vehicleDocs.notFound')} />);
  if (account === undefined || !UUID.test(vehicleId)) return notFound;
  const base = `/host/accounts/${account.orgId}`;
  const [eligReply, vehReply] = await Promise.all([
    callApi('GET', `${base}/vehicle-eligibility`, ctx),
    callApi('GET', `${base}/vehicles`, ctx),
  ]);
  const state = eligibilityOf(eligReply);
  const vehicles = vehiclesOf(vehReply);
  if (state === null || vehicles === null) return error;
  const v = state.vehicles.find((x) => x.vehicleId === vehicleId);
  const car = vehicles.find((x) => x.id === vehicleId);
  if (v === undefined || car === undefined) return notFound;
  const ids = { localeTag: tag, orgId: account.orgId, vehicleId };
  const locked = v.underReview || v.released || v.status === 'INELIGIBLE';
  const docOf = (type: string) => v.documents.find((d) => d.type === type);
  const shown = [
    ...v.requiredDocuments,
    ...v.documents.map((d) => d.type).filter((x) => !v.requiredDocuments.includes(x)),
  ];
  const day = (iso: string) => i18n.date(`${iso}T12:00:00Z`, 'UTC');
  return shell(
    <>
      <p className={accountStyles['text']}>
        <span className={styles['strong']}>
          {[car.makeText, car.modelText].filter(Boolean).join(' ')} {car.year} · {car.plate}
        </span>
      </p>
      {query['saved'] === '1' && (
        <Banner tone="success" live="polite" icon="check">
          {t('web.host.saved')}
        </Banner>
      )}

      <section className={styles['section']} aria-labelledby="a10d-status">
        <h2 id="a10d-status" className={accountStyles['h2']}>
          <Badge tone={STATUS_TONE[v.status] ?? 'neutral'}>
            {t(`web.vehicleDocs.status.${v.status}`)}
          </Badge>
        </h2>
        {v.publishable && (
          <p className={accountStyles['text']}>{t('web.vehicleDocs.publishable')}</p>
        )}
        {v.underReview && (
          <Banner tone="info" live="polite">
            {t('web.vehicleDocs.underReview')}
          </Banner>
        )}
        {v.released && (
          <Banner tone="danger" live="polite">
            {t('web.vehicleDocs.released')}
          </Banner>
        )}
        {v.reasons.length > 0 && !v.underReview && (
          <div role={query['refused'] === '1' ? 'alert' : undefined}>
            <h3 className={styles['strong']}>{t('web.vehicleDocs.reasons')}</h3>
            <ul className={styles['list']}>
              {v.reasons.map((r) => (
                <li key={r}>{t(reasonKey(r))}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className={styles['section']} aria-labelledby="a10d-docs">
        <h2 id="a10d-docs" className={accountStyles['h2']}>
          {t('web.vehicleDocs.documents.title')}
        </h2>
        <ul className={styles['rows']}>
          {shown.map((type) => {
            const d = docOf(type);
            return (
              <li key={type} className={styles['card']}>
                <div className={styles['between']}>
                  <span className={styles['strong']}>
                    {t(`web.vehicleDocs.type.${type}` as MessageKey)}
                  </span>
                  {d === undefined ? (
                    <Badge tone="neutral">{t('web.vehicleDocs.doc.missing')}</Badge>
                  ) : (
                    <Badge tone={DOC_TONE[d.status]}>
                      {t(`web.vehicleDocs.doc.status.${d.status}`)}
                    </Badge>
                  )}
                </div>
                {d?.validUntil != null && (
                  <p className={accountStyles['muted']}>
                    {t('web.vehicleDocs.doc.validUntil', { date: day(d.validUntil) })}
                  </p>
                )}
                {d?.rejectReason != null && (
                  <p className={accountStyles['text']}>
                    {t(`web.vehicleDocs.doc.rejected.${d.rejectReason}` as MessageKey)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {!locked && (
        <>
          <section className={styles['section']} aria-labelledby="a10d-declare-title">
            <h2 id="a10d-declare-title" className={accountStyles['h2']}>
              {t('web.vehicleDocs.declaration.title')}
            </h2>
            <DeclarationForm
              {...ids}
              holder={v.titleHolder}
              lien={v.lienDeclared}
              odometerKm={v.odometerKm}
            />
          </section>

          <section className={styles['section']} aria-labelledby="a10d-upload-title">
            <h2 id="a10d-upload-title" className={accountStyles['h2']}>
              {t('web.vehicleDocs.upload.title')}
            </h2>
            {state.uploads.open ? (
              <UploadForm
                {...ids}
                types={[...DOCUMENT_TYPES]}
                maxLabel={formatPhotoMax(state.uploads.maxBytes, tag)}
              />
            ) : (
              <p className={accountStyles['muted']} role="status">
                {t('web.vehicleDocs.upload.closed')}
              </p>
            )}
          </section>

          {v.status !== 'ELIGIBLE' && (
            <section className={styles['section']} aria-labelledby="a10d-submit-title">
              <h2 id="a10d-submit-title" className={accountStyles['h2']}>
                {t('web.vehicleDocs.submit.title')}
              </h2>
              <p className={accountStyles['muted']}>{t('web.vehicleDocs.submit.intro')}</p>
              <SubmitForm {...ids} />
            </section>
          )}
        </>
      )}
    </>,
  );
}

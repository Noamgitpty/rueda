import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Badge, Banner, ButtonLink } from '@rueda/ui';
import { callApi } from '../../../../account/api-client.ts';
import { clientContext, journeyCountry } from '../../../../account/request.ts';
import { getRequestI18n, getRequestLocaleTag } from '../../../../i18n.ts';
import styles from '../../_account/account.module.css';
import { renderLegalText } from '../../_account/legal-text.tsx';
import { MAIN_ID } from '../../_shell/main-id.ts';

export const metadata: Metadata = { robots: { index: false, follow: false } };

const KINDS = new Set(['TOS_GUEST', 'PRIVACY', 'MARKETING']);

interface LegalDocumentJson {
  readonly title: string;
  readonly version: number;
  readonly draft: boolean;
  readonly locale: string;
  readonly bodyMd: string;
}

/**
 * Document juridique (CGU du voyageur, confidentialité, communications ; US-102) : version en
 * vigueur, ou version passée (`?version=`) pour relire ce qui a été accepté (16 NFR-17). Une
 * version non validée par le juridique est marquée « BROUILLON » (OQ-BR-24).
 */
export default async function LegalDocumentPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly kind: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  const [{ kind }, query, i18n, tag] = await Promise.all([
    params,
    searchParams,
    getRequestI18n(),
    getRequestLocaleTag(),
  ]);
  if (!KINDS.has(kind)) notFound();
  const t = i18n.t.bind(i18n);
  const country = journeyCountry(query['country'], tag);
  const version = typeof query['version'] === 'string' ? query['version'] : undefined;
  const search = new URLSearchParams({
    locale: tag,
    ...(country !== null ? { country } : {}),
    ...(version !== undefined && /^[1-9][0-9]{0,5}$/.test(version) ? { version } : {}),
  });
  const reply = await callApi(
    'GET',
    `/legal/documents/${kind}?${search.toString()}`,
    await clientContext(),
  );
  if (reply.status === 404) notFound();
  const doc = reply.status === 200 ? (reply.json as LegalDocumentJson | null) : null;
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      {doc === null || typeof doc.bodyMd !== 'string' ? (
        <Banner tone="danger" live="polite">
          {t('common.legal.unavailable')}
        </Banner>
      ) : (
        <article className={styles['stack']} lang={doc.locale}>
          <header className={styles['stackTight']}>
            <h1 className={styles['h1']}>{doc.title}</h1>
            <p className={styles['muted']}>
              <Badge>{t('web.legal.version', { version: String(doc.version) })}</Badge>
            </p>
          </header>
          {doc.draft && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
          <div className={styles['document']}>{renderLegalText(doc.bodyMd)}</div>
        </article>
      )}
      <ButtonLink variant="quiet" href="/signup">
        {t('web.legal.back')}
      </ButtonLink>
    </main>
  );
}

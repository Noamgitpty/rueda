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

// CGU de l'hôte (US-126) : servies comme les documents du voyageur, acceptées depuis /host ;
// politique d'annulation et zones de circulation (US-208) : liens des cases du checkout S05
const KINDS = new Set([
  'TOS_GUEST',
  'PRIVACY',
  'MARKETING',
  'TOS_HOST',
  'CANCELLATION_POLICY',
  'GEO_TERMS',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface LegalDocumentJson {
  readonly title: string;
  readonly version: number;
  readonly draft: boolean;
  readonly locale: string;
  readonly validFrom: string;
  readonly bodyMd: string;
}

/** Date d'entrée en vigueur (UTC : la page publique ne connaît pas le fuseau du lecteur). */
function validFromOf(i18n: { date(instant: string, timeZone: string): string }, value: unknown) {
  if (typeof value !== 'string') return null;
  try {
    return i18n.date(value, 'UTC');
  } catch {
    return null;
  }
}

/**
 * Document juridique (CGU du voyageur, confidentialité, communications ; US-102 ; CGU de l'hôte,
 * US-126 ; politique d'annulation et zones de circulation du checkout, US-208) : version, date d'entrée en vigueur, mention « traduction » hors de l'espagnol qui fait
 * foi ; version en vigueur, ou version passée (`?version=`) pour relire ce qui a été accepté (16 NFR-17). Une
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
  const fromHost = query['from'] === 'host';
  // ouvert depuis une case du checkout (S05) : retour au devis, identifiant vérifié
  const quote = query['from'] === 'checkout' ? query['quote'] : undefined;
  const back =
    typeof quote === 'string' && UUID.test(quote)
      ? { href: `/checkout/${quote}`, key: 'web.legal.backCheckout' as const }
      : fromHost
        ? { href: '/host', key: 'web.legal.backHost' as const }
        : { href: '/signup', key: 'web.legal.back' as const };
  const since = doc === null ? null : validFromOf(i18n, doc.validFrom);
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
              {since !== null && <> {t('web.legal.validFrom', { date: since })}</>}
            </p>
          </header>
          {doc.draft && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
          {/* seule la version espagnole fait foi (16 NFR-11) : les autres sont des traductions */}
          {doc.locale !== 'es' && <p className={styles['muted']}>{t('web.legal.translation')}</p>}
          <div className={styles['document']}>{renderLegalText(doc.bodyMd)}</div>
        </article>
      )}
      <ButtonLink variant="quiet" href={back.href}>
        {t(back.key)}
      </ButtonLink>
    </main>
  );
}

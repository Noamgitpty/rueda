import type { Metadata } from 'next';
import type { MessageKey } from '@rueda/i18n';
import { Badge, Banner } from '@rueda/ui';
import { getRequestI18n, getRequestLocaleTag } from '../../../i18n.ts';
import styles from '../_account/account.module.css';
import { MAIN_ID } from '../_shell/main-id.ts';
import hostStyles from '../host/host.module.css';

export async function generateMetadata(): Promise<Metadata> {
  const i18n = await getRequestI18n();
  return { title: i18n.t('web.legalCenter.title') };
}

/**
 * Version des textes du centre juridique (gabarit versionné du catalogue, pas un bloc éditable :
 * 19 US-212, notes techniques ; US-121) et date de cette version. BROUILLON tant que l'avocat ne
 * les a pas validés (GL-39, OQ-MK-01, OQ-BR-24) ; une nouvelle version change ces deux valeurs.
 */
const LEGAL_CENTER_VERSION = 1;
const LEGAL_CENTER_DATE = '2026-11-18T12:00:00.000Z';
const LEGAL_CENTER_DRAFT = true;

/** Documents publiés (CTR, US-102, US-126, US-208), servis par `/legal/{kind}`. */
const DOCUMENTS: readonly { readonly kind: string; readonly key: MessageKey }[] = [
  { kind: 'TOS_GUEST', key: 'web.legalCenter.doc.TOS_GUEST' },
  { kind: 'TOS_HOST', key: 'web.legalCenter.doc.TOS_HOST' },
  { kind: 'PRIVACY', key: 'web.legalCenter.doc.PRIVACY' },
  { kind: 'CANCELLATION_POLICY', key: 'web.legalCenter.doc.CANCELLATION_POLICY' },
  { kind: 'GEO_TERMS', key: 'web.legalCenter.doc.GEO_TERMS' },
];

/**
 * Centre juridique public (US-212, ADR-162 ; 16 LEG-011 SIMPLIFIÉ, LEG-014, LEG-015 ; 19 US-212
 * critère 2 « version, date, es et en (es fait foi) ; definitiva e inapelable absent ») :
 * positionnement d'intermédiaire entre particuliers (la plateforme n'est ni loueur ni propriétaire
 * des voitures ; marchand de référence pour le paiement ; protection de l'assureur partenaire),
 * documents publiés, documents de chaque trip (contrat et constancia), désaccords : messagerie,
 * support et médiation, puis voies externes toujours ouvertes (PROPOSÉ, comme Turo), loi du lieu
 * du trip. Page publique, sans donnée personnelle.
 */
export default async function LegalCenterPage() {
  const [i18n, tag] = await Promise.all([getRequestI18n(), getRequestLocaleTag()]);
  const t = i18n.t.bind(i18n);
  const section = (id: string, title: MessageKey, body: readonly MessageKey[]) => (
    <section className={hostStyles['section']} aria-labelledby={id} data-testid={id}>
      <h2 id={id} className={styles['h2']}>
        {t(title)}
      </h2>
      {body.map((k) => (
        <p key={k} className={styles['text']}>
          {t(k)}
        </p>
      ))}
    </section>
  );
  return (
    <main id={MAIN_ID} tabIndex={-1} className={styles['content']}>
      <article className={styles['stack']}>
        <header className={styles['stackTight']}>
          <h1 className={styles['h1']} data-testid="legal-center-title">
            {t('web.legalCenter.title')}
          </h1>
          <p className={styles['muted']}>
            <Badge>
              {t('web.legalCenter.version', {
                version: String(LEGAL_CENTER_VERSION),
                date: i18n.date(LEGAL_CENTER_DATE, 'UTC'),
              })}
            </Badge>
          </p>
          <p className={styles['text']}>{t('web.legalCenter.lead')}</p>
        </header>
        {LEGAL_CENTER_DRAFT && <Banner tone="warning">{t('web.legal.draft')}</Banner>}
        {/* seule la version espagnole fait foi (16 NFR-11) : les autres sont des traductions */}
        {!tag.startsWith('es') && <p className={styles['muted']}>{t('web.legal.translation')}</p>}
        {section('legal-center-role', 'web.legalCenter.role.title', [
          'web.legalCenter.role.body1',
          'web.legalCenter.role.body2',
          'web.legalCenter.role.body3',
        ])}
        <section
          className={hostStyles['section']}
          aria-labelledby="legal-center-docs"
          data-testid="legal-center-docs"
        >
          <h2 id="legal-center-docs" className={styles['h2']}>
            {t('web.legalCenter.docs.title')}
          </h2>
          <ul className={styles['stackTight']}>
            {DOCUMENTS.map((d) => (
              <li key={d.kind}>
                <a className={hostStyles['link']} href={`/legal/${d.kind}`}>
                  {t(d.key)}
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section
          className={hostStyles['section']}
          aria-labelledby="legal-center-trip"
          data-testid="legal-center-trip"
        >
          <h2 id="legal-center-trip" className={styles['h2']}>
            {t('web.legalCenter.trip.title')}
          </h2>
          <p className={styles['text']}>{t('web.legalCenter.trip.body')}</p>
          <a className={hostStyles['link']} href="/host/constancia">
            {t('web.legalCenter.trip.hostSearch')}
          </a>
        </section>
        {section('legal-center-disputes', 'web.legalCenter.disputes.title', [
          'web.legalCenter.disputes.body1',
          'web.legalCenter.disputes.body2',
          'web.legalCenter.disputes.body3',
          'web.legalCenter.disputes.law',
        ])}
      </article>
    </main>
  );
}

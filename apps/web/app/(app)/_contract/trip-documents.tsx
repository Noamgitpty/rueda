/**
 * Autres documents du trip (US-212, ADR-162) : liens depuis S09 · contrat (voyageur) et A03 ·
 * contrat (hôte) vers la constancia d'arrendamiento (16 LEG-026), la recherche de l'hôte par plaque
 * et date (EC-48) et le centre juridique (16 LEG-011, LEG-014, LEG-015). Composant serveur, sans
 * JavaScript ; aucune donnée personnelle dans les liens.
 */
import type { Translator } from '@rueda/i18n';
import accountStyles from '../_account/account.module.css';
import hostStyles from '../host/host.module.css';

export interface TripDocumentsProps {
  readonly i18n: Translator;
  readonly tripId: string;
  readonly role: 'GUEST' | 'HOST';
}

export function TripDocuments({ i18n, tripId, role }: TripDocumentsProps) {
  const t = i18n.t.bind(i18n);
  return (
    <section
      className={hostStyles['section']}
      aria-labelledby="trip-documents"
      data-testid="trip-documents"
    >
      <h2 id="trip-documents" className={accountStyles['h2']}>
        {t('web.contract.documents')}
      </h2>
      <ul className={accountStyles['stackTight']}>
        <li>
          <a
            className={hostStyles['link']}
            href={`/trips/${tripId}/constancia`}
            data-testid="trip-constancia-link"
          >
            {t('web.contract.constancia')}
          </a>
        </li>
        {role === 'HOST' && (
          <li>
            <a className={hostStyles['link']} href="/host/constancia">
              {t('web.contract.constanciaSearch')}
            </a>
          </li>
        )}
        <li>
          <a className={hostStyles['link']} href="/legal" data-testid="legal-center-link">
            {t('web.contract.legalCenter')}
          </a>
        </li>
      </ul>
    </section>
  );
}

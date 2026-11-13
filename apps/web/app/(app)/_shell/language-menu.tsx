import type { LocaleProfile, Translator } from '@rueda/i18n';
import styles from './shell.module.css';

/**
 * Choix de la langue (10b UX-11), sans JavaScript : un `<details>` ouvre la liste des locales de
 * la configuration ; chaque choix envoie `POST /locale` (cookie, puis retour à l'accueil). Les noms
 * de langue sont écrits dans leur propre langue, avec leur attribut `lang` (WCAG 3.1.2).
 */
export function LanguageMenu({
  i18n,
  locales,
}: {
  readonly i18n: Translator;
  readonly locales: readonly LocaleProfile[];
}) {
  const current = i18n.profile;
  return (
    <details className={styles['language']}>
      {/* Nom accessible = code visible puis libellé complet (WCAG 2.5.3, « label in name » :
          axe le refusait quand `aria-label` remplaçait le code affiché ; US-044). */}
      <summary className={styles['languageToggle']}>
        <span>{current.language.toUpperCase()}</span>
        <span className={styles['srOnly']}>
          {i18n.t('common.locale.current', { language: current.displayName })}
        </span>
      </summary>
      <div className={styles['languagePanel']}>
        <p className={styles['languageTitle']}>{i18n.t('common.locale.switchLabel')}</p>
        <form method="post" action="/locale" className={styles['languageList']}>
          {locales.map((profile) => (
            <button
              key={profile.tag}
              type="submit"
              name="locale"
              value={profile.tag}
              lang={profile.tag}
              className={styles['languageOption']}
              aria-current={profile.tag === current.tag ? 'true' : undefined}
            >
              {profile.displayName}
            </button>
          ))}
        </form>
        <p className={styles['languageHint']}>{i18n.t('web.shell.languageHint')}</p>
      </div>
    </details>
  );
}

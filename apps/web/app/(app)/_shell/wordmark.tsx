import type { ShellBrand } from '../../../brand-source.ts';
import { splitInitial, svgDataUri } from '../../../pwa/icon.tsx';
import styles from './shell.module.css';

/**
 * Marque dans l'en-tête : logo du thème (image, jamais injecté dans la page) et nom, dont la
 * première lettre prend la couleur d'action (règle du mot-symbole de la palette Tinta, appliquée
 * à tout nom). Lien vers l'accueil ; le nom accessible vient du catalogue.
 */
export function Wordmark({ brand, label }: { readonly brand: ShellBrand; readonly label: string }) {
  const [initial, rest] = splitInitial(brand.name);
  const { light, dark } = brand.logo;
  const scheme = brand.active.dataTheme;
  const single = scheme === 'dark' ? (dark ?? light) : light;
  return (
    <a className={styles['brand']} href="/" aria-label={label}>
      {single !== undefined && (
        <picture className={styles['logo']}>
          {scheme === undefined && dark !== undefined && (
            <source media="(prefers-color-scheme: dark)" srcSet={svgDataUri(dark)} />
          )}
          <img src={svgDataUri(single)} alt="" width={32} height={32} />
        </picture>
      )}
      <span className={styles['name']} aria-hidden="true">
        <span className={styles['initial']}>{initial}</span>
        {rest}
      </span>
    </a>
  );
}

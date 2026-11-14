/**
 * US-122 — red team du lot 1, axe marque (RT-L1-A05, US-120, ADR-116) : charges SVG
 * contre le contrôle du logo (`logoProblem` / `logoProblems` de @rueda/design-tokens, appliqué à
 * l'enregistrement d'un brouillon de marque par l'API). Le contrôle n'ouvre aucune base : il est
 * joué dans la suite red team de la base (groupe `l0-redteam`, joué après tous les autres fichiers),
 * pour que ses échecs ne masquent pas les autres suites d'intégration. Rapport :
 * docs/team/redteam/L1-rls-abus.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Règle de l'ADR-116 : « un logo doit être un SVG autonome, borné, sans script, sans
 * gestionnaire d'événement, sans contenu étranger ni ressource externe, sans déclaration DTD ».
 * Le logo n'est affiché qu'en image (`<img src="data:image/svg+xml,…">`) : un script ne s'y
 * exécute pas ; le contrôle est une défense en profondeur (ouverture directe de l'actif, futur
 * affichage en ligne), d'où une gravité PROPOSÉE faible pour un contournement.
 */
import { describe, expect, it } from 'vitest';
import { LOGO_MAX_LENGTH, logoProblem, logoProblems } from '../../../../design-tokens/src/logo.ts';
import { withRole } from '../../../src/testing/index.ts';

/** Assertion L0-05 en tête de chaque test : le contrôle ne touche pas la base, le rôle est affirmé. */
const l005 = (): Promise<void> => withRole('app_api', async () => undefined);

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const svg = (inner: string, attrs = NS): string =>
  `<svg ${attrs} viewBox="0 0 10 10">${inner}</svg>`;

/** Charges que la liste de refus de l'ADR-116 nomme : elles doivent être refusées. */
const IN_SCOPE: readonly (readonly [string, string])[] = [
  ['script', svg('<script>alert(1)</script>')],
  ['script en casse mixte', svg('<ScRiPt>alert(1)</sCrIpT>')],
  ['gestionnaire onload', `<svg ${NS} onload="alert(1)"></svg>`],
  ['gestionnaire sur un élément', svg('<rect onclick="alert(1)" width="1" height="1"/>')],
  ['lien javascript', svg('<a href="javascript:alert(1)"><rect width="1" height="1"/></a>')],
  ['lien javascript avec blanc', svg('<a href=" javascript:alert(1)"><rect/></a>')],
  ['lien javascript xlink', svg('<a xlink:href="javascript:alert(1)"><rect/></a>')],
  ['lien avec entité numérique', svg('<a href="&#106;avascript:alert(1)"><rect/></a>')],
  ['foreignObject', svg('<foreignObject><div>x</div></foreignObject>')],
  [
    'entité externe',
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${svg('<text>&x;</text>')}`,
  ],
  ['CDATA', svg('<style><![CDATA[*{opacity:1}]]></style>')],
  ['instruction de traitement', `<?xml-stylesheet href="https://evil.example/x.css"?>${svg('')}`],
  ['ressource externe par href', svg('<use href="https://evil.example/x.svg#a"/>')],
  ['ressource externe par url()', svg('<rect style="fill:url(https://evil.example/x)"/>')],
  ['feuille externe', svg('<style>@import "https://evil.example/x.css";</style>')],
  ['image intégrée', svg('<image href="data:image/png;base64,AAAA"/>')],
  ['data: dans un attribut', svg('<rect style="opacity:1" data-x="data:text/html,x"/>')],
  ['iframe', svg('<iframe src="https://evil.example"></iframe>')],
  ['animation de href', svg('<set attributeName="href" to="javascript:alert(1)"/>')],
  ['taille excessive', svg(`<!-- ${'x'.repeat(LOGO_MAX_LENGTH)} -->`)],
  ['caractère de contrôle', svg('<text>a\u0001b</text>')],
  ['texte qui n’est pas un SVG', '<div onclick="alert(1)">x</div>'],
  ['deux racines', `${svg('')}<script>alert(1)</script>${svg('')}`],
];

/**
 * Contournements simples du contrôle par motifs (liste de refus) : ils ne contiennent pas les
 * séquences exactes que les règles cherchent. Mesurés ; gravité PROPOSÉE faible (défense en
 * profondeur, affichage en image seulement).
 */
const EVASIONS: readonly (readonly [string, string])[] = [
  ['gestionnaire après une barre oblique', '<svg/onload=alert(1)></svg>'],
  ['gestionnaire collé à la valeur précédente', `<svg ${NS}onload="alert(1)"></svg>`],
  [
    'gestionnaire sur un élément enfant sans blanc',
    `<svg ${NS}><rect width="1"height="1"onmouseover="alert(1)"/></svg>`,
  ],
  [
    'script d’un autre préfixe de nom',
    svg('<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>'),
  ],
  [
    '@import écrit avec une échappation CSS',
    svg('<style>@\\69mport "https://evil.example/x.css";</style>'),
  ],
  [
    'ressource externe par image-set',
    svg('<style>*{background:image-set("https://evil.example/x.png" 1x)}</style>'),
  ],
];

describe('RT-L1-A05 — logo SVG : contrôle de l’ADR-116', () => {
  it('témoin : un SVG simple, avec un dégradé interne, est accepté', async () => {
    await l005();
    expect(
      logoProblem(
        svg('<defs><linearGradient id="g"/></defs><rect fill="url(#g)" width="1" height="1"/>'),
      ),
    ).toBeNull();
  });

  it.each(IN_SCOPE)('dans la liste de refus — %s : refusé', async (_name, payload) => {
    await l005();
    expect(logoProblem(payload)).not.toBeNull();
  });

  it.each(EVASIONS)('contournement simple — %s : refusé', async (_name, payload) => {
    await l005();
    expect(
      logoProblem(payload),
      'le contrôle par motifs laisse passer cette charge',
    ).not.toBeNull();
  });

  it('un logo est refusé aux trois jetons (brand.logo, brand.logoDark, brand.logoMono), le jeton est nommé', async () => {
    await l005();
    const bad = '<svg/onload=alert(1)></svg>';
    for (const path of ['logo', 'logoDark', 'logoMono']) {
      const problems = logoProblems({ brand: { [path]: { $value: bad } } });
      expect(problems, path).toHaveLength(1);
      expect(problems[0], path).toContain(`brand.${path}`);
    }
  });
});

/**
 * Logo SVG de la marque (US-120, ADR-116) : refusé s'il peut charger, exécuter ou déclarer quoi
 * que ce soit ; les logos des palettes US-028 (source unique) passent tous.
 */
import { describe, expect, it } from 'vitest';
import {
  LOGO_MAX_LENGTH,
  LOGO_TOKEN_PATHS,
  logoProblem,
  logoProblems,
  PALETTE_IDS,
  paletteDocument,
} from '../src/index.ts';

const OK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48"/></svg>';
const wrap = (inner: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${inner}</svg>`;

describe('logo SVG de la marque', () => {
  it('chaque logo de chaque palette US-028 est conforme', () => {
    for (const id of PALETTE_IDS) expect(logoProblems(paletteDocument(id)), id).toEqual([]);
  });

  it('un SVG simple passe ; un dégradé interne (url(#id)) aussi', () => {
    expect(logoProblem(OK)).toBeNull();
    expect(
      logoProblem(wrap('<defs><linearGradient id="g"/></defs><rect fill="url(#g)"/>')),
    ).toBeNull();
    expect(logoProblem(wrap('<use href="#a"/>'))).toBeNull();
  });

  it.each([
    ['script', wrap('<script>alert(1)</script>')],
    ['script en majuscules', wrap('<SCRIPT>x</SCRIPT>')],
    ['gestionnaire', wrap('<rect onload="x()"/>')],
    ['gestionnaire sans guillemet', '<svg onclick=x()></svg>'],
    ['foreignObject', wrap('<foreignObject><div/></foreignObject>')],
    ['entité', `<!DOCTYPE svg [<!ENTITY x "y">]>${OK}`],
    ['entité dans le svg', wrap('<!ENTITY x "y">')],
    ['CDATA', wrap('<style><![CDATA[a{}]]></style>')],
    ['instruction', wrap('<?xml-stylesheet href="x"?>')],
    ['lien externe', wrap('<a href="https://example.test"><rect/></a>')],
    ['xlink externe', wrap('<use xlink:href="https://example.test/a.svg#x"/>')],
    ['image', wrap('<image href="#x"/>')],
    ['url externe', wrap('<rect fill="url(https://example.test/x)"/>')],
    ['javascript:', wrap('<a href="#" style="background:javascript:x"/>')],
    ['data:', wrap('<rect style="fill:url(data:x)"/>')],
    ['import', wrap('<style>@import "x.css";</style>')],
    ['animation', wrap('<animate attributeName="x"/>')],
    ['iframe', wrap('<iframe/>')],
    ['pas un svg', '<html><svg/></html>'],
    ['deux racines', `${OK}<p/>`],
    ['contrôle', wrap('\u0007')],
  ])('refuse : %s', (_why, svg) => {
    expect(logoProblem(svg)).not.toBeNull();
  });

  // US-122 (red team F-L1-B-01, ADR-122) : liste blanche par analyse XML
  it.each([
    ['gestionnaire collé', '<svg xmlns="http://www.w3.org/2000/svg"onload="x()"></svg>'],
    ['gestionnaire après une barre', '<svg/onload=x()></svg>'],
    ['élément préfixé', wrap('<svg:script xmlns:svg="http://www.w3.org/2000/svg">x</svg:script>')],
    ['attribut préfixé', wrap('<rect xml:base="https://example.test/"/>')],
    ['espace de noms inconnu', wrap('<g xmlns:ev="http://www.w3.org/2001/xml-events"/>')],
    ['xmlns étranger', '<svg xmlns="http://www.w3.org/1999/xhtml"></svg>'],
    ['attribut hors liste', wrap('<rect data-x="1"/>')],
    ['élément style', wrap('<style>rect{fill:red}</style>')],
    ['échappement CSS', wrap('<rect style="fill:\\72 ed"/>')],
    ['image-set', wrap('<rect style="fill:image-set(&quot;x&quot; 1x)"/>')],
    ['entité dans un texte', wrap('<text>&amp;</text>')],
    ['commentaire', wrap('<!-- x -->')],
    ['texte hors élément de texte', wrap('alert(1)')],
    ['valeur sans guillemets', '<svg width=1></svg>'],
    ['balise non fermée', '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'],
    ['href vers un autre élément que use', wrap('<g href="#a"/>')],
  ])('refuse (liste blanche) : %s', (_why, svg) => {
    expect(logoProblem(svg)).not.toBeNull();
  });

  it('admet un logo usuel : groupes, dégradé, découpe, titre et texte', () => {
    expect(
      logoProblem(
        wrap(
          '<title>Marque</title><defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="#000"/></linearGradient><clipPath id="c"><rect width="4" height="4"/></clipPath></defs><g clip-path="url(#c)" transform="translate(1 1)"><path d="M0 0h4" stroke="url(#g)"/><text x="1" y="2" font-size="2">K</text></g>',
        ),
      ),
    ).toBeNull();
  });

  it('taille bornée ; un texte est exigé', () => {
    expect(logoProblem('')).not.toBeNull();
    expect(logoProblem(`<svg>${' '.repeat(LOGO_MAX_LENGTH)}</svg>`)).not.toBeNull();
    expect(logoProblem(42)).not.toBeNull();
  });

  it('logoProblems nomme le jeton en cause ; un logo absent ne pose pas problème', () => {
    expect(logoProblems({})).toEqual([]);
    expect(logoProblems({ brand: { logo: { $value: wrap('<script/>') } } })).toEqual([
      'brand.logo : script',
    ]);
    expect(LOGO_TOKEN_PATHS).toContain('brand.logoDark');
  });
});

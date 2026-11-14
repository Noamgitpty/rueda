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

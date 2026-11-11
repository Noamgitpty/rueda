/**
 * Registre des blocs éditables (US-121, ADR-095). Attendus : 19 US-121 (critère 3 : CGU, contrat,
 * politique d'annulation jamais éditables comme bloc), 17 §3.2.13 (`legal.*` refusé), 10b UX-58
 * (aucune chaîne absente : chaque bloc remplace un texte existant dans les quatre langues).
 */
import { describe, expect, it } from 'vitest';
import {
  BLOCK_KEY_PATTERN,
  CATALOGS,
  CATALOG_LANGUAGES,
  EDITABLE_BLOCKS,
  blockKeyOf,
  editableBlock,
  isLegalBlockKey,
  placeholdersOf,
  richTextProblem,
} from '../src/index.ts';

describe('registre', () => {
  const entries = Object.entries(EDITABLE_BLOCKS);

  it('chaque clé suit le motif de la base, n’est pas juridique et vise un texte du catalogue', () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const [key, block] of entries) {
      expect(BLOCK_KEY_PATTERN.test(key), key).toBe(true);
      expect(isLegalBlockKey(key), key).toBe(false);
      for (const lang of CATALOG_LANGUAGES) {
        const message = CATALOGS[lang].messages[block.catalogKey];
        // texte simple : ni pluriel, ni variable (un bloc ne reçoit pas de valeur calculée)
        expect(typeof message, `${key} ${lang}`).toBe('string');
        expect(placeholdersOf(message as string), `${key} ${lang}`).toEqual([]);
        // le texte livré respecte lui-même les règles du bloc : il est un repli valide
        expect(richTextProblem(message as string, block.format, block.maxLength)).toBeNull();
      }
    }
  });

  it('un texte du catalogue n’est remplacé que par un seul bloc', () => {
    const targets = entries.map(([, b]) => b.catalogKey);
    expect(new Set(targets).size).toBe(targets.length);
    expect(blockKeyOf('web.s01.title')).toBe('home.hero.title');
    expect(blockKeyOf('common.auth.requestInvalid')).toBeUndefined();
  });

  it('clé inconnue ou héritée de l’objet : non éditable', () => {
    expect(editableBlock('home.hero.title')).toMatchObject({ catalogKey: 'web.s01.title' });
    expect(editableBlock('home.unknown.title')).toBeUndefined();
    expect(editableBlock('constructor')).toBeUndefined();
    expect(editableBlock('__proto__')).toBeUndefined();
  });
});

describe('textes juridiques (critère 3)', () => {
  it.each([
    'legal.terms',
    'legal.terms.body',
    'home.terms',
    'page.cgu.body',
    'trip.contract.body',
    'checkout.cancellation_policy',
    'help.politica_cancelacion',
    'footer.privacy',
    'footer.privacidad.link',
    'protection.plans.body',
    'insurance.summary',
    'home.refund.title',
    'web.cookies.banner',
    // es et pt, sous-chaînes d'un segment (revue sécurité US-121, constat 1)
    'help.terminos_uso',
    'help.terminos',
    'page.condiciones',
    'ajuda.termos',
    'ajuda.condicoes_gerais',
    'footer.legalnotice',
    'footer.avisolegal',
    'page.mentions_legales',
    'app.eula',
    'home.disclaimer',
    'trip.waiver',
    'protection.deductible',
    'home.franquicia',
    'home.franquia',
    'home.warranty',
    'home.garantia',
    'home.garantie',
    'trip.contrato_alquiler',
    'help.politica_privacidade',
    'help.reembolsos',
    'help.remboursement',
    'trip.responsabilidad',
    'home.seguros',
    // sigles et mots courts, par segment (revue sécurité 2e passe, constat 2)
    'home.tos',
    'footer.tos.link',
    'help.tyc',
    'help.t_c',
    'help.tandc',
    'footer.rgpd',
    'footer.lgpd',
    'footer.gdpr',
    'legal_x.dpa',
    'footer.lopd',
    'footer.aviso',
    'footer.mentions',
    'footer.impressum',
    'footer.imprint',
    'app.license',
    'app.licencia',
    'app.licenca',
    'page.cgv',
    'footer.cookies',
    // chaque document juridique réel, dans les quatre langues
    'page.terms_of_service',
    'page.terminos_y_condiciones',
    'page.termos_de_uso',
    'page.conditions_generales',
    'page.privacy_policy',
    'page.politica_de_privacidad',
    'page.politique_de_confidentialite',
    'trip.rental_contract',
    'trip.contrato',
    'trip.contrat_de_location',
    'checkout.cancellation_policy',
    'checkout.politica_de_cancelacion',
    'checkout.politique_d_annulation',
    'checkout.politica_de_cancelamento',
    'protection.insurance_terms',
    'protection.seguro_auto',
    'protection.franquia',
    'protection.assurance',
    'footer.cookie_policy',
    'footer.politica_de_cookies',
  ])('%s : juridique', (key) => {
    expect(isLegalBlockKey(key)).toBe(true);
  });

  it.each([
    'home.hero.title',
    'home.how.step2.body',
    'home.owner.body',
    'faq.pickup.where',
    'home.autos.title',
    'web.fotos.caption',
    'home.precio.final',
    'home.vecinos.body',
    // faux positifs évités (revue sécurité 2e passe, constat 3)
    'home.autos_cerca.title',
    'home.photos.title',
    'home.pickup.airport_terminal',
    'home.car.vehicle_condition',
    'home.air_conditioning',
    'home.free_cancel',
    'home.viaja_seguro',
    'web.cookie_banner',
  ])('%s : non juridique', (key) => {
    expect(isLegalBlockKey(key)).toBe(false);
  });
});

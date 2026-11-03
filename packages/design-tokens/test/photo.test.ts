/**
 * Règles photo (US-031). Les valeurs attendues viennent des spécifications, jamais du code testé :
 * 16 TRP-004 (≥ 15 extérieures, ≥ 8 intérieures, carburant, compteur, de chaque côté, appareil
 * photo de l'app seulement, ≈ 1 600 px, ≤ 500 ko), 17 §3.2.10 (`EXT_01`…`EXT_15`,
 * `INT_01`…`INT_08`, `FUEL`, `ODOMETER` ; `KEY`, `DAMAGE_n` hors minimum), 08 BR-LIST-05
 * (≥ 6 obligatoires, 10 recommandées), 10b UX-52 (≤ 20 mots) et UX-58 (aucune langue manquante).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  angleKeyOf,
  checkHandoverSet,
  PHOTO_LANGUAGES,
  PHOTO_MESSAGES,
  PHOTO_RULES,
  PhotoRulesError,
  validatePhotoMessages,
  validatePhotoRules,
} from '../src/photo.ts';

const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(new URL(`../rules/${file}`, import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
const rawRules = (): Record<string, unknown> => read('photo.rules.json');
const rawMessages = (): Record<string, unknown> => read('photo.messages.json');
const problemsOf = (fn: () => unknown): readonly string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof PhotoRulesError) return error.problems;
    throw error;
  }
  return [];
};

const range = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}_${String(i + 1).padStart(2, '0')}`);
const TRP004_SLOTS = [...range('EXT', 15), ...range('INT', 8), 'FUEL', 'ODOMETER'];

describe('gabarit de remise entre particuliers (16 TRP-004, 17 §3.2.10)', () => {
  const { handover } = PHOTO_RULES;

  it('exactement les emplacements de 17 §3.2.10, dans l’ordre du tour de la voiture', () => {
    expect(handover.slots.map((s) => s.slotCode)).toEqual(TRP004_SLOTS);
  });

  it('au moins 15 extérieures, 8 intérieures, carburant et compteur', () => {
    const count = (zone: string): number =>
      handover.slots.filter((s) => s.angle.zone === zone).length;
    expect(count('exterior')).toBeGreaterThanOrEqual(15);
    expect(count('interior')).toBeGreaterThanOrEqual(8);
    expect(handover.slots.find((s) => s.slotCode === 'FUEL')?.angle.code).toBe('GAUGE_FUEL');
    expect(handover.slots.find((s) => s.slotCode === 'ODOMETER')?.angle.code).toBe(
      'GAUGE_ODOMETER',
    );
    expect(handover.minimum).toEqual({ exterior: 15, interior: 8, gauge: 2 });
  });

  it('chaque partie, au départ et au retour, avec l’appareil photo de l’app seulement', () => {
    expect(handover.perParticipant).toEqual(['HOST', 'GUEST']);
    expect(handover.phases).toEqual(['PICKUP', 'RETURN']);
    expect(handover.source).toBe('inAppCameraOnly');
  });

  it('KEY et DAMAGE_n sont optionnels, hors du minimum', () => {
    expect(handover.optionalSlots.map((s) => s.code)).toEqual(['KEY', 'DAMAGE_n']);
  });

  it('chaque angle du gabarit est distinct et fait le tour des deux côtés', () => {
    const angles = handover.slots.map((s) => s.angle.code);
    expect(new Set(angles).size).toBe(angles.length);
    const ext = handover.slots.filter((s) => s.angle.zone === 'exterior');
    for (const side of ['driver', 'passenger', 'center'])
      expect(
        ext.some((s) => s.angle.side === side),
        side,
      ).toBe(true);
  });

  // Critères de 16 TRP-004, rejoués sur la fonction de contrôle livrée aux consommateurs.
  it('15 extérieures, 7 intérieures, carburant et compteur : incomplet (PHOTO_TEMPLATE_INCOMPLETE)', () => {
    const set = TRP004_SLOTS.filter((c) => c !== 'INT_08');
    expect(checkHandoverSet(set)).toEqual({ complete: false, missing: ['INT_08'] });
  });

  it('série complète : complète ; KEY et DAMAGE_1 en plus ne changent rien', () => {
    expect(checkHandoverSet(TRP004_SLOTS).complete).toBe(true);
    expect(checkHandoverSet([...TRP004_SLOTS, 'KEY', 'DAMAGE_1']).complete).toBe(true);
    expect(checkHandoverSet(['KEY', 'DAMAGE_1']).missing).toEqual(TRP004_SLOTS);
  });
});

describe('photos d’annonce (08 BR-LIST-05)', () => {
  const { listing } = PHOTO_RULES;

  it('au moins 6 obligatoires, 10 recommandées', () => {
    expect(listing.minPhotos).toBe(6);
    expect(listing.recommendedPhotos).toBe(10);
    expect(listing.shots.filter((s) => s.required)).toHaveLength(6);
    expect(listing.shots).toHaveLength(10);
  });

  it('extérieur et intérieur, couverture obligatoire en trois-quarts avant', () => {
    const zones = new Set(listing.shots.filter((s) => s.required).map((s) => s.angle.zone));
    expect([...zones].sort()).toEqual(['exterior', 'interior']);
    expect(listing.cover.code).toBe('EXT_FRONT_34_DRIVER');
  });

  it('affichage 16:9 (cartes de packages/ui) avec une marge de sécurité', () => {
    expect(listing.displayAspectRatio).toEqual({ width: 16, height: 9 });
    expect(listing.safeAreaInsetPercent).toBeGreaterThan(0);
  });
});

describe('prise de vue, cadrages, lumière, interdits', () => {
  it('paysage 4:3, au moins 1 600 × 1 200, stockée en 1 600 px et 500 ko au plus', () => {
    expect(PHOTO_RULES.capture).toMatchObject({
      orientation: 'landscape',
      aspectRatio: { width: 4, height: 3 },
      minLongEdgePx: 1600,
      minShortEdgePx: 1200,
      storedLongEdgePx: 1600,
    });
    expect(PHOTO_RULES.capture.storedMaxBytes).toBeLessThanOrEqual(500 * 1024);
  });

  it('cadrages et lumière publiés', () => {
    expect(PHOTO_RULES.framing.length).toBeGreaterThanOrEqual(4);
    expect(PHOTO_RULES.light.map((l) => l.code)).toEqual(
      expect.arrayContaining(['daylight', 'backlight', 'night']),
    );
  });

  it('plaque lisible floutée dans l’annonce ; personnes refusées partout', () => {
    const plate = PHOTO_RULES.forbidden.find((f) => f.code === 'plate');
    expect(plate).toMatchObject({ appliesTo: ['listing'], enforcement: 'blur' });
    const people = PHOTO_RULES.forbidden.find((f) => f.code === 'people');
    expect(people).toMatchObject({ appliesTo: ['listing', 'handover'], enforcement: 'refuse' });
    // Photos de remise : preuves privées, la plaque y reste lisible (jamais publiées).
    expect(PHOTO_RULES.handover.plate).toBe('visibleNeverPublished');
  });

  it('IA, photos de stock, texte en surimpression et coordonnées refusés (08 BR-LIST-05)', () => {
    const codes = PHOTO_RULES.forbidden.map((f) => f.code);
    for (const c of ['aiGenerated', 'stock', 'overlay', 'contact', 'unsafe', 'offensive'])
      expect(codes).toContain(c);
  });
});

describe('textes es / en / fr / pt-BR (10b UX-52, UX-58)', () => {
  const keys = (lang: (typeof PHOTO_LANGUAGES)[number]): string[] =>
    Object.keys(PHOTO_MESSAGES[lang]).sort();

  it('quatre langues déclarées : es, en, fr, pt (pt-BR)', () => {
    expect(PHOTO_LANGUAGES).toEqual(['es', 'en', 'fr', 'pt']);
    expect(rawMessages()['languages']).toEqual(['es', 'en', 'fr', 'pt']);
  });

  it('mêmes clés dans les quatre langues', () => {
    expect(keys('en')).toEqual(keys('es'));
    expect(keys('fr')).toEqual(keys('es'));
    expect(keys('pt')).toEqual(keys('es'));
  });

  it('chaque angle, cadrage, lumière, interdit et contrôle a son texte dans les quatre langues', () => {
    const needed = [
      ...PHOTO_RULES.angles.flatMap((a) => [a.labelKey, a.hintKey]),
      ...[
        ...PHOTO_RULES.framing,
        ...PHOTO_RULES.light,
        ...PHOTO_RULES.forbidden,
        ...PHOTO_RULES.checks,
      ].map((g) => g.messageKey),
    ];
    for (const lang of PHOTO_LANGUAGES)
      for (const key of needed) expect(PHOTO_MESSAGES[lang][key], `${lang} ${key}`).toBeTruthy();
  });

  it('aucune clé orpheline : chaque texte sert à une règle ou à un écran de gabarit', () => {
    const used = new Set([
      ...PHOTO_RULES.angles.flatMap((a) => [a.labelKey, a.hintKey]),
      ...[
        ...PHOTO_RULES.framing,
        ...PHOTO_RULES.light,
        ...PHOTO_RULES.forbidden,
        ...PHOTO_RULES.checks,
        ...PHOTO_RULES.handover.optionalSlots,
      ].map((g) => g.messageKey),
    ]);
    const orphans = keys('es').filter(
      (k) => !used.has(k) && !/^web\.photo\.(listing|handover)\.\w+$/.test(k),
    );
    expect(orphans).toEqual([]);
  });

  it.each(PHOTO_LANGUAGES.map((l) => [l] as const))(
    '%s : phrases de 20 mots au plus (UX-52)',
    (lang) => {
      for (const [key, text] of Object.entries(PHOTO_MESSAGES[lang]))
        for (const sentence of text.split(/(?<=[.!?])\s+/))
          expect(
            sentence.split(/\s+/).filter(Boolean).length,
            `${key} : ${sentence}`,
          ).toBeLessThanOrEqual(20);
    },
  );

  it('fr : espace insécable avant « : ; ! ? » et apostrophe typographique', () => {
    for (const [key, text] of Object.entries(PHOTO_MESSAGES.fr)) {
      expect(text, key).not.toMatch(/ [:;!?]/);
      expect(text, key).not.toContain("'");
    }
  });

  it('pt-BR : réécrit pour le Brésil, pas recopié de l’espagnol', () => {
    expect(PHOTO_MESSAGES.pt['web.photo.angle.intTrunk.label']).toBe('Porta-malas');
    const same = Object.keys(PHOTO_MESSAGES.es).filter(
      // Un mot isolé peut coïncider (« Frente ») ; une phrase, jamais.
      (k) => PHOTO_MESSAGES.pt[k] === PHOTO_MESSAGES.es[k] && /\s/.test(PHOTO_MESSAGES.es[k] ?? ''),
    );
    expect(same).toEqual([]);
  });

  it('les variables sont les mêmes dans chaque langue', () => {
    expect(PHOTO_MESSAGES.fr['web.photo.listing.count']).toContain('{min}');
    expect(PHOTO_MESSAGES.en['web.photo.rule.forbidden.contact']).toContain('{brand}');
  });

  it('clé d’angle dérivée du code', () => {
    expect(angleKeyOf('EXT_FRONT_34_DRIVER')).toBe('extFront34Driver');
  });
});

describe('fail-closed : des données fautives empêchent le chargement', () => {
  const messages = PHOTO_MESSAGES;
  /** Vue modifiable du JSON brut, pour les mutations. */
  interface RawRules {
    handover: {
      minimum: Record<string, number>;
      slots: { slotCode: string; angle: string }[];
      source: string;
      perParticipant: string[];
    };
    forbidden: { code: string }[];
    listing: { minPhotos: number; cover: string; recommendedPhotos: number };
    capture: { aspectRatio: { width: number; height: number }; minShortEdgePx: number };
  }
  const mutate = (fn: (doc: RawRules) => void): readonly string[] => {
    const doc = rawRules();
    fn(doc as unknown as RawRules);
    return problemsOf(() => validatePhotoRules(doc, messages));
  };

  it('données publiées : aucun problème', () => {
    expect(problemsOf(() => validatePhotoRules(rawRules(), messages))).toEqual([]);
  });

  it('minimum de remise abaissé sous TRP-004', () => {
    expect(mutate((d) => (d.handover.minimum.interior = 7)).join('\n')).toContain(
      'handover.minimum.interior : au moins 8',
    );
  });

  it('emplacement retiré, en double ou dans la mauvaise zone', () => {
    expect(mutate((d) => d.handover.slots.splice(15, 1)).join('\n')).toContain(
      'emplacements interior pour un minimum de 8',
    );
    expect(mutate((d) => (d.handover.slots[1]!.slotCode = 'EXT_01')).join('\n')).toContain(
      'EXT_01 : en double',
    );
    expect(mutate((d) => (d.handover.slots[0]!.angle = 'INT_DASHBOARD')).join('\n')).toContain(
      'incompatible avec la zone interior',
    );
  });

  it('galerie autorisée à la remise, ou une seule partie', () => {
    expect(mutate((d) => (d.handover.source = 'cameraOrLibrary')).join('\n')).toContain(
      'handover.source',
    );
    expect(mutate((d) => (d.handover.perParticipant = ['HOST'])).join('\n')).toContain(
      'HOST et GUEST',
    );
  });

  it('interdit obligatoire retiré (plaque, personnes)', () => {
    const p = mutate((d) => {
      d.forbidden = d.forbidden.filter(
        (f: { code: string }) => !['plate', 'people'].includes(f.code),
      );
    }).join('\n');
    expect(p).toContain('forbidden.plate : interdit obligatoire');
    expect(p).toContain('forbidden.people : interdit obligatoire');
  });

  it('annonce : minimum sous 6, couverture facultative, compte incohérent', () => {
    expect(mutate((d) => (d.listing.minPhotos = 5)).join('\n')).toContain('au moins 6');
    expect(mutate((d) => (d.listing.cover = 'EXT_FRONT')).join('\n')).toContain('couverture');
    expect(mutate((d) => (d.listing.recommendedPhotos = 12)).join('\n')).toContain(
      'recommendedPhotos',
    );
  });

  it('ratio portrait ou définition incohérente', () => {
    expect(mutate((d) => (d.capture.aspectRatio = { width: 3, height: 4 })).join('\n')).toContain(
      'ratio paysage',
    );
    expect(mutate((d) => (d.capture.minShortEdgePx = 900)).join('\n')).toContain('1200 attendu');
  });

  it('angle sans texte dans une langue', () => {
    const msgs = rawMessages();
    delete (msgs['fr'] as Record<string, string>)['web.photo.angle.extFront.hint'];
    expect(problemsOf(() => validatePhotoMessages(msgs)).join('\n')).toContain(
      'web.photo.angle.extFront.hint : texte fr absent',
    );
  });

  it('portugais absent ou langue non déclarée', () => {
    const msgs = rawMessages();
    delete (msgs['pt'] as Record<string, string>)['web.photo.check.blurry'];
    expect(problemsOf(() => validatePhotoMessages(msgs)).join('\n')).toContain(
      'web.photo.check.blurry : texte pt absent',
    );
    const undeclared = rawMessages();
    undeclared['languages'] = ['es', 'en', 'fr'];
    expect(problemsOf(() => validatePhotoMessages(undeclared)).join('\n')).toContain(
      'languages : es, en, fr, pt attendues',
    );
  });

  it('variables différentes entre langues', () => {
    const msgs = rawMessages();
    (msgs['en'] as Record<string, string>)['web.photo.listing.count'] =
      'Add at least {count} photos.';
    expect(problemsOf(() => validatePhotoMessages(msgs)).join('\n')).toContain(
      'web.photo.listing.count : variables en différentes de es',
    );
  });
});

/**
 * Règles photo (US-031, ADR-069) : cadrages, nombre minimal, ratio, lumière, interdits, gabarit
 * de l'annonce (08 BR-LIST-05) et gabarit d'angles de la remise entre particuliers (16 TRP-004,
 * 17 §3.2.10 `slot_code`). Données dans `rules/photo.rules.json`, textes es / en / fr dans
 * `rules/photo.messages.json`. Le tout est validé au chargement du module (fail-closed) : une
 * clé absente dans une langue, un emplacement en double ou un gabarit sous le minimum de TRP-004
 * empêchent le paquet de se charger.
 *
 * Consommateurs prévus : capture guidée (US-303, A03 / A04 / S09), assistant d'annonce (US-508).
 */
import photoMessages from '../rules/photo.messages.json' with { type: 'json' };
import photoRules from '../rules/photo.rules.json' with { type: 'json' };

export const PHOTO_LANGUAGES = ['es', 'en', 'fr'] as const;
export type PhotoLanguage = (typeof PHOTO_LANGUAGES)[number];

export type AngleZone = 'exterior' | 'interior' | 'gauge';
export type AngleSide = 'center' | 'driver' | 'passenger';
export type AngleFraming = 'full' | 'half' | 'detail';
export type PhotoUse = 'listing' | 'handover';

export interface PhotoAngle {
  readonly code: string;
  readonly zone: AngleZone;
  readonly side: AngleSide;
  readonly position: string;
  readonly framing: AngleFraming;
  /** Clés de texte : nom de l'angle et consigne d'une phrase. */
  readonly labelKey: string;
  readonly hintKey: string;
}

export interface PhotoGuideline {
  readonly code: string;
  readonly messageKey: string;
}

export interface PhotoForbidden extends PhotoGuideline {
  readonly appliesTo: readonly PhotoUse[];
  /** `blur` : la plateforme floute avant publication ; `refuse` : la photo est refusée. */
  readonly enforcement: 'blur' | 'refuse';
}

export interface Ratio {
  readonly width: number;
  readonly height: number;
}

export interface ListingShot {
  readonly angle: PhotoAngle;
  readonly required: boolean;
}

export interface HandoverSlot {
  /** Valeur de `inspection_photo.slot_code` (17 §3.2.10). */
  readonly slotCode: string;
  readonly angle: PhotoAngle;
}

export interface PhotoRules {
  readonly version: string;
  readonly capture: {
    readonly orientation: 'landscape';
    readonly aspectRatio: Ratio;
    readonly minLongEdgePx: number;
    readonly minShortEdgePx: number;
    readonly storedLongEdgePx: number;
    readonly storedMaxBytes: number;
    readonly storedFormats: readonly string[];
  };
  readonly framing: readonly PhotoGuideline[];
  readonly light: readonly PhotoGuideline[];
  readonly forbidden: readonly PhotoForbidden[];
  readonly checks: readonly PhotoGuideline[];
  readonly angles: readonly PhotoAngle[];
  readonly listing: {
    readonly minPhotos: number;
    readonly recommendedPhotos: number;
    readonly source: 'cameraOrLibrary';
    readonly displayAspectRatio: Ratio;
    readonly safeAreaInsetPercent: number;
    readonly cover: PhotoAngle;
    readonly shots: readonly ListingShot[];
  };
  readonly handover: {
    readonly source: 'inAppCameraOnly';
    readonly perParticipant: readonly ('HOST' | 'GUEST')[];
    readonly phases: readonly ('PICKUP' | 'RETURN')[];
    /** La plaque reste visible : photos de preuve, jamais publiées. */
    readonly plate: 'visibleNeverPublished';
    readonly minimum: Readonly<Record<AngleZone, number>>;
    readonly slots: readonly HandoverSlot[];
    readonly optionalSlots: readonly PhotoGuideline[];
  };
}

export type PhotoMessages = Readonly<Record<PhotoLanguage, Readonly<Record<string, string>>>>;

export class PhotoRulesError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`règles photo invalides :\n- ${problems.join('\n- ')}`);
    this.name = 'PhotoRulesError';
    this.problems = problems;
  }
}

/**
 * Plancher de 16 TRP-004 (et 17 §3.2.10) : un gabarit de remise ne descend jamais en dessous,
 * quelle que soit la donnée. Le relever est permis.
 */
export const TRP004_MINIMUM: Readonly<Record<AngleZone, number>> = {
  exterior: 15,
  interior: 8,
  gauge: 2,
};
/** Plancher de 08 BR-LIST-05, recommandation LATAM ([NOUS]). */
export const LISTING_MINIMUM_FLOOR = 6;

const ZONES: readonly AngleZone[] = ['exterior', 'interior', 'gauge'];
const SIDES: readonly AngleSide[] = ['center', 'driver', 'passenger'];
const FRAMINGS: readonly AngleFraming[] = ['full', 'half', 'detail'];
const USES: readonly PhotoUse[] = ['listing', 'handover'];
/** Interdits que le fondateur exige (US-031) : on ne peut pas les retirer des données. */
const MANDATORY_FORBIDDEN: Readonly<Record<string, readonly PhotoUse[]>> = {
  plate: ['listing'],
  people: ['listing', 'handover'],
};
const SLOT_PREFIX: Readonly<Record<AngleZone, RegExp>> = {
  exterior: /^EXT_\d{2}$/,
  interior: /^INT_\d{2}$/,
  gauge: /^(FUEL|ODOMETER)$/,
};

/** `EXT_FRONT_34_DRIVER` → `extFront34Driver`. */
export const angleKeyOf = (code: string): string =>
  code
    .toLowerCase()
    .split('_')
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('');

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;
const placeholders = (text: string): string =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');

/** Valide les textes : mêmes clés dans les trois langues, non vides, mêmes variables. */
export function validatePhotoMessages(doc: unknown): PhotoMessages {
  const problems: string[] = [];
  if (!isRecord(doc)) throw new PhotoRulesError(['messages : objet attendu']);
  const byLang = Object.fromEntries(
    PHOTO_LANGUAGES.map((lang) => [lang, isRecord(doc[lang]) ? doc[lang] : {}]),
  ) as Record<PhotoLanguage, Record<string, unknown>>;
  const keys = new Set(PHOTO_LANGUAGES.flatMap((lang) => Object.keys(byLang[lang])));
  for (const key of keys) {
    if (!/^web\.photo\.[A-Za-z0-9.]+$/.test(key)) problems.push(`${key} : clé hors de web.photo.*`);
    const ref = byLang.es[key];
    for (const lang of PHOTO_LANGUAGES) {
      const text = byLang[lang][key];
      if (typeof text !== 'string' || text.trim() === '') {
        problems.push(`${key} : texte ${lang} absent (aucun repli entre langues, 10b UX-58)`);
      } else if (typeof ref === 'string' && placeholders(text) !== placeholders(ref)) {
        problems.push(`${key} : variables ${lang} différentes de es`);
      }
    }
  }
  if (problems.length > 0) throw new PhotoRulesError(problems);
  return byLang as unknown as PhotoMessages;
}

function guidelines(
  list: unknown,
  name: string,
  has: (key: string) => boolean,
  problems: string[],
): PhotoGuideline[] {
  if (!Array.isArray(list) || list.length === 0) {
    problems.push(`${name} : liste vide`);
    return [];
  }
  const seen = new Set<string>();
  for (const g of list) {
    const code = isRecord(g) ? String(g['code']) : '?';
    if (!isRecord(g) || typeof g['code'] !== 'string' || typeof g['messageKey'] !== 'string') {
      problems.push(`${name}.${code} : code et messageKey requis`);
      continue;
    }
    if (seen.has(code)) problems.push(`${name}.${code} : en double`);
    seen.add(code);
    if (!has(g['messageKey'])) problems.push(`${name}.${code} : texte ${g['messageKey']} absent`);
  }
  return list as PhotoGuideline[];
}

const validRatio = (r: unknown): r is Ratio =>
  isRecord(r) && isPositiveInt(r['width']) && isPositiveInt(r['height']);

/** Valide les règles contre leurs textes ; lève `PhotoRulesError` avec chaque problème. */
export function validatePhotoRules(doc: unknown, messages: PhotoMessages): PhotoRules {
  const problems: string[] = [];
  if (!isRecord(doc) || !isRecord(doc['meta']) || !isRecord(doc['capture']))
    throw new PhotoRulesError(['meta et capture requis']);
  const has = (key: string): boolean => PHOTO_LANGUAGES.every((l) => key in messages[l]);

  // Prise de vue : paysage, ratio, définition cohérente (16 TRP-004 : ≈ 1 600 px, ≤ 500 ko).
  const c = doc['capture'];
  if (c['orientation'] !== 'landscape') problems.push('capture.orientation : paysage attendu');
  if (!validRatio(c['aspectRatio']) || c['aspectRatio'].width <= c['aspectRatio'].height)
    problems.push('capture.aspectRatio : ratio paysage attendu (largeur > hauteur)');
  for (const k of ['minLongEdgePx', 'minShortEdgePx', 'storedLongEdgePx', 'storedMaxBytes'])
    if (!isPositiveInt(c[k])) problems.push(`capture.${k} : entier > 0 attendu`);
  if (validRatio(c['aspectRatio']) && isPositiveInt(c['minLongEdgePx'])) {
    const short = (c['minLongEdgePx'] * c['aspectRatio'].height) / c['aspectRatio'].width;
    if (c['minShortEdgePx'] !== short)
      problems.push(`capture.minShortEdgePx : ${short} attendu pour ce ratio`);
  }
  if (!Array.isArray(c['storedFormats']) || c['storedFormats'].length === 0)
    problems.push('capture.storedFormats : au moins un format');

  const framing = guidelines(doc['framing'], 'framing', has, problems);
  const light = guidelines(doc['light'], 'light', has, problems);
  const checks = guidelines(doc['checks'], 'checks', has, problems);
  const forbidden = guidelines(doc['forbidden'], 'forbidden', has, problems) as PhotoForbidden[];
  for (const f of forbidden) {
    if (!Array.isArray(f.appliesTo) || !f.appliesTo.every((u) => USES.includes(u)))
      problems.push(`forbidden.${f.code} : appliesTo ⊂ ${USES.join(', ')}`);
    if (f.enforcement !== 'blur' && f.enforcement !== 'refuse')
      problems.push(`forbidden.${f.code} : enforcement blur ou refuse`);
  }
  for (const [code, uses] of Object.entries(MANDATORY_FORBIDDEN)) {
    const f = forbidden.find((x) => x.code === code);
    if (!f || !uses.every((u) => f.appliesTo?.includes(u)))
      problems.push(`forbidden.${code} : interdit obligatoire pour ${uses.join(', ')}`);
  }

  // Angles : vocabulaire unique, chaque angle nommé et expliqué dans les trois langues.
  const angles = new Map<string, PhotoAngle>();
  for (const a of Array.isArray(doc['angles']) ? doc['angles'] : []) {
    if (!isRecord(a) || typeof a['code'] !== 'string' || !/^[A-Z][A-Z0-9_]+$/.test(a['code'])) {
      problems.push(`angles : code invalide (${JSON.stringify(a)})`);
      continue;
    }
    const code = a['code'];
    if (angles.has(code)) problems.push(`angles.${code} : en double`);
    if (!ZONES.includes(a['zone'] as AngleZone)) problems.push(`angles.${code} : zone inconnue`);
    if (!SIDES.includes(a['side'] as AngleSide)) problems.push(`angles.${code} : côté inconnu`);
    if (!FRAMINGS.includes(a['framing'] as AngleFraming))
      problems.push(`angles.${code} : cadrage inconnu`);
    if (typeof a['position'] !== 'string') problems.push(`angles.${code} : position manquante`);
    const base = `web.photo.angle.${angleKeyOf(code)}`;
    for (const key of [`${base}.label`, `${base}.hint`])
      if (!has(key)) problems.push(`angles.${code} : texte ${key} absent`);
    angles.set(code, {
      code,
      zone: a['zone'] as AngleZone,
      side: a['side'] as AngleSide,
      position: String(a['position']),
      framing: a['framing'] as AngleFraming,
      labelKey: `${base}.label`,
      hintKey: `${base}.hint`,
    });
  }
  const angle = (code: unknown, where: string): PhotoAngle | undefined => {
    const found = typeof code === 'string' ? angles.get(code) : undefined;
    if (!found) problems.push(`${where} : angle inconnu (${String(code)})`);
    return found;
  };

  // Annonce (08 BR-LIST-05) : minimum ≥ 6, recommandé = nombre de prises proposées.
  const l = isRecord(doc['listing']) ? doc['listing'] : {};
  const shots: ListingShot[] = [];
  const shotCodes = new Set<string>();
  for (const s of Array.isArray(l['shots']) ? l['shots'] : []) {
    if (!isRecord(s)) continue;
    const a = angle(s['angle'], 'listing.shots');
    if (!a) continue;
    if (shotCodes.has(a.code)) problems.push(`listing.shots.${a.code} : en double`);
    shotCodes.add(a.code);
    shots.push({ angle: a, required: s['required'] === true });
  }
  const required = shots.filter((s) => s.required).length;
  if (!isPositiveInt(l['minPhotos']) || l['minPhotos'] < LISTING_MINIMUM_FLOOR)
    problems.push(`listing.minPhotos : au moins ${LISTING_MINIMUM_FLOOR} (08 BR-LIST-05)`);
  else if (required !== l['minPhotos'])
    problems.push(
      `listing.shots : ${required} prises obligatoires pour un minimum de ${l['minPhotos']}`,
    );
  if (!isPositiveInt(l['recommendedPhotos']) || l['recommendedPhotos'] !== shots.length)
    problems.push(`listing.recommendedPhotos : ${shots.length} prises proposées`);
  if (l['source'] !== 'cameraOrLibrary') problems.push('listing.source : cameraOrLibrary attendu');
  if (!validRatio(l['displayAspectRatio'])) problems.push('listing.displayAspectRatio invalide');
  const inset = l['safeAreaInsetPercent'];
  if (typeof inset !== 'number' || inset < 0 || inset >= 50)
    problems.push('listing.safeAreaInsetPercent : entre 0 et 50');
  const cover = angle(l['cover'], 'listing.cover');
  if (cover && !shots.some((s) => s.required && s.angle.code === cover.code))
    problems.push('listing.cover : la couverture doit être une prise obligatoire');

  // Remise (16 TRP-004, 17 §3.2.10) : emplacements uniques, zone cohérente, plancher respecté.
  const h = isRecord(doc['handover']) ? doc['handover'] : {};
  const slots: HandoverSlot[] = [];
  const slotCodes = new Set<string>();
  for (const s of Array.isArray(h['slots']) ? h['slots'] : []) {
    if (!isRecord(s) || typeof s['slotCode'] !== 'string') {
      problems.push('handover.slots : slotCode requis');
      continue;
    }
    const a = angle(s['angle'], `handover.slots.${s['slotCode']}`);
    if (!a) continue;
    if (slotCodes.has(s['slotCode'])) problems.push(`handover.slots.${s['slotCode']} : en double`);
    slotCodes.add(s['slotCode']);
    if (!SLOT_PREFIX[a.zone].test(s['slotCode']))
      problems.push(`handover.slots.${s['slotCode']} : code incompatible avec la zone ${a.zone}`);
    slots.push({ slotCode: s['slotCode'], angle: a });
  }
  const angleUse = new Set<string>();
  for (const s of slots) {
    if (angleUse.has(s.angle.code))
      problems.push(`handover.slots : angle ${s.angle.code} utilisé deux fois`);
    angleUse.add(s.angle.code);
  }
  const minimum = isRecord(h['minimum']) ? h['minimum'] : {};
  for (const zone of ZONES) {
    const min = minimum[zone];
    const count = slots.filter((s) => s.angle.zone === zone).length;
    if (!isPositiveInt(min) || min < TRP004_MINIMUM[zone])
      problems.push(`handover.minimum.${zone} : au moins ${TRP004_MINIMUM[zone]} (16 TRP-004)`);
    else if (count < min)
      problems.push(`handover.slots : ${count} emplacements ${zone} pour un minimum de ${min}`);
  }
  for (const code of ['FUEL', 'ODOMETER'])
    if (!slotCodes.has(code)) problems.push(`handover.slots : ${code} requis (16 TRP-004)`);
  if (h['source'] !== 'inAppCameraOnly')
    problems.push('handover.source : appareil photo de l’app seulement (PHOTO_GALLERY_FORBIDDEN)');
  if (h['plate'] !== 'visibleNeverPublished')
    problems.push('handover.plate : visibleNeverPublished attendu');
  const participants = Array.isArray(h['perParticipant']) ? h['perParticipant'] : [];
  if (!['HOST', 'GUEST'].every((p) => participants.includes(p)))
    problems.push('handover.perParticipant : HOST et GUEST, chacun sa série (16 TRP-004)');
  const phases = Array.isArray(h['phases']) ? h['phases'] : [];
  if (!['PICKUP', 'RETURN'].every((p) => phases.includes(p)))
    problems.push('handover.phases : PICKUP et RETURN');
  const optionalSlots = guidelines(h['optionalSlots'], 'handover.optionalSlots', has, problems);

  if (problems.length > 0) throw new PhotoRulesError(problems);
  return {
    version: String(doc['meta']['version']),
    capture: c as unknown as PhotoRules['capture'],
    framing,
    light,
    forbidden,
    checks,
    angles: [...angles.values()],
    listing: {
      minPhotos: l['minPhotos'] as number,
      recommendedPhotos: l['recommendedPhotos'] as number,
      source: 'cameraOrLibrary',
      displayAspectRatio: l['displayAspectRatio'] as Ratio,
      safeAreaInsetPercent: inset as number,
      cover: cover as PhotoAngle,
      shots,
    },
    handover: {
      source: 'inAppCameraOnly',
      perParticipant: ['HOST', 'GUEST'],
      phases: ['PICKUP', 'RETURN'],
      plate: 'visibleNeverPublished',
      minimum: minimum as Record<AngleZone, number>,
      slots,
      optionalSlots: optionalSlots.map((s) => ({ code: s.code, messageKey: s.messageKey })),
    },
  };
}

/** Textes publiés (es, en, fr), validés au chargement. */
export const PHOTO_MESSAGES: PhotoMessages = validatePhotoMessages(photoMessages);
/** Règles publiées, validées au chargement (fail-closed). */
export const PHOTO_RULES: PhotoRules = validatePhotoRules(photoRules, PHOTO_MESSAGES);

export interface HandoverSetCheck {
  readonly complete: boolean;
  /** Emplacements obligatoires manquants, dans l'ordre du gabarit. */
  readonly missing: readonly string[];
}

/**
 * Série de remise d'une partie (hôte ou voyageur) : complète si chaque emplacement obligatoire
 * du gabarit est présent. Sinon, l'appelant rend `PHOTO_TEMPLATE_INCOMPLETE` (16 TRP-004).
 * `KEY` et `DAMAGE_n` sont optionnels et n'entrent pas dans le compte.
 */
export function checkHandoverSet(
  slotCodes: Iterable<string>,
  rules: PhotoRules = PHOTO_RULES,
): HandoverSetCheck {
  const present = new Set(slotCodes);
  const missing = rules.handover.slots.map((s) => s.slotCode).filter((c) => !present.has(c));
  return { complete: missing.length === 0, missing };
}

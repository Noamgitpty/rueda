/**
 * Constancia d'arrendamiento d'un trip (US-212, ADR-162 ; 16 LEG-026 ; 19 US-212 critère 1 ; 08
 * BR-TT-03). Fonctions PURES :
 *   - `parseConstanciaFacts` : lecture stricte des faits rendus par la base
 *     (`core.booking_trip_constancia`, 0136) : faits FIGÉS de la dernière version du contrat de
 *     location (période locale, véhicule, plaque, lieu de remise, total payé), hôte en prénom et
 *     initiale, conducteur du contrat, signature à l'heure locale ; une forme inattendue est
 *     refusée, jamais devinée ;
 *   - `buildConstanciaBody` : texte (lignes) en espagnol, qui fait foi, puis dans la langue de la
 *     personne (anglais pour un lecteur hispanophone : document bilingue, 19 US-212) ;
 *   - `renderConstanciaPdf` : PDF DÉTERMINISTE du texte (même rendu que le contrat, `ctr.pdf/1` :
 *     mêmes faits ⇒ mêmes octets ⇒ même empreinte), rendu à chaque demande, jamais stocké.
 * Textes du catalogue `ctr.constancia.*` (es, en, fr, pt-BR), gabarit BROUILLON à faire valider par
 * l'avocat (GL-39, OQ-BR-24 ; aucune « definitiva e inapelable »). La plateforme y est nommée
 * intermédiaire entre particuliers, ni bailleur ni propriétaire du véhicule (LEG-014) ; aucune
 * pièce, aucun contact, aucune adresse exacte (L2-PM-35).
 */
import { createHash } from 'node:crypto';
import { createTranslator } from '@rueda/i18n';
import type { LocaleConfig, MessageKey } from '@rueda/i18n';
import { PDF_RENDERER_V1, renderPdf } from '../contract/pdf.js';
import type { ContractLine } from '../contract/pdf.js';
import { moneyText, profileOf } from '../contract/rental-contract.js';

/** Forme des faits du contrat lus (`terms` de 0122, `ctr.rental/1`). */
export const CONSTANCIA_SOURCE_SCHEMA = 'ctr.rental/1';
export const CONSTANCIA_RENDERER = PDF_RENDERER_V1;
/** Version du gabarit de la constancia (textes `ctr.constancia.*`) ; BROUILLON tant que l'avocat ne l'a pas validé (GL-39). */
export const CONSTANCIA_TEMPLATE_VERSION = 1;
export const CONSTANCIA_TEMPLATE_DRAFT = true;

export type ConstanciaLocale = 'en' | 'fr' | 'pt';
export type ConstanciaViewerRole = 'GUEST' | 'HOST';

/** Faits de la constancia tels que la base les rend à une partie du trip. */
export interface ConstanciaFacts {
  readonly viewerRole: ConstanciaViewerRole;
  readonly viewerLocale: string | null;
  readonly tripStatus: string;
  readonly contractVersion: number;
  readonly tripRef: string;
  readonly country: string;
  readonly currency: string;
  /** Heures locales du pays du trip (`AAAA-MM-JJ HH:MM`), figées au contrat. */
  readonly startLocal: string;
  readonly endLocal: string;
  readonly vehicle: { readonly make: string; readonly model: string; readonly year: number };
  readonly hostCapacity: 'OWNER' | 'AUTHORIZED';
  readonly priceTotalMinor: string;
  readonly brand: string;
  /** Prénom et initiale (L2-PM-35). */
  readonly hostName: string;
  /** Conducteur tel que nommé au contrat (prénom et initiale). */
  readonly driverName: string;
  readonly plate: string;
  readonly handoverPlace: string | null;
  readonly handoverCity: string;
  /** Signature du voyageur sur cette version, à l'heure locale du trip ; `null` : non signée. */
  readonly signedAtLocal: string | null;
}

export class ConstanciaInputError extends Error {
  override readonly name = 'ConstanciaInputError';
}

type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;

function str(o: Rec, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.trim().length === 0) {
    throw new ConstanciaInputError(`champ ${k} attendu`);
  }
  return v;
}
function strOrNull(o: Rec, k: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ConstanciaInputError(`champ ${k} attendu`);
  return v.trim() === '' ? null : v;
}
function local(o: Rec, k: string): string {
  const v = str(o, k);
  if (!LOCAL.test(v)) throw new ConstanciaInputError(`heure locale ${k} mal formée`);
  return v;
}

/** Ligne de `core.booking_trip_constancia` (issue `OK`) : forme stricte. */
export function parseConstanciaFacts(row: Rec): ConstanciaFacts {
  const role = row['viewer_role'];
  if (role !== 'GUEST' && role !== 'HOST') throw new ConstanciaInputError('rôle inconnu');
  const version = row['contract_version'];
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
    throw new ConstanciaInputError('version du contrat attendue');
  }
  const t = row['terms'];
  if (!isRec(t)) throw new ConstanciaInputError('faits du contrat attendus');
  if (t['schema'] !== CONSTANCIA_SOURCE_SCHEMA) {
    throw new ConstanciaInputError('schéma de contrat inconnu');
  }
  const vehicle = t['vehicle'];
  if (!isRec(vehicle)) throw new ConstanciaInputError('véhicule attendu');
  const year = vehicle['year'];
  if (typeof year !== 'number' || !Number.isSafeInteger(year)) {
    throw new ConstanciaInputError('année du véhicule attendue');
  }
  const capacity = t['hostCapacity'];
  if (capacity !== 'OWNER' && capacity !== 'AUTHORIZED') {
    throw new ConstanciaInputError('capacité de l’hôte inconnue');
  }
  const total = str(t, 'priceTotalMinor');
  if (!MINOR.test(total)) throw new ConstanciaInputError('total mal formé');
  const country = str(t, 'country');
  if (!/^[A-Z]{2}$/.test(country)) throw new ConstanciaInputError('pays mal formé');
  const signed = row['signed_at_local'];
  if (signed !== null && (typeof signed !== 'string' || !LOCAL.test(signed))) {
    throw new ConstanciaInputError('heure de signature mal formée');
  }
  const locale = row['viewer_locale'];
  return {
    viewerRole: role,
    viewerLocale: typeof locale === 'string' ? locale : null,
    tripStatus: str(row, 'trip_status'),
    contractVersion: version,
    tripRef: str(t, 'tripRef'),
    country,
    currency: str(t, 'currency'),
    startLocal: local(t, 'startLocal'),
    endLocal: local(t, 'endLocal'),
    vehicle: { make: str(vehicle, 'make'), model: str(vehicle, 'model'), year },
    hostCapacity: capacity,
    priceTotalMinor: total,
    brand: str(row, 'brand'),
    hostName: str(row, 'host_name'),
    driverName: str(row, 'guest_name'),
    plate: str(row, 'plate'),
    handoverPlace: strOrNull(row, 'handover_place'),
    handoverCity: str(row, 'handover_city'),
    signedAtLocal: signed,
  };
}

/** Langue de la seconde partie : celle du lecteur, l'anglais s'il lit l'espagnol (19 US-212). */
export function constanciaLocaleOf(viewerLocale: string | null): ConstanciaLocale {
  const language = (viewerLocale ?? '').split('-')[0];
  return language === 'fr' || language === 'pt' ? language : 'en';
}

export interface ConstanciaInput {
  readonly facts: ConstanciaFacts;
  readonly courtesy: ConstanciaLocale;
  /** Exposant de la devise (CFG : 2 ou 0 pour les devises de premier rang). */
  readonly exponent: number;
  readonly localeConfig: LocaleConfig;
  /** Nom du pays du trip dans chaque langue (configuration des pays, `names`). */
  readonly countryNames: Readonly<Partial<Record<'es' | ConstanciaLocale, string>>>;
}

const NOTICES: readonly MessageKey[] = [
  'ctr.constancia.notice.purpose',
  'ctr.constancia.notice.parties',
  'ctr.constancia.notice.documents',
  'ctr.constancia.notice.fines',
];

function part(input: ConstanciaInput, language: 'es' | ConstanciaLocale): ContractLine[] {
  const f = input.facts;
  const profile = profileOf(input.localeConfig, language, f.country);
  const tr = createTranslator(profile);
  const countryName = input.countryNames[language];
  if (countryName === undefined || countryName.trim() === '') {
    throw new ConstanciaInputError(`nom du pays absent (${language})`);
  }
  const lines: ContractLine[] = [{ s: 'title', t: tr.t('ctr.constancia.title') }];
  if (CONSTANCIA_TEMPLATE_DRAFT) lines.push({ s: 'note', t: tr.t('ctr.constancia.draft') });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.ref', { ref: f.tripRef, version: f.contractVersion }),
  });
  lines.push({ s: 'h', t: tr.t('ctr.constancia.partiesHeading') });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.host', {
      name: f.hostName,
      capacity: tr.t(
        f.hostCapacity === 'AUTHORIZED'
          ? 'ctr.contract.hostCapacity.authorized'
          : 'ctr.contract.hostCapacity.owner',
      ),
    }),
  });
  lines.push({ s: 'kv', t: tr.t('ctr.constancia.driver', { name: f.driverName }) });
  lines.push({ s: 'kv', t: tr.t('ctr.constancia.platform', { brand: f.brand }) });
  lines.push({ s: 'h', t: tr.t('ctr.constancia.tripHeading') });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.vehicle', {
      make: f.vehicle.make,
      model: f.vehicle.model,
      year: String(f.vehicle.year),
      plate: f.plate,
    }),
  });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.period', {
      start: f.startLocal,
      end: f.endLocal,
      country: countryName,
    }),
  });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.handover', {
      place: [f.handoverPlace, f.handoverCity]
        .filter((x): x is string => x !== null && x.trim() !== '')
        .join(', '),
    }),
  });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.constancia.total', {
      amount: moneyText(profile, f.priceTotalMinor, f.currency, input.exponent),
    }),
  });
  lines.push({
    s: 'kv',
    t:
      f.signedAtLocal === null
        ? tr.t('ctr.constancia.unsigned')
        : tr.t('ctr.constancia.signed', { date: f.signedAtLocal }),
  });
  lines.push({ s: 'h', t: tr.t('ctr.constancia.noticeHeading') });
  for (const key of NOTICES) lines.push({ s: 'p', t: tr.t(key, { brand: f.brand }) });
  return lines;
}

/** Texte de la constancia : partie espagnole (fait foi), puis la langue du lecteur. */
export function buildConstanciaBody(input: ConstanciaInput): ContractLine[] {
  if (!Number.isInteger(input.exponent) || input.exponent < 0) {
    throw new ConstanciaInputError('exposant de devise invalide');
  }
  const courtesyProfile = profileOf(input.localeConfig, input.courtesy, input.facts.country);
  const note = createTranslator(courtesyProfile).t('ctr.constancia.courtesy', {
    language: courtesyProfile.displayName,
  });
  return [...part(input, 'es'), { s: 'h', t: note }, ...part(input, input.courtesy)];
}

/** Pied de page du PDF (référence et version du contrat suivi). */
export function constanciaFooter(tripRef: string, contractVersion: number): string {
  return `Constancia ${tripRef} v${contractVersion}`;
}

/** PDF déterministe de la constancia (aucune date de rendu, aucun identifiant aléatoire). */
export function renderConstanciaPdf(body: readonly ContractLine[], footer: string): Uint8Array {
  return renderPdf(body, footer);
}

/** Empreinte SHA-256 (hexadécimal minuscule) d'un PDF. */
export function constanciaSha256(pdf: Uint8Array): string {
  return createHash('sha256').update(pdf).digest('hex');
}

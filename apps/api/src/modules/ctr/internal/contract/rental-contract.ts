/**
 * Contrat de location hôte–voyageur par trip (US-211, ADR-143 ; 16 BKG-018, BKG-019 ; 17 §2.7 ;
 * 08 BR-BOOK-12). Fonctions PURES :
 *   - `buildContractBody` : texte du contrat (lignes) à partir des FAITS lus par la base (devis
 *     figé, assureur et caution à la réservation, véhicule, parties minimisées), des valeurs
 *     calculées par le travailleur (retenue du moteur de règlement, marque) et des gabarits
 *     juridiques (espagnol qui fait foi, puis traduction de courtoisie). Le texte est FIGÉ avec le
 *     document : le PDF se reproduit à l'identique même si les catalogues changent ensuite ;
 *   - `renderContractPdf` : PDF déterministe du texte (contrat à signer, ou contrat signé avec son
 *     bloc de signature) ;
 *   - `verifyContractPdf` : empreinte d'un PDF présenté comparée à celle enregistrée
 *     (`CONTRACT_HASH_MISMATCH`, 16 BKG-019).
 * La plateforme est nommée intermédiaire entre particuliers et marchand de référence, jamais loueur
 * ni partie (LEG-014, DEC-FONDATEUR-13). Le voyageur est nommé par son prénom et l'initiale de son
 * nom (minimisation, `host_guest_v`, L2-PM-35) ; la pièce de l'hôte n'est jamais citée.
 */
import { createHash } from 'node:crypto';
import { createTranslator, formatMoney, getProfile } from '@rueda/i18n';
import type { LocaleConfig, LocaleProfile, MessageKey, Translator } from '@rueda/i18n';
import { PDF_RENDERER_V1, renderPdf } from './pdf.js';
import type { ContractLine } from './pdf.js';

export const RENTAL_CONTRACT_SCHEMA = 'ctr.rental/1';
export const RENTAL_CONTRACT_RENDERER = PDF_RENDERER_V1;

export type CourtesyLocale = 'en' | 'fr' | 'pt';

export interface ContractPriceLine {
  readonly type: string;
  readonly amountMinor: string;
  readonly taxMinor: string;
}

/** Faits non nominatifs lus par la base (`terms` de `core.booking_contract_facts`). */
export interface ContractTerms {
  readonly schema: string;
  readonly tripRef: string;
  readonly country: string;
  readonly currency: string;
  readonly timezone: string;
  readonly startLocal: string;
  readonly endLocal: string;
  readonly bookedAtLocal: string;
  readonly vehicle: { readonly make: string; readonly model: string; readonly year: number };
  readonly hostCapacity: 'OWNER' | 'AUTHORIZED';
  readonly priceTotalMinor: string;
  readonly priceLines: readonly ContractPriceLine[];
  readonly protection: {
    readonly level: string;
    readonly deductibleMinor: string;
    readonly rcMinor: string;
    readonly insurer: string;
    readonly broker: string | null;
  };
  readonly depositMinor: string | null;
  readonly mileage: {
    readonly mode: 'UNLIMITED' | 'INCLUDED';
    readonly includedKm: number | null;
    readonly extraKmPriceMinor: string | null;
  };
  readonly lateGraceMinutes: number | null;
}

/** Faits nominatifs (`identity`), conservés hors du registre immuable. */
export interface ContractIdentity {
  readonly hostName: string;
  readonly guestName: string;
  readonly plate: string;
  readonly handoverPlace: string | null;
  readonly handoverAddress: string | null;
  readonly handoverCity: string;
}

/** Retenue d'une annulation hors fenêtre gratuite, par le moteur de règlement unique (N-199). */
export interface ContractCancellation {
  readonly freeUntilLocal: string;
  readonly penaltyDays: '1' | '1/2';
  readonly retainedMinor: string;
  readonly engineVersion: string;
}

/** Valeurs calculées par le travailleur (`derived`). */
export interface ContractDerived {
  readonly brand: string;
  readonly cancellation: ContractCancellation | null;
}

export interface ContractTemplateText {
  readonly title: string;
  readonly body: string;
  readonly isDraft: boolean;
}

export interface RentalContractInput {
  readonly terms: ContractTerms;
  readonly identity: ContractIdentity;
  readonly derived: ContractDerived;
  readonly version: number;
  readonly es: ContractTemplateText;
  readonly courtesy: ContractTemplateText & { readonly locale: CourtesyLocale };
  /** Exposant de la devise (CFG : 2 ou 0 pour les devises de premier rang). */
  readonly exponent: number;
  readonly localeConfig: LocaleConfig;
}

/** Bloc de signature (ligne de `contract_signature`). */
export interface ContractSignatureBlock {
  readonly signatureId: string;
  readonly signedAt: Date;
  readonly documentSha256: string;
  readonly sealSha256: string;
}

export class ContractInputError extends Error {
  override readonly name = 'ContractInputError';
}

const SIGNED_AT = '{{signedAt}}';
const DOCUMENT_SHA = '{{documentSha256}}';
const SEAL = '{{seal}}';
const SIGNATURE_ID = '{{signatureId}}';

const LINE_KEYS: Readonly<Record<string, MessageKey>> = {
  TRIP_PRICE: 'ctr.contract.line.tripPrice',
  TRIP_FEE: 'ctr.contract.line.tripFee',
  PROTECTION: 'ctr.contract.line.protection',
  PROMO_PLATFORM: 'ctr.contract.line.promo',
  PROMO_HOST: 'ctr.contract.line.promo',
  DELIVERY_FEE: 'ctr.contract.line.delivery',
};
const LEVEL_KEYS: Readonly<Record<string, MessageKey>> = {
  BASICA: 'ctr.contract.level.basica',
  ESTANDAR: 'ctr.contract.level.estandar',
  TOTAL: 'ctr.contract.level.total',
};

/** Profil de la langue : l'espagnol du pays s'il est déclaré, sinon la locale par défaut. */
function profileOf(config: LocaleConfig, language: 'es' | CourtesyLocale, country: string) {
  const tags = language === 'es' ? [`es-${country}`, config.defaultLocale] : [language];
  for (const tag of tags) {
    const found = config.locales.find((p) => p.tag === tag);
    if (found !== undefined) return found;
  }
  return getProfile(config, language);
}

/** Montant avec le code ISO de la devise (jamais un symbole hors de l'encodage du PDF). */
function moneyText(profile: LocaleProfile, minor: string, currency: string, exponent: number) {
  if (!/^-?(0|[1-9][0-9]*)$/.test(minor)) throw new ContractInputError('montant mal formé');
  return formatMoney(
    { amountMinor: BigInt(minor), currency, exponent },
    {
      ...profile,
      currency: {
        symbols: {},
        pattern: '{amount} {symbol}',
        negativePattern: '-{amount} {symbol}',
      },
    },
  );
}

function part(
  input: RentalContractInput,
  language: 'es' | CourtesyLocale,
  template: ContractTemplateText,
): ContractLine[] {
  const { terms: t, identity: who, derived } = input;
  const profile = profileOf(input.localeConfig, language, t.country);
  const tr: Translator = createTranslator(profile);
  const money = (minor: string) => moneyText(profile, minor, t.currency, input.exponent);
  const lines: ContractLine[] = [{ s: 'title', t: template.title }];
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.ref', { ref: t.tripRef, version: input.version }),
  });

  lines.push({ s: 'h', t: tr.t('ctr.contract.parties') });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.host', {
      name: who.hostName,
      capacity: tr.t(
        t.hostCapacity === 'AUTHORIZED'
          ? 'ctr.contract.hostCapacity.authorized'
          : 'ctr.contract.hostCapacity.owner',
      ),
    }),
  });
  lines.push({ s: 'kv', t: tr.t('ctr.contract.guest', { name: who.guestName }) });
  lines.push({ s: 'kv', t: tr.t('ctr.contract.platform', { brand: derived.brand }) });

  lines.push({ s: 'h', t: tr.t('ctr.contract.vehicleHeading') });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.vehicle', {
      make: t.vehicle.make,
      model: t.vehicle.model,
      year: String(t.vehicle.year),
      plate: who.plate,
    }),
  });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.period', { start: t.startLocal, end: t.endLocal, timezone: t.timezone }),
  });
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.handover', {
      place: [who.handoverPlace, who.handoverAddress, who.handoverCity]
        .filter((x): x is string => x !== null && x.trim() !== '')
        .join(', '),
    }),
  });

  lines.push({ s: 'h', t: tr.t('ctr.contract.priceHeading') });
  lines.push({ s: 'kv', t: tr.t('ctr.contract.total', { amount: money(t.priceTotalMinor) }) });
  for (const l of t.priceLines) {
    lines.push({
      s: 'kv',
      t:
        l.taxMinor === '0'
          ? tr.t('ctr.contract.priceLine', {
              label: tr.t(LINE_KEYS[l.type] ?? 'ctr.contract.line.other'),
              amount: money(l.amountMinor),
            })
          : tr.t('ctr.contract.priceLineTax', {
              label: tr.t(LINE_KEYS[l.type] ?? 'ctr.contract.line.other'),
              amount: money(l.amountMinor),
              tax: money(l.taxMinor),
            }),
    });
  }
  const levelKey = LEVEL_KEYS[t.protection.level];
  lines.push({
    s: 'kv',
    t: tr.t('ctr.contract.protection', {
      level: levelKey === undefined ? t.protection.level : tr.t(levelKey),
      deductible: money(t.protection.deductibleMinor),
      rc: money(t.protection.rcMinor),
      insurer: t.protection.insurer,
    }),
  });
  if (t.protection.broker !== null) {
    lines.push({ s: 'kv', t: tr.t('ctr.contract.broker', { broker: t.protection.broker }) });
  }
  lines.push({
    s: 'kv',
    t:
      t.depositMinor === null
        ? tr.t('ctr.contract.depositGeneric')
        : tr.t('ctr.contract.deposit', { amount: money(t.depositMinor) }),
  });
  lines.push({ s: 'kv', t: mileageText(tr, t.mileage, money) });
  const c = derived.cancellation;
  lines.push({
    s: 'kv',
    t:
      c === null
        ? tr.t('ctr.contract.cancelPolicy')
        : tr.t('ctr.contract.cancelFree', {
            date: c.freeUntilLocal,
            dur: tr.t(
              c.penaltyDays === '1' ? 'ctr.contract.cancelOneDay' : 'ctr.contract.cancelHalfDay',
            ),
            amount: money(c.retainedMinor),
          }),
  });
  lines.push({
    s: 'kv',
    t:
      t.lateGraceMinutes === null
        ? tr.t('ctr.contract.lateReturnPolicy')
        : tr.t('ctr.contract.lateReturn', { minutes: t.lateGraceMinutes }),
  });

  lines.push({ s: 'h', t: tr.t('ctr.contract.clauses') });
  for (const clause of template.body.split('\n')) {
    if (clause.trim() !== '') lines.push({ s: 'p', t: clause });
  }

  lines.push({ s: 'h', t: tr.t('ctr.contract.signatureHeading') });
  lines.push({ s: 'sig', t: tr.t('ctr.contract.signedBy', { value: who.guestName }) });
  lines.push({ s: 'sig', t: tr.t('ctr.contract.signedAt', { value: SIGNED_AT }) });
  lines.push({ s: 'sig', t: tr.t('ctr.contract.documentHash', { value: DOCUMENT_SHA }) });
  lines.push({ s: 'sig', t: tr.t('ctr.contract.seal', { value: SEAL }) });
  lines.push({ s: 'sig', t: tr.t('ctr.contract.signatureId', { value: SIGNATURE_ID }) });
  return lines;
}

/**
 * Distance du devis : illimitée, ou km inclus ET prix du km supplémentaire ; des faits incohérents
 * (mode inconnu, km ou prix absent) font échouer la génération, jamais un texte deviné.
 */
function mileageText(
  tr: Translator,
  m: ContractTerms['mileage'],
  money: (minor: string) => string,
): string {
  if (m.mode === 'UNLIMITED' && m.includedKm === null && m.extraKmPriceMinor === null) {
    return tr.t('ctr.contract.mileageUnlimited');
  }
  if (
    m.mode === 'INCLUDED' &&
    m.includedKm !== null &&
    m.includedKm >= 1 &&
    m.extraKmPriceMinor !== null
  ) {
    return tr.t('ctr.contract.mileageIncluded', {
      km: tr.number(m.includedKm),
      price: money(m.extraKmPriceMinor),
    });
  }
  throw new ContractInputError('distance du devis incohérente');
}

/** Texte du contrat : partie espagnole (fait foi), puis traduction de courtoisie. */
export function buildContractBody(input: RentalContractInput): ContractLine[] {
  if (input.terms.schema !== RENTAL_CONTRACT_SCHEMA) {
    throw new ContractInputError(`schéma de contrat inconnu : ${input.terms.schema}`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new ContractInputError('version de contrat invalide');
  }
  const courtesyProfile = profileOf(input.localeConfig, input.courtesy.locale, input.terms.country);
  const courtesyNote = createTranslator(courtesyProfile).t('ctr.contract.courtesy', {
    language: courtesyProfile.displayName,
  });
  return [
    ...part(input, 'es', input.es),
    { s: 'h', t: courtesyNote },
    ...part(input, input.courtesy.locale, input.courtesy),
  ];
}

/** Pied de page du PDF (référence et version ; jamais l'empreinte du document lui-même). */
export function contractFooter(tripRef: string, version: number): string {
  return `${tripRef} v${version}`;
}

const iso = (d: Date): string =>
  d
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, ' UTC');

/**
 * PDF du contrat : sans `signature`, le document présenté au voyageur (champs de signature
 * « - ») ; avec, le contrat signé et son bloc de signature (heure serveur, empreinte, sceau).
 */
export function renderContractPdf(
  body: readonly ContractLine[],
  footer: string,
  renderer: string,
  signature?: ContractSignatureBlock,
): Uint8Array {
  if (renderer !== PDF_RENDERER_V1) {
    throw new ContractInputError(`version de rendu inconnue : ${renderer}`);
  }
  const values: Readonly<Record<string, string>> = signature
    ? {
        [SIGNED_AT]: iso(signature.signedAt),
        [DOCUMENT_SHA]: signature.documentSha256,
        [SEAL]: signature.sealSha256,
        [SIGNATURE_ID]: signature.signatureId,
      }
    : { [SIGNED_AT]: '-', [DOCUMENT_SHA]: '-', [SEAL]: '-', [SIGNATURE_ID]: '-' };
  // marqueurs remplacés dans les SEULES lignes du bloc de signature (jamais dans le texte libre)
  const filled = body.map((l) => ({
    s: l.s,
    t:
      l.s !== 'sig'
        ? l.t
        : l.t.replace(/\{\{(signedAt|documentSha256|seal|signatureId)\}\}/g, (m) => values[m] ?? m),
  }));
  return renderPdf(filled, footer);
}

/** Empreinte SHA-256 (hexadécimal minuscule) d'un PDF. */
export function contractSha256(pdf: Uint8Array): string {
  return createHash('sha256').update(pdf).digest('hex');
}

export type ContractVerification =
  { readonly ok: true } | { readonly ok: false; readonly code: 'CONTRACT_HASH_MISMATCH' };

/** Le PDF présenté est-il celui enregistré ? Toute modification ⇒ `CONTRACT_HASH_MISMATCH`. */
export function verifyContractPdf(
  presented: Uint8Array,
  recordedSha256: string,
): ContractVerification {
  if (!/^[0-9a-f]{64}$/.test(recordedSha256)) return { ok: false, code: 'CONTRACT_HASH_MISMATCH' };
  return contractSha256(presented) === recordedSha256
    ? { ok: true }
    : { ok: false, code: 'CONTRACT_HASH_MISMATCH' };
}

// Lecture stricte des faits rendus par la base (jsonb) : une forme inattendue est refusée, jamais
// devinée (le contrat n'est alors pas généré : CONTRACT_GENERATION_FAILED côté travailleur).
type Rec = Readonly<Record<string, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
function str(o: Rec, k: string): string {
  const v = o[k];
  if (typeof v !== 'string' || v.length === 0) throw new ContractInputError(`champ ${k} attendu`);
  return v;
}
function strOrNull(o: Rec, k: string): string | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new ContractInputError(`champ ${k} attendu`);
  return v;
}
function minor(o: Rec, k: string): string {
  const v = str(o, k);
  if (!/^-?(0|[1-9][0-9]{0,17})$/.test(v)) throw new ContractInputError(`montant ${k} mal formé`);
  return v;
}
function minorOrNull(o: Rec, k: string): string | null {
  return o[k] === null || o[k] === undefined ? null : minor(o, k);
}
function intOrNull(o: Rec, k: string): number | null {
  const v = o[k];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isSafeInteger(v))
    throw new ContractInputError(`${k} entier`);
  return v;
}
function rec(o: Rec, k: string): Rec {
  const v = o[k];
  if (!isRec(v)) throw new ContractInputError(`objet ${k} attendu`);
  return v;
}

export interface ContractFacts {
  readonly terms: ContractTerms;
  readonly identity: ContractIdentity;
}

export function parseContractFacts(raw: unknown): ContractFacts {
  if (!isRec(raw)) throw new ContractInputError('faits attendus');
  const t = rec(raw, 'terms');
  const who = rec(raw, 'identity');
  const vehicle = rec(t, 'vehicle');
  const protection = rec(t, 'protection');
  const mileage = rec(t, 'mileage');
  const lines = t['priceLines'];
  if (!Array.isArray(lines)) throw new ContractInputError('lignes de prix attendues');
  const capacity = str(t, 'hostCapacity');
  const mode = str(mileage, 'mode');
  if (capacity !== 'OWNER' && capacity !== 'AUTHORIZED') {
    throw new ContractInputError('capacité de l’hôte inconnue');
  }
  if (mode !== 'UNLIMITED' && mode !== 'INCLUDED')
    throw new ContractInputError('distance inconnue');
  const year = intOrNull(vehicle, 'year');
  if (year === null) throw new ContractInputError('année du véhicule attendue');
  return {
    terms: {
      schema: str(t, 'schema'),
      tripRef: str(t, 'tripRef'),
      country: str(t, 'country'),
      currency: str(t, 'currency'),
      timezone: str(t, 'timezone'),
      startLocal: str(t, 'startLocal'),
      endLocal: str(t, 'endLocal'),
      bookedAtLocal: str(t, 'bookedAtLocal'),
      vehicle: { make: str(vehicle, 'make'), model: str(vehicle, 'model'), year },
      hostCapacity: capacity,
      priceTotalMinor: minor(t, 'priceTotalMinor'),
      priceLines: lines.map((l: unknown) => {
        if (!isRec(l)) throw new ContractInputError('ligne de prix attendue');
        return {
          type: str(l, 'type'),
          amountMinor: minor(l, 'amountMinor'),
          taxMinor: minor(l, 'taxMinor'),
        };
      }),
      protection: {
        level: str(protection, 'level'),
        deductibleMinor: minor(protection, 'deductibleMinor'),
        rcMinor: minor(protection, 'rcMinor'),
        insurer: str(protection, 'insurer'),
        broker: strOrNull(protection, 'broker'),
      },
      depositMinor: minorOrNull(t, 'depositMinor'),
      mileage: {
        mode,
        includedKm: intOrNull(mileage, 'includedKm'),
        extraKmPriceMinor: minorOrNull(mileage, 'extraKmPriceMinor'),
      },
      lateGraceMinutes: intOrNull(t, 'lateGraceMinutes'),
    },
    identity: {
      hostName: str(who, 'hostName'),
      guestName: str(who, 'guestName'),
      plate: str(who, 'plate'),
      handoverPlace: strOrNull(who, 'handoverPlace'),
      handoverAddress: strOrNull(who, 'handoverAddress'),
      handoverCity: str(who, 'handoverCity'),
    },
  };
}

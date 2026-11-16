// Double de l'API des comptes et des consentements pour les parcours e2e (US-102) — TESTS
// SEULEMENT, démarré par Playwright (playwright.config.ts) sur 127.0.0.1. Il répond comme le
// contrat apps/api/openapi/openapi.json (codes stables, corps { code, messageKey }, cookie
// __Host-session) pour les routes que le site appelle CÔTÉ SERVEUR : le navigateur ne le voit
// jamais. La vraie API est prouvée par ses propres tests (contrat, intégration, L0).
//
// État : documents en vigueur (CGU v2 majeure, confidentialité v1, communications v1, BROUILLON),
// comptes inscrits, sessions. Un compte `reaccept-<nom>@example.test` (créé à sa première
// connexion, un par parcours) a accepté les CGU v1 : l'API exige la réacceptation (critère 3). `GET /__e2e/signups` rend les inscriptions
// reçues (sans mot de passe) au test, jamais au navigateur.
//
// Téléphone par OTP (US-104) : un compte `phone-<nom>@example.test` (créé à sa première connexion,
// documents à jour) parcourt l'étape OTP de S15. Pays et plans de numérotation : données de
// configuration du dépôt (countries.json), jamais une constante. Le « SMS » du double porte
// toujours le code `OTP_CODE` ; 5 codes faux bloquent (16 VER-013).
//
// Vérification d'identité (US-105) : un compte `identity-<nom>@example.test` (créé à sa première
// connexion, documents à jour, téléphone vérifié) parcourt S04 : consentement biométrique v1
// (texte BROUILLON), ouverture du parcours hébergé (adresse `https://identity.fake.invalid/…`,
// jamais résolue : le test l'intercepte), décision posée par `GET /__e2e/identity/approve`.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const PORT = Number(process.env.RUEDA_E2E_API_PORT ?? 3199);
const VERSIONS = { TOS_GUEST: 2, PRIVACY: 1, MARKETING: 1 };
const MAJOR = { TOS_GUEST: true, PRIVACY: true, MARKETING: true };
const LANGS = ['es', 'en', 'fr', 'pt'];
const MARK = {
  es: 'BORRADOR — pendiente de validación jurídica',
  en: 'DRAFT — pending legal review',
  fr: 'BROUILLON — à valider par le juridique',
  pt: 'RASCUNHO — pendente de validação jurídica',
};
const REACCEPT = /^reaccept-[a-z0-9-]+@example\.test$/;
const PASSWORD_MIN = 10;
// pays inconnu de la configuration (jeton fictif, jamais un vrai pays) : 400 COUNTRY_UNKNOWN
const UNKNOWN_COUNTRY = 'ZZ';

const PHONE_ACCOUNT = /^phone-[a-z0-9-]+@example\.test$/;
const OTP_CODE = '246810';
const OTP_MAX_ATTEMPTS = 5;
const COUNTRIES = JSON.parse(
  readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
).countries.map((c) => ({
  code: c.code,
  names: c.names,
  callingCode: c.phone.callingCode,
  nationalLength: c.phone.nationalLength,
  example: c.phone.example,
  trunkPrefix: c.phone.trunkPrefix,
  mobilePrefixes: c.phone.mobilePrefixes,
}));
const phones = new Map();

const IDENTITY_ACCOUNT = /^identity-[a-z0-9-]+@example\.test$/;
const BIOMETRIC_TITLE = {
  es: 'Consentimiento para la verificación biométrica (BORRADOR)',
  en: 'Consent to biometric verification (DRAFT)',
  fr: 'Consentement à la vérification biométrique (BROUILLON)',
  pt: 'Consentimento para a checagem biométrica (RASCUNHO)',
};
const identities = new Map();
let identitySessions = 0;
const identityOf = (email) => {
  const i = identities.get(email) ?? {
    consent: null,
    status: 'NOT_STARTED',
    session: null,
    reason: null,
  };
  identities.set(email, i);
  return i;
};
const identityView = (i, lang) => ({
  code: 'KYC_STATE',
  status: i.status,
  country: i.session?.country ?? null,
  reasonCode: i.reason ?? null,
  licenseExpiresOn: i.status === 'APPROVED' ? '2031-06-30' : null,
  sessionLive: i.status === 'DOCS_SUBMITTED',
  phoneVerified: true,
  available: true,
  consent: {
    version: 1,
    accepted: i.consent === 1,
    locale: lang,
    title: BIOMETRIC_TITLE[lang],
    bodyMd: `**${MARK[lang]}**

BIOMETRIC_CONSENT ${lang}`,
  },
  countries: COUNTRIES.map((c) => ({ code: c.code, names: c.names })),
});

/** Même règle que l'API (plan du pays) : forme nationale ou internationale, mobiles seulement. */
const normalize = (raw, country) => {
  const c = COUNTRIES.find((x) => x.code === country);
  if (!c || typeof raw !== 'string') return null;
  let d = raw.replace(/[\s.\-()]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else
    d = `${c.callingCode}${c.trunkPrefix && d.length === c.nationalLength + c.trunkPrefix.length && d.startsWith(c.trunkPrefix) ? d.slice(c.trunkPrefix.length) : d}`;
  if (!/^[0-9]+$/.test(d) || !d.startsWith(c.callingCode)) return null;
  const n = d.slice(c.callingCode.length);
  if (n.length !== c.nationalLength || !c.mobilePrefixes.some((p) => n.startsWith(p))) return null;
  return { e164: `+${d}`, country: c };
};
const mask = (e164, c) => {
  const n = e164.slice(c.callingCode.length + 1);
  return `+${c.callingCode} ${'•'.repeat(n.length - 2)}${n.slice(-2)}`;
};
const phoneState = (email) => {
  const p = phones.get(email) ?? { verified: null, pending: null, locked: false };
  phones.set(email, p);
  return p;
};
const phoneView = (p) => ({
  verified: p.verified !== null,
  phone: p.verified,
  pending:
    p.pending === null || p.locked
      ? null
      : {
          phone: p.pending.masked,
          resendAfterS: Math.max(0, Math.ceil((p.pending.resendAt - Date.now()) / 1000)),
          expiresInS: 600,
          attemptsLeft: OTP_MAX_ATTEMPTS - p.pending.attempts,
        },
  lockedForS: p.locked ? 3600 : null,
  countries: COUNTRIES.map(({ code, names, callingCode, nationalLength, example }) => ({
    code,
    names,
    callingCode,
    nationalLength,
    example,
  })),
});

const signups = [];
const accounts = new Map();
const sessions = new Map();

const json = (res, status, body, headers = {}) => {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const err = (res, status, code, messageKey, values) =>
  json(res, status, { code, messageKey, ...(values ? { values } : {}) });

const languageOf = (url) => {
  const l = (url.searchParams.get('locale') ?? '').slice(0, 2);
  return LANGS.includes(l) ? l : null;
};
const doc = (kind, lang) => ({
  kind,
  version: VERSIONS[kind],
  isMajor: MAJOR[kind],
  locale: lang,
  title: `${kind} (${lang})`,
  contentHash: '0'.repeat(64),
  draft: true,
  validFrom: '2026-01-01T00:00:00.000Z',
});

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });

const sessionOf = (req) => {
  const m = /__Host-session=([A-Za-z0-9_-]{43})/.exec(req.headers.cookie ?? '');
  return m ? sessions.get(m[1]) : undefined;
};

const statusOf = (email) => {
  const a = accounts.get(email);
  const rows = ['MARKETING', 'PRIVACY', 'TOS_GUEST'].map((kind) => {
    const required = kind !== 'MARKETING';
    const acc = a?.accepted[kind] ?? null;
    return {
      kind,
      required,
      currentVersion: VERSIONS[kind],
      requiredVersion: VERSIONS[kind],
      acceptedVersion: acc,
      accepted: acc !== null,
      reacceptRequired: required && (acc === null || acc < VERSIONS[kind]),
    };
  });
  const pending = rows.some((r) => r.reacceptRequired);
  return {
    code: pending ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT',
    messageKey: pending ? 'common.legal.reacceptRequired' : 'common.legal.current',
    documents: rows,
    marketingOptIn: false,
  };
};

// ---- Espace de l'hôte et fiche publique (US-115) --------------------------------------------
// Session `H0st…` (43 caractères) inconnue : deux comptes d'hôte neufs lui sont créés (un par
// parcours, aucun partage d'état entre tests parallèles) : le premier dans un marché à deux
// décimales (XTS) où le dépôt des photos est FERMÉ comme en production (antivirus et stockage pas
// encore branchés : 503), le second dans un marché SANS décimale (XXX, exposant 0, comme le PYG)
// où le dépôt est ouvert avec une petite taille maximale (413 au-delà) ; `N0ho…` : session sans
// compte d'hôte. Fiches publiques : `PUBLIC_ID` publiée, `DOWN_ID` en panne (503), le reste 404.
// Données fictives ; la fiche publique ne porte que des colonnes C0 (aucune adresse exacte).
const HOST_TOKEN = /^H0st[A-Za-z0-9_-]{39}$/;
const NOHOST_TOKEN = /^N0ho[A-Za-z0-9_-]{39}$/;
const PUBLIC_ID = '11500000-0000-4000-8000-00000000f001';
const DOWN_ID = '11500000-0000-4000-8000-00000000f503';
// Fiche du véhicule (US-204) : galerie de la fiche `PUBLIC_ID` dans l'ordre de l'hôte (trois
// photos, identifiants volontairement non triés) ; la deuxième est INTROUVABLE au bucket (404) :
// la galerie montre sa vignette de remplacement, les autres restent affichées. Le bucket est servi
// par ce double sous `/media/` (WEB_MEDIA_URL du site, playwright.config.ts) : petites images PNG
// unies, toujours les mêmes octets.
const GALLERY = [
  '20400000-0000-4000-8000-0000000000c3',
  '20400000-0000-4000-8000-0000000000a1',
  '20400000-0000-4000-8000-0000000000b2',
];
const BROKEN_PHOTO = GALLERY[1];
const PHOTO_BYTES = [
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR42mNIKGiAIwacHAAx1g/Bj08FAwAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR42mNYUBEARww4OQBNBhDhVPqafgAAAABJRU5ErkJggg==',
].map((b) => Buffer.from(b, 'base64'));
// Dates de la fiche (US-204) : départ à 07:00 ⇒ 422 DATES_NOTICE_TOO_SHORT (préavis de 3 h de
// l'hôte) ; départ le 24 décembre ⇒ 409 DATES_UNAVAILABLE (créneau pris, sans détail) ; sinon
// libre. Lieu exact : session `B00k…` (voyageur d'un trip confirmé de `PUBLIC_ID`) ⇒ 200 ; toute
// autre session ⇒ 404 ; sans session ⇒ 401.
const NOTICE_TIME = 'T07:00';
const BUSY_DAY = '-12-24T';
const BOOKED_TOKEN = /^B00k[A-Za-z0-9_-]{39}$/;
/** Ville fictive dont la recherche rend 503 `SEARCH_UNAVAILABLE` (US-201, état d'erreur). */
const SEARCH_DOWN_CITY = 'Ciudad Caida';
/** Annonces de la recherche du double sans fiche (US-203) : LUXE notée, sans point sur la carte. */
const SEARCH_LUXE_ID = '20300000-0000-4000-8000-00000000f002';
const SEARCH_NO_POINT_ID = '20300000-0000-4000-8000-00000000f003';
// Conditions de la fiche (US-205) : `PUBLIC_ID` et `MANUAL_ID` sont couvertes par le contrat de
// l'assureur partenaire du double (assureur, courtier, RC, franchises, exclusions fictifs) ;
// `NO_COVER_ID` est une fiche publiée SANS protection promise (interrupteur fermé, RC sous le
// minimum ou véhicule hors contrat : la base ne dit pas lequel) ⇒ aucun bouton « Reservar ».
// Départ à 09:30 ⇒ réservation de dernière minute (aucune date limite, fenêtre de 60 min) ;
// sinon gratuite jusqu'à 24 h avant le départ (08 BR-CXL-01, règle du pays du double).
const NO_COVER_ID = '20500000-0000-4000-8000-00000000f005';
const LAST_MINUTE_TIME = 'T09:30';
const FREE_CANCEL_LEAD_H = 24;
const LAST_MINUTE_THRESHOLD_H = 25;
const LAST_MINUTE_WINDOW_MIN = 60;
const KM_PER_DAY = 200;
const EXTRA_KM_MINOR = '20';
const PROTECTION = {
  insurerName: 'Aseguradora Ficticia',
  insurerLicenseRef: 'SSRP-0000',
  brokerName: 'Corredor Ficticio',
  brokerLicenseRef: null,
  contractVersion: 1,
  rcAmountMinor: '10000000',
  deductibles: { BASICA: '150000', ESTANDAR: '50000', TOTAL: '0' },
  exclusions: {
    es: 'Daños interiores y mecánicos, conducir fuera del territorio y conductores no aprobados.',
    en: 'Interior and mechanical damage, driving outside the country and unapproved drivers.',
    fr: 'Dommages intérieurs et mécaniques, conduite hors du pays et conducteurs non approuvés.',
    'pt-BR': 'Danos internos e mecânicos, dirigir fora do território e motoristas não aprovados.',
  },
};
const hosts = new Map();
const uuid = () => {
  const h = randomBytes(16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const tokenOf = (req) => /__Host-session=([A-Za-z0-9_-]{43})/.exec(req.headers.cookie ?? '')?.[1];
const hostOf = (req) => {
  const token = tokenOf(req);
  if (token === undefined) return undefined;
  if (NOHOST_TOKEN.test(token)) return null;
  if (!HOST_TOKEN.test(token)) return undefined;
  if (!hosts.has(token)) {
    const account = (market, photoUploads) => ({
      orgId: uuid(),
      market,
      photoUploads,
      locations: [],
      vehicles: [],
      listings: [],
      // CGU de l'hôte (US-126) : jamais acceptées à l'ouverture
      terms: { acceptedVersion: null, acceptedAt: null },
    });
    hosts.set(token, {
      accounts: [
        account(MARKET, { open: false, maxBytes: 75_000 }),
        account(MARKET_NO_DECIMALS, { open: true, maxBytes: 2_000 }),
      ],
    });
  }
  return hosts.get(token);
};
// devises de test ISO 4217 (XTS, XXX) et pays réservés : aucune vraie devise ni aucun vrai pays
// écrits ici (ADR-024)
const MARKET = { country: 'ZZ', currency: 'XTS', currencyExponent: 2 };
const HOST_TERMS_VERSION = 1;
const hostTermsDoc = (lang) => ({
  kind: 'TOS_HOST',
  version: HOST_TERMS_VERSION,
  isMajor: true,
  locale: lang,
  title: `TOS_HOST (${lang})`,
  contentHash: '0'.repeat(64),
  draft: true,
  validFrom: '2026-01-01T00:00:00.000Z',
});
const MARKET_NO_DECIMALS = { country: 'QZ', currency: 'XXX', currencyExponent: 0 };

// ---- Checkout en une page (US-208, partie 208b) : devis figé, pose du hold ------------------
// Session `G0st<ll>…` (43 caractères ; `<ll>` = langue du compte : es, en, fr, pt) : voyageur
// vérifié, CGU à jour, titulaire « Lucía Gómez » (données fictives). Toute autre session : 401.
// Devis : prix du jour de l'annonce × jours facturés, taxe de 7 % sur le loyer (configuration
// « PA1 » de TA01, 16 A.8.1 : 40,00 × 3 j = 120,00 + 8,40 = 128,40), aucune ligne de trip fee ;
// la réponse est TOUJOURS celle de la base (lignes, total, validité), jamais recalculée par le
// site. Scénarios par jour de départ :
//   - le 15 décembre : le premier devis expire à la pose (409 QUOTE_EXPIRED, aucun devis de
//     remplacement dans la réponse, comme l'API) ;
//   - le 20 décembre : le premier devis est déjà expiré à la lecture (`expired: true`) ;
//   - un devis redemandé (même session, même annonce, même période) a un nouveau prix (42,00 par
//     jour) : le site doit afficher ce nouveau total.
// `MANUAL_ID` : même fiche avec une boîte manuelle (case BKG-025). Instants de validité du devis
// et d'expiration du hold FIXES (captures stables).
const GUEST_TOKEN = /^G0st[A-Za-z0-9_-]{39}$/;
const MANUAL_ID = '11500000-0000-4000-8000-00000000f004';
const GUEST_NAME = ['Lucía', 'Gómez'];
const QUOTE_EXPIRES_AT = '2036-11-30T15:30:00.000Z';
const HOLD_EXPIRES_AT = '2036-11-30T15:10:00.000Z';
const EXPIRE_ON_HOLD_DAY = '-12-15T';
const EXPIRED_ON_READ_DAY = '-12-20T';
// US-226 : le 25, le devis porte la protection du voyageur, BASICA présélectionnée, non taxée
// (grille de TEST du dépôt, 16 PRC-018 : 1/4, 2/5 et 13/20 du prix journalier net, TOTAL dès
// 21 ans ; 40,00 ⇒ 10,00 / 16,00 / 26,00 par jour) ; le devis rend les niveaux et leur prix pour
// la période (`protectionOptions`), l'âge déclaré et l'interrupteur de l'assureur (US-226b). Niveau
// absent ⇒ BASICA ; niveau vide ⇒ 422 PROTECTION_LEVEL_REQUIRED ; niveau refusé à l'âge déclaré ⇒
// 422 PROTECTION_LEVEL_NOT_ELIGIBLE. Le 27 : contrat de l'assureur fermé au gel (409
// INSURER_CONTRACT_INACTIVE) ; le 28 : devis figé, contrat fermé depuis (lecture
// `insurerContractActive: false`). Les autres jours gardent le devis de 208b (références visuelles
// inchangées).
// Le 22 (revue qa de 226b, n° 1) : protection comme le 25, mais un devis figé avec un choix du
// voyageur (niveau autre que BASICA, ou âge déclaré) est expiré à la lecture : son prix redemandé
// (42,00 par jour) doit garder le niveau et l'âge. Le 26 : S05 ouvert, contrat de l'assureur fermé
// à la pose du hold (409 INSURER_CONTRACT_INACTIVE).
const PROTECTION_RENEW_DAY = '-12-22T';
const INSURER_CLOSED_ON_HOLD_DAY = '-12-26T';
const PROTECTION_DAY = '-12-25T';
const INSURER_CLOSED_DAY = '-12-27T';
const INSURER_CLOSED_ON_READ_DAY = '-12-28T';
const PROTECTION_GRID = [
  { level: 'BASICA', num: 1, den: 4, minDriverAge: null },
  { level: 'ESTANDAR', num: 2, den: 5, minDriverAge: null },
  { level: 'TOTAL', num: 13, den: 20, minDriverAge: 21 },
];
/** Prix par jour d'un niveau : arrondi au plus proche, moitié vers le haut (montants positifs). */
const protectionDaily = (daily, t) => Math.floor((daily * t.num * 2 + t.den) / (2 * t.den));
const eligibleAt = (t, age) => t.minDriverAge === null || (age !== null && age >= t.minDriverAge);
// US-209 : refus du conducteur à la pose (403, 16 BKG-012), un code par jour de départ ; le 8 :
// code inconnu du site (message générique, témoin)
const DRIVER_REFUSALS = {
  '-12-04T': ['KYC_NOT_APPROVED', 'common.kyc.notApproved'],
  '-12-05T': ['KYC_BIOMETRIC_CONSENT_MISSING', 'common.kyc.consentMissing'],
  '-12-06T': ['KYC_LICENSE_EXPIRED', 'common.kyc.licenseExpired'],
  '-12-07T': ['AGE_CLASS_MISMATCH', 'common.checkout.ageClassMismatch'],
  '-12-08T': ['DRIVER_CHECK_UNKNOWN', 'common.checkout.unavailable'],
};
const DAILY_MINOR = 4000;
const RENEWED_DAILY_MINOR = 4200;
const TAX_PCT = 7;
const CHECKOUT_DOCS = { TOS_GUEST: VERSIONS.TOS_GUEST, CANCELLATION_POLICY: 1, GEO_TERMS: 1 };
const CHECKOUT_TITLES = {
  TOS_GUEST: {
    es: 'Términos y condiciones',
    en: 'Terms and conditions',
    fr: 'Conditions générales',
    pt: 'Termos e condições',
  },
  CANCELLATION_POLICY: {
    es: 'Política de cancelación',
    en: 'Cancellation policy',
    fr: 'Politique d’annulation',
    pt: 'Política de cancelamento',
  },
  GEO_TERMS: {
    es: 'Zonas de circulación',
    en: 'Where you can drive',
    fr: 'Zones de circulation',
    pt: 'Onde você pode dirigir',
  },
};
const quotes = new Map();
const holds = new Map();
const DAY_MS = 86_400_000;
const STEP = /^\d{4}-\d{2}-\d{2}T\d{2}:[03]0:00(\.000)?Z$/;

const guestOf = (req) => {
  const token = tokenOf(req);
  if (token === undefined || !GUEST_TOKEN.test(token)) return undefined;
  const lang = token.slice(4, 6);
  return { token, lang: LANGS.includes(lang) ? lang : 'es' };
};
const sameName = (a, b) =>
  typeof a === 'string' &&
  a.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase() === b.normalize('NFC').toLowerCase();
const checkoutDoc = (kind, lang) => ({
  kind,
  version: CHECKOUT_DOCS[kind],
  isMajor: true,
  locale: lang,
  title: CHECKOUT_TITLES[kind][lang],
  contentHash: '0'.repeat(64),
  draft: true,
  validFrom: '2026-01-01T00:00:00.000Z',
});
const quoteJson = (q) => ({
  quoteId: q.id,
  listingId: q.listingId,
  country: MARKET.country,
  currency: MARKET.currency,
  startAt: q.startAt,
  endAt: q.endAt,
  billableDays: q.days,
  lines: [
    { type: 'TRIP_PRICE', amountMinor: String(q.rent), taxMinor: String(q.tax) },
    ...(q.protection > 0
      ? [{ type: 'PROTECTION', amountMinor: String(q.protection), taxMinor: '0' }]
      : []),
  ],
  totalMinor: String(q.rent + q.tax + q.protection),
  ...(q.protection > 0
    ? {
        protectionLevel: q.level,
        driverAge: q.driverAge,
        insurerContractActive: !q.insurerClosedOnRead,
        protectionOptions: PROTECTION_GRID.map((t) => {
          const eligible = eligibleAt(t, q.driverAge);
          const daily = protectionDaily(q.daily, t);
          return {
            level: t.level,
            eligible,
            reason: eligible ? null : 'DRIVER_AGE',
            minDriverAge: t.minDriverAge,
            dailyMinor: String(daily),
            lineMinor: String(daily * q.days),
            selected: t.level === q.level,
          };
        }),
      }
    : {}),
  expiresAt: QUOTE_EXPIRES_AT,
  expired: q.expiredOnRead,
  manualTransmission: q.listingId === MANUAL_ID,
  instantBook: true,
  documents: Object.keys(CHECKOUT_DOCS).map((kind) => ({
    kind,
    version: CHECKOUT_DOCS[kind],
    locale: q.lang,
    title: CHECKOUT_TITLES[kind][q.lang],
  })),
});
const holdJson = (h) => ({
  holdId: h.id,
  status: 'ACTIVE',
  expiresAt: HOLD_EXPIRES_AT,
  quoteId: h.quote.id,
  listingId: h.quote.listingId,
  currency: MARKET.currency,
  startAt: h.quote.startAt,
  endAt: h.quote.endAt,
  totalMinor: String(h.quote.rent + h.quote.tax + h.quote.protection),
  manualConfirmed: h.manual,
  documents: Object.keys(CHECKOUT_DOCS).map((kind) => ({
    kind,
    version: CHECKOUT_DOCS[kind],
    locale: h.quote.lang,
  })),
});
/** Total TTC du créneau (même règle que le devis du double) ; prix du jour donné. */
const slotTotal = (startMs, endMs, daily) => {
  const days = Math.max(1, Math.ceil((endMs - startMs) / DAY_MS));
  const rent = days * daily;
  // arrondi au plus proche, moitié vers le haut (montants positifs)
  const tax = Math.floor((rent * TAX_PCT + 50) / 100);
  return { days, rent, tax };
};

async function checkoutRoute(req, res, path) {
  const holdPath = /^\/checkout\/quotes\/([0-9a-f-]{36})\/hold$/.exec(path)?.[1];
  const quotePath = /^\/checkout\/quotes\/([0-9a-f-]{36})$/.exec(path)?.[1];
  const holdRead = /^\/checkout\/holds\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (!path.startsWith('/checkout/')) return false;
  const guest = guestOf(req);
  if (guest === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  if (req.method === 'POST' && path === '/checkout/quotes') {
    const b = await readBody(req);
    if (b === null || typeof b !== 'object') {
      return err(res, 400, 'QUOTE_INPUT_INVALID', 'common.quote.datesInvalid');
    }
    if (b.listingId !== PUBLIC_ID && b.listingId !== MANUAL_ID) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    if (!STEP.test(b.startAt ?? '') || !STEP.test(b.endAt ?? '') || b.endAt <= b.startAt) {
      return err(res, 400, 'QUOTE_INPUT_INVALID', 'common.quote.datesInvalid');
    }
    const startAt = new Date(b.startAt).toISOString();
    const endAt = new Date(b.endAt).toISOString();
    // prix redemandé APRÈS un devis expiré (même session, annonce et période) : nouveau prix ; un
    // nouveau devis pour un autre niveau de protection garde le prix du jour (US-226b)
    const renewed = [...quotes.values()].some(
      (q) =>
        q.token === guest.token &&
        q.listingId === b.listingId &&
        q.startAt === startAt &&
        q.endAt === endAt &&
        (q.expiredOnRead || q.expireOnHold),
    );
    if (startAt.includes(INSURER_CLOSED_DAY)) {
      return err(res, 409, 'INSURER_CONTRACT_INACTIVE', 'common.quote.insurerContractInactive');
    }
    const renewDay = startAt.includes(PROTECTION_RENEW_DAY);
    const withProtection =
      renewDay ||
      startAt.includes(PROTECTION_DAY) ||
      startAt.includes(INSURER_CLOSED_ON_READ_DAY) ||
      startAt.includes(INSURER_CLOSED_ON_HOLD_DAY);
    const age = b.driverAge === undefined || b.driverAge === null ? null : b.driverAge;
    if (age !== null && !(Number.isInteger(age) && age >= 1 && age <= 150)) {
      return err(res, 400, 'QUOTE_INPUT_INVALID', 'common.quote.datesInvalid');
    }
    if (b.protectionLevel === null || b.protectionLevel === '') {
      return err(res, 422, 'PROTECTION_LEVEL_REQUIRED', 'common.quote.protectionRequired');
    }
    const level = b.protectionLevel ?? 'BASICA';
    const terms = PROTECTION_GRID.find((t) => t.level === level);
    if (withProtection && (terms === undefined || !eligibleAt(terms, age))) {
      return err(res, 422, 'PROTECTION_LEVEL_NOT_ELIGIBLE', 'common.quote.protectionNotEligible');
    }
    const t = slotTotal(
      Date.parse(startAt),
      Date.parse(endAt),
      renewed ? RENEWED_DAILY_MINOR : DAILY_MINOR,
    );
    const daily = renewed ? RENEWED_DAILY_MINOR : DAILY_MINOR;
    const q = {
      id: uuid(),
      token: guest.token,
      lang: guest.lang,
      listingId: b.listingId,
      startAt,
      endAt,
      ...t,
      daily,
      level,
      driverAge: age,
      insurerClosedOnRead: startAt.includes(INSURER_CLOSED_ON_READ_DAY),
      insurerClosedOnHold: startAt.includes(INSURER_CLOSED_ON_HOLD_DAY),
      protection: withProtection ? protectionDaily(daily, terms) * t.days : 0,
      expiredOnRead:
        !renewed &&
        (startAt.includes(EXPIRED_ON_READ_DAY) ||
          (renewDay && (level !== 'BASICA' || age !== null))),
      expireOnHold: !renewed && startAt.includes(EXPIRE_ON_HOLD_DAY),
      used: false,
    };
    quotes.set(q.id, q);
    return json(res, 201, { quote: quoteJson(q) });
  }
  if (req.method === 'GET' && quotePath !== undefined) {
    const q = quotes.get(quotePath);
    if (q === undefined || q.token !== guest.token) {
      return err(res, 404, 'QUOTE_NOT_FOUND', 'common.quote.notFound');
    }
    return json(res, 200, { quote: quoteJson(q) });
  }
  if (req.method === 'POST' && holdPath !== undefined) {
    const q = quotes.get(holdPath);
    if (q === undefined || q.token !== guest.token) {
      return err(res, 404, 'QUOTE_NOT_FOUND', 'common.quote.notFound');
    }
    const b = await readBody(req);
    if (b === null || typeof b !== 'object' || typeof b.driver !== 'object' || b.driver === null) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    // ordre des contrôles de la base (0108)
    if (q.used) return err(res, 409, 'QUOTE_ALREADY_USED', 'common.checkout.quoteAlreadyUsed');
    if (q.expiredOnRead || q.expireOnHold) {
      return err(res, 409, 'QUOTE_EXPIRED', 'common.quote.expired');
    }
    if (q.insurerClosedOnRead || q.insurerClosedOnHold) {
      return err(res, 409, 'INSURER_CONTRACT_INACTIVE', 'common.quote.insurerContractInactive');
    }
    if (q.listingId === MANUAL_ID && b.manualTransmissionConfirmed !== true) {
      return err(
        res,
        422,
        'MANUAL_TRANSMISSION_NOT_CONFIRMED',
        'common.checkout.manualNotConfirmed',
      );
    }
    if (
      !sameName(b.driver.firstName, GUEST_NAME[0]) ||
      !sameName(b.driver.lastName, GUEST_NAME[1])
    ) {
      return err(
        res,
        422,
        'DRIVER_MUST_BE_ACCOUNT_HOLDER',
        'common.checkout.driverMustBeAccountHolder',
      );
    }
    const docs = Array.isArray(b.acceptedDocuments) ? b.acceptedDocuments : [];
    const kinds = Object.keys(CHECKOUT_DOCS);
    // US-209 : contrôle du conducteur après la pose (refus, aucun hold)
    const refusal = Object.entries(DRIVER_REFUSALS).find(([day]) => q.startAt.includes(day));
    if (refusal !== undefined) return err(res, 403, refusal[1][0], refusal[1][1]);
    if (docs.length !== kinds.length || !kinds.every((k) => docs.some((d) => d?.kind === k))) {
      return err(res, 422, 'TERMS_NOT_ACCEPTED', 'common.checkout.termsNotAccepted');
    }
    if (!docs.every((d) => d.version === CHECKOUT_DOCS[d.kind])) {
      return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
    }
    q.used = true;
    const h = { id: uuid(), quote: q, manual: q.listingId === MANUAL_ID };
    holds.set(h.id, h);
    return json(res, 201, { hold: holdJson(h) });
  }
  if (req.method === 'GET' && holdRead !== undefined) {
    const h = holds.get(holdRead);
    if (h === undefined || h.quote.token !== guest.token) {
      return err(res, 404, 'HOLD_NOT_FOUND', 'common.checkout.holdNotFound');
    }
    return json(res, 200, { hold: holdJson(h) });
  }
  return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
}

// ---- Vérification de l'hôte (US-123) : liste de tâches A07 -----------------------------------
// Double : identité et âge déjà vérifiés ; un type de numéro fiscal NEUTRE (données fictives, aucun
// type propre à un pays) ; envoi ⇒ filtrage fait, dossier en revue si les CGU sont acceptées (numéro
// fiscal facultatif, ADR-115) ;
// `GET /__e2e/host-verification/approve?token=` ⇒ dossier approuvé, compte en attente
// d'activation, pays pas encore ouvert (interrupteurs fermés, comme la production).
const TAX_KINDS = ['TAX_NUMBER'];
const verificationOf = (h) => {
  h.verification ??= { status: null, orgStatus: 'ONBOARDING', taxKind: null, screening: false };
  return h.verification;
};
const verificationView = (h, code, messageKey) => {
  const v = verificationOf(h);
  const terms = h.terms.acceptedVersion !== null;
  const missing = [
    ...(v.screening ? [] : ['HOST_SCREENING_MISSING']),
    // numéro fiscal facultatif (graine false en PA et en PY, ADR-115) : jamais une pièce manquante
    ...(terms ? [] : ['TERMS_REACCEPT_REQUIRED']),
  ];
  return {
    code,
    messageKey,
    country: h.market.country,
    orgStatus: v.orgStatus,
    verificationStatus: v.status,
    missing: v.status === null || v.status === 'APPROVED' ? [] : missing,
    kycApproved: true,
    ageStatus: 'OK',
    residenceStatus: 'VERIFIED',
    taxRequired: false,
    taxSaved: v.taxKind !== null,
    taxKind: v.taxKind,
    taxKinds: TAX_KINDS,
    termsAccepted: terms,
    screeningDone: v.screening,
    blockers:
      v.status === 'APPROVED'
        ? ['SUBMERCHANT_NOT_ACTIVE', 'P2P_HOSTS_DISABLED', 'INSURER_CONTRACT_INACTIVE']
        : [
            ...(terms ? [] : ['TERMS_REACCEPT_REQUIRED']),
            'HOST_VERIFICATION_NOT_APPROVED',
            'SUBMERCHANT_NOT_ACTIVE',
            'P2P_HOSTS_DISABLED',
            'INSURER_CONTRACT_INACTIVE',
          ],
  };
};

async function verificationRoute(req, res, path) {
  const m = /^\/host\/accounts\/([0-9a-f-]{36})\/verification(\/tax-profile)?$/.exec(path);
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === m[1]);
  if (h === undefined)
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  const v = verificationOf(h);
  if (req.method === 'GET' && m[2] === undefined) {
    return json(
      res,
      200,
      verificationView(h, 'HOST_VERIFICATION_STATE', 'common.hostVerification.state'),
    );
  }
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = (await readBody(req)) ?? {};
  const locked = v.status !== null && !['OPEN', 'DOCS_PENDING'].includes(v.status);
  // en revue ou approuvé : un PREMIER numéro reste admis (ADR-115)
  const taxLocked = locked && !(['IN_REVIEW', 'APPROVED'].includes(v.status) && v.taxKind === null);
  if (m[2] !== undefined) {
    if (!TAX_KINDS.includes(body.kind)) {
      return err(res, 422, 'HOST_TAX_ID_KIND_INVALID', 'common.hostVerification.taxKindInvalid');
    }
    const taxId = String(body.taxId ?? '')
      .replace(/[\s.]/g, '')
      .toUpperCase();
    if (!/^[0-9A-Z][0-9A-Z-]{3,19}$/.test(taxId)) {
      return err(res, 422, 'HOST_TAX_ID_INVALID', 'common.hostVerification.taxIdInvalid');
    }
    if (taxLocked) {
      return err(res, 409, 'HOST_VERIFICATION_LOCKED', 'common.hostVerification.locked');
    }
    // le numéro n'est jamais gardé par le double (le vrai magasin ne reçoit que son enveloppe)
    v.taxKind = body.kind;
    return json(
      res,
      200,
      verificationView(h, 'HOST_TAX_PROFILE_SAVED', 'common.hostVerification.taxSaved'),
    );
  }
  if (!locked) {
    v.screening = true;
    v.status = h.terms.acceptedVersion !== null ? 'IN_REVIEW' : 'DOCS_PENDING';
  }
  return json(
    res,
    200,
    verificationView(h, 'HOST_VERIFICATION_SUBMITTED', 'common.hostVerification.submitted'),
  );
}

async function hostRoute(req, res, url) {
  const path = url.pathname;
  if ((await verificationRoute(req, res, path)) !== false) return true;
  if (req.method === 'GET' && path === '/__e2e/host-verification/approve') {
    const h = hosts.get(url.searchParams.get('token') ?? '');
    if (h === undefined) return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    for (const a of h.accounts) {
      const v = verificationOf(a);
      v.status = 'APPROVED';
      v.orgStatus = 'PENDING_ACTIVATION';
      v.screening = true;
    }
    return json(res, 200, { status: 'APPROVED' });
  }
  if (req.method === 'GET' && path === '/auth/session') {
    const h = hostOf(req);
    if (h === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, {
      userId: uuid(),
      mfaLevel: 'NONE',
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      emailVerified: true,
      roles: h === null ? ['GUEST'] : ['GUEST', 'P2P_HOST'],
      hostAccounts:
        h === null
          ? []
          : h.accounts.map((a) => ({
              orgId: a.orgId,
              country: a.market.country,
              role: 'P2P_HOST',
              status: 'ONBOARDING',
              displayName: 'Ana',
            })),
    });
  }
  // Recherche publique (US-201) : une ville fictive, deux zones ; la fiche publiée du double est
  // disponible à toute date future (fuseau UTC : l'heure locale saisie est l'heure rendue)
  if (req.method === 'GET' && path === '/search/areas') {
    return json(res, 200, {
      areas: [
        { country: 'ZZ', city: 'Ciudad Ficticia', area: null, timezone: 'UTC' },
        { country: 'ZZ', city: 'Ciudad Ficticia', area: 'Barrio Norte', timezone: 'UTC' },
      ],
    });
  }
  if (req.method === 'GET' && path === '/search') {
    const q = new URL(req.url ?? '/', 'http://stub').searchParams;
    const slot = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[03]0$/;
    const start = q.get('start') ?? '';
    const end = q.get('end') ?? '';
    if (q.get('country') === null || (q.get('city') ?? '') === '') {
      return err(res, 422, 'SEARCH_LOCATION_REQUIRED', 'common.search.locationRequired');
    }
    if (!slot.test(start) || !slot.test(end) || end <= start) {
      return err(res, 422, 'SEARCH_DATES_INVALID', 'common.search.datesInvalid');
    }
    // base injoignable (état d'erreur de la page de résultats) : ville réservée du double
    if (q.get('city') === SEARCH_DOWN_CITY) {
      return err(res, 503, 'SEARCH_UNAVAILABLE', 'common.search.unavailable');
    }
    const found =
      q.get('city') === 'Ciudad Ficticia' && (q.get('area') ?? 'Barrio Norte') === 'Barrio Norte';
    // US-203 : cartes (total TTC et jours du devis provisoire de l'API, caution de la plateforme,
    // note) ; trois annonces : la fiche publiée du double (sans caution annoncée, sans avis), une
    // annonce LUXE (caution de 300,00, valeur de test de 08 T70) notée, une annonce sans point sur
    // la carte. Totaux de forme du double (taxe de 7 % sur le loyer, jours de 24 h) : l'API réelle
    // les tient du moteur de devis (PRC), prouvé par ses tests.
    const days = Math.max(
      1,
      Math.ceil((Date.parse(`${end}:00Z`) - Date.parse(`${start}:00Z`)) / 86_400_000),
    );
    const card = (id, daily, extra) => ({
      id,
      dailyPriceMinor: String(daily),
      currency: 'XTS',
      currencyExponent: 2,
      instantBook: true,
      transmission: 'AUTOMATIC',
      seats: 5,
      fuelType: 'GASOLINE',
      locationKind: 'POI',
      city: 'Ciudad Ficticia',
      areaLabel: 'Barrio Norte',
      timezone: 'UTC',
      startAt: `${start}:00.000Z`,
      endAt: `${end}:00.000Z`,
      totalMinor: String(Math.round((daily * days * 107) / 100)),
      billableDays: days,
      depositAmountMinor: null,
      rating: null,
      ...extra,
    });
    return json(res, 200, {
      results: found
        ? [
            card(PUBLIC_ID, 4000, {
              makeName: 'Toyota',
              modelName: 'Yaris',
              year: 2021,
              approximatePoint: { lat: 8.98, lng: -79.52 },
            }),
            card(SEARCH_LUXE_ID, 9000, {
              makeName: 'Audi',
              modelName: 'A4',
              year: 2022,
              approximatePoint: { lat: 9.01, lng: -79.5 },
              depositAmountMinor: '30000',
              rating: { averageX100: 480, reviewCount: 3, tripCount: 5 },
            }),
            card(SEARCH_NO_POINT_ID, 3000, {
              makeName: 'Suzuki',
              modelName: 'Swift',
              year: 2020,
              areaLabel: null,
              approximatePoint: null,
            }),
          ]
        : [],
    });
  }
  // ---- Fiche du véhicule (US-204) : bucket des photos, dates, lieu exact ---------------------
  const media = /^\/media\/listing\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/.exec(path);
  if (req.method === 'GET' && media !== null) {
    const i = GALLERY.indexOf(media[2]);
    if (media[1] !== PUBLIC_ID || i < 0 || media[2] === BROKEN_PHOTO) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('introuvable');
    }
    const body = PHOTO_BYTES[i % PHOTO_BYTES.length];
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(body.length) });
    return res.end(body);
  }
  const avail = /^\/listings\/([0-9a-f-]{36})\/availability$/.exec(path)?.[1];
  if (req.method === 'GET' && avail !== undefined) {
    if (avail !== PUBLIC_ID && avail !== MANUAL_ID && avail !== NO_COVER_ID) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    const start = url.searchParams.get('start') ?? '';
    const end = url.searchParams.get('end') ?? '';
    const slot = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[03]0$/;
    if (!slot.test(start) || !slot.test(end) || end <= start) {
      return err(res, 422, 'SEARCH_DATES_INVALID', 'common.search.datesInvalid');
    }
    if (start.endsWith(NOTICE_TIME)) {
      return json(res, 422, {
        code: 'DATES_NOTICE_TOO_SHORT',
        messageKey: 'common.listing.datesNoticeTooShort',
        values: { noticeHours: 3 },
      });
    }
    if (start.includes(BUSY_DAY)) {
      return err(res, 409, 'DATES_UNAVAILABLE', 'common.listing.datesUnavailable');
    }
    // total TTC du devis provisoire (US-208) : même règle que le devis du checkout du double
    const t = slotTotal(Date.parse(`${start}:00Z`), Date.parse(`${end}:00Z`), DAILY_MINOR);
    return json(res, 200, {
      availability: {
        startAt: `${start}:00.000Z`,
        endAt: `${end}:00.000Z`,
        timezone: 'UTC',
        price: {
          totalMinor: String(t.rent + t.tax),
          currency: MARKET.currency,
          billableDays: t.days,
        },
        // US-205 : annulation pour ce départ (dernière minute : départ à 09:30 dans le double) et
        // distance sur la période (km par jour × jours facturables du devis)
        cancellation: start.endsWith(LAST_MINUTE_TIME)
          ? { lastMinute: true, freeUntil: null, lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN }
          : {
              lastMinute: false,
              freeUntil: new Date(
                Date.parse(`${start}:00Z`) - FREE_CANCEL_LEAD_H * 3_600_000,
              ).toISOString(),
              lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN,
            },
        mileage: {
          mode: 'INCLUDED',
          includedKmPerDay: KM_PER_DAY,
          includedKm: KM_PER_DAY * t.days,
          extraKmPriceMinor: EXTRA_KM_MINOR,
        },
      },
    });
  }
  const cond = /^\/listings\/([0-9a-f-]{36})\/conditions$/.exec(path)?.[1];
  if (req.method === 'GET' && cond !== undefined) {
    if (cond !== PUBLIC_ID && cond !== MANUAL_ID && cond !== NO_COVER_ID) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    return json(res, 200, {
      conditions: {
        currency: MARKET.currency,
        timezone: 'UTC',
        cancellation: {
          freeCancelLeadHours: FREE_CANCEL_LEAD_H,
          lastMinuteThresholdHours: LAST_MINUTE_THRESHOLD_H,
          lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN,
        },
        deposit: null,
        protection: cond === NO_COVER_ID ? null : PROTECTION,
      },
    });
  }
  const meet = /^\/listings\/([0-9a-f-]{36})\/meeting-point$/.exec(path)?.[1];
  if (req.method === 'GET' && meet !== undefined) {
    const token = tokenOf(req);
    if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (meet !== PUBLIC_ID || !BOOKED_TOKEN.test(token)) {
      return err(res, 404, 'MEETING_POINT_NOT_FOUND', 'common.listing.meetingPointNotFound');
    }
    return json(res, 200, {
      meetingPoint: {
        placeLabel: 'Entrada del centro comercial',
        addressLine: 'Avenida Ficticia 123',
        city: 'Ciudad Ficticia',
        areaLabel: 'Barrio Norte',
        locationKind: 'POI',
      },
    });
  }
  const pub = /^\/listings\/([0-9a-f-]{36})$/.exec(path)?.[1];
  if (req.method === 'GET' && pub !== undefined) {
    if (pub === DOWN_ID) return err(res, 503, 'LISTING_UNAVAILABLE', 'common.listing.unavailable');
    if (pub !== PUBLIC_ID && pub !== MANUAL_ID && pub !== NO_COVER_ID) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    const manual = pub === MANUAL_ID;
    const bare = manual || pub === NO_COVER_ID;
    return json(res, 200, {
      listing: {
        id: pub,
        country: 'ZZ',
        dailyPriceMinor: '4000',
        currency: 'XTS',
        currencyExponent: 2,
        mileageMode: 'INCLUDED',
        includedKmPerDay: KM_PER_DAY,
        extraKmPriceMinor: EXTRA_KM_MINOR,
        instantBook: true,
        variantId: null,
        makeName: 'Toyota',
        modelName: 'Yaris',
        year: 2021,
        transmission: manual ? 'MANUAL' : 'AUTOMATIC',
        seats: 5,
        fuelType: 'GASOLINE',
        locationKind: 'POI',
        city: 'Ciudad Ficticia',
        areaLabel: 'Barrio Norte',
        approximatePoint: { lat: 8.98, lng: -79.52 },
        timezone: 'UTC',
        hostFirstName: 'Ana',
        photos: bare
          ? []
          : GALLERY.map((id, order) => ({ id, order, key: `listing/${PUBLIC_ID}/${id}` })),
        hostVerified: true,
        ratings: {
          vehicle: { averageX100: 480, reviewCount: 3, tripCount: 5 },
          host: { averageX100: 490, reviewCount: 10, tripCount: 12 },
        },
      },
    });
  }
  // ---- Trips de l'hôte (US-219) : lecture seule ------------------------------------------------
  // Double : chaque auto du compte porte un trip à venir (référence fixe, voyageur minimisé) ; la
  // première porte aussi un trip annulé (jambe HOST nulle). Montants en unités mineures (chaînes),
  // exposant du marché du compte. Période inversée ⇒ 400 ; compte d'un autre ⇒ 404.
  const tr = /^\/host\/accounts\/([0-9a-f-]{36})\/trips(?:\/([^/]+))?$/.exec(path);
  if (tr !== null && req.method === 'GET') {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const a = owner === null ? undefined : owner.accounts.find((x) => x.orgId === tr[1]);
    if (a === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    a.tripIds ??= new Map();
    const loc = (v) => a.locations.find((l) => l.id === v.locationId)?.label ?? null;
    const trips = a.vehicles.flatMap((v, i) => {
      const ids = a.tripIds.get(v.id) ?? [uuid(), uuid()];
      a.tripIds.set(v.id, ids);
      const base = {
        status: 'BOOKED',
        vehicle: {
          id: v.id,
          makeText: v.makeText,
          modelText: v.modelText,
          year: v.year,
          plate: v.plate,
        },
        handoverPlace: loc(v),
        startsAt: '2036-12-12T14:00:00.000Z',
        endsAt: '2036-12-14T14:00:00.000Z',
        timezone: 'UTC',
        bookedAt: '2036-12-01T15:00:00.000Z',
        paymentStatus: 'CONFIRMED',
        currency: a.market.currency,
        guest: { firstName: 'Lucía', ageYears: 29, rating: null, verified: true },
      };
      const out = [
        {
          ...base,
          tripId: ids[0],
          reference: `KM-${i + 1}01`,
          tab: 'UPCOMING',
          hostEarningsMinor: a.market.currencyExponent === 0 ? '850000' : '12000',
        },
      ];
      if (i === 0) {
        out.push({
          ...base,
          tripId: ids[1],
          reference: `KM-${i + 1}02`,
          tab: 'CANCELLED',
          status: 'CANCELLED_BY_GUEST',
          paymentStatus: 'REFUNDED',
          hostEarningsMinor: null,
          guest: { firstName: 'Mateo', ageYears: 34, rating: null, verified: false },
        });
      }
      return out;
    });
    const market = { currency: a.market.currency, currencyExponent: a.market.currencyExponent };
    if (tr[2] !== undefined) {
      const one = trips.find((t) => t.tripId === tr[2]);
      if (!one) return err(res, 404, 'TRIP_NOT_FOUND', 'common.hostTrips.notFound');
      return json(res, 200, { market, trip: one });
    }
    const q = url.searchParams;
    const from = q.get('from');
    const to = q.get('to');
    if (from !== null && to !== null && to < from) {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: [{ field: 'to', reason: 'INVALID' }],
      });
    }
    const tab = q.get('tab');
    const vehicleId = q.get('vehicleId');
    return json(res, 200, {
      market,
      trips: trips.filter(
        (t) =>
          (tab === null || t.tab === tab) && (vehicleId === null || t.vehicle.id === vehicleId),
      ),
    });
  }
  // ---- Plans de gains de l'hôte (US-226) : plan de chaque véhicule, plans vendus, changement ----
  // Double : premier compte (XTS) : un seul plan vendu (`ESTÁNDAR` 3/4, comme la configuration du
  // dépôt, OQ-P2P-11) ; second compte (XXX) : deux plans (`ESTÁNDAR` 3/4 et un plan fictif `ALTO`
  // 17/20) pour exercer le changement. `PRO` n'est jamais vendu (422 EARNINGS_PLAN_NOT_AVAILABLE).
  const plan =
    /^\/host\/accounts\/([0-9a-f-]{36})\/(?:earnings-plans|vehicles\/([0-9a-f-]{36})\/earnings-plan)$/.exec(
      path,
    );
  if (plan !== null) {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === plan[1]);
    if (h === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    const offered =
      h.market === MARKET
        ? [{ planCode: 'ESTÁNDAR', hostShare: '3/4' }]
        : [
            { planCode: 'ESTÁNDAR', hostShare: '3/4' },
            { planCode: 'ALTO', hostShare: '17/20' },
          ];
    h.plans ??= {};
    if (req.method === 'GET' && plan[2] === undefined) {
      return json(res, 200, {
        plans: {
          defaultPlan: 'ESTÁNDAR',
          offered,
          vehicles: h.vehicles.map((v) => ({
            vehicleId: v.id,
            planCode: h.plans[v.id] ?? 'ESTÁNDAR',
            chosen: h.plans[v.id] !== undefined,
            chosenAt: h.plans[v.id] === undefined ? null : '2036-11-30T15:00:00.000Z',
          })),
        },
      });
    }
    if (req.method !== 'PUT' || plan[2] === undefined) {
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    }
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
      return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const v = h.vehicles.find((x) => x.id === plan[2]);
    if (!v) return err(res, 404, 'VEHICLE_NOT_FOUND', 'common.listing.vehicleNotFound');
    const body = (await readBody(req)) ?? {};
    if (!offered.some((o) => o.planCode === body.planCode)) {
      return err(
        res,
        422,
        'EARNINGS_PLAN_NOT_AVAILABLE',
        'common.listing.earningsPlanNotAvailable',
      );
    }
    h.plans[v.id] = body.planCode;
    return json(res, 200, {
      code: 'EARNINGS_PLAN_SAVED',
      messageKey: 'common.listing.earningsPlanSaved',
      planCode: body.planCode,
    });
  }
  // ---- Calendrier d'un véhicule (US-119) : occupations, blocages, préavis du lieu -------------
  // Double : un véhicule qui a une annonce vaut « publié » (le double ne publie jamais, US-118) ;
  // heures locales comparées comme des chaînes (fuseau UTC du double) ; préavis du pays : 180 min.
  const cal =
    /^\/host\/accounts\/([0-9a-f-]{36})\/(?:vehicles\/([0-9a-f-]{36})\/(calendar|blocks)(?:\/([0-9a-f-]{36}))?|locations\/([0-9a-f-]{36})\/notice)$/.exec(
      path,
    );
  if (cal !== null) {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === cal[1]);
    if (h === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    h.blocks ??= [];
    const [, , vehicleId, what, blockId, locationId] = cal;
    if (locationId !== undefined) {
      if (req.method !== 'PUT') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
      if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
        return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      const loc = h.locations.find((x) => x.id === locationId);
      if (!loc) return err(res, 404, 'LOCATION_NOT_FOUND', 'common.listing.locationNotFound');
      const body = (await readBody(req)) ?? {};
      const m = body.minutes;
      if (m !== null && !(Number.isInteger(m) && m >= 60 && m <= 10_080 && m % 30 === 0)) {
        return json(res, 400, {
          code: 'REQUEST_INVALID',
          messageKey: 'common.auth.requestInvalid',
          fields: [{ field: 'minutes', reason: 'INVALID' }],
        });
      }
      loc.notice = m;
      return err(res, 200, 'NOTICE_SAVED', 'common.calendar.noticeSaved');
    }
    const v = h.vehicles.find((x) => x.id === vehicleId);
    if (!v) return err(res, 404, 'VEHICLE_NOT_FOUND', 'common.listing.vehicleNotFound');
    const listed = v.listingId !== null;
    if (req.method === 'GET' && what === 'calendar' && blockId === undefined) {
      const loc = h.locations.find((x) => x.id === v.locationId);
      const notice = loc?.notice ?? null;
      return json(res, 200, {
        vehicle: {
          id: v.id,
          timezone: 'UTC',
          listed,
          locationId: v.locationId,
          noticeMinutes: notice,
          effectiveNoticeMinutes: notice ?? 180,
        },
        entries: h.blocks
          .filter((b) => b.vehicleId === v.id && b.active)
          .sort((a, b) => (a.startLocal < b.startLocal ? -1 : 1))
          .map((b) => ({
            id: b.id,
            kind: 'HOST_BLOCK',
            startsAt: `${b.startLocal}:00.000Z`,
            endsAt: `${b.endLocal}:00.000Z`,
            startLocal: b.startLocal,
            endLocal: b.endLocal,
            removable: true,
          })),
      });
    }
    if (what !== 'blocks') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
      return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const body = (await readBody(req)) ?? {};
    if (req.method === 'DELETE' && blockId !== undefined) {
      const b = h.blocks.find((x) => x.id === blockId && x.vehicleId === v.id && x.active);
      if (!b) return err(res, 404, 'BLOCK_NOT_FOUND', 'common.calendar.blockNotFound');
      b.active = false;
      return err(res, 200, 'BLOCK_REMOVED', 'common.calendar.blockRemoved');
    }
    if (req.method !== 'POST' || blockId !== undefined) {
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    }
    let startLocal;
    let endLocal;
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const time = /^\d{4}-\d{2}-\d{2}T\d{2}:(00|30)$/;
    if (day.test(String(body.from)) && day.test(String(body.to)) && body.to >= body.from) {
      const next = new Date(`${body.to}T00:00:00.000Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      startLocal = `${body.from}T00:00`;
      endLocal = `${next.toISOString().slice(0, 10)}T00:00`;
    } else if (
      time.test(String(body.start)) &&
      time.test(String(body.end)) &&
      body.end > body.start
    ) {
      startLocal = body.start;
      endLocal = body.end;
    } else {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: [{ field: 'from', reason: 'INVALID' }],
      });
    }
    if (!listed) return err(res, 409, 'VEHICLE_NOT_LISTED', 'common.calendar.notListed');
    if (
      h.blocks.some(
        (b) =>
          b.vehicleId === v.id && b.active && b.startLocal < endLocal && startLocal < b.endLocal,
      )
    ) {
      return err(res, 409, 'VEHICLE_UNAVAILABLE', 'common.calendar.vehicleUnavailable');
    }
    const id = uuid();
    h.blocks.push({ id, vehicleId: v.id, startLocal, endLocal, active: true });
    return json(res, 201, {
      code: 'BLOCK_CREATED',
      messageKey: 'common.calendar.blockCreated',
      blockId: id,
    });
  }
  // CGU de l'hôte (US-126) : version 1 BROUILLON ; acceptation de la version affichée
  const terms = /^\/host\/accounts\/([0-9a-f-]{36})\/terms(\/accept)?$/.exec(path);
  if (terms !== null) {
    const owner = hostOf(req);
    if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === terms[1]);
    if (h === undefined) {
      return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
    }
    let lang = languageOf(url);
    if (req.method === 'POST' && terms[2] !== undefined) {
      if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
        return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      const body = (await readBody(req)) ?? {};
      lang = LANGS.includes(String(body.locale).slice(0, 2))
        ? String(body.locale).slice(0, 2)
        : null;
      if (lang === null || !Number.isInteger(body.version)) {
        return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
      }
      if (body.version !== HOST_TERMS_VERSION) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
      h.terms = { acceptedVersion: HOST_TERMS_VERSION, acceptedAt: new Date().toISOString() };
    } else if (req.method !== 'GET' || terms[2] !== undefined) {
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    }
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    const pending = h.terms.acceptedVersion !== HOST_TERMS_VERSION;
    return json(res, 200, {
      code: pending ? 'TERMS_REACCEPT_REQUIRED' : 'TERMS_CURRENT',
      messageKey: pending ? 'common.legal.reacceptRequired' : 'common.legal.current',
      country: h.market.country,
      timeZone: 'UTC',
      document: hostTermsDoc(lang),
      requiredVersion: HOST_TERMS_VERSION,
      acceptedVersion: h.terms.acceptedVersion,
      acceptedAt: h.terms.acceptedAt,
      reacceptRequired: pending,
    });
  }
  const m =
    /^\/host\/accounts\/([0-9a-f-]{36})\/(locations|vehicles|listings)(?:\/([0-9a-f-]{36})(?:\/(pricing|submit|unlist|photos))?)?$/.exec(
      path,
    );
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === m[1]);
  if (h === undefined) {
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  }
  const [, , kind, id, step] = m;
  if (req.method === 'GET') {
    if (kind === 'locations') return json(res, 200, { locations: h.locations });
    if (kind === 'vehicles') return json(res, 200, { vehicles: h.vehicles });
    return json(res, 200, {
      listings: h.listings.filter((l) => l.status !== 'DELETED'),
      market: h.market,
      photoUploads: h.photoUploads,
    });
  }
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = (await readBody(req)) ?? {};
  const missing = (names) =>
    names.filter((n) => typeof body[n] !== 'string' || body[n].trim() === '');
  if (req.method === 'POST' && kind === 'locations' && id === undefined) {
    const fields = missing(['label', 'addressLine', 'city']);
    if (fields.length > 0) {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: fields.map((field) => ({ field, reason: 'REQUIRED' })),
      });
    }
    // zone qui ressemble à une adresse exacte (filtre de la base, BOARD N-62 ; modèle réduit)
    if (typeof body.areaLabel === 'string' && /[0-9]{3,}|\bcalle\s*[0-9]/i.test(body.areaLabel)) {
      return json(res, 422, {
        code: 'LOCATION_AREA_ADDRESS',
        messageKey: 'common.listing.areaLooksLikeAddress',
        fields: [{ field: 'areaLabel', reason: 'INVALID' }],
      });
    }
    const loc = {
      id: uuid(),
      kind: body.kind,
      label: body.label,
      addressLine: body.addressLine,
      city: body.city,
      areaLabel: body.areaLabel ?? null,
      lat: null,
      lng: null,
      timezone: 'UTC',
    };
    h.locations.push(loc);
    return json(res, 201, {
      code: 'LOCATION_CREATED',
      messageKey: 'common.listing.locationCreated',
      locationId: loc.id,
    });
  }
  if (req.method === 'POST' && kind === 'vehicles' && id === undefined) {
    const plate = String(body.plate ?? '')
      .replace(/[ .-]/g, '')
      .toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(plate)) {
      return json(res, 400, {
        code: 'REQUEST_INVALID',
        messageKey: 'common.auth.requestInvalid',
        fields: [{ field: 'plate', reason: 'INVALID' }],
      });
    }
    if (
      [...hosts.values()].some((x) =>
        x.accounts.some((a) => a.vehicles.some((v) => v.plate === plate)),
      )
    ) {
      return err(res, 409, 'VEHICLE_PLATE_DUPLICATE', 'common.listing.plateDuplicate');
    }
    const v = {
      id: uuid(),
      locationId: body.locationId,
      plate,
      vin: body.vin ?? null,
      variantId: null,
      makeText: body.makeText,
      modelText: body.modelText,
      year: body.year,
      trim: null,
      valueClass: null,
      transmission: body.transmission,
      seats: body.seats,
      fuelType: body.fuelType,
      odometerKm: null,
      gpsInstalled: false,
      lienDeclared: false,
      eligibilityStatus: 'PENDING',
      listingId: null,
      listingStatus: null,
    };
    h.vehicles.push(v);
    return json(res, 201, {
      code: 'VEHICLE_CREATED',
      messageKey: 'common.listing.vehicleCreated',
      vehicleId: v.id,
    });
  }
  if (req.method === 'POST' && kind === 'listings' && id === undefined) {
    const v = h.vehicles.find((x) => x.id === body.vehicleId);
    if (!v) return err(res, 404, 'VEHICLE_NOT_FOUND', 'common.listing.vehicleNotFound');
    if (!/^[1-9][0-9]*$/.test(String(body.dailyPriceMinor))) {
      return err(res, 422, 'PRICE_INVALID', 'common.listing.priceInvalid');
    }
    const l = {
      id: uuid(),
      vehicleId: v.id,
      status: 'DRAFT',
      dailyPriceMinor: body.dailyPriceMinor,
      currency: h.market.currency,
      mileageMode: body.mileageMode,
      includedKmPerDay: body.includedKmPerDay ?? null,
      extraKmPriceMinor: body.extraKmPriceMinor ?? null,
      instantBook: true,
      photos: 0,
      submittedAt: null,
    };
    h.listings.push(l);
    v.listingId = l.id;
    v.listingStatus = 'DRAFT';
    return json(res, 201, {
      code: 'LISTING_CREATED',
      messageKey: 'common.listing.created',
      listingId: l.id,
    });
  }
  const l = h.listings.find((x) => x.id === id);
  if (!l) return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
  if (req.method === 'PUT' && step === 'pricing') {
    if (!/^[1-9][0-9]*$/.test(String(body.dailyPriceMinor))) {
      return err(res, 422, 'PRICE_INVALID', 'common.listing.priceInvalid');
    }
    if (
      body.mileageMode === 'INCLUDED' &&
      !/^(0|[1-9][0-9]*)$/.test(String(body.extraKmPriceMinor))
    ) {
      return err(res, 422, 'MILEAGE_CONFIG_INVALID', 'common.listing.mileageInvalid');
    }
    l.dailyPriceMinor = body.dailyPriceMinor;
    l.mileageMode = body.mileageMode;
    l.includedKmPerDay = body.includedKmPerDay ?? null;
    l.extraKmPriceMinor = body.extraKmPriceMinor ?? null;
    return err(res, 200, 'LISTING_SAVED', 'common.listing.saved');
  }
  if (req.method === 'POST' && step === 'photos') {
    if (!h.photoUploads.open) {
      return err(res, 503, 'PHOTO_UPLOAD_UNAVAILABLE', 'common.listing.photoUnavailable');
    }
    if (Buffer.from(String(body.dataBase64 ?? ''), 'base64').length > h.photoUploads.maxBytes) {
      return err(res, 413, 'REQUEST_TOO_LARGE', 'common.error.server');
    }
    l.photos += 1;
    return err(res, 201, 'PHOTO_ADDED', 'common.listing.photoAdded');
  }
  if (req.method === 'POST' && step === 'submit') {
    if (!['DRAFT', 'REJECTED', 'UNLISTED'].includes(l.status)) {
      return err(res, 409, 'LISTING_TRANSITION_FORBIDDEN', 'common.listing.transitionForbidden');
    }
    if (l.photos < 6) return err(res, 422, 'PHOTO_MIN_COUNT', 'common.listing.photoMinCount');
    if (h.terms.acceptedVersion !== HOST_TERMS_VERSION) {
      return err(res, 409, 'TERMS_REACCEPT_REQUIRED', 'common.listing.hostTermsRequired');
    }
    // US-118 : le second compte du double tient lieu de compte activé dans un pays ouvert, au
    // véhicule confirmé et assuré : publié dès les contrôles automatiques (DEC-FONDATEUR-22)
    if (h.market !== MARKET_NO_DECIMALS) {
      return err(res, 422, 'HOST_NOT_ACTIVATED', 'common.listing.hostNotActivated');
    }
    l.status = 'LISTED';
    return json(res, 200, {
      code: 'LISTING_PUBLISHED',
      messageKey: 'common.listing.published',
      status: 'LISTED',
    });
  }
  if (req.method === 'POST' && step === 'unlist') {
    if (l.status !== 'LISTED') {
      return err(res, 409, 'LISTING_TRANSITION_FORBIDDEN', 'common.listing.transitionForbidden');
    }
    l.status = 'UNLISTED';
    return json(res, 200, {
      code: 'LISTING_UNLISTED',
      messageKey: 'common.listing.unlisted',
      status: 'UNLISTED',
    });
  }
  if (req.method === 'DELETE' && step === undefined) {
    l.status = 'DELETED';
    // l'annonce supprimée libère son véhicule (index unique partiel de 0067)
    const freed = h.vehicles.find((x) => x.id === l.vehicleId);
    if (freed) {
      freed.listingId = null;
      freed.listingStatus = null;
    }
    return json(res, 200, {
      code: 'LISTING_DELETED',
      messageKey: 'common.listing.deleted',
      status: 'DELETED',
    });
  }
  return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  if ((await checkoutRoute(req, res, path)) !== false) return;
  if ((await hostRoute(req, res, url)) !== false) return;
  if (req.method === 'GET' && path === '/__e2e/signups') return json(res, 200, signups);
  if (req.method === 'GET' && path === '/legal/documents') {
    const lang = languageOf(url);
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    if (url.searchParams.get('country') === UNKNOWN_COUNTRY) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    return json(res, 200, {
      documents: ['MARKETING', 'PRIVACY', 'TOS_GUEST'].map((k) => doc(k, lang)),
    });
  }
  const kind = /^\/legal\/documents\/([A-Z_]+)$/.exec(path)?.[1];
  if (req.method === 'GET' && kind !== undefined) {
    const lang = languageOf(url);
    if (lang === null) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    if (kind in CHECKOUT_DOCS && kind !== 'TOS_GUEST') {
      return json(res, 200, {
        ...checkoutDoc(kind, lang),
        bodyMd: `**${MARK[lang]}**

${CHECKOUT_TITLES[kind][lang]}`,
      });
    }
    if (kind === 'TOS_HOST') {
      return json(res, 200, {
        ...hostTermsDoc(lang),
        bodyMd: `**${MARK[lang]}**

${kind} ${lang}`,
      });
    }
    if (!(kind in VERSIONS))
      return err(res, 404, 'LEGAL_DOCUMENT_NOT_FOUND', 'common.legal.notFound');
    return json(res, 200, { ...doc(kind, lang), bodyMd: `**${MARK[lang]}**\n\n${kind} ${lang}` });
  }
  if (req.method === 'GET' && path === '/legal/consents') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, { ...statusOf(s.email), history: [] });
  }
  if (req.method === 'GET' && path === '/__e2e/identity/approve') {
    const i = identities.get(url.searchParams.get('email') ?? '');
    if (!i || i.status !== 'DOCS_SUBMITTED')
      return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
    i.status = 'APPROVED';
    return json(res, 200, { status: i.status });
  }
  // décision de l'ops (US-106) : état et motif posés comme par KYC_DECISION (dossier en revue)
  if (req.method === 'GET' && path === '/__e2e/identity/ops') {
    const i = identityOf(url.searchParams.get('email') ?? '');
    const status = url.searchParams.get('status');
    const reason = url.searchParams.get('reason');
    if (!['MANUAL_REVIEW', 'REJECTED', 'MORE_INFO_REQUIRED'].includes(status ?? ''))
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    i.status = status;
    i.reason = reason !== null && /^[A-Z_]{2,40}$/.test(reason) ? reason : null;
    return json(res, 200, { status: i.status });
  }
  if (req.method === 'GET' && path === '/identity') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    // langue préférée du compte : celle du parcours (identity-<langue>-<nom>@example.test)
    const lang = LANGS.find((l) => s.email.startsWith('identity-' + l + '-')) ?? 'es';
    return json(res, 200, identityView(identityOf(s.email), lang));
  }
  if (req.method === 'GET' && path === '/phone') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    return json(res, 200, phoneView(phoneState(s.email)));
  }
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = await readBody(req);
  if (body === null || typeof body !== 'object') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (path === '/auth/signup') {
    if (body.country === UNKNOWN_COUNTRY) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    if (body.termsAccepted !== true) {
      return err(res, 400, 'AUTH_TERMS_NOT_ACCEPTED', 'common.auth.termsNotAccepted');
    }
    if (typeof body.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
      return err(res, 400, 'AUTH_EMAIL_INVALID', 'common.auth.emailInvalid');
    }
    if (typeof body.password !== 'string' || [...body.password].length < PASSWORD_MIN) {
      return err(res, 400, 'AUTH_PASSWORD_WEAK', 'common.auth.passwordWeak', { min: PASSWORD_MIN });
    }
    if (!body.legalFirstName || !body.legalLastName) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const shown = body.acceptedDocuments ?? [];
    for (const k of ['TOS_GUEST', 'PRIVACY']) {
      const v = shown.find((d) => d.kind === k)?.version;
      if (shown.length > 0 && v !== VERSIONS[k]) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
    }
    const recorded = { ...body };
    delete recorded.password; // jamais conservé
    signups.push(recorded);
    if (!accounts.has(body.email)) {
      accounts.set(body.email, {
        password: body.password,
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    // même réponse que l'email soit libre ou pris (16 ACC-001)
    return err(res, 202, 'SIGNUP_ACCEPTED', 'common.auth.signupAccepted');
  }
  if (path === '/phone/otp') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const c = COUNTRIES.find((x) => x.code === body.country);
    if (!c) return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    const n = normalize(body.phone, body.country);
    if (n === null) {
      return err(res, 400, 'PHONE_INVALID', 'common.error.phoneDigits', {
        digits: c.nationalLength,
        example: c.example,
      });
    }
    const p = phoneState(s.email);
    if (p.locked) return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
    const masked = mask(n.e164, c);
    p.pending = { e164: n.e164, masked, resendAt: Date.now() + 60_000, attempts: 0 };
    return err(res, 202, 'OTP_SENT', 'common.otp.sent', {
      phone: masked,
      resendAfterS: 60,
      expiresInS: 600,
    });
  }
  if (path === '/phone/verify') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (typeof body.code !== 'string' || !/^[0-9]{6}$/.test(body.code)) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const p = phoneState(s.email);
    if (p.locked) return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
    if (p.pending === null) return err(res, 400, 'OTP_EXPIRED', 'common.otp.expired');
    if (body.code !== OTP_CODE) {
      p.pending.attempts += 1;
      if (p.pending.attempts >= OTP_MAX_ATTEMPTS) {
        p.locked = true;
        return err(res, 429, 'OTP_LOCKED', 'common.otp.locked', { minutes: 60 });
      }
      return err(res, 400, 'OTP_INVALID', 'common.otp.invalid', {
        attempts: OTP_MAX_ATTEMPTS - p.pending.attempts,
      });
    }
    p.verified = p.pending.masked;
    p.pending = null;
    return err(res, 200, 'PHONE_VERIFIED', 'common.otp.verified');
  }
  if (path === '/identity/consent') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (typeof body.accepted !== 'boolean') {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    if (body.accepted && body.version !== 1) {
      return err(res, 409, 'KYC_CONSENT_VERSION_CHANGED', 'common.kyc.consentVersionChanged');
    }
    const i = identityOf(s.email);
    i.consent = body.accepted ? 1 : null;
    // retrait : session effacée, dossier en RECHECK (ADR-102)
    if (!body.accepted && i.status !== 'NOT_STARTED') {
      i.status = 'RECHECK';
      i.session = null;
    }
    return json(res, 200, {
      code: 'KYC_CONSENT_RECORDED',
      messageKey: 'common.kyc.consentRecorded',
      version: 1,
    });
  }
  if (path === '/identity/verification') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const i = identityOf(s.email);
    if (i.consent !== 1) {
      return err(res, 403, 'KYC_BIOMETRIC_CONSENT_MISSING', 'common.kyc.consentMissing');
    }
    if (!COUNTRIES.some((c) => c.code === body.country)) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    if (i.status === 'APPROVED') {
      return err(res, 409, 'KYC_ALREADY_APPROVED', 'common.kyc.alreadyApproved');
    }
    const resumed = i.session !== null;
    if (!resumed) {
      identitySessions += 1;
      i.session = {
        country: body.country,
        url: `https://identity.fake.invalid/session/fk_idv_${String(identitySessions).padStart(6, '0')}`,
      };
    }
    i.status = 'DOCS_SUBMITTED';
    return json(res, resumed ? 200 : 201, {
      code: resumed ? 'KYC_SESSION_IN_PROGRESS' : 'KYC_SESSION_STARTED',
      messageKey: resumed ? 'common.kyc.sessionInProgress' : 'common.kyc.sessionStarted',
      hostedUrl: i.session.url,
      expiresAt: new Date(Date.now() + 1_800_000).toISOString(),
    });
  }
  if (path === '/auth/login') {
    if (
      typeof body.email === 'string' &&
      IDENTITY_ACCOUNT.test(body.email) &&
      !accounts.has(body.email)
    ) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    if (
      typeof body.email === 'string' &&
      PHONE_ACCOUNT.test(body.email) &&
      !accounts.has(body.email)
    ) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: VERSIONS.TOS_GUEST, PRIVACY: VERSIONS.PRIVACY },
      });
    }
    if (typeof body.email === 'string' && REACCEPT.test(body.email) && !accounts.has(body.email)) {
      accounts.set(body.email, {
        password: 'Correct-Horse-9',
        accepted: { TOS_GUEST: 1, PRIVACY: 1 },
      });
    }
    const a = accounts.get(body.email);
    if (!a || a.password !== body.password) {
      return err(res, 401, 'AUTH_INVALID_CREDENTIALS', 'common.auth.invalidCredentials');
    }
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { email: body.email });
    return json(
      res,
      200,
      { expiresAt: new Date(Date.now() + 1_209_600_000).toISOString() },
      {
        'set-cookie': `__Host-session=${token}; Max-Age=1209600; Path=/; HttpOnly; Secure; SameSite=Lax`,
      },
    );
  }
  if (path === '/auth/verify-email') {
    if (typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token)) {
      return err(res, 200, 'EMAIL_VERIFIED', 'common.auth.emailVerified');
    }
    return err(res, 400, 'AUTH_LINK_EXPIRED', 'common.auth.linkExpired');
  }
  if (path === '/legal/consents/accept') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const docs = Array.isArray(body.documents) ? body.documents : [];
    if (docs.length === 0) return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    for (const d of docs) {
      if (d.version !== VERSIONS[d.kind]) {
        return err(res, 409, 'TERMS_VERSION_CHANGED', 'common.legal.versionChanged');
      }
    }
    const a = accounts.get(s.email);
    for (const d of docs) a.accepted[d.kind] = d.version;
    const { documents, ...rest } = statusOf(s.email);
    return json(res, 200, { ...rest, documents });
  }
  return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
}).listen(PORT, '127.0.0.1');

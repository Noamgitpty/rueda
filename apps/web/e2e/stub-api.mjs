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
import { createHash, randomBytes } from 'node:crypto';
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
/** Jour « aujourd'hui » de la déclaration d'entrée : celui de l'horloge figée des e2e (FROZEN_AT). */
const ENTRY_TODAY = '2026-11-03';
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
// US-701c (T70 c) : fiche d'un véhicule dont la classe impose une caution sans montant décidé
// (LUXE, `deposit_amount` À DÉCIDER) ⇒ conditions « caution non disponible » (UNAVAILABLE) ; sans
// photo, couverte comme `PUBLIC_ID`. Aucune capture de référence ne l'ouvre.
const DEPOSIT_UNAVAILABLE_ID = '70100000-0000-4000-8000-00000000f006';
// US-223 (ouverture du mode sur demande, ADR-175) : fiche SUR DEMANDE (`instantBook: false`) d'un
// pays où le mode est ouvert (`requestMode`, délai de 4 h comme la graine 0125 / 22 OQ-P2P-10) ;
// sans photo, couverte comme `PUBLIC_ID`. Toutes les autres fiches et tous les devis rendent le
// mode FERMÉ, comme la base tant que `booking_request_mode_enabled` est faux.
const REQUEST_ID = '22300000-0000-4000-8000-00000000f007';
const REQUEST_EXPIRY_HOURS = 4;
const requestModeOf = (listingId) =>
  listingId === REQUEST_ID
    ? { enabled: true, expiryHours: REQUEST_EXPIRY_HOURS }
    : { enabled: false, expiryHours: null };
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
  // US-212b (N-346) : hôte de l'annonce en prénom et initiale (la fiche dit « Ana »)
  hostName: 'Ana P.',
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
  instantBook: q.listingId !== REQUEST_ID,
  requestMode: requestModeOf(q.listingId),
  documents: Object.keys(CHECKOUT_DOCS).map((kind) => ({
    kind,
    version: CHECKOUT_DOCS[kind],
    locale: q.lang,
    title: CHECKOUT_TITLES[kind][q.lang],
  })),
  // US-205b : distance figée (200 km par jour × jours facturables), annulation gratuite jusqu'à
  // départ − 24 h et retenue hors fenêtre (08 BR-CXL-06 : 1 jour au-delà de 2 jours, ½ sinon)
  mileage: { mode: 'INCLUDED', includedKm: KM_PER_DAY * q.days, extraKmPriceMinor: EXTRA_KM_MINOR },
  cancellation: {
    lastMinute: false,
    freeUntil: new Date(Date.parse(q.startAt) - FREE_CANCEL_LEAD_H * 3_600_000).toISOString(),
    lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN,
    endsAtStart: false,
  },
  lateCancellation: lateRetention(q),
});
/**
 * Retenue hors fenêtre du double (même règle que 08 BR-CXL-06, valeurs de forme) : j jours du
 * loyer, arrondis au plus proche, et la taxe de ce loyer au prorata ; protection remboursée.
 */
const lateRetention = (q) => {
  const half = q.days <= 2;
  // loyer × j / jours, arrondi au plus proche (moitié vers le haut) : j = 1 ou ½
  const retainedRent = half
    ? Math.floor((q.rent + q.days) / (2 * q.days))
    : Math.floor((2 * q.rent + q.days) / (2 * q.days));
  const refundedTax = Math.floor((2 * q.tax * (q.rent - retainedRent) + q.rent) / (2 * q.rent));
  return {
    penaltyDays: half ? '1/2' : '1',
    retainedMinor: String(retainedRent + q.tax - refundedTax),
  };
};
const holdJson = (h) => ({
  holdId: h.id,
  // paiement du hold (US-223b) : état posé par la route du paiement et les webhooks du double
  status: h.status ?? 'ACTIVE',
  expiresAt: h.expiresAt ?? HOLD_EXPIRES_AT,
  quoteId: h.quote.id,
  listingId: h.quote.listingId,
  currency: MARKET.currency,
  startAt: h.quote.startAt,
  endAt: h.quote.endAt,
  totalMinor: String(h.quote.rent + h.quote.tax + h.quote.protection),
  manualConfirmed: h.manual,
  // US-209c (ADR-144) : état de revue rendu par la base (0120)
  reviewState: h.review ?? 'NONE',
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
    if (![PUBLIC_ID, MANUAL_ID, REQUEST_ID].includes(b.listingId)) {
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
    // préfixe fixe (US-223b) : le numéro de réservation de S06 (8 premiers caractères) est stable
    // dans les captures ; le reste reste unique
    const h = {
      id: `${HOLD_ID_PREFIX}${uuid().slice(8)}`,
      quote: q,
      manual: q.listingId === MANUAL_ID,
      // US-223d : le 23, demande à l'hôte (hold REQUEST, voir « Demande à l'hôte » plus bas)
      ...(q.startAt.includes(REQUEST_DAY) ? { kind: 'REQUEST' } : {}),
    };
    // US-209c : réservation signalée (revue avant le débit, hold de revue de 120 min)
    if (q.startAt.includes(REVIEW_DAY)) {
      h.review = 'PENDING';
      h.expiresAt = REVIEW_EXPIRES_AT;
    }
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

// ---- Paiement du hold (US-223 partie 223b, ADR-142) -----------------------------------------
// `POST /checkout/holds/{id}/payment` : ordre créé (201, page hébergée `https://psp.fake.invalid/…`,
// jamais résolue : le test l'intercepte), hold « en vol » ; pendant un ordre actif, aucun nouvel
// ordre (200 avec l'état). Refus par jour de départ : le 18, capacité bloquante du PSP non validée
// (409 HOST_PAYOUT_RAIL_UNAVAILABLE) ; le 19, réservation en revue avant tout débit (409
// BOOKING_UNDER_REVIEW tant que la revue n'est pas décidée) ; le 21, aucun compte marchand (503
// PAYMENT_UNAVAILABLE). Aucun montant
// reçu : un champ autre que `method`, `mitConsent` et `locale` ⇒ 400 ; consentement MIT absent ⇒
// 422 MIT_CONSENT_REQUIRED (US-703). `GET …/payment` : état dérivé du hold et du trip né,
// comme l'API (jamais un statut d'opération). `GET /__e2e/payment/webhook?hold=&event=` joue le
// webhook FAKE signé et la conversion : SUCCEEDED (trip né ; après échéance : compensé), FAILED
// (refus, hold gardé), MISMATCH (montant reçu différent : rien n'est appliqué), EXPIRE (échéance) ;
// PAY met le hold « en vol » sans passer par le site (captures de S06) ; INTERRUPT : T1 passée sans
// ordre enregistré (PSP sans réponse), reprise possible par « Reintentar el pago ».
const PSP_PAGE = 'https://psp.fake.invalid/pay/';
const HOLD_ID_PREFIX = '22300000';
const TRIP_ID_PREFIX = '21300000';
const PAYMENT_REFUSALS = {
  '-12-18T': [409, 'HOST_PAYOUT_RAIL_UNAVAILABLE', 'common.payment.payoutRailUnavailable'],
  '-12-21T': [503, 'PAYMENT_UNAVAILABLE', 'common.payment.unavailable'],
};
// ---- Revue d'une réservation signalée (US-209 partie 209c, ADR-144) ---------------------------
// Le 19 décembre : hold de revue avant le débit (`reviewState` PENDING), échéance de la revue
// REVIEW_EXPIRES_AT (pose + 120 min) ; paiement refusé (409 BOOKING_UNDER_REVIEW) tant que la revue
// n'est pas décidée. `GET /__e2e/review?hold=&decision=` joue la décision de l'ops : APPROVED
// (`reviewed_at`, prolongation unique : échéance APPROVED_EXPIRES_AT, fenêtre de paiement),
// REJECTED (RELEASED / REVIEW_REJECTED) ou LAPSE (revue non faite dans le délai : même état).
const REVIEW_DAY = '-12-19T';
// ---- Caution de la plateforme (US-701, ADR-169) -----------------------------------------------
// Le 12 décembre : caution exigée mais impossible pour ces dates (T59) : vue `UNAVAILABLE` avec
// 3 jours possibles, paiement refusé (409 DEPOSIT_RAIL_UNAVAILABLE) avant tout ordre. Le 13 :
// caution exigée, blocage de 300,00 (T57, valeur de test) libéré au plus tard à fin + 72 h. Les
// autres jours : aucun champ `deposit` (forme d'US-223 inchangée).
const DEPOSIT_UNAVAILABLE_DAY = '-12-12T';
const DEPOSIT_REQUIRED_DAY = '-12-13T';
const DEPOSIT_RELEASE_DELAY_MS = 72 * 3_600_000;
const depositJson = (h) => {
  if (h.kind === 'REQUEST') return {};
  if (h.quote.startAt.includes(DEPOSIT_UNAVAILABLE_DAY)) {
    return { deposit: { status: 'UNAVAILABLE', maxBookableDays: 3 } };
  }
  if (h.quote.startAt.includes(DEPOSIT_REQUIRED_DAY)) {
    const releaseAt = new Date(Date.parse(h.quote.endAt) + DEPOSIT_RELEASE_DELAY_MS).toISOString();
    return {
      deposit: {
        status: 'REQUIRED',
        amountMinor: '30000',
        currency: MARKET.currency,
        kind: 'HOLD',
        releaseAt,
      },
    };
  }
  return {};
};
const REVIEW_EXPIRES_AT = '2036-11-30T17:00:00.000Z';
const APPROVED_EXPIRES_AT = '2036-11-30T15:40:00.000Z';
const PAYMENT_IN_FLIGHT_UNTIL = '2036-11-30T15:16:00.000Z';
// ---- Demande à l'hôte (US-223 partie 223d ; mode REQUEST de 223c, ADR-146) -------------------
// Le 23 décembre : hold de DEMANDE (`kind` REQUEST). Depuis l'ouverture du mode (US-223,
// ADR-175), `request-mode.spec.ts` pose la demande par la fiche sur demande `REQUEST_ID` (S03 →
// S05) ; les captures de `screens.spec.ts` la posent encore depuis le checkout de `PUBLIC_ID`. Événements de
// `GET /__e2e/payment/webhook` sur une demande : PAY (autorisation en vol), SUCCEEDED (autorisation
// prouvée ⇒ AWAITING_HOST, heure limite REQUEST_RESPOND_BY ; après l'acceptation : capture prouvée
// ⇒ trip né), FAILED (capture refusée ⇒ RELEASED / PAYMENT_DECLINED), EXPIRE (heure limite passée
// ⇒ EXPIRED), DECLINE (refus de l'hôte joué sans A05, captures du voyageur).
// `GET /__e2e/request/assign?hold=&host=<jeton>&refuse=` rattache la demande au premier
// compte de l'hôte (refus forcé de l'acceptation : REQUEST_EXPIRED, PAYMENT_UNAVAILABLE).
// État de la demande calculé comme `core.booking_checkout_request` (0126).
const REQUEST_DAY = '-12-23T';
const REQUEST_RESPOND_BY = '2036-11-30T19:10:00.000Z';
const REQUEST_ENDED = ['DECLINED', 'EXPIRED', 'CAPTURE_FAILED', 'ENDED'];
const requestStatusOf = (h) => {
  const status = h.status ?? 'ACTIVE';
  if (status === 'AWAITING_HOST') return 'AWAITING_HOST';
  if (h.respondBy === undefined) {
    return status === 'ACTIVE' || status === 'PAYMENT_IN_FLIGHT' ? 'AUTHORIZING' : 'ENDED';
  }
  if (status === 'PAYMENT_IN_FLIGHT') return 'CAPTURING';
  if (status === 'CONVERTED') return 'ACCEPTED';
  if (status === 'RELEASED' && h.reason === 'REQUEST_DECLINED') return 'DECLINED';
  if (status === 'RELEASED' && h.reason === 'PAYMENT_DECLINED') return 'CAPTURE_FAILED';
  if (status === 'EXPIRED') return 'EXPIRED';
  if (status === 'COMPENSATED') return 'COMPENSATED';
  return 'ENDED';
};
const paymentStateOf = (h) => {
  const status = h.status ?? 'ACTIVE';
  // comme `paymentStateOf` de l'API (US-223c) : demande terminée ⇒ ENDED ; attente ⇒ VERIFYING
  if (h.kind === 'REQUEST' && REQUEST_ENDED.includes(requestStatusOf(h))) return 'ENDED';
  if (status === 'AWAITING_HOST') return 'VERIFYING';
  if (status === 'CONVERTED') return h.tripId ? 'CONFIRMED' : 'VERIFYING';
  if (status === 'PAYMENT_IN_FLIGHT') return h.op === 'PENDING' ? 'INTERRUPTED' : 'VERIFYING';
  if (status === 'ACTIVE') return !h.op ? 'PAYABLE' : h.op === 'FAILED' ? 'DECLINED' : 'VERIFYING';
  if (status === 'COMPENSATED') return 'REFUND_DUE';
  return !h.op || h.op === 'FAILED' ? 'ENDED' : 'UNPROVEN';
};
// US-703 (ADR-189 n° 15, DEC-FONDATEUR-22) : forme du consentement MIT du pays rendue pour un hold
// payable : mention au bouton (NOTICE, défaut comme Turo) ; le 16 décembre, case séparée
// obligatoire (CHECKBOX : pays dont `mit_consent_checkbox_required` vaut vrai) ; le 11, paramètre
// du pays absent (BLOCKED, fail_mode BLOCK : aucun paiement offert).
const MIT_CHECKBOX_DAY = '-12-16T';
const MIT_BLOCKED_DAY = '-12-11T';
const mitModeOf = (h) =>
  h.quote.startAt.includes(MIT_CHECKBOX_DAY)
    ? 'CHECKBOX'
    : h.quote.startAt.includes(MIT_BLOCKED_DAY)
      ? 'BLOCKED'
      : 'NOTICE';
const mitConsentJson = (h) =>
  ['PAYABLE', 'DECLINED', 'INTERRUPTED'].includes(paymentStateOf(h))
    ? { mitConsent: { mode: mitModeOf(h) } }
    : {};
const paymentJson = (h, redirectUrl) => ({
  holdId: h.id,
  state: paymentStateOf(h),
  holdStatus: h.status ?? 'ACTIVE',
  tripId: h.tripId ?? null,
  expiresAt: h.expiresAt ?? HOLD_EXPIRES_AT,
  paymentInFlightUntil: h.status === 'PAYMENT_IN_FLIGHT' ? PAYMENT_IN_FLIGHT_UNTIL : null,
  ...(redirectUrl === undefined ? {} : { redirectUrl }),
  ...(h.kind === 'REQUEST'
    ? { request: { status: requestStatusOf(h), respondBy: h.respondBy ?? null } }
    : {}),
  ...depositJson(h),
  ...mitConsentJson(h),
});

async function paymentRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/review') {
    const h = holds.get(url.searchParams.get('hold') ?? '');
    if (h === undefined || h.review !== 'PENDING' || (h.status ?? 'ACTIVE') !== 'ACTIVE') {
      return err(res, 409, 'INVALID_TRANSITION', 'common.error.notFound');
    }
    const decision = url.searchParams.get('decision');
    if (decision === 'APPROVED') {
      h.review = 'APPROVED';
      h.expiresAt = APPROVED_EXPIRES_AT;
    } else if (decision === 'REJECTED' || decision === 'LAPSE') {
      h.review = 'REJECTED';
      h.status = 'RELEASED';
    } else {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    return json(res, 200, { hold: holdJson(h) });
  }
  if (req.method === 'GET' && path === '/__e2e/payment/webhook') {
    const h = holds.get(url.searchParams.get('hold') ?? '');
    if (h === undefined) return err(res, 404, 'HOLD_NOT_FOUND', 'common.checkout.holdNotFound');
    const event = url.searchParams.get('event');
    const status = h.status ?? 'ACTIVE';
    const state = paymentStateOf(h);
    if (event === 'PAY' && (state === 'PAYABLE' || state === 'DECLINED')) {
      // ordre créé et enregistré (T1, createHostedPayment, T2), sans passer par le site
      h.status = 'PAYMENT_IN_FLIGHT';
      h.op = 'SUBMITTED';
    } else if (event === 'INTERRUPT' && (state === 'PAYABLE' || state === 'DECLINED')) {
      // T1 passée, PSP sans réponse avant T2 : opération PENDING sans référence
      h.status = 'PAYMENT_IN_FLIGHT';
      h.op = 'PENDING';
    } else if (
      event === 'SUCCEEDED' &&
      h.kind === 'REQUEST' &&
      status === 'PAYMENT_IN_FLIGHT' &&
      h.respondBy === undefined
    ) {
      // demande : autorisation prouvée (rien n'est capturé), l'hôte a jusqu'à l'heure limite
      h.status = 'AWAITING_HOST';
      h.op = 'SUCCEEDED';
      h.respondBy = REQUEST_RESPOND_BY;
      h.expiresAt = REQUEST_RESPOND_BY;
    } else if (
      event === 'FAILED' &&
      h.kind === 'REQUEST' &&
      status === 'PAYMENT_IN_FLIGHT' &&
      h.respondBy !== undefined
    ) {
      // demande acceptée : capture refusée ⇒ demande terminée, autorisation annulée (VOID)
      h.status = 'RELEASED';
      h.reason = 'PAYMENT_DECLINED';
    } else if (event === 'EXPIRE' && status === 'AWAITING_HOST') {
      h.status = 'EXPIRED';
    } else if (event === 'DECLINE' && status === 'AWAITING_HOST') {
      // refus de l'hôte joué sans passer par A05 (captures du voyageur)
      h.status = 'RELEASED';
      h.reason = 'REQUEST_DECLINED';
    } else if (event === 'SUCCEEDED' && status === 'PAYMENT_IN_FLIGHT') {
      h.status = 'CONVERTED';
      h.op = 'SUCCEEDED';
      // préfixe fixe (US-213) : S06 confirmé montre le numéro du trip (8 premiers caractères),
      // stable dans les captures ; le reste reste unique
      h.tripId = `${TRIP_ID_PREFIX}${uuid().slice(8)}`;
      // contrat de location du trip né (US-211 partie 211b), partie : le voyageur du hold
      newContract(
        h.tripId,
        h.quote.token,
        null,
        guestOf({ headers: { cookie: `__Host-session=${h.quote.token}` } })?.lang ?? 'es',
      );
    } else if (event === 'SUCCEEDED' && status === 'EXPIRED') {
      // payé après la libération du créneau : compensation (remboursement intégral)
      h.status = 'COMPENSATED';
      h.op = 'SUCCEEDED';
    } else if (event === 'FAILED' && status === 'PAYMENT_IN_FLIGHT') {
      h.status = 'ACTIVE';
      h.op = 'FAILED';
    } else if (event === 'EXPIRE' && (status === 'ACTIVE' || status === 'PAYMENT_IN_FLIGHT')) {
      h.status = 'EXPIRED';
    } else if (event !== 'MISMATCH') {
      return err(res, 409, 'INVALID_TRANSITION', 'common.error.notFound');
    }
    return json(res, 200, { payment: paymentJson(h) });
  }
  const id = /^\/checkout\/holds\/([0-9a-f-]{36})\/payment$/.exec(path)?.[1];
  if (id === undefined) return false;
  const guest = guestOf(req);
  if (guest === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = holds.get(id);
  if (h === undefined || h.quote.token !== guest.token) {
    return err(res, 404, 'HOLD_NOT_FOUND', 'common.checkout.holdNotFound');
  }
  if (req.method === 'GET') return json(res, 200, { payment: paymentJson(h) });
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  const b = await readBody(req);
  // US-703 : le consentement MIT du checkout (case S05) et la langue du texte, comme l'API
  const PAY_KEYS = ['method', 'mitConsent', 'locale'];
  if (b !== null && (typeof b !== 'object' || Object.keys(b).some((k) => !PAY_KEYS.includes(k)))) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (b !== null && b.mitConsent === true && typeof b.locale !== 'string') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (b === null || b.mitConsent !== true) {
    return err(res, 422, 'MIT_CONSENT_REQUIRED', 'common.payment.mitConsentRequired');
  }
  const state = paymentStateOf(h);
  // INTERRUPTED : reprise sous la même clé (le PSP du double ne trouve aucun ordre : il le crée)
  if (state !== 'PAYABLE' && state !== 'DECLINED' && state !== 'INTERRUPTED') {
    return json(res, 200, { payment: paymentJson(h, null) });
  }
  // revue avant le débit pas encore décidée : aucune intention de paiement (UXQ-08)
  if (h.review === 'PENDING') {
    return err(res, 409, 'BOOKING_UNDER_REVIEW', 'common.payment.underReview');
  }
  // US-701 : caution décidée avant le paiement ; impossible ⇒ aucun ordre
  if (h.quote.startAt.includes(DEPOSIT_UNAVAILABLE_DAY)) {
    return err(res, 409, 'DEPOSIT_RAIL_UNAVAILABLE', 'common.payment.depositUnavailable');
  }
  const refusal = Object.entries(PAYMENT_REFUSALS).find(([day]) => h.quote.startAt.includes(day));
  if (refusal !== undefined) return err(res, refusal[1][0], refusal[1][1], refusal[1][2]);
  h.status = 'PAYMENT_IN_FLIGHT';
  h.op = 'SUBMITTED';
  return json(res, 201, { payment: paymentJson(h, `${PSP_PAGE}${h.id}`) });
}

// ---- Demandes de l'hôte (routes de 223c, ADR-146 §10 ; écrans de 223d) -------------------------
// `GET /host/accounts/{orgId}/requests[/{holdId}]` : demandes rattachées au compte (`/__e2e/request/
// assign`), en attente ou acceptées dont la capture attend sa preuve ; `POST …/accept` : capture
// demandée (CAPTURING), sauf refus forcé ; `POST …/decline` : RELEASED (REQUEST_DECLINED). Compte
// d'un autre hôte, demande inconnue ou sortie de l'attente ⇒ 404 REQUEST_NOT_FOUND (même réponse).
// Montants en unités mineures (chaînes), jambe HOST de forme (3/4 du loyer), devise du marché.
const hostRequestJson = (h) => ({
  holdId: h.id,
  status: h.status === 'AWAITING_HOST' ? 'AWAITING_HOST' : 'CAPTURING',
  vehicleId: h.requestVehicleId,
  scheduledStart: h.quote.startAt,
  scheduledEnd: h.quote.endAt,
  timezone: 'UTC',
  respondBy: h.respondBy,
  currency: MARKET.currency,
  totalMinor: String(h.quote.rent + h.quote.tax + h.quote.protection),
  hostLegMinor: String(Math.floor((h.quote.rent * 3) / 4)),
  guest: { firstName: 'Lucía', ageYears: 29, rating: 4.8, verified: true },
});
const openRequest = (h) =>
  h.kind === 'REQUEST' &&
  (h.status === 'AWAITING_HOST' || (h.status === 'PAYMENT_IN_FLIGHT' && h.respondBy !== undefined));

async function hostRequestRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/request/assign') {
    const h = holds.get(url.searchParams.get('hold') ?? '');
    const owner = hosts.get(url.searchParams.get('host') ?? '');
    if (h === undefined || h.kind !== 'REQUEST' || owner === undefined) {
      return err(res, 404, 'REQUEST_NOT_FOUND', 'common.request.notFound');
    }
    const a = owner.accounts[0];
    h.requestOrg = a.orgId;
    h.requestVehicleId = a.vehicles[0]?.id ?? uuid();
    h.refuse = url.searchParams.get('refuse') ?? undefined;
    return json(res, 200, { orgId: a.orgId });
  }
  const m =
    /^\/host\/accounts\/([0-9a-f-]{36})\/requests(?:\/([0-9a-f-]{36})(?:\/(accept|decline))?)?$/.exec(
      path,
    );
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const a = owner === null ? undefined : owner.accounts.find((x) => x.orgId === m[1]);
  const notFound = () => err(res, 404, 'REQUEST_NOT_FOUND', 'common.request.notFound');
  if (a === undefined) return notFound();
  const mine = [...holds.values()].filter((h) => h.requestOrg === a.orgId && openRequest(h));
  const [, , holdId, verb] = m;
  if (holdId === undefined) {
    if (req.method !== 'GET') return notFound();
    return json(res, 200, { requests: mine.map(hostRequestJson) });
  }
  const h = mine.find((x) => x.id === holdId);
  if (h === undefined) return notFound();
  if (verb === undefined) {
    if (req.method !== 'GET') return notFound();
    return json(res, 200, { request: hostRequestJson(h) });
  }
  if (req.method !== 'POST') return notFound();
  if (h.status !== 'AWAITING_HOST') {
    return err(res, 409, 'INVALID_TRANSITION', 'common.request.alreadyAnswered');
  }
  if (verb === 'decline') {
    h.status = 'RELEASED';
    h.reason = 'REQUEST_DECLINED';
    return json(res, 200, { decision: { holdId: h.id, status: 'DECLINED' } });
  }
  if (h.refuse === 'REQUEST_EXPIRED') {
    return err(res, 409, 'REQUEST_EXPIRED', 'common.request.expired');
  }
  if (h.refuse === 'PAYMENT_UNAVAILABLE') {
    return err(res, 503, 'PAYMENT_UNAVAILABLE', 'common.request.paymentUnavailable');
  }
  h.status = 'PAYMENT_IN_FLIGHT';
  h.op = 'SUBMITTED';
  return json(res, 200, { decision: { holdId: h.id, status: 'CAPTURING' } });
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

// ---- Compte de versement de l'hôte (US-707) ---------------------------------------------------
// Double : deux rails NEUTRES (aucun format ni établissement propre à un pays) : compte bancaire
// à code d'établissement saisi (`[0-9A-Z]{2,12}`), portefeuille parmi deux codes fictifs ; numéro
// de compte : 6 à 20 chiffres (espaces et tirets retirés), sinon 422 PAYOUT_ACCOUNT_INVALID.
// Numéro fiscal exigé : type enregistré par le profil fiscal A07 (sinon `taxKind` null et 409
// HOST_TAX_ID_REQUIRED). Règle déterministe du titulaire discordant : noms du titulaire contenant
// « OTRO » (casse ignorée) ⇒ 422 PAYOUT_HOLDER_MISMATCH, rien n'est enregistré. Le prestataire du
// double vérifie tout autre compte (VERIFIED) ; un CHANGEMENT de compte retient les versements
// 48 h (`holdUntil`). Le double ne garde que les 4 derniers chiffres, jamais le numéro.
const PAYOUT_RAILS = [
  { kind: 'BANK_ACCOUNT', institutions: null },
  { kind: 'WALLET', institutions: ['WALLET_A', 'WALLET_B'] },
];
const PAYOUT_HOLD_MS = 48 * 3_600_000;
const payoutView = (h, code, messageKey) => ({
  code,
  messageKey,
  country: h.market.country,
  currency: h.market.currency,
  rails: PAYOUT_RAILS,
  taxKind: verificationOf(h).taxKind,
  account: h.payoutAccount ?? null,
});

async function payoutRoute(req, res, path) {
  const m = /^\/host\/accounts\/([0-9a-f-]{36})\/payout-account$/.exec(path);
  if (m === null) return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const h = owner === null ? undefined : owner.accounts.find((a) => a.orgId === m[1]);
  if (h === undefined)
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  if (req.method === 'GET') {
    return json(res, 200, payoutView(h, 'PAYOUT_ACCOUNT_STATE', 'common.payoutAccount.state'));
  }
  if (req.method !== 'POST') return err(res, 404, 'NOT_FOUND', 'common.error.notFound');
  if (!/^application\/json/.test(req.headers['content-type'] ?? '')) {
    return err(res, 415, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const body = (await readBody(req)) ?? {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const rail = PAYOUT_RAILS.find((r) => r.kind === body.kind);
  const institution = str(body.institution).toUpperCase();
  const given = str(body.holderGivenNames);
  const surnames = str(body.holderSurnames);
  const taxId = str(body.holderTaxId);
  if (given === '' || surnames === '' || taxId === '') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (
    rail === undefined ||
    (rail.institutions === null
      ? !/^[0-9A-Z]{2,12}$/.test(institution)
      : !rail.institutions.includes(institution))
  ) {
    return err(res, 422, 'PAYOUT_RAIL_UNSUPPORTED', 'common.payoutAccount.railUnsupported');
  }
  const number = str(body.accountNumber).replace(/[\s-]/g, '');
  if (!/^[0-9]{6,20}$/.test(number)) {
    return err(res, 422, 'PAYOUT_ACCOUNT_INVALID', 'common.payoutAccount.invalid');
  }
  if (verificationOf(h).taxKind === null) {
    return err(res, 409, 'HOST_TAX_ID_REQUIRED', 'common.payoutAccount.taxRequired');
  }
  if (/otro/i.test(`${given} ${surnames}`)) {
    return err(res, 422, 'PAYOUT_HOLDER_MISMATCH', 'common.payoutAccount.holderMismatch');
  }
  const change = h.payoutAccount !== undefined && h.payoutAccount !== null;
  h.payoutAccount = {
    status: 'VERIFIED',
    kind: rail.kind,
    institution,
    last4: number.slice(-4),
    holdUntil: change ? new Date(Date.now() + PAYOUT_HOLD_MS).toISOString() : null,
    rejectReason: null,
  };
  return json(res, 200, payoutView(h, 'PAYOUT_ACCOUNT_SAVED', 'common.payoutAccount.saved'));
}

async function hostRoute(req, res, url) {
  const path = url.pathname;
  if ((await verificationRoute(req, res, path)) !== false) return true;
  if ((await payoutRoute(req, res, path)) !== false) return true;
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
      // US-701c : mention générique, sauf la LUXE ci-dessous (montant)
      depositStatus: 'GENERIC',
      rating: null,
      // US-205b : la base promet la protection de l'assureur (mention « protección incluida »)
      protectionOffered: true,
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
              depositStatus: 'REQUIRED',
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
    if (![PUBLIC_ID, MANUAL_ID, NO_COVER_ID, DEPOSIT_UNAVAILABLE_ID, REQUEST_ID].includes(avail)) {
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
        // US-205b : en dernière minute, freeUntil = min(maintenant + fenêtre, départ) de la base
        // (ici réservé 20 h avant : départ − 19 h), départ après la fin de la fenêtre
        cancellation: start.endsWith(LAST_MINUTE_TIME)
          ? {
              lastMinute: true,
              freeUntil: new Date(Date.parse(`${start}:00Z`) - 19 * 3_600_000).toISOString(),
              lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN,
              endsAtStart: false,
            }
          : {
              lastMinute: false,
              freeUntil: new Date(
                Date.parse(`${start}:00Z`) - FREE_CANCEL_LEAD_H * 3_600_000,
              ).toISOString(),
              lastMinuteWindowMinutes: LAST_MINUTE_WINDOW_MIN,
              endsAtStart: false,
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
    if (![PUBLIC_ID, MANUAL_ID, NO_COVER_ID, DEPOSIT_UNAVAILABLE_ID, REQUEST_ID].includes(cond)) {
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
        // US-701c : caution non disponible pour la classe de cette fiche, sinon mention générique
        depositStatus: cond === DEPOSIT_UNAVAILABLE_ID ? 'UNAVAILABLE' : 'GENERIC',
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
    if (![PUBLIC_ID, MANUAL_ID, NO_COVER_ID, DEPOSIT_UNAVAILABLE_ID, REQUEST_ID].includes(pub)) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    const manual = pub === MANUAL_ID;
    const bare =
      manual || pub === NO_COVER_ID || pub === DEPOSIT_UNAVAILABLE_ID || pub === REQUEST_ID;
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
        instantBook: pub !== REQUEST_ID,
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
        requestMode: requestModeOf(pub),
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
      // contrat du trip à venir (US-211 partie 211b), partie : l'hôte de la session
      newContract(ids[0], null, tokenOf(req), 'es');
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

// ---- Contrat de location d'un trip (US-211 partie 211b) : lecture, PDF, signature -------------
// Un contrat naît avec le trip : celui du voyageur au webhook SUCCEEDED (session `G0st…` du hold,
// courtoisie dans sa langue, l'anglais pour l'espagnol), celui de l'hôte pour chaque trip à venir
// de ses autos (session `H0st…`, voyageur fictif). Lecture : la seule partie de la session ; toute
// autre session ⇒ 404 CONTRACT_NOT_FOUND (comme l'API). Texte fictif, BROUILLON, faits fixes
// (captures stables) ; empreinte = SHA-256 du PDF fictif de la version. `GET /__e2e/contract/
// regenerate?trip=` crée la version suivante (critère 2) ; `GET /__e2e/contract/sign?trip=` signe
// au nom du voyageur (vue de l'hôte). Heure de signature et sceau fixes.
const contracts = new Map();
const CONTRACT_SIGNED_AT = '2036-11-30T15:20:00.000Z';
const CONTRACT_SEAL = 'c'.repeat(64);
const COURTESY = { es: 'en', en: 'en', fr: 'fr', pt: 'pt' };
const CONTRACT_COUNTRY = COUNTRIES[0].code;
// octets indépendants du trip : empreinte affichée identique d'une exécution à l'autre (captures)
const contractPdf = (_tripId, version, signed) =>
  Buffer.from(`%PDF-1.4\n% contrat fictif v${version}${signed ? ' signé' : ''}\n%%EOF\n`, 'latin1');
const sha256hex = (b) => createHash('sha256').update(b).digest('hex');
const newContract = (tripId, guest, host, lang) => {
  if (contracts.has(tripId)) return;
  contracts.set(tripId, {
    guest,
    host,
    courtesy: COURTESY[lang] ?? 'en',
    status: 'BOOKED',
    docs: [{ id: uuid(), sha256: sha256hex(contractPdf(tripId, 1, false)), signature: null }],
  });
};
const contractLines = (lang, version, sig) => {
  const t = {
    es: [
      'Contrato de alquiler de vehículo entre particulares',
      'Partes',
      'Anfitrión: María G., propietaria del vehículo',
      'Conductor (viajero): Lucía G.',
      'Cláusulas',
      '1. Partes. El anfitrión alquila al viajero un vehículo propio.',
      'Firma electrónica del viajero',
      'Firma: Lucía G.',
      'Fecha y hora del servidor (UTC)',
      'Sello',
    ],
    en: [
      'Peer-to-peer vehicle rental agreement',
      'Parties',
      'Host: María G., owner of the vehicle',
      'Driver (guest): Lucía G.',
      'Clauses',
      '1. Parties. The host rents to the guest a vehicle they own.',
      'Guest electronic signature',
      'Signature: Lucía G.',
      'Server date and time (UTC)',
      'Seal',
    ],
    fr: [
      'Contrat de location de véhicule entre particuliers',
      'Parties',
      'Hôte : María G., propriétaire du véhicule',
      'Conducteur (voyageur) : Lucía G.',
      'Clauses',
      '1. Parties. L’hôte loue au voyageur un véhicule qui lui appartient.',
      'Signature électronique du voyageur',
      'Signature : Lucía G.',
      'Date et heure du serveur (UTC)',
      'Sceau',
    ],
    pt: [
      'Contrato de aluguel de veículo entre particulares',
      'Partes',
      'Anfitrião: María G., proprietária do veículo',
      'Condutor (viajante): Lucía G.',
      'Cláusulas',
      '1. Partes. O anfitrião aluga ao viajante um veículo próprio.',
      'Assinatura eletrônica do viajante',
      'Assinatura: Lucía G.',
      'Data e hora do servidor (UTC)',
      'Selo',
    ],
  }[lang];
  return [
    { style: 'title', text: t[0] },
    { style: 'note', text: MARK[lang] },
    { style: 'kv', text: `KM-2110 v${version}` },
    { style: 'h', text: t[1] },
    { style: 'kv', text: t[2] },
    { style: 'kv', text: t[3] },
    { style: 'h', text: t[4] },
    { style: 'p', text: t[5] },
    { style: 'h', text: t[6] },
    { style: 'kv', text: t[7] },
    { style: 'sig', text: `${t[8]}: ${sig === null ? '-' : '2036-11-30 15:20:00 UTC'}` },
    { style: 'sig', text: `${t[9]}: ${sig === null ? '-' : CONTRACT_SEAL}` },
  ];
};
const contractView = (tripId, c, role, d, n) => ({
  tripId,
  viewerRole: role,
  documentId: d.id,
  version: n,
  latestVersion: c.docs.length,
  courtesyLocale: c.courtesy,
  generatedAt: '2036-11-30T15:15:00.000Z',
  sha256: d.sha256,
  renderer: 'ctr.pdf/1',
  draft: true,
  summary: {
    tripRef: 'KM-2110',
    country: CONTRACT_COUNTRY,
    currency: 'XXX',
    currencyExponent: 0,
    timezone: 'UTC',
    startLocal: '2036-12-10 10:00',
    endLocal: '2036-12-13 10:00',
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2021 },
    hostCapacity: 'OWNER',
    priceTotalMinor: '128400',
    protection: { level: 'BASICA', deductibleMinor: '500000', insurer: 'Aseguradora ficticia' },
    depositMinor: '250000',
    mileage: { mode: 'INCLUDED', includedKm: 600, extraKmPriceMinor: '350' },
    lateGraceMinutes: 30,
    cancellation: { freeUntilLocal: '2036-12-09 10:00', penaltyDays: '1', retainedMinor: '42800' },
  },
  parts: [
    { lang: 'es', authoritative: true, lines: contractLines('es', n, d.signature) },
    { lang: c.courtesy, authoritative: false, lines: contractLines(c.courtesy, n, d.signature) },
  ],
  signature:
    d.signature === null ? null : { signedAt: CONTRACT_SIGNED_AT, sealSha256: CONTRACT_SEAL },
  signable: role === 'GUEST' && n === c.docs.length && d.signature === null,
});
const signDoc = (d) => {
  d.signature ??= { signedAt: CONTRACT_SIGNED_AT, sealSha256: CONTRACT_SEAL };
};

async function contractRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/contract/regenerate') {
    const tripId = url.searchParams.get('trip') ?? '';
    const c = contracts.get(tripId);
    if (c === undefined) return err(res, 404, 'CONTRACT_NOT_FOUND', 'common.contract.notFound');
    const n = c.docs.length + 1;
    c.docs.push({ id: uuid(), sha256: sha256hex(contractPdf(tripId, n, false)), signature: null });
    return json(res, 200, { version: n });
  }
  if (req.method === 'GET' && path === '/__e2e/contract/sign') {
    const c = contracts.get(url.searchParams.get('trip') ?? '');
    if (c === undefined) return err(res, 404, 'CONTRACT_NOT_FOUND', 'common.contract.notFound');
    signDoc(c.docs[c.docs.length - 1]);
    return json(res, 200, {});
  }
  const m = /^\/trips\/([^/]+)\/contract(\/pdf|\/sign)?$/.exec(path);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const c = contracts.get(m[1]);
  const role =
    c === undefined ? null : token === c.guest ? 'GUEST' : token === c.host ? 'HOST' : null;
  if (c === undefined || role === null) {
    return err(res, 404, 'CONTRACT_NOT_FOUND', 'common.contract.notFound');
  }
  if (m[2] === '/sign' && req.method === 'POST') {
    const b = (await readBody(req)) ?? {};
    if (
      b.accepted !== true ||
      typeof b.documentId !== 'string' ||
      typeof b.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(b.sha256)
    ) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const i = c.docs.findIndex((d) => d.id === b.documentId);
    if (role !== 'GUEST' || i < 0) {
      return err(res, 404, 'CONTRACT_NOT_FOUND', 'common.contract.notFound');
    }
    const d = c.docs[i];
    if (d.signature === null && i !== c.docs.length - 1) {
      return err(res, 409, 'CONTRACT_SUPERSEDED', 'common.contract.superseded');
    }
    if (d.signature === null && b.sha256 !== d.sha256) {
      return err(res, 409, 'CONTRACT_HASH_MISMATCH', 'common.contract.hashMismatch');
    }
    const outcome = d.signature === null ? 'SIGNED' : 'ALREADY_SIGNED';
    signDoc(d);
    return json(res, 200, { outcome, ...d.signature });
  }
  if (req.method !== 'GET' || m[2] === '/sign') return false;
  const raw = url.searchParams.get('version');
  if (raw !== null && !/^[1-9][0-9]{0,3}$/.test(raw)) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const n = raw === null ? c.docs.length : Number(raw);
  const d = c.docs[n - 1];
  if (d === undefined) return err(res, 404, 'CONTRACT_NOT_FOUND', 'common.contract.notFound');
  if (m[2] === '/pdf') {
    const bytes = contractPdf(m[1], n, d.signature !== null);
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="contract-KM-2110-v${n}${d.signature === null ? '' : '-signed'}.pdf"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-contract-sha256': sha256hex(bytes),
    });
    res.end(bytes);
    return true;
  }
  return json(res, 200, contractView(m[1], c, role, d, n));
}

// ---- Constancia d'arrendamiento d'un trip (US-212) : lecture, PDF, recherche de l'hôte ---------
// La partie est celle du contrat du trip (voyageur du hold, hôte de ses autos) ; toute autre
// session ⇒ 404 CONSTANCIA_NOT_FOUND (comme l'API). Faits fixes du contrat fictif (captures
// stables), langue du lecteur = courtoisie du contrat ; empreinte = SHA-256 du PDF fictif. La
// recherche (corps : plaque, date) rend les trips dont la session est l'hôte, plaque fictive
// `AB 1234`, du 10 au 14 décembre 2036 (lendemain de la fin compris).
const CONSTANCIA_PLATE = 'AB1234';
const constanciaPdf = (version, lang) =>
  Buffer.from(`%PDF-1.4\n% constancia fictive v${version} es-${lang}\n%%EOF\n`, 'latin1');
const constanciaLines = (lang) =>
  ({
    es: ['CONSTANCIA DE ALQUILER ENTRE PARTICULARES', 'Vehículo: Toyota Yaris 2021, placa AB 1234'],
    en: [
      'CERTIFICATE OF RENTAL BETWEEN PRIVATE INDIVIDUALS',
      'Vehicle: Toyota Yaris 2021, license plate AB 1234',
    ],
    fr: [
      'ATTESTATION DE LOCATION ENTRE PARTICULIERS',
      'Véhicule : Toyota Yaris 2021, immatriculation AB 1234',
    ],
    pt: ['COMPROVANTE DE LOCAÇÃO ENTRE PARTICULARES', 'Veículo: Toyota Yaris 2021, placa AB 1234'],
  })[lang].map((text, i) => ({ style: i === 0 ? 'title' : 'kv', text }));

async function constanciaRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'POST' && path === '/trips/constancias/search') {
    const token = tokenOf(req);
    if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const b = (await readBody(req)) ?? {};
    const plate =
      typeof b.plate === 'string' ? b.plate.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '';
    if (
      Object.keys(b).length !== 2 ||
      plate.length < 2 ||
      plate.length > 12 ||
      typeof b.date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(b.date)
    ) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const trips = [...contracts.entries()]
      .filter(([, c]) => c.host === token && c.status !== 'CANCELLED')
      .filter(() => plate === CONSTANCIA_PLATE && b.date >= '2036-12-10' && b.date <= '2036-12-14')
      .map(([tripId]) => ({
        tripId,
        tripRef: 'KM-2110',
        status: 'BOOKED',
        startLocal: '2036-12-10 10:00',
        endLocal: '2036-12-13 10:00',
      }));
    return json(res, 200, { trips });
  }
  const m = /^\/trips\/([^/]+)\/constancia(\/pdf)?$/.exec(path);
  if (m === null || req.method !== 'GET') return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const c = contracts.get(m[1]);
  const role =
    c === undefined ? null : token === c.guest ? 'GUEST' : token === c.host ? 'HOST' : null;
  if (c === undefined || role === null) {
    return err(res, 404, 'CONSTANCIA_NOT_FOUND', 'common.constancia.notFound');
  }
  const n = c.docs.length;
  const lang = c.courtesy;
  const bytes = constanciaPdf(n, lang);
  if (m[2] === '/pdf') {
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="constancia-KM-2110-v${n}-es-${lang}.pdf"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-constancia-sha256': sha256hex(bytes),
    });
    res.end(bytes);
    return true;
  }
  const signed = c.docs[n - 1].signature !== null;
  return json(res, 200, {
    tripId: m[1],
    viewerRole: role,
    contractVersion: n,
    courtesyLocale: lang,
    sha256: sha256hex(bytes),
    renderer: 'ctr.pdf/1',
    templateVersion: 1,
    draft: true,
    summary: {
      tripRef: 'KM-2110',
      tripStatus: 'BOOKED',
      country: CONTRACT_COUNTRY,
      startLocal: '2036-12-10 10:00',
      endLocal: '2036-12-13 10:00',
      vehicle: { make: 'Toyota', model: 'Yaris', year: 2021 },
      plate: 'AB 1234',
      hostName: 'María G.',
      hostCapacity: 'OWNER',
      driverName: 'Lucía G.',
      handoverPlace: 'Casa',
      handoverCity: 'Ciudad Ficticia',
      currency: 'XXX',
      currencyExponent: 0,
      priceTotalMinor: '128400',
      signedAtLocal: signed ? '2036-11-30 15:20' : null,
    },
    parts: [
      { lang: 'es', authoritative: true, lines: constanciaLines('es') },
      { lang, authoritative: false, lines: constanciaLines(lang) },
    ],
  });
}

// ---- Remboursement d'un trip (US-224 partie 224d) : lecture par la partie du trip ---------------
// La partie est celle du contrat du trip (voyageur du hold, hôte du premier trip à venir) ; toute
// autre session ⇒ 404 REFUND_NOT_FOUND (comme l'API). `GET /__e2e/refund/cancel?trip=&state=`
// pose un remboursement (annulation réglée) : `issued` (envoyé au PSP, date d'émission fixe) ou
// `preparing` (planifié, aucune date). Montants de −TJ02b (08 E7 : 187,44 remboursés, jambe HOST
// 86,25), devise et exposant du marché fictif ; heures fixes (captures stables).
const refundsByTrip = new Map();
const REFUND_PLANNED_AT = '2036-12-05T14:00:00.000Z';
const REFUND_ISSUED_AT = '2036-12-05T14:00:10.000Z';

function refundRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/refund/cancel') {
    const tripId = url.searchParams.get('trip') ?? '';
    if (!contracts.has(tripId)) return err(res, 404, 'REFUND_NOT_FOUND', 'common.refund.notFound');
    refundsByTrip.set(
      tripId,
      url.searchParams.get('state') === 'preparing' ? 'preparing' : 'issued',
    );
    return json(res, 200, {});
  }
  const m = /^\/trips\/([^/]+)\/refunds$/.exec(path);
  if (m === null || req.method !== 'GET') return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const c = contracts.get(m[1]);
  const role =
    c === undefined ? null : token === c.guest ? 'GUEST' : token === c.host ? 'HOST' : null;
  if (role === null) return err(res, 404, 'REFUND_NOT_FOUND', 'common.refund.notFound');
  const state = refundsByTrip.get(m[1]);
  const issued = state === 'issued';
  const one = {
    status: issued ? 'SENT' : 'PLANNED',
    plannedAt: REFUND_PLANNED_AT,
    issuedAt: issued ? REFUND_ISSUED_AT : null,
  };
  return json(res, 200, {
    tripId: m[1],
    viewerRole: role,
    tripStatus: state === undefined ? 'BOOKED' : 'CANCELLED_BY_GUEST',
    currency: MARKET.currency,
    currencyExponent: MARKET.currencyExponent,
    timezone: 'UTC',
    refunds:
      state === undefined
        ? []
        : [
            role === 'GUEST'
              ? { ...one, amountMinor: '18744', rail: 'NATIVE_PARTIAL' }
              : { ...one, hostLegMinor: '8625' },
          ],
  });
}

// ---- « Mis viajes » et détail du trip du voyageur (US-214) : lecture par le voyageur ------------
// Les trips du voyageur de la session sont ceux dont il est la partie voyageur du contrat (trip né au
// webhook SUCCEEDED) ; toute autre session ⇒ liste vide et 404 TRIP_NOT_FOUND (comme l'API). Faits
// FIXES (captures stables) : auto, dates, hôte en prénom et initiale, lieu, total ; un trip annulé
// par `__e2e/refund/cancel` passe en CANCELLED (adresse retirée, paiement remboursé en partie).
const GUEST_TRIP_START = '2036-12-10T15:00:00.000Z';
const GUEST_TRIP_END = '2036-12-13T15:00:00.000Z';

function guestTripView(tripId, c) {
  const cancelled = refundsByTrip.has(tripId);
  const last = c.docs[c.docs.length - 1];
  return {
    kind: 'TRIP',
    id: tripId,
    // référence FIXE (captures stables ; l'API rend le numéro public du trip)
    reference: 'K-E2E00214',
    tab: cancelled ? 'CANCELLED' : 'UPCOMING',
    status: cancelled ? 'CANCELLED_BY_GUEST' : 'BOOKED',
    paymentStatus: cancelled ? 'REFUNDED_PARTIAL' : 'CONFIRMED',
    currency: MARKET.currency,
    currencyExponent: MARKET.currencyExponent,
    timezone: 'UTC',
    startsAt: GUEST_TRIP_START,
    endsAt: GUEST_TRIP_END,
    respondBy: null,
    vehicle: { make: 'Toyota', model: 'Yaris', year: 2021 },
    hostName: 'María G.',
    handover: {
      place: 'Casa',
      address: cancelled ? null : 'Calle de prueba 1',
      city: cancelled ? null : 'Ciudad de prueba',
    },
    totalMinor: '12840',
    contract: last === undefined ? 'NONE' : last.signature === null ? 'TO_SIGN' : 'SIGNED',
  };
}

function guestTripsRoute(req, res, url) {
  const path = url.pathname;
  const one = /^\/trips\/([^/]+)$/.exec(path);
  if (req.method !== 'GET' || (path !== '/trips' && one === null)) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const mine = [...contracts.entries()].filter(([, c]) => c.guest !== null && c.guest === token);
  if (one === null) {
    return json(res, 200, { trips: mine.map(([id, c]) => guestTripView(id, c)) });
  }
  const found = mine.find(([id]) => id === one[1].toLowerCase());
  if (found === undefined) return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  return json(res, 200, { trip: guestTripView(found[0], found[1]) });
}

// ---- Messagerie par trip (US-525) : fil S16 du voyageur ------------------------------------------
// Deux trips FIXES (captures stables) : MESSAGES_TRIP (fil ouvert, un message de l'hôte au départ) et
// MESSAGES_CLOSED_TRIP (fil en lecture seule). Partie : toute session « G0st… » (voyageur), un fil par
// session ; toute autre session ⇒ 404 TRIP_NOT_FOUND (comme l'API). Masquage IMITÉ (7 chiffres ou
// plus ⇒ « ••• ») et signal imité (« efectivo ») : les vraies règles sont prouvées sur PostgreSQL
// (l0-us525-messaging). Jamais le texte d'un message dans un journal.
const MESSAGES_TRIP = '00000000-0000-4000-8000-000000525e2e';
const MESSAGES_CLOSED_TRIP = '00000000-0000-4000-8000-000000525c10';
const threadsByToken = new Map();

function seedThread() {
  return [
    {
      id: '00000000-0000-4000-8000-000000525001',
      mine: false,
      authorRole: 'HOST',
      authorName: 'María',
      body: 'Hola, te espero en el lugar de entrega. Avísame si llegas tarde.',
      masked: false,
      offPlatform: false,
      sentAt: '2036-12-09T15:00:00.000Z',
      purged: false,
    },
  ];
}

async function messagesRoute(req, res, url) {
  const m = /^\/trips\/([^/]+)\/messages$/.exec(url.pathname);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const tripId = m[1].toLowerCase();
  if (!GUEST_TOKEN.test(token) || (tripId !== MESSAGES_TRIP && tripId !== MESSAGES_CLOSED_TRIP)) {
    return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  }
  const key = `${token}:${tripId}`;
  if (!threadsByToken.has(key)) threadsByToken.set(key, seedThread());
  const messages = threadsByToken.get(key);
  const writable = tripId === MESSAGES_TRIP;
  if (req.method === 'GET') {
    return json(res, 200, {
      code: 'TRIP_MESSAGES',
      messageKey: 'common.messages.thread',
      tripId,
      viewerRole: 'GUEST',
      counterpartName: 'María',
      writable,
      closesAt: '2036-12-23T15:00:00.000Z',
      timezone: 'UTC',
      messages,
    });
  }
  if (req.method !== 'POST') return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  const b = await readBody(req);
  if (b === null || typeof b.id !== 'string' || typeof b.body !== 'string') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (!writable) return err(res, 409, 'MESSAGE_THREAD_CLOSED', 'common.messages.threadClosed');
  const text = b.body.trim();
  if (text.length < 1 || [...text].length > 2000) {
    return err(res, 422, 'MESSAGE_INVALID', 'common.messages.invalid');
  }
  const body = text.replace(/\+?\d[\d\s().-]{5,}\d/g, '•••');
  const masked = body !== text;
  const offPlatform = /\befectivo\b/i.test(text);
  const sentAt = new Date(Date.parse('2036-12-09T16:00:00.000Z') + messages.length * 60_000);
  const message = { id: b.id, body, masked, offPlatform, sentAt: sentAt.toISOString() };
  if (!messages.some((x) => x.id === b.id)) {
    messages.push({
      ...message,
      mine: true,
      authorRole: 'GUEST',
      authorName: 'Lucía',
      purged: false,
    });
  }
  const notices = [
    ...(masked ? ['CONTACT_MASKED'] : []),
    ...(offPlatform ? ['OFF_PLATFORM_PAYMENT'] : []),
  ];
  return json(res, 201, {
    code: 'MESSAGE_SENT',
    messageKey: 'common.messages.sent',
    message,
    notices,
  });
}

// ---- Rendez-vous du trip (US-316) : remise proposée par l'hôte, réponse du voyageur ---------------
// Même trips FIXES et mêmes parties que la messagerie : le voyageur (session « G0st… ») voit une
// remise PROPOSÉE (lieu sans coordonnées, heure fixe) sur MESSAGES_TRIP, aucune sur
// MESSAGES_CLOSED_TRIP ; il la confirme ou la refuse (une fois). Toute autre session ⇒ 404. Les
// vraies règles (bornes, statuts, coordonnées, événement sans lieu) sont prouvées sur PostgreSQL
// (l0-us316-messaging-privacy). Jamais un lieu dans un journal.
const MEETING_ID = '00000000-0000-4000-8000-000000316001';
const meetingsByToken = new Map();

function seedMeetings(tripId) {
  if (tripId !== MESSAGES_TRIP) return [];
  return [
    {
      id: MEETING_ID,
      kind: 'PICKUP',
      place: 'Estacionamiento del centro comercial, entrada norte',
      meetAt: '2036-12-10T14:00:00.000Z',
      status: 'PROPOSED',
      mine: false,
      createdAt: '2036-12-09T15:05:00.000Z',
      answeredAt: null,
    },
  ];
}

async function meetingsRoute(req, res, url) {
  const m = /^\/trips\/([^/]+)\/meetings(?:\/([^/]+)\/answer)?$/.exec(url.pathname);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const tripId = m[1].toLowerCase();
  if (!GUEST_TOKEN.test(token) || (tripId !== MESSAGES_TRIP && tripId !== MESSAGES_CLOSED_TRIP)) {
    return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  }
  const key = `${token}:${tripId}`;
  if (!meetingsByToken.has(key)) meetingsByToken.set(key, seedMeetings(tripId));
  const meetings = meetingsByToken.get(key);
  if (m[2] === undefined) {
    if (req.method !== 'GET') {
      return err(res, 403, 'MEETING_NOT_ALLOWED', 'common.meetings.notAllowed');
    }
    return json(res, 200, {
      code: 'TRIP_MEETINGS',
      messageKey: 'common.meetings.list',
      tripId,
      viewerRole: 'GUEST',
      canPropose: false,
      timezone: 'UTC',
      meetings,
    });
  }
  if (req.method !== 'POST') return err(res, 404, 'MEETING_NOT_FOUND', 'common.meetings.notFound');
  const b = await readBody(req);
  const found = meetings.find((x) => x.id === m[2].toLowerCase());
  if (found === undefined) return err(res, 404, 'MEETING_NOT_FOUND', 'common.meetings.notFound');
  if (b === null || (b.decision !== 'ACCEPT' && b.decision !== 'DECLINE')) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const target = b.decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
  if (found.status !== 'PROPOSED' && found.status !== target) {
    return err(res, 409, 'MEETING_NOT_PENDING', 'common.meetings.notPending');
  }
  found.status = target;
  found.mine = true;
  found.answeredAt = '2036-12-09T16:00:00.000Z';
  return json(res, 200, {
    code: 'MEETING_ANSWERED',
    messageKey: 'common.meetings.answered',
    meeting: { id: found.id, kind: found.kind, meetAt: found.meetAt, status: target },
  });
}

// ---- Aide et urgence (US-310) -------------------------------------------------------------------
// `GET /help` : aide du marché fictif (pays réservé ZZ, ADR-024 : aucun vrai pays) ; numéros
// d'assistance ABSENTS (comme le dépôt tant que le fondateur ne les a pas fournis) et aucune plage
// publiée (SUP-020) : l'écran doit renvoyer à l'aide dans l'appli sans inventer de numéro.
// `GET /trips/{id}/help` et `POST /trips/{id}/help-requests` : la partie voyageur du contrat
// seulement ; toute autre session ⇒ 404 TRIP_NOT_FOUND (comme l'API). La demande : motif fermé,
// identifiant de la demande ; rejeu ⇒ 200 DUPLICATE ; hors plage (aucune plage) ⇒ offHours.
const HELP_TOPICS = ['ACCIDENT', 'BREAKDOWN', 'HANDOVER', 'SAFETY', 'OTHER'];
const helpRequests = new Map();
const helpView = () => ({
  country: MARKET.country,
  names: { es: 'Tierra de prueba', en: 'Test country', fr: 'Pays de test', pt: 'Terra de teste' },
  emergencyNumber: '911',
  trafficAuthority: { id: 'attt', messageKey: 'common.help.authority.attt' },
  supportPhone: null,
  insurerAssistancePhone: null,
  supportHours: null,
});

async function helpRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/help') {
    const country = url.searchParams.get('country');
    if (country !== null && country !== MARKET.country) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    return json(res, 200, { countries: [helpView()] });
  }
  const m = /^\/trips\/([^/]+)\/(help|help-requests)$/.exec(path);
  if (m === null) return false;
  if (
    (m[2] === 'help' && req.method !== 'GET') ||
    (m[2] === 'help-requests' && req.method !== 'POST')
  ) {
    return false;
  }
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const tripId = m[1].toLowerCase();
  const c = contracts.get(tripId);
  if (c === undefined || c.guest !== token) {
    return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  }
  if (m[2] === 'help') return json(res, 200, { tripId, role: 'GUEST', help: helpView() });
  const body = await readBody(req);
  if (
    body === null ||
    typeof body.requestId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(body.requestId) ||
    !HELP_TOPICS.includes(body.topic)
  ) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (helpRequests.has(body.requestId)) {
    return json(res, 200, { caseId: body.requestId, outcome: 'DUPLICATE', offHours: true });
  }
  helpRequests.set(body.requestId, { tripId, topic: body.topic });
  return json(res, 201, { caseId: body.requestId, outcome: 'OPENED', offHours: true });
}

// ---- Reçu du voyageur et gains de l'hôte (US-217 partie 217b) ---------------------------------
// `GET /trips/{id}/receipt` : la partie voyageur du contrat lit le reçu de son paiement ; toute autre
// session ⇒ 404 RECEIPT_NOT_FOUND (comme l'API). Montants FIXES de forme (le total est celui du détail
// S09 du double) : trip fee 12,00 et sa taxe de ligne 0,84 (7 %) ; après `__e2e/refund/cancel`, le
// règlement rend un remboursement dû, le trip fee conservé en partie et AUCUNE taxe (ADR-167, N-337).
function receiptRoute(req, res, url) {
  const m = /^\/trips\/([^/]+)\/receipt$/.exec(url.pathname);
  if (m === null || req.method !== 'GET') return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const tripId = m[1].toLowerCase();
  const c = contracts.get(tripId);
  if (c === undefined || c.guest === null || token !== c.guest) {
    return err(res, 404, 'RECEIPT_NOT_FOUND', 'common.receipt.notFound');
  }
  const cancelled = refundsByTrip.has(tripId);
  return json(res, 200, {
    tripId,
    viewerRole: 'GUEST',
    tripStatus: cancelled ? 'CANCELLED_BY_GUEST' : 'BOOKED',
    currency: MARKET.currency,
    currencyExponent: MARKET.currencyExponent,
    timezone: 'UTC',
    receipt: {
      source: cancelled ? 'SETTLEMENT' : 'CAPTURE',
      settlementVersion: cancelled ? 1 : null,
      totalPaidMinor: '12840',
      refundMinor: cancelled ? '8640' : '0',
      tripFee: cancelled
        ? {
            chargedMinor: '1200',
            taxMinor: null,
            taxRateBps: null,
            refundedMinor: '800',
            retainedMinor: '400',
          }
        : {
            chargedMinor: '1200',
            taxMinor: '84',
            taxRateBps: 700,
            refundedMinor: '0',
            retainedMinor: '1200',
          },
      fiscalDocument: 'OFF_PLATFORM',
    },
  });
}

// `GET /host/accounts/{orgId}/payouts` (US-314) : versements du compte de la session (compte d'un
// autre ⇒ 404 HOST_ACCOUNT_NOT_FOUND). Données FIXES (trips et lots fictifs) : un premier versement
// PAYÉ dont la pénalité de l'hôte est compensée, puis un lot RETENU (réclamation ouverte,
// versements fermés dans le pays). Montants des vecteurs de 08 (jambe HOST de TJ01, pénalité de
// T14 en exposant 2 ; TJ08a, T48 sans décimale) ; calendrier : J+2 / J+5 ouvrés à 10:00 (forme de
// 17 §7.2, fuseau UTC du double).
function payoutsRoute(req, res, url) {
  const m = /^\/host\/accounts\/([0-9a-f-]{36})\/payouts$/.exec(url.pathname);
  if (m === null || req.method !== 'GET') return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const a = owner === null ? undefined : owner.accounts.find((x) => x.orgId === m[1]);
  if (a === undefined)
    return err(res, 404, 'HOST_ACCOUNT_NOT_FOUND', 'common.listing.hostNotFound');
  const z = a.market.currencyExponent === 0;
  const leg = z ? '787500' : '13125';
  const netted = z ? '200000' : '2500';
  const paidNet = z ? '587500' : '10625';
  const batch = (id, trip, over) => ({
    batchId: id,
    kind: 'FINAL',
    currency: a.market.currency,
    grossMinor: leg,
    nettedMinor: '0',
    netMinor: leg,
    holdReasons: [],
    initiatedAt: null,
    paidAt: null,
    trips: [{ tripId: trip, amountMinor: leg }],
    ...over,
  });
  return json(res, 200, {
    orgId: m[1],
    country: a.market.country,
    currency: a.market.currency,
    currencyExponent: a.market.currencyExponent,
    schedule: {
      businessDayOffset: 2,
      firstPayoutBusinessDay: 5,
      localTimeMinutes: 600,
      timeZone: 'UTC',
      payoutsOpen: false,
    },
    payouts: [
      batch('31400000-0000-4000-8000-000000000002', '31400000-0000-4000-8000-0000000000b2', {
        status: 'ON_HOLD',
        scheduledFor: '2036-12-16T10:00:00.000Z',
        firstPayout: false,
        holdReasons: ['CLAIM', 'PAYOUTS_DISABLED'],
      }),
      batch('31400000-0000-4000-8000-000000000001', '31400000-0000-4000-8000-0000000000b1', {
        status: 'PAID',
        scheduledFor: '2036-12-05T10:00:00.000Z',
        firstPayout: true,
        nettedMinor: netted,
        netMinor: paidNet,
        initiatedAt: '2036-12-05T10:01:00.000Z',
        paidAt: '2036-12-06T10:00:00.000Z',
      }),
    ],
  });
}

// `GET /host/accounts/{orgId}/earnings/{month}` : relevé du compte de la session (compte d'un autre
// ⇒ 404 EARNINGS_NOT_FOUND ; mois mal formé ⇒ 400). Seul le mois EARNINGS_MONTH porte des lignes
// FIXES (trips fictifs) : un trip à venir capturé (à liquider), un trip annulé par le voyageur et
// réglé (part retenue), un trip annulé par l'hôte (part nulle) et sa pénalité EN LIGNE SÉPARÉE.
// Formes des vecteurs de 08 (TJ01, T03, T14 en exposant 2 ; TJ08a, T27, T48 sans décimale).
const EARNINGS_MONTH = '2036-12';
function earningsRoute(req, res, url) {
  const m = /^\/host\/accounts\/([0-9a-f-]{36})\/earnings\/([^/]+)$/.exec(url.pathname);
  if (m === null || req.method !== 'GET') return false;
  const owner = hostOf(req);
  if (owner === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const a = owner === null ? undefined : owner.accounts.find((x) => x.orgId === m[1]);
  if (a === undefined) return err(res, 404, 'EARNINGS_NOT_FOUND', 'common.earnings.notFound');
  const month = decodeURIComponent(m[2]);
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  const base = { orgId: m[1], month, country: a.market.country };
  if (month !== EARNINGS_MONTH) return json(res, 200, { ...base, statements: [] });
  const z = a.market.currencyExponent === 0;
  const v = z
    ? {
        leg: '787500',
        base: '1050000',
        fee: '262500',
        kept: '270000',
        keptBase: '360000',
        keptFee: '90000',
        penalty: '-200000',
        earned: '70000',
        hostLeg: '1057500',
        net: '857500',
      }
    : {
        leg: '13125',
        base: '17500',
        fee: '4375',
        kept: '4500',
        keptBase: '6000',
        keptFee: '1500',
        penalty: '-2500',
        earned: '2000',
        hostLeg: '17625',
        net: '15125',
      };
  const line = {
    settlementVersion: null,
    reason: null,
    hostPlanCode: 'ESTÁNDAR',
    hostSharePct: '3/4',
  };
  return json(res, 200, {
    ...base,
    statements: [
      {
        currency: a.market.currency,
        currencyExponent: a.market.currencyExponent,
        tripsCount: 3,
        hostLegMinor: v.hostLeg,
        adjustmentsMinor: v.penalty,
        netMinor: v.net,
        earnedMinor: v.earned,
        pendingMinor: v.leg,
        lines: [
          {
            ...line,
            kind: 'CXL_EARNING',
            tripId: '21700000-0000-4000-8000-0000000b0002',
            tripStatus: 'CANCELLED_BY_GUEST',
            source: 'SETTLEMENT',
            settlementVersion: 1,
            eventAt: '2036-12-03T15:00:00.000Z',
            amountMinor: v.kept,
            shareBaseMinor: v.keptBase,
            kminoFeeMinor: v.keptFee,
          },
          {
            ...line,
            kind: 'CXL_EARNING',
            tripId: '21700000-0000-4000-8000-0000000b0003',
            tripStatus: 'CANCELLED_BY_HOST',
            source: 'SETTLEMENT',
            settlementVersion: 1,
            eventAt: '2036-12-05T15:00:00.000Z',
            amountMinor: '0',
            shareBaseMinor: '0',
            kminoFeeMinor: '0',
          },
          {
            kind: 'ADJUSTMENT',
            tripId: '21700000-0000-4000-8000-0000000b0003',
            tripStatus: 'CANCELLED_BY_HOST',
            source: 'HOST_LEDGER',
            settlementVersion: 1,
            reason: 'HOST_CANCELLATION_PENALTY',
            eventAt: '2036-12-05T15:00:00.000Z',
            amountMinor: v.penalty,
            shareBaseMinor: null,
            kminoFeeMinor: null,
            hostPlanCode: null,
            hostSharePct: null,
          },
          {
            ...line,
            kind: 'EARNING',
            tripId: '21700000-0000-4000-8000-0000000b0001',
            tripStatus: 'BOOKED',
            source: 'CAPTURE',
            eventAt: '2036-12-14T14:00:00.000Z',
            amountMinor: v.leg,
            shareBaseMinor: v.base,
            kminoFeeMinor: v.fee,
          },
        ],
      },
    ],
  });
}

// Photos d'état du véhicule (US-303) : `GET /__e2e/inspection/new?guest=&host=` crée un trip dont
// les séries sont ouvertes (départ) pour ces deux jetons ; toute autre session ⇒ 404
// INSPECTION_NOT_FOUND (comme l'API). Gabarit de la version 1 (migration 0158) ; jeton de capture
// à usage unique ; source autre que CAMERA ⇒ 422 PHOTO_GALLERY_FORBIDDEN ; gabarit incomplet ⇒ 422.
const INSPECTION_TZ = JSON.parse(
  readFileSync(new URL('../../api/src/modules/cfg/data/countries.json', import.meta.url), 'utf8'),
).countries[0].timeZone;
const INSPECTION_SLOTS = [
  ...Array.from({ length: 15 }, (_, i) => ({
    code: `EXT_${String(i + 1).padStart(2, '0')}`,
    group: 'EXTERIOR',
    required: true,
  })),
  ...Array.from({ length: 8 }, (_, i) => ({
    code: `INT_${String(i + 1).padStart(2, '0')}`,
    group: 'INTERIOR',
    required: true,
  })),
  { code: 'FUEL', group: 'FUEL', required: true },
  { code: 'ODOMETER', group: 'ODOMETER', required: true },
  { code: 'KEY', group: 'KEY', required: false },
  ...Array.from({ length: 10 }, (_, i) => ({
    code: `DAMAGE_${String(i + 1).padStart(2, '0')}`,
    group: 'DAMAGE',
    required: false,
  })),
];
const inspections = new Map();
const INSPECTION_RECEIVED_AT = '2036-12-10T14:05:00.000Z';

async function inspectionRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/inspection/new') {
    const tripId = uuid();
    inspections.set(tripId, {
      guest: url.searchParams.get('guest') ?? '',
      host: url.searchParams.get('host') ?? '',
      sides: {
        HOST: { status: 'DRAFT', photos: new Map() },
        GUEST: { status: 'DRAFT', photos: new Map() },
      },
      captures: new Map(),
    });
    return json(res, 200, { tripId });
  }
  const m = /^\/trips\/([^/]+)\/inspections\/([^/]+)(\/captures|\/photos|\/submit)?$/.exec(path);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const t = inspections.get(m[1]);
  const role =
    t === undefined ? null : token === t.guest ? 'GUEST' : token === t.host ? 'HOST' : null;
  if (t === undefined || role === null || m[2] !== 'checkin') {
    return err(res, 404, 'INSPECTION_NOT_FOUND', 'common.inspection.notFound');
  }
  const mine = t.sides[role];
  if (m[3] === undefined && req.method === 'GET') {
    const side = (r) => ({
      role: r,
      status:
        t.sides[r].status === 'SUBMITTED'
          ? 'SUBMITTED'
          : t.sides[r].photos.size > 0
            ? 'DRAFT'
            : 'NONE',
      submittedAt: t.sides[r].status === 'SUBMITTED' ? INSPECTION_RECEIVED_AT : null,
      photos: [...t.sides[r].photos.values()],
    });
    return json(res, 200, {
      tripId: m[1],
      kind: 'checkin',
      viewerRole: role,
      timezone: INSPECTION_TZ,
      open: true,
      uploads: {
        open: true,
        maxBytes: 76032,
        maxLongSidePx: 1600,
        mimeTypes: ['image/jpeg', 'image/webp'],
      },
      slots: INSPECTION_SLOTS,
      sides: [side('HOST'), side('GUEST')],
    });
  }
  if (req.method !== 'POST' || m[3] === undefined) return false;
  const b = (await readBody(req)) ?? {};
  if (mine.status === 'SUBMITTED' && m[3] !== '/submit') {
    return err(res, 409, 'INSPECTION_SUBMITTED', 'common.inspection.submitted');
  }
  if (m[3] === '/captures') {
    if (!INSPECTION_SLOTS.some((x) => x.code === b.slot)) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const captureId = uuid();
    t.captures.set(captureId, { role, slot: b.slot });
    return json(res, 201, { captureId, slot: b.slot, expiresAt: '2036-12-10T14:07:00.000Z' });
  }
  if (m[3] === '/photos') {
    const c = t.captures.get(b.captureId);
    if (b.source !== 'CAMERA' || c === undefined || c.role !== role || c.slot !== b.slot) {
      return err(res, 422, 'PHOTO_GALLERY_FORBIDDEN', 'common.inspection.galleryForbidden');
    }
    t.captures.delete(b.captureId);
    const fileId = uuid();
    const bytes = Buffer.from(String(b.dataBase64 ?? ''), 'base64');
    const photo = {
      slot: b.slot,
      fileId,
      sha256: sha256hex(bytes),
      bytes: bytes.length,
      receivedAt: INSPECTION_RECEIVED_AT,
      clockSkew: false,
    };
    mine.photos.set(b.slot, photo);
    return json(res, 201, {
      fileId,
      slot: b.slot,
      sha256: photo.sha256,
      bytes: photo.bytes,
      receivedAt: photo.receivedAt,
    });
  }
  const missing = INSPECTION_SLOTS.filter((x) => x.required && !mine.photos.has(x.code)).map(
    (x) => x.code,
  );
  if (mine.status !== 'SUBMITTED' && missing.length > 0) {
    return json(res, 422, {
      code: 'PHOTO_TEMPLATE_INCOMPLETE',
      messageKey: 'common.inspection.templateIncomplete',
      missing,
    });
  }
  mine.status = 'SUBMITTED';
  return json(res, 200, { status: 'SUBMITTED', submittedAt: INSPECTION_RECEIVED_AT });
}

// Remise et retour entre particuliers (US-315) : `GET /__e2e/handover/new?guest=&host=&status=`
// crée un trip (statut SM-1 donné, BOOKED par défaut) dont les deux séries de photos sont déjà
// validées ; toute autre session ⇒ 404 HANDOVER_NOT_FOUND (comme l'API). Contrôle du permis :
// hôte seulement, 6 points ou motif ; validation : en personne seulement, aucune heure reçue, la
// seconde validation termine l'étape à l'heure « serveur » fixe du double.
const handovers = new Map();
const HANDOVER_AT = '2036-12-10T15:00:00.000Z';
const HANDOVER_CHECKS = ['face', 'name', 'birthYear', 'valid', 'provisional', 'restrictions'];
const HANDOVER_REASONS = ['INVALID_LICENSE', 'IDENTITY_NOT_VERIFIED', 'OTHER_DRIVER_SENT'];

async function handoverRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/handover/new') {
    const tripId = uuid();
    handovers.set(tripId, {
      guest: url.searchParams.get('guest') ?? '',
      host: url.searchParams.get('host') ?? '',
      status: url.searchParams.get('status') ?? 'BOOKED',
      // US-703 : permis déjà contrôlé par l'hôte (capture du départ du voyageur, S09)
      identity: url.searchParams.get('identity') === 'OK' ? 'OK' : null,
      done: { checkin: null, checkout: null },
      validations: {
        checkin: { HOST: null, GUEST: null },
        checkout: { HOST: null, GUEST: null },
      },
    });
    return json(res, 200, { tripId });
  }
  const m = /^\/trips\/([^/]+)\/handover\/([^/]+)(\/open|\/identity|\/validate)?$/.exec(path);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const t = handovers.get(m[1]);
  const role =
    t === undefined ? null : token === t.guest ? 'GUEST' : token === t.host ? 'HOST' : null;
  const direction = m[2];
  if (t === undefined || role === null || (direction !== 'checkin' && direction !== 'checkout')) {
    return err(res, 404, 'HANDOVER_NOT_FOUND', 'common.handover.notFound');
  }
  const checkin = direction === 'checkin';
  const open = checkin
    ? t.status === 'CHECKIN_OPEN' || t.status === 'START_WINDOW_EXPIRED'
    : t.status === 'IN_PROGRESS' || t.status === 'OVERDUE';
  const other = role === 'HOST' ? 'GUEST' : 'HOST';
  if (m[3] === undefined && req.method === 'GET') {
    return json(res, 200, {
      tripId: m[1],
      direction,
      viewerRole: role,
      tripStatus: t.status,
      timezone: INSPECTION_TZ,
      opensAt: checkin ? '2036-12-09T15:00:00.000Z' : null,
      open,
      canOpen: checkin && t.status === 'BOOKED',
      blockers: [],
      identityCheck: checkin
        ? {
            status: t.identity === null ? 'PENDING' : t.identity,
            checkedAt: t.identity === null ? null : HANDOVER_AT,
          }
        : null,
      guest:
        checkin && role === 'HOST' ? { firstName: 'Ana', lastInitial: 'P', birthYear: 1990 } : null,
      photos: { mine: 'SUBMITTED', other: 'SUBMITTED' },
      validations: {
        mine: t.validations[direction][role],
        other: t.validations[direction][other],
      },
      contactlessOffered: false,
      completedAt: t.done[direction],
    });
  }
  if (req.method !== 'POST' || m[3] === undefined) return false;
  const b = (await readBody(req)) ?? {};
  if (m[3] === '/open') {
    if (!checkin || Object.keys(b).length > 0) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    if (t.status === 'BOOKED') t.status = 'CHECKIN_OPEN';
    if (t.status !== 'CHECKIN_OPEN') {
      return err(res, 409, 'CHECKIN_NOT_OPEN', 'common.handover.checkinNotOpen');
    }
    return json(res, 200, { tripStatus: 'CHECKIN_OPEN', openedAt: HANDOVER_AT });
  }
  if (m[3] === '/identity') {
    if (!checkin) return err(res, 404, 'HANDOVER_NOT_FOUND', 'common.handover.notFound');
    if (role !== 'HOST') return err(res, 403, 'HANDOVER_HOST_ONLY', 'common.handover.hostOnly');
    if (!open) return err(res, 409, 'CHECKIN_NOT_OPEN', 'common.handover.checkinNotOpen');
    const c = b.checklist;
    const keys = c !== null && typeof c === 'object' ? Object.keys(c) : [];
    if (
      keys.length !== 6 ||
      !HANDOVER_CHECKS.every((k) => typeof c[k] === 'boolean') ||
      Object.keys(b).some((k) => k !== 'checklist' && k !== 'subreason')
    ) {
      return err(
        res,
        422,
        'CHECKIN_LICENSE_CHECK_INCOMPLETE',
        'common.handover.licenseCheckIncomplete',
      );
    }
    const ok = HANDOVER_CHECKS.every((k) => c[k]);
    if (ok === (b.subreason !== undefined) || (!ok && !HANDOVER_REASONS.includes(b.subreason))) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    const already = t.identity !== null;
    if (!already) t.identity = ok ? 'OK' : 'FAILED';
    return json(res, 200, { status: t.identity, checkedAt: HANDOVER_AT, alreadyChecked: already });
  }
  // validation : en personne seulement ; toute clé inconnue (une heure du client) est refusée
  // US-703 : langue du rappel du consentement MIT (voyageur, au départ)
  if (Object.keys(b).some((k) => !['odometerKm', 'fuelEighths', 'method', 'locale'].includes(k))) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (b.method === 'CONTACTLESS') {
    return err(res, 409, 'CONTACTLESS_UNAVAILABLE', 'common.handover.contactlessUnavailable');
  }
  if (b.method !== 'IN_PERSON') {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (!open) {
    return checkin
      ? err(res, 409, 'CHECKIN_NOT_OPEN', 'common.handover.checkinNotOpen')
      : err(res, 409, 'CHECKOUT_NOT_OPEN', 'common.handover.checkoutNotOpen');
  }
  if (
    !Number.isSafeInteger(b.odometerKm) ||
    b.odometerKm < 0 ||
    b.odometerKm > 9999999 ||
    !Number.isSafeInteger(b.fuelEighths) ||
    b.fuelEighths < 0 ||
    b.fuelEighths > 8
  ) {
    return err(res, 422, 'READING_INVALID', 'common.handover.readingInvalid');
  }
  if (checkin && role === 'HOST' && t.identity !== 'OK') {
    return t.identity === 'FAILED'
      ? err(res, 409, 'IDENTITY_CHECK_FAILED', 'common.handover.identityFailed')
      : err(res, 422, 'CHECKIN_LICENSE_CHECK_INCOMPLETE', 'common.handover.licenseCheckIncomplete');
  }
  const v = t.validations[direction];
  const already = v[role] !== null;
  if (!already) {
    v[role] = { validatedAt: HANDOVER_AT, odometerKm: b.odometerKm, fuelEighths: b.fuelEighths };
  }
  if (v.HOST !== null && v.GUEST !== null && t.done[direction] === null) {
    t.done[direction] = HANDOVER_AT;
    t.status = checkin ? 'IN_PROGRESS' : 'RETURNED';
  }
  return json(res, 200, {
    validatedAt: v[role].validatedAt,
    completed: t.done[direction] !== null,
    completedAt: t.done[direction],
    tripStatus: t.status,
    alreadyValidated: already,
  });
}

// ---- Avis réciproques (US-317) : S13 du voyageur, avis reçus, profil public de l'hôte ------------
// Un trip FIXE rendu (REVIEW_TRIP, captures stables) : le voyageur (session « G0st… ») note une fois ;
// l'hôte n'a pas encore noté, l'avis reste donc SCELLÉ (en attente). Avis reçus : un avis publié de
// l'hôte sur le voyageur ; l'hôte (« H0st… ») a un avis publié d'une voyageuse. Profil public de
// l'hôte des annonces du double : ancienneté seulement, aucun avis (captures de la fiche stables).
// Les vraies règles (fenêtre, scellé, publication simultanée, masquage) sont prouvées sur
// PostgreSQL (l0-us317-*). Jamais une note ni un texte dans un journal.
const REVIEW_TRIP = '00000000-0000-4000-8000-000000317e2e';
const reviewsByToken = new Map();
const HOST_REVIEW = {
  authorRole: 'HOST',
  authorName: 'María',
  overall: 5,
  subScores: { punctuality: 5 },
  text: 'Devolvió el auto limpio y a la hora acordada. ¡Gracias!',
  publishedAt: '2036-12-14T15:00:00.000Z',
};

async function reviewsRoute(req, res, url) {
  const profile = /^\/listings\/([0-9a-f-]{36})\/host-profile$/.exec(url.pathname)?.[1];
  if (profile !== undefined && req.method === 'GET') {
    if (
      ![PUBLIC_ID, MANUAL_ID, NO_COVER_ID, DEPOSIT_UNAVAILABLE_ID, REQUEST_ID].includes(profile)
    ) {
      return err(res, 404, 'LISTING_NOT_FOUND', 'common.listing.notFound');
    }
    return json(res, 200, {
      code: 'HOST_PROFILE',
      messageKey: 'common.reviews.hostProfile',
      listingId: profile,
      firstName: 'Ana',
      memberSince: '2024-03',
      tripCount: 0,
      reviewCount: 0,
      averageX100: null,
      reviews: [],
    });
  }
  if (url.pathname === '/reviews/received' && req.method === 'GET') {
    const token = tokenOf(req);
    if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    const host = HOST_TOKEN.test(token);
    return json(res, 200, {
      code: 'REVIEWS_RECEIVED',
      messageKey: 'common.reviews.received',
      asGuest: host
        ? { reviewCount: 0, averageX100: null, reviews: [] }
        : { reviewCount: 1, averageX100: 500, reviews: [HOST_REVIEW] },
      asHost: host
        ? {
            firstName: 'Ana',
            memberSince: '2024-03',
            tripCount: 1,
            reviewCount: 1,
            averageX100: 400,
            reviews: [
              {
                authorRole: 'GUEST',
                authorName: 'Lucía',
                overall: 4,
                subScores: {},
                text: 'Auto cómodo y entrega puntual en el lugar acordado.',
                publishedAt: '2036-12-15T15:00:00.000Z',
              },
            ],
          }
        : null,
    });
  }
  const m = /^\/trips\/([^/]+)\/reviews$/.exec(url.pathname);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const tripId = m[1].toLowerCase();
  if (!GUEST_TOKEN.test(token) || tripId !== REVIEW_TRIP) {
    return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  }
  const key = `${token}:${tripId}`;
  const mine = reviewsByToken.get(key) ?? null;
  if (req.method === 'GET') {
    return json(res, 200, {
      code: 'TRIP_REVIEWS',
      messageKey: 'common.reviews.trip',
      tripId,
      viewerRole: 'GUEST',
      counterpartName: 'María',
      timezone: 'UTC',
      windowDays: 10,
      endedAt: '2036-12-13T15:00:00.000Z',
      closesAt: '2099-12-23T15:00:00.000Z',
      canSubmit: mine === null,
      mine,
      published: [],
      guestProfile: null,
    });
  }
  if (req.method !== 'POST') return err(res, 404, 'TRIP_NOT_FOUND', 'common.trips.notFound');
  const b = await readBody(req);
  if (b === null || !Number.isInteger(b.overall)) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (mine !== null) {
    return err(res, 409, 'REVIEW_ALREADY_SUBMITTED', 'common.reviews.alreadySubmitted');
  }
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (b.overall < 1 || b.overall > 5)
    return err(res, 422, 'REVIEW_INVALID', 'common.reviews.invalid');
  if (b.overall <= 3 && [...text].length < 25) {
    return err(res, 422, 'REVIEW_TEXT_REQUIRED', 'common.reviews.textRequired');
  }
  const body = text.replace(/\+?\d[\d\s().-]{5,}\d/g, '•••');
  const submittedAt = '2036-12-14T16:00:00.000Z';
  reviewsByToken.set(key, {
    status: 'SUBMITTED',
    overall: b.overall,
    subScores: b.subScores ?? {},
    text: body === '' ? null : body,
    contactMasked: body !== text,
    submittedAt,
  });
  return json(res, 201, {
    code: 'REVIEW_SUBMITTED',
    messageKey: 'common.reviews.submitted',
    review: { status: 'SUBMITTED', submittedAt, publishedAt: null },
  });
}

// No-show entre particuliers (US-307) : `GET /__e2e/no-show/new?guest=&host=&traced=` crée un trip
// en remise ouverte dont la fenêtre de déclaration est ouverte à l'heure « serveur » fixe du double
// (`traced` : message de la partie présente suivi de 15 min sans réponse) ; l'hôte déclare le
// voyageur absent, le voyageur l'hôte ; toute autre session ⇒ 404 NO_SHOW_NOT_FOUND ; même
// `requestId` ⇒ la même demande ; une seconde ⇒ 409 CANCELLATION_PENDING ; aucune heure reçue.
const noShows = new Map();
const NO_SHOW_START = '2036-12-10T12:00:00.000Z';
const NO_SHOW_AT = '2036-12-10T15:00:00.000Z';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function noShowRoute(req, res, url) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/__e2e/no-show/new') {
    const tripId = uuid();
    noShows.set(tripId, {
      guest: url.searchParams.get('guest') ?? '',
      host: url.searchParams.get('host') ?? '',
      traced: url.searchParams.get('traced') === 'yes',
      declaration: null,
    });
    return json(res, 200, { tripId });
  }
  const m = /^\/trips\/([^/]+)\/no-show$/.exec(path);
  if (m === null) return false;
  const token = tokenOf(req);
  if (token === undefined) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
  const t = noShows.get(m[1]);
  const role =
    t === undefined ? null : token === t.guest ? 'GUEST' : token === t.host ? 'HOST' : null;
  if (t === undefined || role === null) {
    return err(res, 404, 'NO_SHOW_NOT_FOUND', 'common.noShow.notFound');
  }
  const absent = role === 'HOST' ? 'GUEST' : 'HOST';
  const blocker =
    t.declaration !== null
      ? 'CANCELLATION_PENDING'
      : role === 'GUEST' && !t.traced
        ? 'NO_SHOW_EVIDENCE_REQUIRED'
        : null;
  if (req.method === 'GET') {
    return json(res, 200, {
      tripId: m[1],
      viewerRole: role,
      absentParty: absent,
      tripStatus: 'CHECKIN_OPEN',
      timezone: INSPECTION_TZ,
      scheduledStart: NO_SHOW_START,
      declarableFrom: role === 'HOST' ? '2036-12-10T13:00:00.000Z' : '2036-12-10T12:30:00.000Z',
      declarableUntil: '2036-12-13T12:00:00.000Z',
      canDeclare: blocker === null,
      blocker,
      messageTraced: t.traced,
      declaration:
        t.declaration === null
          ? null
          : {
              id: t.declaration.id,
              requestedReason: t.declaration.reason,
              status: t.declaration.status,
              requestedAt: NO_SHOW_AT,
              mine: t.declaration.by === role,
            },
    });
  }
  if (req.method !== 'POST') return false;
  const b = (await readBody(req)) ?? {};
  const keys = Object.keys(b);
  if (keys.length !== 1 || typeof b.requestId !== 'string' || !UUID_RE.test(b.requestId)) {
    return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
  }
  if (t.declaration !== null && t.declaration.id === b.requestId && t.declaration.by === role) {
    return json(res, 200, {
      declarationId: b.requestId,
      requestedAt: NO_SHOW_AT,
      status: t.declaration.status,
    });
  }
  if (blocker === 'CANCELLATION_PENDING') {
    return err(res, 409, 'CANCELLATION_PENDING', 'common.noShow.pending');
  }
  if (blocker === 'NO_SHOW_EVIDENCE_REQUIRED') {
    return err(res, 409, 'NO_SHOW_EVIDENCE_REQUIRED', 'common.noShow.evidenceRequired');
  }
  t.declaration = {
    id: b.requestId,
    by: role,
    reason: absent === 'GUEST' ? 'GUEST_NO_SHOW' : 'HOST_NO_SHOW',
    // le signalement du voyageur attend la validation de l'ops (US-307, ADR-191)
    status: role === 'GUEST' ? 'AWAITING_REVIEW' : 'PENDING',
  };
  return json(res, 200, {
    declarationId: b.requestId,
    requestedAt: NO_SHOW_AT,
    status: t.declaration.status,
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname;
  if ((await paymentRoute(req, res, url)) !== false) return;
  if ((await hostRequestRoute(req, res, url)) !== false) return;
  if ((await contractRoute(req, res, url)) !== false) return;
  if ((await inspectionRoute(req, res, url)) !== false) return;
  if ((await handoverRoute(req, res, url)) !== false) return;
  if ((await noShowRoute(req, res, url)) !== false) return;
  if ((await constanciaRoute(req, res, url)) !== false) return;
  if (refundRoute(req, res, url) !== false) return;
  if (receiptRoute(req, res, url) !== false) return;
  if (earningsRoute(req, res, url) !== false) return;
  if (payoutsRoute(req, res, url) !== false) return;
  if ((await messagesRoute(req, res, url)) !== false) return;
  if ((await meetingsRoute(req, res, url)) !== false) return;
  if ((await reviewsRoute(req, res, url)) !== false) return;
  if ((await helpRoute(req, res, url)) !== false) return;
  if (guestTripsRoute(req, res, url) !== false) return;
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
  // déclaration d'entrée (US-209b, écran de 209c ; 16 VER-007) : mêmes refus que l'API ; « aujourd'hui »
  // = jour de l'horloge figée des e2e (FROZEN_AT, 3 novembre 2026), date future ⇒ 422
  if (path === '/identity/entry-declaration') {
    const s = sessionOf(req);
    if (!s) return err(res, 401, 'AUTH_REQUIRED', 'common.auth.sessionRequired');
    if (!COUNTRIES.some((c) => c.code === body.country)) {
      return err(res, 400, 'COUNTRY_UNKNOWN', 'common.legal.countryUnknown');
    }
    const day = body.entryDate ?? null;
    const calendarDay =
      typeof day === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(day) &&
      !Number.isNaN(Date.parse(`${day}T00:00:00Z`)) &&
      new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
    if (
      !['TOURIST', 'RESIDENT'].includes(body.residencyStatus) ||
      (day !== null && !calendarDay) ||
      (body.residencyStatus === 'TOURIST' && day === null) ||
      Object.keys(body).some((k) => !['country', 'residencyStatus', 'entryDate'].includes(k))
    ) {
      return err(res, 400, 'REQUEST_INVALID', 'common.auth.requestInvalid');
    }
    if (day !== null && day > ENTRY_TODAY) {
      return err(res, 422, 'KYC_ENTRY_DATE_INVALID', 'common.kyc.entryDateInvalid');
    }
    identityOf(s.email).entry = { residencyStatus: body.residencyStatus, entryDate: day };
    return err(res, 200, 'ENTRY_DECLARED', 'common.kyc.entryDeclared');
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

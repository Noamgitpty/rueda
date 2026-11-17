/**
 * Contrat de location d'un trip côté site (US-211 partie 211b, ADR-149 ; 10b S09, A03, UX-51) :
 * lecture DÉFENSIVE de `GET /trips/{id}/contract` (toute forme inattendue ⇒ `null`, l'écran dit
 * l'erreur, jamais un contrat partiel) et relais du PDF `GET /trips/{id}/contract/pdf` (octets de
 * l'API tels quels, sans cache, empreinte transmise). Côté serveur seulement ; jamais de donnée
 * personnelle dans une URL ni dans un journal.
 */
import { apiUrl, SESSION_COOKIE } from './api-client.ts';
import type { ApiResult, ClientContext } from './api-client.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MINOR = /^-?(0|[1-9][0-9]{0,17})$/;
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const STYLES = ['title', 'h', 'p', 'kv', 'note', 'sig'] as const;
export type ContractLineStyle = (typeof STYLES)[number];

export interface ContractLineView {
  readonly style: ContractLineStyle;
  readonly text: string;
}

export interface ContractPartView {
  readonly lang: string;
  readonly authoritative: boolean;
  readonly lines: readonly ContractLineView[];
}

export interface ContractSummary {
  readonly tripRef: string;
  readonly country: string;
  readonly currency: string;
  readonly currencyExponent: number;
  /** Fuseau IANA du pays du trip (heure de la signature), jamais affiché tel quel. */
  readonly timezone: string;
  /** Heure locale du pays du trip (`AAAA-MM-JJ HH:MM`). */
  readonly startLocal: string;
  readonly endLocal: string;
  readonly vehicle: { readonly make: string; readonly model: string; readonly year: number };
  readonly priceTotalMinor: string;
  readonly protection: { readonly level: string; readonly deductibleMinor: string };
  readonly depositMinor: string | null;
  readonly mileage: {
    readonly mode: 'UNLIMITED' | 'INCLUDED';
    readonly includedKm: number | null;
    readonly extraKmPriceMinor: string | null;
  };
  readonly lateGraceMinutes: number | null;
  readonly cancellation: {
    readonly freeUntilLocal: string;
    readonly penaltyDays: '1' | '1/2';
    readonly retainedMinor: string;
  } | null;
}

export interface TripContractView {
  readonly tripId: string;
  readonly viewerRole: 'GUEST' | 'HOST';
  readonly documentId: string;
  readonly version: number;
  readonly latestVersion: number;
  readonly sha256: string;
  readonly draft: boolean;
  readonly summary: ContractSummary;
  readonly parts: readonly ContractPartView[] | null;
  readonly signature: { readonly signedAt: string; readonly sealSha256: string } | null;
  readonly signable: boolean;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string): string | null => {
  const v = o[k];
  return typeof v === 'string' && v.length > 0 ? v : null;
};
const minorOf = (o: Obj, k: string): string | null => {
  const v = o[k];
  return typeof v === 'string' && MINOR.test(v) ? v : null;
};
const intOf = (o: Obj, k: string): number | null => {
  const v = o[k];
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
};

function summaryOf(v: unknown): ContractSummary | null {
  if (!isObj(v) || !isObj(v['vehicle']) || !isObj(v['protection']) || !isObj(v['mileage'])) {
    return null;
  }
  const vehicle = v['vehicle'];
  const protection = v['protection'];
  const mileage = v['mileage'];
  const tripRef = str(v, 'tripRef');
  const country = str(v, 'country');
  const currency = str(v, 'currency');
  const exponent = intOf(v, 'currencyExponent');
  const timezone = str(v, 'timezone');
  const start = str(v, 'startLocal');
  const end = str(v, 'endLocal');
  const make = str(vehicle, 'make');
  const model = str(vehicle, 'model');
  const year = intOf(vehicle, 'year');
  const total = minorOf(v, 'priceTotalMinor');
  const level = str(protection, 'level');
  const deductible = minorOf(protection, 'deductibleMinor');
  const mode = mileage['mode'];
  if (
    tripRef === null ||
    country === null ||
    !/^[A-Z]{2}$/.test(country) ||
    currency === null ||
    exponent === null ||
    timezone === null ||
    start === null ||
    !LOCAL.test(start) ||
    end === null ||
    !LOCAL.test(end) ||
    make === null ||
    model === null ||
    year === null ||
    total === null ||
    level === null ||
    deductible === null ||
    (mode !== 'UNLIMITED' && mode !== 'INCLUDED')
  ) {
    return null;
  }
  const deposit = v['depositMinor'] === null ? null : minorOf(v, 'depositMinor');
  if (v['depositMinor'] !== null && deposit === null) return null;
  const km = mileage['includedKm'] === null ? null : intOf(mileage, 'includedKm');
  const extra =
    mileage['extraKmPriceMinor'] === null ? null : minorOf(mileage, 'extraKmPriceMinor');
  if (mode === 'INCLUDED' && (km === null || extra === null)) return null;
  const grace = v['lateGraceMinutes'] === null ? null : intOf(v, 'lateGraceMinutes');
  let cancellation: ContractSummary['cancellation'] = null;
  const c = v['cancellation'];
  if (c !== null) {
    if (!isObj(c)) return null;
    const until = str(c, 'freeUntilLocal');
    const days = c['penaltyDays'];
    const retained = minorOf(c, 'retainedMinor');
    if (
      until === null ||
      !LOCAL.test(until) ||
      (days !== '1' && days !== '1/2') ||
      retained === null
    ) {
      return null;
    }
    cancellation = { freeUntilLocal: until, penaltyDays: days, retainedMinor: retained };
  }
  return {
    tripRef,
    country,
    currency,
    currencyExponent: exponent,
    timezone,
    startLocal: start,
    endLocal: end,
    vehicle: { make, model, year },
    priceTotalMinor: total,
    protection: { level, deductibleMinor: deductible },
    depositMinor: deposit,
    mileage: { mode, includedKm: km, extraKmPriceMinor: extra },
    lateGraceMinutes: grace,
    cancellation,
  };
}

function partsOf(v: unknown): ContractPartView[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.length === 0 || v.length > 2) return undefined;
  const out: ContractPartView[] = [];
  for (const p of v as unknown[]) {
    if (!isObj(p) || !Array.isArray(p['lines'])) return undefined;
    const lang = p['lang'];
    if (lang !== 'es' && lang !== 'en' && lang !== 'fr' && lang !== 'pt') return undefined;
    const lines: ContractLineView[] = [];
    for (const l of p['lines'] as unknown[]) {
      if (
        !isObj(l) ||
        typeof l['text'] !== 'string' ||
        !(STYLES as readonly unknown[]).includes(l['style'])
      ) {
        return undefined;
      }
      lines.push({ style: l['style'] as ContractLineStyle, text: l['text'] });
    }
    out.push({ lang, authoritative: p['authoritative'] === true, lines });
  }
  return out;
}

/** Version du contrat d'une réponse 200 de `GET /trips/{id}/contract`, sinon `null`. */
export function tripContractOf(reply: ApiResult): TripContractView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const role = j['viewerRole'];
  const summary = summaryOf(j['summary']);
  const parts = partsOf(j['parts']);
  const version = intOf(j, 'version');
  const latest = intOf(j, 'latestVersion');
  const tripId = str(j, 'tripId');
  const documentId = str(j, 'documentId');
  const sha = str(j, 'sha256');
  let signature: TripContractView['signature'] = null;
  if (j['signature'] !== null) {
    const s = j['signature'];
    if (!isObj(s)) return null;
    const at = str(s, 'signedAt');
    const seal = str(s, 'sealSha256');
    if (at === null || !Number.isFinite(Date.parse(at)) || seal === null || !HEX64.test(seal)) {
      return null;
    }
    signature = { signedAt: at, sealSha256: seal };
  }
  if (
    (role !== 'GUEST' && role !== 'HOST') ||
    summary === null ||
    parts === undefined ||
    version === null ||
    latest === null ||
    version < 1 ||
    version > latest ||
    tripId === null ||
    !UUID.test(tripId) ||
    documentId === null ||
    !UUID.test(documentId) ||
    sha === null ||
    !HEX64.test(sha) ||
    typeof j['draft'] !== 'boolean' ||
    typeof j['signable'] !== 'boolean'
  ) {
    return null;
  }
  return {
    tripId,
    viewerRole: role,
    documentId,
    version,
    latestVersion: latest,
    sha256: sha,
    draft: j['draft'],
    summary,
    parts,
    signature,
    signable: j['signable'],
  };
}

/**
 * Heure locale du pays (`AAAA-MM-JJ HH:MM`, déjà dans le fuseau du trip) comme instant à formater
 * en UTC : la date et l'heure affichées sont exactement celles du contrat.
 */
export function localInstant(local: string): Date {
  return new Date(`${local.replace(' ', 'T')}:00.000Z`);
}

/** Nom du pays dans la langue de la vue (`Intl.DisplayNames`), sinon son code. */
export function countryName(tag: string, code: string): string {
  try {
    return new Intl.DisplayNames([tag], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Env = Readonly<Record<string, string | undefined>>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const noStore = (status: number): Response =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * PDF du contrat relayé depuis l'API avec la session du visiteur : 200 (octets tels quels, nom du
 * fichier, empreinte), sinon un statut vide (401 sans session, 404 pour tout refus : rien n'est
 * révélé, 503 API absente). Jamais mis en cache.
 */
export async function relayContractPdf(
  tripId: string,
  version: string | null,
  ctx: ClientContext,
  options: { env?: Env; fetcher?: Fetcher } = {},
): Promise<Response> {
  if (!UUID.test(tripId) || (version !== null && !/^[1-9][0-9]{0,3}$/.test(version))) {
    return noStore(404);
  }
  if (ctx.sessionToken === null || !/^[A-Za-z0-9_-]{43}$/.test(ctx.sessionToken)) {
    return noStore(401);
  }
  const base = apiUrl(options.env);
  if (base === undefined) return noStore(503);
  const path = `trips/${tripId}/contract/pdf${version === null ? '' : `?version=${version}`}`;
  const headers: Record<string, string> = {
    accept: 'application/pdf',
    cookie: `${SESSION_COOKIE}=${ctx.sessionToken}`,
  };
  if (ctx.forwardedFor !== null) headers['x-forwarded-for'] = ctx.forwardedFor;
  if (ctx.userAgent !== null) headers['user-agent'] = ctx.userAgent.slice(0, 512);
  try {
    const r = await (options.fetcher ?? fetch)(
      new URL(path, base.href.endsWith('/') ? base : `${base.href}/`).href,
      {
        method: 'GET',
        headers,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    );
    const type = r.headers.get('content-type') ?? '';
    const disposition = r.headers.get('content-disposition') ?? '';
    const sha = r.headers.get('x-contract-sha256') ?? '';
    if (r.status === 401) return noStore(401);
    if (
      r.status !== 200 ||
      type.split(';')[0]?.trim() !== 'application/pdf' ||
      !/^attachment; filename="contract-[A-Za-z0-9-]+-v[1-9][0-9]*(-signed)?\.pdf"$/.test(
        disposition,
      ) ||
      !HEX64.test(sha)
    ) {
      return noStore(r.status === 503 ? 503 : 404);
    }
    const bytes = await r.arrayBuffer();
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': disposition,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Contract-Sha256': sha,
      },
    });
  } catch {
    return noStore(503);
  }
}

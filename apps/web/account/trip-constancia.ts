/**
 * Constancia d'arrendamiento d'un trip côté site (US-212, ADR-162 ; 16 LEG-026 ; 10b S09, A05,
 * UX-51) : lecture DÉFENSIVE de `GET /trips/{id}/constancia` (toute forme inattendue ⇒ `null`,
 * l'écran dit l'erreur, jamais une constancia partielle), de la recherche de l'hôte
 * (`POST /trips/constancias/search`) et relais du PDF `GET /trips/{id}/constancia/pdf` (octets de
 * l'API tels quels, sans cache, empreinte transmise). Côté serveur seulement ; jamais de donnée
 * personnelle dans une URL ni dans un journal (la plaque passe dans le corps de la recherche).
 */
import { apiUrl, SESSION_COOKIE } from './api-client.ts';
import type { ApiResult, ClientContext } from './api-client.ts';
import type { ContractPartView } from './trip-contract.ts';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MINOR = /^(0|[1-9][0-9]{0,17})$/;
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const STYLES = ['title', 'h', 'p', 'kv', 'note', 'sig'] as const;
const LANGS = ['es', 'en', 'fr', 'pt'] as const;

export interface ConstanciaSummary {
  readonly tripRef: string;
  readonly country: string;
  /** Heures locales du pays du trip (`AAAA-MM-JJ HH:MM`). */
  readonly startLocal: string;
  readonly endLocal: string;
  readonly vehicle: { readonly make: string; readonly model: string; readonly year: number };
  readonly plate: string;
  readonly hostName: string;
  readonly driverName: string;
  readonly handoverPlace: string | null;
  readonly handoverCity: string;
  readonly currency: string;
  readonly currencyExponent: number;
  readonly priceTotalMinor: string;
  readonly signedAtLocal: string | null;
}

export interface TripConstanciaView {
  readonly tripId: string;
  readonly viewerRole: 'GUEST' | 'HOST';
  readonly contractVersion: number;
  readonly sha256: string;
  readonly draft: boolean;
  readonly summary: ConstanciaSummary;
  readonly parts: readonly ContractPartView[];
}

export interface ConstanciaSearchItem {
  readonly tripId: string;
  readonly tripRef: string;
  readonly startLocal: string;
  readonly endLocal: string;
}

type Obj = Readonly<Record<string, unknown>>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (o: Obj, k: string): string | null => {
  const v = o[k];
  return typeof v === 'string' && v.length > 0 ? v : null;
};
const intOf = (o: Obj, k: string): number | null => {
  const v = o[k];
  return typeof v === 'number' && Number.isSafeInteger(v) ? v : null;
};
const localOf = (o: Obj, k: string): string | null => {
  const v = str(o, k);
  return v !== null && LOCAL.test(v) ? v : null;
};

function summaryOf(v: unknown): ConstanciaSummary | null {
  if (!isObj(v) || !isObj(v['vehicle'])) return null;
  const vehicle = v['vehicle'];
  const out = {
    tripRef: str(v, 'tripRef'),
    country: str(v, 'country'),
    startLocal: localOf(v, 'startLocal'),
    endLocal: localOf(v, 'endLocal'),
    make: str(vehicle, 'make'),
    model: str(vehicle, 'model'),
    year: intOf(vehicle, 'year'),
    plate: str(v, 'plate'),
    hostName: str(v, 'hostName'),
    driverName: str(v, 'driverName'),
    handoverCity: str(v, 'handoverCity'),
    currency: str(v, 'currency'),
    exponent: intOf(v, 'currencyExponent'),
    total: str(v, 'priceTotalMinor'),
  };
  const place = v['handoverPlace'] === null ? null : str(v, 'handoverPlace');
  const signed = v['signedAtLocal'] === null ? null : localOf(v, 'signedAtLocal');
  if (
    Object.values(out).some((x) => x === null) ||
    !/^[A-Z]{2}$/.test(out.country ?? '') ||
    !MINOR.test(out.total ?? '') ||
    (v['handoverPlace'] !== null && place === null) ||
    (v['signedAtLocal'] !== null && signed === null)
  ) {
    return null;
  }
  return {
    tripRef: out.tripRef!,
    country: out.country!,
    startLocal: out.startLocal!,
    endLocal: out.endLocal!,
    vehicle: { make: out.make!, model: out.model!, year: out.year! },
    plate: out.plate!,
    hostName: out.hostName!,
    driverName: out.driverName!,
    handoverPlace: place,
    handoverCity: out.handoverCity!,
    currency: out.currency!,
    currencyExponent: out.exponent!,
    priceTotalMinor: out.total!,
    signedAtLocal: signed,
  };
}

function partsOf(v: unknown): ContractPartView[] | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const out: ContractPartView[] = [];
  for (const p of v as unknown[]) {
    if (!isObj(p) || !Array.isArray(p['lines'])) return null;
    const lang = p['lang'];
    if (!(LANGS as readonly unknown[]).includes(lang)) return null;
    const lines = [];
    for (const l of p['lines'] as unknown[]) {
      if (
        !isObj(l) ||
        typeof l['text'] !== 'string' ||
        !(STYLES as readonly unknown[]).includes(l['style'])
      ) {
        return null;
      }
      lines.push({ style: l['style'] as (typeof STYLES)[number], text: l['text'] });
    }
    out.push({ lang: lang as string, authoritative: p['authoritative'] === true, lines });
  }
  // l'espagnol fait foi et vient en premier
  return out[0]?.lang === 'es' && out[0].authoritative && !out[1]!.authoritative ? out : null;
}

/** Constancia d'une réponse 200 de `GET /trips/{id}/constancia`, sinon `null`. */
export function tripConstanciaOf(reply: ApiResult): TripConstanciaView | null {
  if (reply.status !== 200 || !isObj(reply.json)) return null;
  const j = reply.json;
  const role = j['viewerRole'];
  const tripId = str(j, 'tripId');
  const version = intOf(j, 'contractVersion');
  const sha = str(j, 'sha256');
  const summary = summaryOf(j['summary']);
  const parts = partsOf(j['parts']);
  if (
    (role !== 'GUEST' && role !== 'HOST') ||
    tripId === null ||
    !UUID.test(tripId) ||
    version === null ||
    version < 1 ||
    sha === null ||
    !HEX64.test(sha) ||
    typeof j['draft'] !== 'boolean' ||
    summary === null ||
    parts === null
  ) {
    return null;
  }
  return {
    tripId,
    viewerRole: role,
    contractVersion: version,
    sha256: sha,
    draft: j['draft'],
    summary,
    parts,
  };
}

/** Trips d'une réponse 200 de la recherche de l'hôte, sinon `null`. */
export function constanciaSearchOf(reply: ApiResult): ConstanciaSearchItem[] | null {
  if (reply.status !== 200 || !isObj(reply.json) || !Array.isArray(reply.json['trips'])) {
    return null;
  }
  const out: ConstanciaSearchItem[] = [];
  for (const t of reply.json['trips'] as unknown[]) {
    if (!isObj(t)) return null;
    const tripId = str(t, 'tripId');
    const tripRef = str(t, 'tripRef');
    const start = localOf(t, 'startLocal');
    const end = localOf(t, 'endLocal');
    if (
      tripId === null ||
      !UUID.test(tripId) ||
      tripRef === null ||
      start === null ||
      end === null
    ) {
      return null;
    }
    out.push({ tripId, tripRef, startLocal: start, endLocal: end });
  }
  return out;
}

type Env = Readonly<Record<string, string | undefined>>;
type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

const noStore = (status: number): Response =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * PDF de la constancia relayé depuis l'API avec la session du visiteur : 200 (octets tels quels,
 * nom du fichier, empreinte), sinon un statut vide (401 sans session, 404 pour tout refus : rien
 * n'est révélé, 503 API absente). Jamais mis en cache.
 */
export async function relayConstanciaPdf(
  tripId: string,
  ctx: ClientContext,
  options: { env?: Env; fetcher?: Fetcher } = {},
): Promise<Response> {
  if (!UUID.test(tripId)) return noStore(404);
  if (ctx.sessionToken === null || !/^[A-Za-z0-9_-]{43}$/.test(ctx.sessionToken)) {
    return noStore(401);
  }
  const base = apiUrl(options.env);
  if (base === undefined) return noStore(503);
  const headers: Record<string, string> = {
    accept: 'application/pdf',
    cookie: `${SESSION_COOKIE}=${ctx.sessionToken}`,
  };
  if (ctx.forwardedFor !== null) headers['x-forwarded-for'] = ctx.forwardedFor;
  if (ctx.userAgent !== null) headers['user-agent'] = ctx.userAgent.slice(0, 512);
  try {
    const r = await (options.fetcher ?? fetch)(
      new URL(`trips/${tripId}/constancia/pdf`, base.href.endsWith('/') ? base : `${base.href}/`)
        .href,
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
    const sha = r.headers.get('x-constancia-sha256') ?? '';
    if (r.status === 401) return noStore(401);
    if (
      r.status !== 200 ||
      type.split(';')[0]?.trim() !== 'application/pdf' ||
      !/^attachment; filename="constancia-[A-Za-z0-9-]+-v[1-9][0-9]*-es-(en|fr|pt)\.pdf"$/.test(
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
        'X-Constancia-Sha256': sha,
      },
    });
  } catch {
    return noStore(503);
  }
}

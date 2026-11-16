/**
 * Carte des résultats (US-203 ; 16 SRC-008 « carte avec marqueurs de prix », 10b S02 « mini-carte,
 * liste équivalente » ; 17 `MapTiles` ; ADR-131) : position de chaque marqueur, en pourcentage du
 * cadre, à partir du point APPROXIMATIF de la zone de remise (arrondi au centième de degré par la
 * base, jamais l'adresse ni le point exact). Projection équirectangulaire sur l'emprise des
 * résultats : à l'échelle d'une ville, l'écart avec une projection de Mercator est invisible.
 *
 * Fond de carte : aucun fournisseur de tuiles n'est retenu (F-04, question au fondateur) ; défaut
 * PROPOSÉ fail-closed : cadre schématique aux jetons du thème, sans tuile, aucun tiers ne reçoit
 * l'IP du visiteur. Les marqueurs et la liste viennent du MÊME tableau de résultats : mêmes
 * annonces, mêmes totaux (19 US-203 critère 1). Une annonce sans point est rendue sous la carte
 * (« sans point sur la carte »), jamais omise.
 */

export interface MapPoint {
  readonly id: string;
  readonly point: { readonly lat: number; readonly lng: number } | null;
}

/** Position d'un marqueur : pourcentages du cadre (gauche, haut), dans la marge intérieure. */
export interface MarkerPosition {
  readonly id: string;
  readonly xPct: number;
  readonly yPct: number;
}

export interface MapLayout {
  /** Annonces placées, dans l'ordre des résultats. */
  readonly placed: readonly MarkerPosition[];
  /** Annonces sans point, dans l'ordre des résultats. */
  readonly unplaced: readonly string[];
}

/** Marge intérieure du cadre (%), pour qu'un marqueur ne déborde jamais. */
const PAD_X = 20;
const PAD_Y = 16;
/** Écart minimal entre deux marqueurs (%), en dessous duquel le second est décalé. */
const MIN_DX = 22;
const MIN_DY = 13;

const round1 = (x: number): number => Math.round(x * 10) / 10;

/** Positions des marqueurs ; deux points proches (même zone arrondie) sont décalés verticalement. */
export function mapLayout(results: readonly MapPoint[]): MapLayout {
  const withPoint = results.filter(
    (r): r is MapPoint & { point: { lat: number; lng: number } } => r.point !== null,
  );
  const unplaced = results.filter((r) => r.point === null).map((r) => r.id);
  if (withPoint.length === 0) return { placed: [], unplaced };
  const lats = withPoint.map((r) => r.point.lat);
  const lngs = withPoint.map((r) => r.point.lng);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLng, maxLng] = [Math.min(...lngs), Math.max(...lngs)];
  const scale = (v: number, min: number, max: number, pad: number, invert: boolean): number => {
    if (max === min) return 50;
    const t = (v - min) / (max - min);
    return pad + (invert ? 1 - t : t) * (100 - 2 * pad);
  };
  const placed: MarkerPosition[] = [];
  for (const r of withPoint) {
    const x = scale(r.point.lng, minLng, maxLng, PAD_X, false);
    let y = scale(r.point.lat, minLat, maxLat, PAD_Y, true);
    // décalage déterministe : tant qu'un marqueur déjà placé est trop proche, descendre (puis
    // remonter depuis le haut de la marge si le bas est atteint)
    for (let guard = 0; guard < results.length + 1; guard += 1) {
      const clash = placed.some(
        (p) => Math.abs(p.xPct - x) < MIN_DX && Math.abs(p.yPct - y) < MIN_DY,
      );
      if (!clash) break;
      y += MIN_DY;
      if (y > 100 - PAD_Y) y = PAD_Y + ((y - PAD_Y) % (100 - 2 * PAD_Y));
    }
    placed.push({ id: r.id, xPct: round1(x), yPct: round1(y) });
  }
  return { placed, unplaced };
}

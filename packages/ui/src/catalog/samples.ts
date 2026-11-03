/**
 * Données d'exemple de la vitrine (`samples.json`), typées. Les devises, exposants et fuseaux sont
 * des **données** (ADR-024) : aucun code de pays, de devise ou de fuseau n'est écrit dans le code.
 */
import raw from './samples.json' with { type: 'json' };

type Tone = 1 | 2 | 3 | 4;

export interface SampleCar {
  readonly id: string;
  readonly title: string;
  readonly host: { readonly name: string; readonly tone: Tone };
  readonly rating?: number;
  readonly trips: number;
  readonly place: string;
  readonly distanceKm: number;
  readonly days: number;
  readonly currency: string;
  readonly exponent: number;
  readonly totalMinor: string;
  readonly perDayMinor: string;
  readonly carTone: Tone;
}

export interface Samples {
  readonly merchantName: string;
  readonly timeZone: string;
  readonly errorCode: string;
  readonly cars: readonly [SampleCar, SampleCar];
  readonly price: {
    readonly currency: string;
    readonly exponent: number;
    readonly days: number;
    readonly rentMinor: string;
    readonly tripFeeMinor: string;
    readonly protectionMinor: string;
    readonly taxMinor: string;
    readonly totalMinor: string;
  };
  readonly host: {
    readonly name: string;
    readonly titleForm: 'masc' | 'fem' | 'neutral';
    readonly tone: Tone;
    readonly rating: number;
    readonly trips: number;
    readonly memberSince: number;
    readonly responseRate: number;
    readonly responseHours: number;
  };
  readonly deposit: {
    readonly currency: string;
    readonly exponent: number;
    readonly amountMinor: string;
    readonly releaseBy: string;
    readonly refundIssuedOn: string;
  };
  readonly table: ReadonlyArray<{
    readonly id: string;
    readonly car: string;
    readonly guest: string;
    readonly start: string;
    readonly end: string;
    readonly status: 'confirmed' | 'pending';
    readonly earningsMinor: string;
  }>;
}

export const SAMPLES = raw as unknown as Samples;

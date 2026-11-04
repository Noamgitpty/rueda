/** Écrans du prototype US-033, par identifiant de 10b §4.1 (voyageur, hôte, plateforme). */
import type { ReactElement } from 'react';
import type { ScreenContext } from '../context.ts';
import { S04, S15 } from './account.tsx';
import { S03 } from './car.tsx';
import { S05, S06, S07 } from './checkout.tsx';
import { S17 } from './help.tsx';
import { A01, A07, A10, A11, A13 } from './host-onboarding.tsx';
import { A02, A05, A06, A08 } from './host-space.tsx';
import { A03, A04, A09, A12 } from './host-trip.tsx';
import { O01 } from './ops.tsx';
import { S14 } from './profile.tsx';
import { S01, S02 } from './search.tsx';
import { S08, S09, S09c } from './trips.tsx';

export type ScreenComponent = (props: { readonly ctx: ScreenContext }) => ReactElement;

export const SCREEN_COMPONENTS: Readonly<Record<string, ScreenComponent>> = {
  s01: S01,
  s02: S02,
  s03: S03,
  s15: S15,
  s04: S04,
  s05: S05,
  s06: S06,
  s07: S07,
  s08: S08,
  s09: S09,
  s09c: S09c,
  s17: S17,
  s14: S14,
  a01: A01,
  a07: A07,
  a10: A10,
  a11: A11,
  a13: A13,
  a02: A02,
  a05: A05,
  a06: A06,
  a03: A03,
  a04: A04,
  a12: A12,
  a08: A08,
  a09: A09,
  o01: O01,
};

/** Écrans du prototype US-033, par identifiant de 10b §4.1. */
import type { ReactElement } from 'react';
import type { ScreenContext } from '../context.ts';
import { S04, S15 } from './account.tsx';
import { S03 } from './car.tsx';
import { S05, S06, S07 } from './checkout.tsx';
import { S17 } from './help.tsx';
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
};

/**
 * N-43 / L2-PM-31 (US-208, première route de réservation du lot 2) : contrôle À L'EXÉCUTION de la
 * garde des CGU, en plus du détecteur par AST de `terms-guard-coverage.test.ts`. On lit les routes
 * réellement MONTÉES par Nest (ApiModule réel, harnais d'US-043) et, pour chacune, les gardes
 * effectives du contrôleur et de la méthode (métadonnées lues comme Nest les lit : chaîne des
 * prototypes comprise). La garde est comparée PAR IDENTITÉ à la classe `TermsGuard` : un alias,
 * une classe de base, `applyDecorators` ou un homonyme ne trompent pas le contrôle. Une différence
 * entre les chemins lus dans les métadonnées et les chemins montés (préfixe ajouté par
 * `RouterModule` ou `setGlobalPrefix`) fait échouer le test : le contrôle ne juge que des chemins
 * qu'il voit vraiment.
 */
import 'reflect-metadata';
import { applyDecorators, Controller, Post, UseGuards } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApiHarness } from '../../../testing/api-harness.js';
import type { ApiHarness } from '../../../testing/api-harness.js';
import { mappedRoutes } from '../../../testing/openapi-contract.js';
import { SessionGuard } from '../../iam/index.js';
import { BOOKING_ROUTES } from './booking-routes.js';
import { TermsGuard } from './terms.guard.js';

/** Entités de réservation (17 §2.5, §3.2.4) ; mêmes jetons que le détecteur par AST. */
const BOOKING_TOKENS = new Set([
  'hold',
  'trip',
  'booking',
  'book',
  'reservation',
  'reserve',
  'checkout',
  'quote',
  'rental',
  'rent',
]);
const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

const isBookingPath = (path: string): boolean =>
  path
    .split(/[/\-_.:{}]+/)
    .filter(Boolean)
    .some((seg) => BOOKING_TOKENS.has(seg.toLowerCase().replace(/s$/, '')));

type Ctor = abstract new (...args: never[]) => unknown;

export interface RuntimeRoute {
  readonly route: string;
  readonly booking: boolean;
  readonly guarded: boolean;
}

const pathsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map((p) => String(p).replace(/^\/+|\/+$/g, ''));

/** Routes d'un contrôleur, méthodes héritées comprises, avec leurs gardes effectives. */
export function runtimeRoutes(controller: Ctor): RuntimeRoute[] {
  const prefixes = pathsOf(Reflect.getMetadata(PATH_METADATA, controller));
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, controller) ?? []) as unknown[];
  const marked = Reflect.getMetadata(BOOKING_ROUTES, controller) === true;
  const seen = new Set<string>();
  const out: RuntimeRoute[] = [];
  for (let proto = controller.prototype as object | null; proto && proto !== Object.prototype;) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === 'constructor' || seen.has(name)) continue;
      const fn = (proto as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      const verb = Reflect.getMetadata(METHOD_METADATA, fn) as number | undefined;
      if (verb === undefined) continue;
      seen.add(name);
      const guards = [
        ...classGuards,
        ...((Reflect.getMetadata(GUARDS_METADATA, fn) ?? []) as unknown[]),
      ];
      for (const prefix of prefixes) {
        for (const sub of pathsOf(Reflect.getMetadata(PATH_METADATA, fn))) {
          const path = [prefix, sub]
            .filter(Boolean)
            .join('/')
            .replace(/:([A-Za-z]+)/g, '{$1}');
          out.push({
            route: `${VERBS[verb] ?? String(verb)} /${path}`,
            booking: marked || isBookingPath(path),
            guarded: guards.includes(TermsGuard),
          });
        }
      }
    }
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  return out;
}

describe('N-43 : TermsGuard sur toute route de réservation MONTÉE (contrôle à l’exécution)', () => {
  let h: ApiHarness;
  beforeAll(async () => {
    h = await startApiHarness();
  });
  afterAll(async () => {
    await h.close();
  });

  it('routes de l’ApiModule réel : chemins des métadonnées = chemins montés, et toute route de réservation porte TermsGuard (identité de la classe)', () => {
    const controllers = new Set<Ctor>();
    for (const module of h.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        if (typeof wrapper.metatype === 'function') controllers.add(wrapper.metatype as Ctor);
      }
    }
    const routes = [...controllers].flatMap(runtimeRoutes);
    const ours = routes.map((r) => r.route).filter((r) => /^(GET|POST|PUT|DELETE|PATCH) /.test(r));
    expect([...new Set(ours)].sort()).toEqual(mappedRoutes(h.logs));
    const booking = routes.filter((r) => r.booking);
    // les routes du checkout (US-208) et des trips de l'hôte (US-219) sont bien vues
    expect(booking.map((r) => r.route)).toEqual(
      expect.arrayContaining(['POST /checkout/quotes', 'POST /checkout/quotes/{quoteId}/hold']),
    );
    expect(booking.filter((r) => !r.guarded)).toEqual([]);
  });

  it('contournements du détecteur par AST (alias, classe de base, applyDecorators, homonyme) : tous vus et refusés', () => {
    // homonyme : une classe nommée TermsGuard qui n'est pas la garde
    const Fake = { TermsGuard: class TermsGuard {} };
    @Controller('holds')
    class Homonym {
      @Post()
      @UseGuards(SessionGuard, Fake.TermsGuard)
      place(): void {}
    }
    // classe de base : la route vient d'une méthode héritée, sans décorateur dans la sous-classe
    class Base {
      @Post('reserve')
      place(): void {}
    }
    @Controller('rentals')
    @UseGuards(SessionGuard)
    class Derived extends Base {}
    // applyDecorators : verbe et chemin regroupés dans un décorateur composé
    const BookingPost = () => applyDecorators(Post('checkout'), UseGuards(SessionGuard));
    @Controller('x')
    class Composed {
      @BookingPost()
      go(): void {}
    }
    for (const c of [Homonym, Derived, Composed]) {
      const unguarded = runtimeRoutes(c).filter((r) => r.booking && !r.guarded);
      expect(unguarded.length, c.name).toBeGreaterThan(0);
    }
    // alias de la vraie garde : accepté (c'est la même classe)
    const Alias = TermsGuard;
    @Controller('trips')
    class Aliased {
      @Post(':id/pay')
      @UseGuards(SessionGuard, Alias)
      pay(): void {}
    }
    expect(runtimeRoutes(Aliased)).toEqual([
      { route: 'POST /trips/{id}/pay', booking: true, guarded: true },
    ]);
  });
});

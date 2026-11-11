/**
 * US-102, critère 3 (revue) : AUCUNE route qui réserve sans `TermsGuard`. Lecture statique des
 * contrôleurs (même méthode que `testing/controller-routes.ts`) : toute route dont le chemin parle
 * de réservation (hold, réservation, trip, checkout, paiement d'un trip) doit porter `TermsGuard`
 * sur la méthode ou sur la classe. Au lot 1, aucune route de réservation n'existe encore (AVL et
 * PAY n'exposent que des commandes en base et les webhooks) : le test garde la porte pour les
 * stories du lot 2 (US-2xx), et un cas fabriqué prouve que le détecteur refuse un oubli.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODULES = fileURLToPath(new URL('../../', import.meta.url));
/** Chemins de réservation (préfixe + sous-chemin) ; les webhooks PSP n'en sont pas. */
const BOOKING =
  /(^|\/)(holds?|bookings?|reservations?|trips?|checkout|quotes?\/[^/]+\/book)(\/|$)/i;

interface Route {
  readonly file: string;
  readonly route: string;
  readonly guarded: boolean;
}

export function bookingRoutes(file: string, source: string): Route[] {
  const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
  const classStart = source.indexOf('export class');
  const classGuards =
    /@UseGuards\(([^)]*)\)/.exec(source.slice(0, Math.max(classStart, 0)))?.[1] ?? '';
  const out: Route[] = [];
  const decorator = /@(Get|Post|Put|Patch|Delete)\((?:'([^']*)')?\)/g;
  for (const m of source.matchAll(decorator)) {
    const path = [prefix, m[2] ?? ''].filter(Boolean).join('/');
    if (!BOOKING.test(path) || path.startsWith('webhooks')) continue;
    // groupe de décorateurs de la méthode : depuis la fin du membre précédent jusqu'à son nom
    const before = source.slice(0, m.index);
    const start = Math.max(
      before.lastIndexOf('}\n'),
      before.lastIndexOf('{\n'),
      before.lastIndexOf(';\n'),
    );
    const rest = source.slice(m.index);
    const end = rest.search(/\n\s*(async\s+)?[a-zA-Z_]\w*\s*\(/);
    const group = source.slice(start, m.index + (end === -1 ? rest.length : end));
    const guarded = /TermsGuard/.test(classGuards) || /TermsGuard/.test(group);
    out.push({ file, route: `${(m[1] as string).toUpperCase()} /${path}`, guarded });
  }
  return out;
}

describe('TermsGuard sur toute route de réservation (US-102)', () => {
  it('chaque route de réservation d’un contrôleur porte TermsGuard', () => {
    const files = readdirSync(MODULES, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.controller.ts'),
    );
    expect(files.length).toBeGreaterThan(0);
    const routes = files.flatMap((f) => bookingRoutes(f, readFileSync(join(MODULES, f), 'utf8')));
    expect(routes.filter((r) => !r.guarded)).toEqual([]);
  });

  it('le détecteur refuse une route de réservation sans la garde, et accepte méthode ou classe gardée', () => {
    const bare = `@Controller('holds')\nexport class C {\n  @Post()\n  @UseGuards(SessionGuard)\n  async place() {}\n}`;
    expect(bookingRoutes('x', bare)).toEqual([{ file: 'x', route: 'POST /holds', guarded: false }]);
    const method = `@Controller('trips')\nexport class C {\n  @Post(':id/pay')\n  @UseGuards(SessionGuard, TermsGuard)\n  async pay() {}\n}`;
    expect(bookingRoutes('x', method)[0]?.guarded).toBe(true);
    const klass = `@Controller('checkout')\n@UseGuards(SessionGuard, TermsGuard)\nexport class C {\n  @Post()\n  async go() {}\n}`;
    expect(bookingRoutes('x', klass)[0]?.guarded).toBe(true);
    // hors réservation : ignoré
    expect(
      bookingRoutes(
        'x',
        `@Controller('legal')\nexport class C {\n  @Get('documents')\n  d() {}\n}`,
      ),
    ).toEqual([]);
  });
});

/**
 * US-102, critère 3 (revues de la PR 102) : AUCUNE route qui réserve sans `TermsGuard`. Analyse par
 * l'AST TypeScript (compilateur du dépôt), jamais par motifs de texte : seuls comptent les
 * décorateurs réels (`@Controller`, `@Get` … `@All`, `@UseGuards`), les commentaires sont ignorés,
 * les deux formes de guillemets et `@Controller({ path })` sont lues, et un chemin qui n'est pas un
 * littéral (constante, expression) est REFUSÉ : il ne peut pas être jugé (fail-closed).
 *
 * Route de réservation : contrôleur marqué `@BookingRoutes()` (`booking-routes.ts`), ou chemin dont
 * un segment désigne une entité de réservation de 17 §2.5 / §3.2.4 (hold, trip, booking,
 * réservation, checkout, devis, location). Elle doit porter `TermsGuard` sur la méthode ou la classe.
 * Au lot 1, aucune route de réservation n'existe : le test garde la porte pour le lot 2 (US-2xx), et
 * les cas fabriqués (contournements relevés par la revue qa de la PR 102) prouvent le détecteur.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const MODULES = fileURLToPath(new URL('../../', import.meta.url));
const ROUTE_DECORATORS = new Set([
  'Get',
  'Post',
  'Put',
  'Patch',
  'Delete',
  'All',
  'Head',
  'Options',
]);
/** Entités de réservation (17 §2.5, §3.2.4 : checkout_hold, trip, booking, quote) ; singulier. */
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

export interface RouteFinding {
  readonly file: string;
  readonly route: string;
  readonly booking: boolean;
  readonly guarded: boolean;
  /** Chemin non littéral : la route ne peut pas être jugée (refusée). */
  readonly unresolved: boolean;
}

const nameOf = (d: ts.Decorator): string | null => {
  const e = ts.isCallExpression(d.expression) ? d.expression.expression : d.expression;
  return ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : null;
};
const argsOf = (d: ts.Decorator): readonly ts.Expression[] =>
  ts.isCallExpression(d.expression) ? d.expression.arguments : [];

/** Chemins littéraux d'un argument de décorateur ; `null` si non littéral. */
function literalPaths(arg: ts.Expression | undefined, allowObject: boolean): string[] | null {
  if (arg === undefined) return [''];
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return [arg.text];
  if (ts.isArrayLiteralExpression(arg)) {
    const all = arg.elements.map((e) => literalPaths(e, false));
    return all.some((x) => x === null) ? null : (all as string[][]).flat();
  }
  if (allowObject && ts.isObjectLiteralExpression(arg)) {
    const path = arg.properties.find(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'path',
    );
    if (path === undefined) return [''];
    return ts.isPropertyAssignment(path) ? literalPaths(path.initializer, false) : null;
  }
  return null;
}

const guardsTerms = (decorators: readonly ts.Decorator[]): boolean =>
  decorators.some(
    (d) =>
      nameOf(d) === 'UseGuards' &&
      argsOf(d).some(
        (a) =>
          (ts.isIdentifier(a) && a.text === 'TermsGuard') ||
          (ts.isPropertyAccessExpression(a) && a.name.text === 'TermsGuard'),
      ),
  );

const isBookingPath = (path: string): boolean =>
  path
    .split(/[/\-_.:{}]+/)
    .filter(Boolean)
    .some((seg) => BOOKING_TOKENS.has(seg.toLowerCase().replace(/s$/, '')));

export function analyse(file: string, source: string): RouteFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: RouteFinding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const classDecorators = ts.getDecorators(node) ?? [];
      const controller = classDecorators.find((d) => nameOf(d) === 'Controller');
      if (controller !== undefined) {
        const prefixes = literalPaths(argsOf(controller)[0], true);
        const marked = classDecorators.some((d) => nameOf(d) === 'BookingRoutes');
        const classGuarded = guardsTerms(classDecorators);
        for (const member of node.members) {
          const decorators = ts.canHaveDecorators(member) ? (ts.getDecorators(member) ?? []) : [];
          for (const d of decorators) {
            const verb = nameOf(d);
            if (verb === null || !ROUTE_DECORATORS.has(verb)) continue;
            const subs = literalPaths(argsOf(d)[0], false);
            const unresolved = prefixes === null || subs === null;
            for (const prefix of prefixes ?? ['?']) {
              for (const sub of subs ?? ['?']) {
                const path = [prefix, sub].filter(Boolean).join('/');
                out.push({
                  file,
                  route: `${verb.toUpperCase()} /${path}`,
                  booking: marked || unresolved || isBookingPath(path),
                  guarded: classGuarded || guardsTerms(decorators),
                  unresolved,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const sourceFiles = (): string[] =>
  readdirSync(MODULES, { recursive: true, encoding: 'utf8' }).filter(
    (f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f) && !/(^|[\\/])testing[\\/]/.test(f),
  );

describe('TermsGuard sur toute route de réservation (US-102)', () => {
  it('toute route d’un contrôleur a un chemin littéral, et toute route de réservation porte TermsGuard', () => {
    const findings = sourceFiles().flatMap((f) =>
      analyse(f, readFileSync(join(MODULES, f), 'utf8')),
    );
    expect(findings.length).toBeGreaterThan(10); // les contrôleurs existants sont bien lus
    expect(findings.filter((r) => r.unresolved)).toEqual([]);
    expect(findings.filter((r) => r.booking && !r.guarded)).toEqual([]);
  });

  const one = (src: string) => analyse('x.ts', src);
  const unguardedBooking = (src: string) => one(src).filter((r) => r.booking && !r.guarded);

  it('contournements relevés par la revue qa de la PR 102 : tous refusés', () => {
    const cases: Record<string, string> = {
      commentaire: `@Controller('holds')\nclass C {\n  // TermsGuard viendra\n  @Post()\n  @UseGuards(SessionGuard)\n  place() {}\n}`,
      'commentaire de doc': `@Controller('holds')\nclass C {\n  /** TermsGuard : plus tard */\n  @Post()\n  @UseGuards(SessionGuard /* TermsGuard */)\n  place() {}\n}`,
      'guillemets doubles': `@Controller("holds")\nclass C {\n  @Post("x")\n  place() {}\n}`,
      'forme objet': `@Controller({ path: 'holds' })\nclass C {\n  @Post()\n  place() {}\n}`,
      'chemin hors de l’ancienne liste': `@Controller('rentals')\nclass C {\n  @Post(':id/reserve')\n  place() {}\n}`,
      'chemin en constante': `const HOLD_PATH = 'holds';\n@Controller('x')\nclass C {\n  @Post(HOLD_PATH)\n  place() {}\n}`,
      'préfixe en constante': `@Controller(PREFIX)\nclass C {\n  @Get()\n  list() {}\n}`,
      '@All et @Head': `@Controller('trips')\nclass C {\n  @All()\n  a() {}\n  @Head()\n  h() {}\n}`,
      'contrôleur marqué': `@Controller('desk')\n@BookingRoutes()\nclass C {\n  @Post('go')\n  go() {}\n}`,
      'chaîne contenant TermsGuard': `@Controller('trips')\nclass C {\n  @Post()\n  @UseGuards(SessionGuard, 'TermsGuard' as never)\n  go() {}\n}`,
    };
    for (const [name, src] of Object.entries(cases)) {
      expect(unguardedBooking(src).length, name).toBeGreaterThan(0);
    }
  });

  it('accepte la garde réelle sur la méthode ou sur la classe ; ignore les routes hors réservation', () => {
    expect(
      unguardedBooking(
        `@Controller('trips')\nclass C {\n  @Post(':id/pay')\n  @UseGuards(SessionGuard, TermsGuard)\n  pay() {}\n}`,
      ),
    ).toEqual([]);
    expect(
      unguardedBooking(
        `@Controller({ path: "checkout" })\n@UseGuards(SessionGuard, TermsGuard)\nclass C {\n  @Post()\n  go() {}\n}`,
      ),
    ).toEqual([]);
    expect(one(`@Controller('legal')\nclass C {\n  @Get('documents')\n  d() {}\n}`)).toEqual([
      {
        file: 'x.ts',
        route: 'GET /legal/documents',
        booking: false,
        guarded: false,
        unresolved: false,
      },
    ]);
  });
});

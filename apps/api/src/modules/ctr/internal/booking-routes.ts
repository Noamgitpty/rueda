/**
 * Marqueur explicite d'un contrôleur de réservation (US-102) : `@BookingRoutes()` sur la classe.
 * Toute route d'un contrôleur marqué doit porter `TermsGuard` ; le contrôle est fait par
 * `terms-guard-coverage.test.ts` (AST TypeScript), en plus des chemins qui désignent une entité de
 * réservation. Métadonnée seulement : aucun effet à l'exécution.
 */
import { SetMetadata } from '@nestjs/common';

export const BOOKING_ROUTES = 'rueda:booking-routes';
export const BookingRoutes = (): ClassDecorator => SetMetadata(BOOKING_ROUTES, true);

/**
 * Service de la remise et du retour entre particuliers (US-315 ; 19 US-315 ; 16 TRP-002, VER-015,
 * TRP-033 ; ADR-183). Toute règle est jugée par la base (conditions de la remise, six points du
 * permis, séries de photos, relevés, seconde validation, heure serveur) : le service lit les corps
 * strictement, appelle la commande et traduit l'issue. Aucune heure n'est lue du client ; aucune
 * file hors ligne (base injoignable ⇒ 503 HANDOVER_UNAVAILABLE, « réessayer », L3-PM-14).
 * Journaux : aucun ; jamais un identifiant ni une donnée personnelle.
 */
import { Inject, Injectable } from '@nestjs/common';
import { UNAVAILABLE_MIT_CONSENTS } from '../../../pay/index.js';
import type { MitConsentPort } from '../../../pay/index.js';
import { TRP_HANDOVER_STORE, TRP_MIT_REMINDERS } from '../tokens.js';
import { HandoverHttpError, handoverOutcomeCode } from './errors.js';
import {
  handoverKindOf,
  parseIdentityRequest,
  parseOpenRequest,
  parseValidateRequest,
} from './model.js';
import type { HandoverKind } from './model.js';
import { HandoverStoreError } from './store.js';
import type { HandoverStore, HandoverValidationRow, HandoverViewRow } from './store.js';

type Body = Readonly<Record<string, unknown>>;

const isoOrNull = (d: Date | null): string | null => (d === null ? null : d.toISOString());
const validationOf = (v: HandoverValidationRow | null) =>
  v === null
    ? null
    : {
        validatedAt: v.validatedAt.toISOString(),
        odometerKm: v.odometerKm,
        fuelEighths: v.fuelEighths,
      };

export interface HandoverView {
  readonly tripId: string;
  readonly direction: 'checkin' | 'checkout';
  readonly viewerRole: HandoverViewRow['viewerRole'];
  readonly tripStatus: string;
  readonly timezone: string;
  readonly opensAt: string | null;
  readonly open: boolean;
  readonly canOpen: boolean;
  readonly blockers: readonly string[];
  readonly identityCheck: { readonly status: string; readonly checkedAt: string | null } | null;
  readonly guest: HandoverViewRow['guest'];
  readonly photos: HandoverViewRow['photos'];
  readonly validations: {
    readonly mine: ReturnType<typeof validationOf>;
    readonly other: ReturnType<typeof validationOf>;
  };
  readonly contactlessOffered: boolean;
  readonly completedAt: string | null;
}

@Injectable()
export class HandoverService {
  constructor(
    @Inject(TRP_HANDOVER_STORE) private readonly store: HandoverStore,
    /** US-703 : rappel du consentement MIT confirmé par le voyageur à la remise (PAY, 0169). */
    @Inject(TRP_MIT_REMINDERS)
    private readonly reminders: MitConsentPort = UNAVAILABLE_MIT_CONSENTS,
  ) {}

  async #call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HandoverStoreError) throw new HandoverHttpError('HANDOVER_UNAVAILABLE');
      throw error;
    }
  }

  #kind(segment: string): HandoverKind {
    const kind = handoverKindOf(segment);
    if (kind === null) throw new HandoverHttpError('HANDOVER_NOT_FOUND');
    return kind;
  }

  async view(proof: Buffer, tripId: string, segment: string): Promise<HandoverView> {
    const kind = this.#kind(segment);
    const v = await this.#call(() => this.store.view(proof, tripId, kind));
    if (v === null) throw new HandoverHttpError('HANDOVER_NOT_FOUND');
    return {
      tripId,
      direction: kind === 'CHECKIN' ? 'checkin' : 'checkout',
      viewerRole: v.viewerRole,
      tripStatus: v.tripStatus,
      timezone: v.timezone,
      opensAt: isoOrNull(v.opensAt),
      open: v.open,
      canOpen: v.canOpen,
      blockers: v.blockers,
      identityCheck:
        v.identityCheck === null
          ? null
          : { status: v.identityCheck.status, checkedAt: isoOrNull(v.identityCheck.checkedAt) },
      // l'hôte, au départ seulement : prénom, initiale du nom, année de naissance (VER-015)
      guest: kind === 'CHECKIN' && v.viewerRole === 'HOST' ? v.guest : null,
      photos: v.photos,
      validations: {
        mine: validationOf(v.validations.mine),
        other: validationOf(v.validations.other),
      },
      // remise sans rencontre hors du périmètre de la bêta (OQ-P2P-05) : jamais proposée
      contactlessOffered: false,
      completedAt: isoOrNull(v.completedAt),
    };
  }

  async open(proof: Buffer, tripId: string, body: Body) {
    parseOpenRequest(body);
    const r = await this.#call(() => this.store.open(proof, tripId));
    if ((r.outcome !== 'DONE' && r.outcome !== 'ALREADY_OPEN') || r.openedAt === null) {
      throw new HandoverHttpError(handoverOutcomeCode(r.outcome));
    }
    return { tripStatus: 'CHECKIN_OPEN' as const, openedAt: r.openedAt.toISOString() };
  }

  async identity(proof: Buffer, tripId: string, body: Body) {
    const input = parseIdentityRequest(body);
    const r = await this.#call(() =>
      this.store.identity(proof, tripId, input.checklist, input.subreason),
    );
    if (
      (r.outcome !== 'DONE' && r.outcome !== 'ALREADY_CHECKED') ||
      (r.status !== 'TRIP_ID_OK' && r.status !== 'TRIP_ID_FAILED') ||
      r.checkedAt === null
    ) {
      throw new HandoverHttpError(handoverOutcomeCode(r.outcome));
    }
    return {
      status: r.status === 'TRIP_ID_OK' ? ('OK' as const) : ('FAILED' as const),
      checkedAt: r.checkedAt.toISOString(),
      alreadyChecked: r.outcome === 'ALREADY_CHECKED',
    };
  }

  async validate(proof: Buffer, tripId: string, segment: string, body: Body) {
    const kind = this.#kind(segment);
    const input = parseValidateRequest(body);
    // US-703 (16 PAY-037 « consentement écrit au check-in », ADR-189) : le voyageur valide la
    // remise sous le rappel du consentement MIT affiché par S09 ; la base l'enregistre pour le
    // voyageur du trip seulement, pendant la remise (avant la seconde validation), une fois. Un
    // échec n'empêche jamais la remise : sans rappel, aucun frais après le trip n'est débité sur
    // la carte (la dette suit le recouvrement hors carte), fail-closed pour l'argent seulement.
    if (kind === 'CHECKIN' && input.locale !== null) {
      const locale = input.locale;
      await this.reminders.acknowledgeReminder(proof, tripId, locale).catch(() => null);
    }
    const r = await this.#call(() =>
      this.store.validate(
        proof,
        tripId,
        kind,
        { odometerKm: input.odometerKm, fuelEighths: input.fuelEighths },
        input.method,
      ),
    );
    if (
      (r.outcome !== 'DONE' && r.outcome !== 'ALREADY_VALIDATED') ||
      r.validatedAt === null ||
      r.tripStatus === null
    ) {
      throw new HandoverHttpError(handoverOutcomeCode(r.outcome));
    }
    return {
      validatedAt: r.validatedAt.toISOString(),
      completed: r.completedAt !== null,
      completedAt: isoOrNull(r.completedAt),
      tripStatus: r.tripStatus,
      alreadyValidated: r.outcome === 'ALREADY_VALIDATED',
    };
  }
}

/**
 * US-122 — red team du lot 1, passe n° 2, axe téléversements (RT-L1-A15 à A17 ; US-109, US-115,
 * US-124, ClamAV fail-closed DEC-FONDATEUR-20) : types déguisés, polyglottes, dimensions et
 * tailles hors borne, antivirus indisponible, pièce lue par un autre compte, rafales. Les
 * contrôles purs de l'API (`photo-ingest.ts`, `ports.ts`) sont joués dans la suite red team de la
 * base (groupe `l0-redteam`, après tous les autres fichiers), pour que leurs échecs ne masquent
 * pas les autres suites d'intégration. Rôles de production seulement (assertion L0-05 par
 * withRole), USD (PA) et PYG (PY). Rapport : docs/team/redteam/L1-passe2.md.
 *
 * Chaque test affirme que l'attaque est BLOQUÉE : un test rouge est une faille trouvée (jamais
 * `skip`). Attendus : 17 §5 (« type MIME réel vérifié, taille maximale, analyse antivirus,
 * quarantaine avant usage »), 16 HST-012 et HST-039, pré-mortem L1-PM-41 à L1-PM-43 (RT-L1-A15 à
 * A17), ADR-099 et ADR-107. Les octets des images sont fabriqués ici, sans fichier de test ;
 * le fichier de test antivirus standard est construit en morceaux (jamais écrit tel quel).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ALL, byCountry, hostOf, otherOf, ops, rolledBack, targetOf, uuid } from './support.ts';
import type { Host, Tx } from './support.ts';
import { claimItem, first } from './support-host.ts';
import { PURPOSE, vehicleInReview } from './support-p2.ts';

// ---------------------------------------------------------------------------------------------
// Base : bornes de la commande, rafales, lecture par un autre compte
// ---------------------------------------------------------------------------------------------
const addPhoto = (
  tx: Tx,
  h: Host,
  listing: string,
  mime: string,
  bytes: number | string,
  sha = randomBytes(32),
) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_listing_photo($1, $2, $3, $4, $5, $6, $7, $8)',
    [h.hash, h.org, listing, uuid(), uuid(), mime, bytes, sha],
  );
const addDocument = (
  tx: Tx,
  h: Host,
  vehicle: string,
  type: string,
  mime: string,
  bytes: number,
  sha = randomBytes(32),
) =>
  first<{ outcome: string }>(
    tx,
    'SELECT * FROM core.catalog_cmd_add_vehicle_document($1, $2, $3, $4, $5, $6, $7, $8, $9)',
    [h.hash, h.org, vehicle, uuid(), type, mime, bytes, sha, null],
  );

describe.each(byCountry)(
  'RT-L1-A15 / A16 — commandes de dépôt de la base (%s)',
  (_country, _currency, cc) => {
    it('photo : type déclaré hors liste blanche, taille nulle ou négative, empreinte de longueur fausse : PHOTO_FORMAT, aucune ligne', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        for (const mime of [
          'image/svg+xml',
          'text/html',
          'application/pdf',
          'application/x-msdownload',
          'image/gif',
        ]) {
          expect((await addPhoto(tx, t.host, t.listing, mime, 1000)).outcome, mime).toBe(
            'PHOTO_FORMAT',
          );
        }
        for (const bytes of [0, -1]) {
          expect(
            (await addPhoto(tx, t.host, t.listing, 'image/jpeg', bytes)).outcome,
            `${bytes} octets`,
          ).toBe('PHOTO_FORMAT');
        }
        expect(
          (await addPhoto(tx, t.host, t.listing, 'image/jpeg', 1000, randomBytes(31))).outcome,
        ).toBe('PHOTO_FORMAT');
        expect((await addPhoto(tx, t.host, t.listing, 'image/jpeg', 1000)).outcome, 'témoin').toBe(
          'DONE',
        );
      });
    });

    it('pièce : type déclaré hors liste blanche, taille hors de 1 à 10 485 760, type de pièce inconnu, date folle : VEHICLE_DOCUMENT_INVALID', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
        for (const mime of ['image/svg+xml', 'text/html', 'application/zip', 'image/webp']) {
          expect(
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', mime, 1000)).outcome,
            mime,
          ).toBe('VEHICLE_DOCUMENT_INVALID');
        }
        for (const bytes of [0, -5, 10_485_761, 2 ** 40]) {
          expect(
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', bytes)).outcome,
            `${bytes} octets`,
          ).toBe('VEHICLE_DOCUMENT_INVALID');
        }
        expect(
          (await addDocument(tx, t.host, t.vehicle, 'AUTRE', 'application/pdf', 1000)).outcome,
        ).toBe('VEHICLE_DOCUMENT_INVALID');
        expect(
          (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', 10_485_760))
            .outcome,
          'témoin à la borne',
        ).toBe('DONE');
      });
    });

    it('F2-U-02 (a) : la base ne laisse pas déclarer une photo de 10 Gio (la taille est bornée comme pour une pièce, défense en profondeur)', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        const r = await addPhoto(tx, t.host, t.listing, 'image/jpeg', String(10n * 1024n ** 3n));
        expect(r.outcome).toBe('PHOTO_FORMAT');
      });
    });

    it('F2-U-02 (b) : une annonce ne reçoit pas plus de 100 photos (PROPOSÉ ; plafond par annonce) ', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        let accepted = 0;
        for (let i = 0; i < 101; i += 1) {
          if ((await addPhoto(tx, t.host, t.listing, 'image/jpeg', 100_000)).outcome === 'DONE')
            accepted += 1;
        }
        expect(accepted).toBeLessThanOrEqual(100);
      });
    });

    it('F2-U-02 (c) : un véhicule ne reçoit pas plus de 20 dépôts de pièces en une minute (PROPOSÉ ; rafale de dépôts)', async () => {
      await rolledBack(async (tx) => {
        const t = await targetOf(tx, cc);
        await tx.query('SELECT test_fixture.us109_subject_key($1)', [t.host.userId]);
        let accepted = 0;
        for (let i = 0; i < 40; i += 1) {
          if (
            (await addDocument(tx, t.host, t.vehicle, 'TITLE', 'application/pdf', 10_485_760))
              .outcome === 'DONE'
          )
            accepted += 1;
        }
        expect(accepted).toBeLessThanOrEqual(20);
      });
    });

    it('A15 — un autre hôte, un voyageur et une session absente ne déposent ni photo ni pièce sur l’annonce ou le véhicule d’autrui', async () => {
      await rolledBack(async (tx) => {
        const victim = await targetOf(tx, cc);
        const intruder = await hostOf(tx, cc.country);
        const guest = await hostOf(tx, otherOf(cc).country);
        for (const [who, h] of [
          ['hôte du même pays', intruder],
          ['hôte de l’autre pays', guest],
        ] as const) {
          const asVictim: Host = { ...h, org: victim.host.org };
          expect(
            (await addPhoto(tx, asVictim, victim.listing, 'image/jpeg', 1000)).outcome,
            who,
          ).not.toBe('DONE');
          expect(
            (await addDocument(tx, asVictim, victim.vehicle, 'TITLE', 'application/pdf', 1000))
              .outcome,
            who,
          ).not.toBe('DONE');
        }
        const forged: Host = { ...victim.host, hash: randomBytes(32) };
        expect((await addPhoto(tx, forged, victim.listing, 'image/jpeg', 1000)).outcome).not.toBe(
          'DONE',
        );
        expect(
          (await addDocument(tx, forged, victim.vehicle, 'TITLE', 'application/pdf', 1000)).outcome,
        ).not.toBe('DONE');
      });
    });
  },
);

describe.each(byCountry)(
  'RT-L1-A15 — pièce du véhicule : lue seulement par l’ops couvert (%s)',
  (country, _currency, cc) => {
    it('SUPPORT, FINANCE et OPS de l’autre pays ne lisent pas le dossier d’éligibilité (pièces) ; témoin : l’OPS du pays qui a pris l’élément le lit', async () => {
      await rolledBack(async (tx) => {
        const host = await hostOf(tx, country);
        const item = await vehicleInReview(tx, host, cc);
        const read = async (s: { hash: Buffer }) =>
          first<{ outcome: string; body: unknown }>(
            tx,
            'SELECT * FROM core.support_staff_vehicle_eligibility($1, $2, $3, $4)',
            [s.hash, uuid(), item, PURPOSE],
          );
        const denied = [
          await ops(tx, 'SUPPORT_AGENT', ALL),
          await ops(tx, 'FINANCE', ALL),
          await ops(tx, 'OPS_AGENT', [otherOf(cc).country]),
        ];
        for (const s of denied) {
          const r = await read(s);
          expect(r.outcome).not.toBe('GRANTED');
          expect(r.body ?? null).toBeNull();
        }
        const agent = await ops(tx, 'OPS_AGENT', [country]);
        await claimItem(tx, agent, item);
        expect((await read(agent)).outcome).toBe('GRANTED');
      });
    });
  },
);

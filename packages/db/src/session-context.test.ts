/**
 * Pose du contexte `app.*` (US-011, 17 §2.3) : validation et forme de l'instruction, sans base.
 * Les effets en base (politiques) sont prouvés par test/l0/l0-rls-actors.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  SESSION_SETTINGS,
  SET_SESSION_CONTEXT_SQL,
  SessionContextError,
  sessionSettings,
  setSessionContext,
} from './session-context.ts';

const A = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const B = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('sessionSettings', () => {
  it('voyageur : actor_kind et actor_id seulement ; les quatre autres vides', () => {
    expect(sessionSettings({ kind: 'GUEST', actorId: A })).toEqual({
      'app.actor_kind': 'GUEST',
      'app.actor_id': A,
      'app.org_id': '',
      'app.vehicle_scope': '',
      'app.country_scope': '',
      'app.worker_name': '',
    });
  });

  it('hôte : org_id, portée facultative en littéral de tableau ; UUID ramenés en minuscules', () => {
    const s = sessionSettings({
      kind: 'HOST',
      actorId: A.toUpperCase(),
      orgId: B,
      vehicleScope: [A, B],
    });
    expect(s['app.actor_id']).toBe(A);
    expect(s['app.org_id']).toBe(B);
    expect(s['app.vehicle_scope']).toBe(`{${A},${B}}`);
    expect(sessionSettings({ kind: 'HOST', actorId: A, orgId: B })['app.vehicle_scope']).toBe('');
    expect(
      sessionSettings({ kind: 'HOST', actorId: A, orgId: B, vehicleScope: [] })[
        'app.vehicle_scope'
      ],
    ).toBe('{}');
  });

  it('staff : portée pays au format ISO, dédoublonnée, jamais vide', () => {
    const s = sessionSettings({ kind: 'STAFF', actorId: A, countryScope: ['AA', 'BB', 'AA'] });
    expect(s['app.country_scope']).toBe('{AA,BB}');
    expect(() => sessionSettings({ kind: 'STAFF', actorId: A, countryScope: [] })).toThrow(
      SessionContextError,
    );
    for (const bad of ['aa', 'AAA', 'A', 'A,B', '{AA}', "AA'"]) {
      expect(
        () => sessionSettings({ kind: 'STAFF', actorId: A, countryScope: [bad] }),
        bad,
      ).toThrow(SessionContextError);
    }
  });

  it('travailleur : nom snake_case ; aucun identifiant de personne', () => {
    expect(sessionSettings({ kind: 'WORKER', workerName: 'booking_conversion' })).toMatchObject({
      'app.actor_kind': 'WORKER',
      'app.worker_name': 'booking_conversion',
      'app.actor_id': '',
    });
    for (const bad of ['', 'Booking', '1x', 'a-b', "x';--", 'a'.repeat(64)]) {
      expect(() => sessionSettings({ kind: 'WORKER', workerName: bad }), bad).toThrow(
        SessionContextError,
      );
    }
  });

  it('refuse tout identifiant mal formé ou un type d’acteur inconnu', () => {
    for (const bad of ['', 'x', `${A}x`, `{${A}}`, "' OR true --"]) {
      expect(() => sessionSettings({ kind: 'GUEST', actorId: bad }), bad).toThrow(
        SessionContextError,
      );
      expect(() => sessionSettings({ kind: 'HOST', actorId: A, orgId: bad }), bad).toThrow(
        SessionContextError,
      );
      expect(
        () => sessionSettings({ kind: 'HOST', actorId: A, orgId: B, vehicleScope: [bad] }),
        bad,
      ).toThrow(SessionContextError);
    }
    expect(() =>
      sessionSettings({ kind: 'AGENCY', actorId: A } as unknown as Parameters<
        typeof sessionSettings
      >[0]),
    ).toThrow(SessionContextError);
  });
});

describe('setSessionContext', () => {
  it('une seule instruction, six set_config locaux à paramètres liés, aucune valeur dans le SQL', async () => {
    const calls: { text: string; values?: unknown[] }[] = [];
    await setSessionContext(
      {
        query: async (text: string, values?: unknown[]) => {
          calls.push({ text, ...(values ? { values } : {}) });
          return {};
        },
      },
      { kind: 'HOST', actorId: A, orgId: B },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe(SET_SESSION_CONTEXT_SQL);
    expect(SET_SESSION_CONTEXT_SQL.match(/set_config\(\$\d+, \$\d+, true\)/g)).toHaveLength(6);
    expect(SET_SESSION_CONTEXT_SQL).not.toContain(A);
    expect(calls[0]?.values).toEqual(
      SESSION_SETTINGS.flatMap((n) => [
        n,
        { 'app.actor_kind': 'HOST', 'app.actor_id': A, 'app.org_id': B }[n as string] ?? '',
      ]),
    );
  });
});

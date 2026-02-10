import {
  SWEEP_ORDER,
  hasExplicitRefresherScopeInput,
  sortSweepUsers,
} from './refresher-sweep.utils';

describe('refresher-sweep.utils', () => {
  it('detects explicit refresher scope inputs', () => {
    expect(hasExplicitRefresherScopeInput({})).toBe(false);
    expect(hasExplicitRefresherScopeInput(undefined)).toBe(false);

    expect(hasExplicitRefresherScopeInput({ plexUserId: 'abc' })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ plexUserTitle: 'viewer' })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ plexAccountId: 123 })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ plexAccountTitle: 'viewer' })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ movieSectionKey: '1' })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ tvSectionKey: '2' })).toBe(true);
    expect(hasExplicitRefresherScopeInput({ seedLibrarySectionId: 7 })).toBe(true);
  });

  it('orders sweep users with admin last and deterministic tie-breakers', () => {
    expect(SWEEP_ORDER).toBe('non_admin_then_admin_last');

    const sorted = sortSweepUsers([
      {
        id: 'admin-1',
        plexAccountTitle: 'Admin',
        isAdmin: true,
        lastSeenAt: '2026-02-08T00:00:00.000Z',
      },
      {
        id: 'u2',
        plexAccountTitle: 'Beta',
        isAdmin: false,
        lastSeenAt: '2026-02-09T00:00:00.000Z',
      },
      {
        id: 'u1',
        plexAccountTitle: 'Alpha',
        isAdmin: false,
        lastSeenAt: null,
      },
      {
        id: 'u3',
        plexAccountTitle: 'alpha',
        isAdmin: false,
        lastSeenAt: null,
      },
    ]);

    expect(sorted.map((u) => u.id)).toEqual(['u1', 'u3', 'u2', 'admin-1']);
  });
});

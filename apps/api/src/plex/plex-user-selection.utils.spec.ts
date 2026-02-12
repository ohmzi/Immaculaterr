import {
  buildExcludedPlexUserIdsFromSelected,
  isPlexUserExcludedFromMonitoring,
  readConfiguredExcludedPlexUserIds,
  resolvePlexUserMonitoringSelection,
  sanitizePlexUserIds,
} from './plex-user-selection.utils';

describe('plex-user-selection.utils', () => {
  describe('sanitizePlexUserIds', () => {
    it('trims and de-duplicates values', () => {
      expect(sanitizePlexUserIds([' u1 ', 'u2', 'u1', null, 3])).toEqual([
        'u1',
        'u2',
      ]);
    });
  });

  describe('readConfiguredExcludedPlexUserIds', () => {
    it('reads configured key list and sanitizes it', () => {
      expect(
        readConfiguredExcludedPlexUserIds({
          plex: {
            userMonitoring: {
              excludedPlexUserIds: [' u3 ', 'u3', 'u2'],
            },
          },
        }),
      ).toEqual(['u3', 'u2']);
    });
  });

  describe('resolvePlexUserMonitoringSelection', () => {
    it('defaults to all selected when config is missing', () => {
      const selection = resolvePlexUserMonitoringSelection({
        settings: {},
        users: [{ id: 'a' }, { id: 'b' }],
      });
      expect(selection.selectedPlexUserIds).toEqual(['a', 'b']);
      expect(selection.excludedPlexUserIds).toEqual([]);
    });

    it('applies configured exclusions limited to known users', () => {
      const selection = resolvePlexUserMonitoringSelection({
        settings: {
          plex: {
            userMonitoring: {
              excludedPlexUserIds: ['b', 'missing'],
            },
          },
        },
        users: [{ id: 'a' }, { id: 'b' }],
      });
      expect(selection.selectedPlexUserIds).toEqual(['a']);
      expect(selection.excludedPlexUserIds).toEqual(['b']);
    });
  });

  describe('buildExcludedPlexUserIdsFromSelected', () => {
    it('computes complement of selected ids', () => {
      const excluded = buildExcludedPlexUserIdsFromSelected({
        users: [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }],
        selectedPlexUserIds: ['u1', 'u3'],
      });
      expect(excluded).toEqual(['u2']);
    });
  });

  describe('isPlexUserExcludedFromMonitoring', () => {
    it('returns true only for configured excluded users', () => {
      const settings = {
        plex: {
          userMonitoring: {
            excludedPlexUserIds: ['u10'],
          },
        },
      };
      expect(
        isPlexUserExcludedFromMonitoring({ settings, plexUserId: 'u10' }),
      ).toBe(true);
      expect(
        isPlexUserExcludedFromMonitoring({ settings, plexUserId: 'u11' }),
      ).toBe(false);
    });
  });
});

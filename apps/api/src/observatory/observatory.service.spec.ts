import { BadRequestException } from '@nestjs/common';
import { ObservatoryService } from './observatory.service';

describe('ObservatoryService library selection guard', () => {
  function makeService() {
    const settings = {
      getInternalSettings: jest.fn(),
    };

    const service = new ObservatoryService(
      {} as never,
      settings as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    return { service, settings };
  }

  it('blocks listMovies for excluded libraries', async () => {
    const { service, settings } = makeService();
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          librarySelection: {
            excludedSectionKeys: ['2'],
          },
        },
      },
      secrets: {},
    });

    await expect(
      service.listMovies({
        userId: 'u1',
        librarySectionKey: '2',
        mode: 'review',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('blocks apply for excluded libraries', async () => {
    const { service, settings } = makeService();
    settings.getInternalSettings.mockResolvedValue({
      settings: {
        plex: {
          librarySelection: {
            excludedSectionKeys: ['9'],
          },
        },
      },
      secrets: {},
    });

    await expect(
      service.apply({
        userId: 'u1',
        librarySectionKey: '9',
        mediaType: 'movie',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

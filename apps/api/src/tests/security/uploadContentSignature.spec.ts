import { BadRequestException } from '@nestjs/common';
import type { Express } from 'express';
import { CollectionArtworkService } from '../../plex/collection-artwork.service';

describe('security/upload content signature validation', () => {
  function makeService() {
    const prisma = {
      setting: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const service = new CollectionArtworkService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, prisma };
  }

  function makeFile(params: {
    mimeType: string;
    buffer: Buffer;
    originalName?: string;
  }): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname: params.originalName ?? 'poster.bin',
      encoding: '7bit',
      mimetype: params.mimeType,
      size: params.buffer.length,
      destination: '',
      filename: '',
      path: '',
      buffer: params.buffer,
      stream: null as never,
    } as Express.Multer.File;
  }

  it('rejects script payloads that pretend to be jpeg', async () => {
    const { service, prisma } = makeService();
    const disguisedScript = Buffer.from('<?php echo "owned"; ?>', 'utf8');

    await expect(
      service.saveOverride({
        plexUserId: 'plex-user-1',
        mediaType: 'movie',
        targetKind: 'immaculate_profile',
        targetId: 'default',
        file: makeFile({
          mimeType: 'image/jpeg',
          buffer: disguisedScript,
          originalName: 'shell.php.jpg',
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });

  it('rejects svg content that pretends to be webp', async () => {
    const { service, prisma } = makeService();
    const svgPayload = Buffer.from('<svg><script>alert(1)</script></svg>', 'utf8');

    await expect(
      service.saveOverride({
        plexUserId: 'plex-user-1',
        mediaType: 'tv',
        targetKind: 'watched_collection',
        targetId: 'Based on your recently watched Show',
        file: makeFile({
          mimeType: 'image/webp',
          buffer: svgPayload,
          originalName: 'payload.svg',
        }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.setting.findUnique).not.toHaveBeenCalled();
    expect(prisma.setting.upsert).not.toHaveBeenCalled();
  });
});

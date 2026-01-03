import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
} from '@nestjs/common';
import { PlexService } from './plex.service';
import { PlexServerService } from './plex-server.service';

type TestPlexServerBody = {
  baseUrl?: unknown;
  token?: unknown;
  movieLibraryName?: unknown;
  tvLibraryName?: unknown;
};

@Controller('plex')
export class PlexController {
  constructor(
    private readonly plexService: PlexService,
    private readonly plexServerService: PlexServerService,
  ) {}

  @Post('pin')
  createPin() {
    return this.plexService.createPin();
  }

  @Get('pin/:id')
  checkPin(@Param('id') id: string) {
    const pinId = Number.parseInt(id, 10);
    if (!Number.isFinite(pinId) || pinId <= 0) {
      throw new BadRequestException('Invalid pin id');
    }
    return this.plexService.checkPin(pinId);
  }

  @Get('whoami')
  whoami(@Headers('x-plex-token') plexToken?: string) {
    if (!plexToken) {
      throw new BadRequestException('Missing header: X-Plex-Token');
    }
    return this.plexService.whoami(plexToken);
  }

  @Post('test')
  async test(@Body() body: TestPlexServerBody) {
    const baseUrlRaw =
      typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const movieLibraryName =
      typeof body.movieLibraryName === 'string'
        ? body.movieLibraryName.trim()
        : '';
    const tvLibraryName =
      typeof body.tvLibraryName === 'string' ? body.tvLibraryName.trim() : '';

    if (!baseUrlRaw) throw new BadRequestException('baseUrl is required');
    if (!token) throw new BadRequestException('token is required');

    // Allow inputs like "localhost:32400" by defaulting to http://
    const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
      ? baseUrlRaw
      : `http://${baseUrlRaw}`;
    try {
      const parsed = new URL(baseUrl);
      if (!/^https?:$/i.test(parsed.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('baseUrl must be a valid http(s) URL');
    }

    const machineIdentifier =
      await this.plexServerService.getMachineIdentifier({ baseUrl, token });

    // Optional: validate that configured libraries exist.
    if (movieLibraryName || tvLibraryName) {
      const sections = await this.plexServerService.getSections({ baseUrl, token });
      const find = (title: string) =>
        sections.find((s) => s.title.toLowerCase() === title.toLowerCase());

      const movie = movieLibraryName ? find(movieLibraryName) : undefined;
      if (movieLibraryName && !movie) {
        throw new BadRequestException({
          code: 'PLEX_MOVIE_LIBRARY_NOT_FOUND',
          message: `Movie library not found: ${movieLibraryName}`,
        });
      }

      const tv = tvLibraryName ? find(tvLibraryName) : undefined;
      if (tvLibraryName && !tv) {
        throw new BadRequestException({
          code: 'PLEX_TV_LIBRARY_NOT_FOUND',
          message: `TV library not found: ${tvLibraryName}`,
        });
      }

      return {
        ok: true,
        machineIdentifier,
        libraries: {
          movie: movie ? { title: movie.title, key: movie.key } : null,
          tv: tv ? { title: tv.title, key: tv.key } : null,
        },
      };
    }

    return { ok: true, machineIdentifier };
  }
}

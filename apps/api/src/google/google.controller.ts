import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { GoogleService } from './google.service';

type TestGoogleBody = {
  apiKey?: unknown;
  cseId?: unknown;
  numResults?: unknown;
  query?: unknown;
};

@Controller('google')
export class GoogleController {
  constructor(private readonly googleService: GoogleService) {}

  @Post('test')
  test(@Body() body: TestGoogleBody) {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    const cseId = typeof body.cseId === 'string' ? body.cseId.trim() : '';
    const query =
      typeof body.query === 'string' ? body.query.trim() : 'imdb the matrix';

    let numResults = 15;
    if (
      typeof body.numResults === 'number' &&
      Number.isFinite(body.numResults)
    ) {
      numResults = Math.trunc(body.numResults);
    } else if (typeof body.numResults === 'string' && body.numResults.trim()) {
      const parsed = Number.parseInt(body.numResults.trim(), 10);
      if (Number.isFinite(parsed)) numResults = parsed;
    }

    if (!apiKey) throw new BadRequestException('GOOGLE_API_KEY is required');
    if (!cseId)
      throw new BadRequestException(
        'GOOGLE_CSE_ID (cx) is required for Google Programmable Search',
      );
    if (!query) throw new BadRequestException('query is required');

    return this.googleService.testConnection({
      apiKey,
      cseId,
      query,
      numResults,
    });
  }
}

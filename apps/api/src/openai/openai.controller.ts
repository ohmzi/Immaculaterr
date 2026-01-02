import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { OpenAiService } from './openai.service';

type TestOpenAiBody = {
  apiKey?: unknown;
};

@Controller('openai')
export class OpenAiController {
  constructor(private readonly openAiService: OpenAiService) {}

  @Post('test')
  test(@Body() body: TestOpenAiBody) {
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
    if (!apiKey) throw new BadRequestException('OPENAI_API_KEY is required');
    return this.openAiService.testConnection({ apiKey });
  }
}



import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { WebhooksService } from './webhooks.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('plex')
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  async plexWebhook(
    @Body() body: Record<string, unknown>,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const payloadRaw = body.payload;
    if (typeof payloadRaw !== 'string') {
      throw new BadRequestException('Expected multipart field "payload"');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      throw new BadRequestException('Invalid JSON in "payload" field');
    }

    const event = {
      receivedAt: new Date().toISOString(),
      payload,
      files: (files ?? []).map((f) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      })),
    };

    const persisted = await this.webhooksService.persistPlexWebhookEvent(event);
    return { ok: true, ...persisted };
  }
}

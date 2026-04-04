import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JobsModule } from '../jobs/jobs.module';
import { PlexModule } from '../plex/plex.module';
import { SettingsModule } from '../settings/settings.module';
import { WebhooksController } from './webhooks.controller';
import { PlexPollingService } from './plex-polling.service';
import { WebhookSecretService } from './webhook-secret.service';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [AuthModule, JobsModule, SettingsModule, PlexModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookSecretService, PlexPollingService],
  exports: [WebhookSecretService],
})
export class WebhooksModule {}

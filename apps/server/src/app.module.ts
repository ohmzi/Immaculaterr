import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlexModule } from './plex/plex.module';
import { WebhooksModule } from './webhooks/webhooks.module';

const webDistPath = join(__dirname, '..', '..', 'web', 'dist');
const staticImports = existsSync(webDistPath)
  ? [
      ServeStaticModule.forRoot({
        rootPath: webDistPath,
        // Keep API routes on the Nest side.
        exclude: ['/api*'],
      }),
    ]
  : [];

@Module({
  imports: [...staticImports, PlexModule, WebhooksModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

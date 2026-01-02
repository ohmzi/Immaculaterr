import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppController } from './app.controller';
import { AppService } from './app.service';

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
  imports: [...staticImports],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

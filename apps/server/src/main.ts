import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Keep the API surface separate from the UI routes we’ll serve later.
  app.setGlobalPrefix('api');

  // Dev-friendly defaults (Vite proxy, etc.)
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);
}
bootstrap();

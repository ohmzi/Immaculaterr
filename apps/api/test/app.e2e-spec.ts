import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PrismaService } from '../src/db/prisma.service';
import { createAppBasePathApiRewriteMiddleware } from '../src/public-base-path';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn(),
          } satisfies Partial<PrismaService>,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(createAppBasePathApiRewriteMiddleware('/recommendations'));
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as unknown;
        const status =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>)['status']
            : null;
        if (status !== 'ok') throw new Error('Expected { status: "ok" }');
      });
  });

  it('/recommendations/api/health (GET)', () => {
    return request(app.getHttpServer())
      .get('/recommendations/api/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as unknown;
        const status =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>)['status']
            : null;
        if (status !== 'ok') throw new Error('Expected { status: "ok" }');
      });
  });
});

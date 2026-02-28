import { NestFactory } from '@nestjs/core';
import { ensureBootstrapEnv } from '../bootstrap-env';
import { AppModule } from '../app.module';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';
import { PrismaService } from '../db/prisma.service';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunFinish(params: {
  prisma: PrismaService;
  runId: string;
  timeoutMs: number;
}) {
  const started = Date.now();
  for (;;) {
    const run = await params.prisma.jobRun.findUnique({
      where: { id: params.runId },
      select: {
        id: true,
        status: true,
        finishedAt: true,
        errorMessage: true,
        startedAt: true,
      },
    });
    if (!run) throw new Error(`Run not found: ${params.runId}`);

    if (run.status !== 'RUNNING' && run.status !== 'PENDING') return run;
    if (Date.now() - started > params.timeoutMs) return run;
    await sleep(500);
  }
}

async function main() {
  await ensureBootstrapEnv();

  const seedTitle = process.argv.slice(2).join(' ').trim() || 'Breaking Bad';

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    // Ensure Prisma is connected before we trigger background job log writes.
    const prisma = app.get(PrismaService);
    await prisma.$connect();

    const auth = app.get(AuthService);
    const jobs = app.get(JobsService);

    const userId = await auth.getFirstAdminUserId();
    if (!userId) {
      throw new Error(
        'No admin user exists. Open the web UI and complete onboarding first.',
      );
    }

    const input = {
      source: 'dryRunScript',
      plexEvent: 'media.scrobble',
      mediaType: 'episode',
      seedTitle, // TV pipeline uses show title as the seed
      seedYear: null,
      seedRatingKey: null,
      seedLibrarySectionId: null,
      seedLibrarySectionTitle: null,
      showTitle: seedTitle,
      showRatingKey: null,
      seasonNumber: 1,
      episodeNumber: 1,
      episodeTitle: 'Pilot',
      persistedPath: null,
    } as const;

    // Mirror the webhook automation: run both jobs, dry-run only (no Plex/Radarr/Sonarr writes).
    const watchedRun = await jobs.runJob({
      jobId: 'watchedMovieRecommendations',
      trigger: 'manual',
      dryRun: true,
      userId,
      input,
    });

    const immaculateRun = await jobs.runJob({
      jobId: 'immaculateTastePoints',
      trigger: 'manual',
      dryRun: true,
      userId,
      input,
    });

    // Wait for background jobs to finish before shutting down (otherwise Prisma disconnects).
    const [watchedFinal, immaculateFinal] = await Promise.all([
      waitForRunFinish({
        prisma,
        runId: watchedRun.id,
        timeoutMs: 5 * 60 * 1000,
      }),
      waitForRunFinish({
        prisma,
        runId: immaculateRun.id,
        timeoutMs: 5 * 60 * 1000,
      }),
    ]);

    const [watchedLogCount, immaculateLogCount] = await Promise.all([
      prisma.jobLogLine.count({ where: { runId: watchedRun.id } }),
      prisma.jobLogLine.count({ where: { runId: immaculateRun.id } }),
    ]);

    process.stdout.write('\n=== DRY RUN COMPLETE ===\n');
    process.stdout.write(
      `${JSON.stringify(
        {
          seedTitle,
          runs: {
            watchedMovieRecommendations: watchedRun.id,
            immaculateTastePoints: immaculateRun.id,
          },
          status: {
            watchedMovieRecommendations: watchedFinal.status,
            immaculateTastePoints: immaculateFinal.status,
          },
          logLines: {
            watchedMovieRecommendations: watchedLogCount,
            immaculateTastePoints: immaculateLogCount,
          },
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const bootstrap_env_1 = require("../bootstrap-env");
const app_module_1 = require("../app.module");
const auth_service_1 = require("../auth/auth.service");
const jobs_service_1 = require("../jobs/jobs.service");
const prisma_service_1 = require("../db/prisma.service");
async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function waitForRunFinish(params) {
    const started = Date.now();
    while (true) {
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
        if (!run)
            throw new Error(`Run not found: ${params.runId}`);
        if (run.status !== 'RUNNING' && run.status !== 'PENDING')
            return run;
        if (Date.now() - started > params.timeoutMs)
            return run;
        await sleep(500);
    }
}
async function main() {
    await (0, bootstrap_env_1.ensureBootstrapEnv)();
    const seedTitle = process.argv.slice(2).join(' ').trim() || 'Breaking Bad';
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ['error', 'warn', 'log'],
    });
    try {
        const prisma = app.get(prisma_service_1.PrismaService);
        await prisma.$connect();
        const auth = app.get(auth_service_1.AuthService);
        const jobs = app.get(jobs_service_1.JobsService);
        const userId = await auth.getFirstAdminUserId();
        if (!userId) {
            throw new Error('No admin user exists. Open the web UI and complete onboarding first.');
        }
        const input = {
            source: 'dryRunScript',
            plexEvent: 'media.scrobble',
            mediaType: 'episode',
            seedTitle,
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
        };
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
        console.log('\n=== DRY RUN COMPLETE ===');
        console.log(JSON.stringify({
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
        }, null, 2));
    }
    finally {
        await app.close();
    }
}
main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
//# sourceMappingURL=dry-run-tv-scrobble.js.map
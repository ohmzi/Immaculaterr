import { JobsScheduler } from './jobs.scheduler';

function callEnsureDefaultSchedules(scheduler: JobsScheduler) {
  const ensureDefaultSchedules = (
    scheduler as unknown as {
      ensureDefaultSchedules: () => Promise<void>;
    }
  ).ensureDefaultSchedules;
  return ensureDefaultSchedules.call(scheduler);
}

function makeScheduler() {
  const prisma = {
    jobSchedule: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
      createMany: jest.fn(),
    },
  };

  const schedulerRegistry = {
    getCronJobs: jest.fn().mockReturnValue(new Map()),
    addCronJob: jest.fn(),
    deleteCronJob: jest.fn(),
  };

  const jobsService = {
    runJob: jest.fn(),
  };

  prisma.jobSchedule.findMany.mockResolvedValue([]);
  prisma.jobSchedule.updateMany.mockResolvedValue({ count: 0 });
  prisma.jobSchedule.createMany.mockResolvedValue({ count: 0 });

  return {
    scheduler: new JobsScheduler(
      prisma as never,
      schedulerRegistry as never,
      jobsService as never,
    ),
    prisma,
  };
}

describe('JobsScheduler default schedules', () => {
  it('migrates the stale Sunday defaults without touching custom crons', async () => {
    const { scheduler, prisma } = makeScheduler();
    prisma.jobSchedule.findMany.mockResolvedValue([
      {
        jobId: 'arrMonitoredSearch',
        cron: '0 4 * * 0',
        enabled: true,
        timezone: null,
      },
      {
        jobId: 'rottenTomatoesUpcomingMovies',
        cron: '0 5 * * 0',
        enabled: false,
        timezone: null,
      },
      {
        jobId: 'tmdbUpcomingMovies',
        cron: '0 5 * * 0',
        enabled: true,
        timezone: null,
      },
      {
        jobId: 'monitorConfirm',
        cron: '15 1 * * *',
        enabled: true,
        timezone: null,
      },
    ]);

    await callEnsureDefaultSchedules(scheduler);

    expect(prisma.jobSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        jobId: 'arrMonitoredSearch',
        cron: '0 4 * * 0',
      },
      data: { cron: '0 5 * * 0' },
    });
    expect(prisma.jobSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        jobId: 'rottenTomatoesUpcomingMovies',
        cron: '0 5 * * 0',
      },
      data: { cron: '15 7 * * 0' },
    });
    expect(prisma.jobSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        jobId: 'tmdbUpcomingMovies',
        cron: '0 5 * * 0',
      },
      data: { cron: '45 7 * * 0' },
    });
    expect(prisma.jobSchedule.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jobId: 'monitorConfirm',
          cron: '15 1 * * *',
        },
      }),
    );
  });

  it('seeds the staggered Sunday defaults for new installs', async () => {
    const { scheduler, prisma } = makeScheduler();

    await callEnsureDefaultSchedules(scheduler);

    const createManyCall = prisma.jobSchedule.createMany.mock.calls[0] as
      | [
          {
            data: Array<{
              jobId: string;
              cron: string;
              enabled: boolean;
              timezone: null;
            }>;
          },
        ]
      | undefined;

    expect(createManyCall).toBeDefined();
    expect(createManyCall?.[0].data).toEqual(
      expect.arrayContaining([
        {
          jobId: 'arrMonitoredSearch',
          cron: '0 5 * * 0',
          enabled: false,
          timezone: null,
        },
        {
          jobId: 'rottenTomatoesUpcomingMovies',
          cron: '15 7 * * 0',
          enabled: false,
          timezone: null,
        },
        {
          jobId: 'tmdbUpcomingMovies',
          cron: '45 7 * * 0',
          enabled: false,
          timezone: null,
        },
      ]),
    );
  });
});

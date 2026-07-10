import { Injectable } from '@nestjs/common';
import { CuttingRoomWantedService } from '../cutting-room/cutting-room-wanted.service';
import { metricRow, type JobReportV1 } from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

/**
 * Unmonitors or removes monitored-but-file-less arr entries. Deletes no files
 * by construction (unmonitor flips a flag; remove uses deleteFiles=false).
 */
@Injectable()
export class CuttingRoomWantedPruneJob {
  constructor(private readonly wanted: CuttingRoomWantedService) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const type = input['type'] === 'sonarr' ? 'sonarr' : 'radarr';
    const instanceId =
      typeof input['instanceId'] === 'string' ? input['instanceId'] : null;
    const mode = input['mode'] === 'remove' ? 'remove' : 'unmonitor';
    const addImportExclusion = input['addImportExclusion'] === true;
    const arrIds =
      input['all'] === true
        ? ('all' as const)
        : Array.isArray(input['arrIds'])
          ? (input['arrIds'] as unknown[])
              .map((v) => Number(v))
              .filter((v) => Number.isFinite(v) && v > 0)
              .map((v) => Math.trunc(v))
          : [];

    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
    }) => {
      void ctx
        .patchSummary({
          phase: 'cuttingRoomWantedPrune',
          progress: {
            step: params.step,
            message: params.message,
            ...(typeof params.current === 'number'
              ? { current: params.current }
              : {}),
            ...(typeof params.total === 'number'
              ? { total: params.total }
              : {}),
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    };

    const summary = await this.wanted.pruneWanted({
      userId: ctx.userId,
      runId: ctx.runId,
      type,
      instanceId,
      arrIds,
      mode,
      addImportExclusion,
      dryRun: ctx.dryRun,
      progress: setProgress,
    });

    const verb = ctx.dryRun
      ? mode === 'remove'
        ? 'Would remove'
        : 'Would unmonitor'
      : mode === 'remove'
        ? 'Removed'
        : 'Unmonitored';

    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline: `${verb} ${summary.changed} of ${summary.planned} wanted-list entries — no files touched`,
      sections: [
        {
          id: 'result',
          title: 'Wanted list prune',
          rows: [
            metricRow({
              label: verb,
              start: null,
              changed: null,
              end: summary.changed,
              unit: 'entries',
            }),
            metricRow({
              label: 'Failed',
              start: null,
              changed: null,
              end: summary.failed,
              unit: 'entries',
            }),
          ],
        },
      ],
      tasks: [],
      issues:
        summary.failed > 0
          ? [
              {
                level: 'warn',
                message: `${summary.failed} entries failed — see logs and re-run.`,
              },
            ]
          : [],
      raw: { ...summary },
    };

    return { summary: report as unknown as JsonObject };
  }
}

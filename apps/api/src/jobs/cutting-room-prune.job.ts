import { Injectable } from '@nestjs/common';
import { CuttingRoomPruneService } from '../cutting-room/cutting-room-prune.service';
import {
  metricRow,
  type JobReportV1,
  simpleFailureReport,
} from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import { truncateErrorMessage } from '../log.utils';

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * Destructive executor behind the Cutting Room page's final confirmation. Every
 * mutation is guarded by dry-run; runs in waves and honors the Stop button.
 */
@Injectable()
export class CuttingRoomPruneJob {
  constructor(private readonly prune: CuttingRoomPruneService) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const snapshotId =
      typeof input['snapshotId'] === 'string' ? input['snapshotId'] : '';
    if (!snapshotId) {
      throw new Error('cuttingRoomPrune requires input.snapshotId');
    }
    const waveSize =
      typeof input['waveSize'] === 'number' && input['waveSize'] > 0
        ? Math.trunc(input['waveSize'])
        : 25;
    const removeEntry = input['removeEntry'] === true;
    const addImportExclusion = input['addImportExclusion'] === true;

    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
    }) => {
      void ctx
        .patchSummary({
          phase: 'cuttingRoomPrune',
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

    let summary: Awaited<ReturnType<typeof this.prune.runPrune>>;
    try {
      summary = await this.prune.runPrune({
        userId: ctx.userId,
        snapshotId,
        runId: ctx.runId,
        dryRun: ctx.dryRun,
        waveSize,
        removeEntry,
        addImportExclusion,
        progress: setProgress,
        log: {
          info: (message, context) =>
            ctx.info(message, context as JsonObject | undefined),
          warn: (message, context) =>
            ctx.warn(message, context as JsonObject | undefined),
        },
      });
    } catch (err) {
      const reason = truncateErrorMessage(err);
      await ctx.error('cuttingRoomPrune: run failed before completing', {
        error: reason,
      });
      return {
        summary: simpleFailureReport({
          jobId: ctx.jobId,
          dryRun: ctx.dryRun,
          trigger: ctx.trigger,
          headline: 'Cutting Room prune failed',
          taskId: 'prune',
          taskTitle: 'Prune selected candidates',
          message: `Prune selected candidates failed: ${reason}`,
        }) as unknown as JsonObject,
      };
    }

    const verb = ctx.dryRun ? 'Would prune' : 'Pruned';
    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline: `${verb} ${summary.pruned} of ${summary.planned} items (${formatGb(summary.bytesFreed)})${summary.stopped ? ' — stopped early' : ''}`,
      sections: [
        {
          id: 'result',
          title: ctx.dryRun ? 'Dry-run result' : 'Prune result',
          rows: [
            metricRow({
              label: verb,
              start: null,
              changed: null,
              end: summary.pruned,
              unit: 'items',
              note: formatGb(summary.bytesFreed),
            }),
            metricRow({
              label: 'Skipped (changed since scan)',
              start: null,
              changed: null,
              end: summary.skippedStale,
              unit: 'items',
            }),
            metricRow({
              label: 'Skipped (Plex-only, disabled)',
              start: null,
              changed: null,
              end: summary.skippedPlexOnly,
              unit: 'items',
            }),
            metricRow({
              label: 'Failed',
              start: null,
              changed: null,
              end: summary.failed,
              unit: 'items',
            }),
            metricRow({
              label: 'Waves',
              start: null,
              changed: null,
              end: summary.wavesRun,
              unit: 'waves',
            }),
          ],
        },
      ],
      tasks: [
        {
          id: 'prune',
          title: 'Prune selected candidates',
          // Total failure (nothing deleted, everything errored) fails the run.
          status:
            !ctx.dryRun && summary.failed > 0 && summary.pruned === 0
              ? ('failed' as const)
              : ('success' as const),
          facts: [
            {
              label: ctx.dryRun ? 'Would delete' : 'Pruned',
              value: String(
                ctx.dryRun ? summary.wouldDelete.length : summary.pruned,
              ),
            },
            { label: 'Failed', value: String(summary.failed) },
          ],
        },
        ...(ctx.dryRun
          ? summary.wouldDelete.slice(0, 50).map((item, index) => ({
              id: `would-${index}`,
              title: `Would delete: ${item.title}`,
              status: 'skipped' as const,
              facts: [
                { label: 'Size', value: formatGb(item.sizeBytes) },
                { label: 'Action', value: item.action },
              ],
            }))
          : []),
      ],
      issues:
        summary.failed > 0
          ? [
              {
                level:
                  !ctx.dryRun && summary.pruned === 0
                    ? ('error' as const)
                    : ('warn' as const),
                message: `${summary.failed} item(s) failed — sources kept; see logs and re-run.`,
              },
            ]
          : [],
      raw: {
        snapshotId,
        ...summary,
        wouldDelete: summary.wouldDelete as unknown as JsonObject[],
      },
    };

    return { summary: report as unknown as JsonObject };
  }
}

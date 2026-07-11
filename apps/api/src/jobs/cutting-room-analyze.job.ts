import { Injectable } from '@nestjs/common';
import { CuttingRoomAnalysisService } from '../cutting-room/cutting-room-analysis.service';
import { PrismaService } from '../db/prisma.service';
import { truncateErrorMessage } from '../log.utils';
import {
  metricRow,
  type JobReportV1,
  simpleFailureReport,
} from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * Read-only scan behind the Cutting Room page: scores the selected libraries and
 * persists candidates onto the snapshot referenced by `input.snapshotId`.
 */
@Injectable()
export class CuttingRoomAnalyzeJob {
  constructor(
    private readonly analysis: CuttingRoomAnalysisService,
    private readonly prisma: PrismaService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const snapshotId =
      typeof ctx.input?.['snapshotId'] === 'string'
        ? ctx.input['snapshotId']
        : '';
    if (!snapshotId) {
      throw new Error('cuttingRoomAnalyze requires input.snapshotId');
    }

    const setProgress = (params: {
      step: string;
      message: string;
      current?: number;
      total?: number;
    }) => {
      void ctx
        .patchSummary({
          phase: 'cuttingRoomAnalyze',
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

    await this.prisma.cuttingRoomSnapshot.update({
      where: { id: snapshotId },
      data: { status: 'RUNNING', analyzeRunId: ctx.runId },
    });

    try {
      const summary = await this.analysis.runAnalysis({
        userId: ctx.userId,
        snapshotId,
        progress: setProgress,
        log: {
          info: (message, context) =>
            ctx.info(message, context as JsonObject | undefined),
          warn: (message, context) =>
            ctx.warn(message, context as JsonObject | undefined),
        },
      });

      const tierRows = Object.entries(summary.tierAgg)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([tier, agg]) =>
          metricRow({
            label: `Tier ${tier}`,
            start: null,
            changed: null,
            end: agg.count,
            unit: 'items',
            note: formatGb(agg.bytes),
          }),
        );

      const report: JobReportV1 = {
        template: 'jobReportV1',
        version: 1,
        jobId: ctx.jobId,
        dryRun: ctx.dryRun,
        trigger: ctx.trigger,
        headline: `Found ${summary.candidateCount} prune candidates (${formatGb(summary.candidateBytes)} reclaimable) across ${summary.sectionsScanned} ${summary.mediaType} libraries`,
        sections: [
          {
            id: 'library',
            title: 'Library',
            rows: [
              metricRow({
                label: 'Items scanned',
                start: null,
                changed: null,
                end: summary.libraryCount,
                unit: 'items',
                note: formatGb(summary.libraryBytes),
              }),
              metricRow({
                label: `${summary.mediaType === 'movie' ? 'Radarr' : 'Sonarr'} entries seen`,
                start: null,
                changed: null,
                end: summary.arrItemsSeen,
                unit: 'items',
              }),
            ],
          },
          { id: 'tiers', title: 'Candidates by tier', rows: tierRows },
        ],
        tasks: [],
        issues: summary.tautulliUsed
          ? []
          : [
              {
                level: 'warn',
                message:
                  'Tautulli is not connected — watch history is limited to Plex data. Connect Tautulli in the Vault for full per-user accuracy.',
              },
            ],
        raw: {
          snapshotId,
          candidateCount: summary.candidateCount,
          candidateBytes: summary.candidateBytes,
          libraryCount: summary.libraryCount,
          libraryBytes: summary.libraryBytes,
          plexOnlyCount: summary.plexOnlyCount,
          tautulliUsed: summary.tautulliUsed,
          protectedAgg: summary.protectedAgg as unknown as JsonObject,
          tierAgg: summary.tierAgg as unknown as JsonObject,
        },
      };

      return { summary: report as unknown as JsonObject };
    } catch (err) {
      const reason = truncateErrorMessage(err);
      await this.prisma.cuttingRoomSnapshot
        .update({
          where: { id: snapshotId },
          data: {
            status: 'FAILED',
            finishedAt: new Date(),
            errorMessage: reason,
          },
        })
        .catch(() => undefined);
      await ctx.error('cuttingRoomAnalyze: analysis failed', {
        snapshotId,
        error: reason,
      });
      return {
        summary: simpleFailureReport({
          jobId: ctx.jobId,
          dryRun: ctx.dryRun,
          trigger: ctx.trigger,
          headline: 'Cutting Room scan failed',
          taskId: 'analyze',
          taskTitle: 'Scan libraries and score candidates',
          message: `Cutting Room analysis failed: ${reason}`,
          facts: [{ label: 'Snapshot', value: snapshotId }],
        }) as unknown as JsonObject,
      };
    }
  }
}

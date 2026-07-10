import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import {
  PlexDuplicatesService,
  type PlexDeletePreference,
} from '../plex/plex-duplicates.service';
import { metricRow, type JobReportV1 } from './job-report-v1';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return null;
    cur = cur[part];
  }
  return typeof cur === 'string' && cur.trim() ? cur.trim() : null;
}

function formatGb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/**
 * Deletes extra versions of selected movies via the existing Plex duplicates
 * cleaner (keep-one-version semantics). Every deletion honors dry-run.
 */
@Injectable()
export class CuttingRoomDuplicatesJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly duplicates: PlexDuplicatesService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const input = ctx.input ?? {};
    const ratingKeys = Array.isArray(input['ratingKeys'])
      ? (input['ratingKeys'] as unknown[])
          .map((v) => String(v))
          .filter((v) => v.length > 0)
      : [];
    if (ratingKeys.length === 0) {
      throw new Error('cuttingRoomDuplicates requires input.ratingKeys');
    }
    const deletePreference: PlexDeletePreference =
      input['deletePreference'] === 'largest_file'
        ? 'largest_file'
        : 'smallest_file';

    const { settings, secrets } =
      await this.settingsService.getInternalSettings(ctx.userId);
    const baseUrl =
      pickString(settings, 'plex.baseUrl') ?? pickString(settings, 'plex.url');
    const token =
      pickString(secrets, 'plex.token') ?? pickString(secrets, 'plexToken');
    if (!baseUrl || !token) {
      throw new Error('Duplicate cleanup requires a configured Plex server.');
    }

    let deleted = 0;
    let wouldDelete = 0;
    let failures = 0;
    let freedBytes = 0;
    const perTitle: Array<{ title: string; removed: number; bytes: number }> =
      [];

    for (let i = 0; i < ratingKeys.length; i += 1) {
      void ctx
        .patchSummary({
          phase: 'cuttingRoomDuplicates',
          progress: {
            step: 'cleaning',
            message: `${ctx.dryRun ? 'Rehearsing' : 'Cleaning'} ${i + 1}/${ratingKeys.length}…`,
            current: i + 1,
            total: ratingKeys.length,
            updatedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);

      try {
        const result = await this.duplicates.cleanupMovieDuplicates({
          baseUrl,
          token,
          ratingKey: ratingKeys[i],
          dryRun: ctx.dryRun,
          deletePreference,
          preserveQualityTerms: [],
        });
        deleted += result.deleted;
        wouldDelete += result.wouldDelete;
        failures += result.failures;
        const bytes = result.deletions.reduce(
          (sum, d) => sum + (d.size ?? 0),
          0,
        );
        freedBytes += bytes;
        perTitle.push({
          title: result.title || ratingKeys[i],
          removed: ctx.dryRun ? result.wouldDelete : result.deleted,
          bytes,
        });
        for (const warning of result.warnings) {
          await ctx.warn(`duplicates: ${result.title}: ${warning}`);
        }
      } catch (err) {
        failures += 1;
        await ctx.warn(
          `duplicates: ${ratingKeys[i]} failed: ${(err as Error)?.message ?? String(err)}`,
        );
      }
    }

    const verb = ctx.dryRun ? 'Would remove' : 'Removed';
    const removedTotal = ctx.dryRun ? wouldDelete : deleted;
    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline: `${verb} ${removedTotal} extra version(s) across ${ratingKeys.length} movies (${formatGb(freedBytes)})`,
      sections: [
        {
          id: 'result',
          title: 'Duplicate cleanup',
          rows: [
            metricRow({
              label: verb,
              start: null,
              changed: null,
              end: removedTotal,
              unit: 'versions',
              note: formatGb(freedBytes),
            }),
            metricRow({
              label: 'Failures',
              start: null,
              changed: null,
              end: failures,
              unit: 'items',
            }),
          ],
        },
      ],
      tasks: perTitle.slice(0, 50).map((row, index) => ({
        id: `dup-${index}`,
        title: `${row.title}: ${verb.toLowerCase()} ${row.removed} version(s)`,
        status: 'success' as const,
        facts: [{ label: 'Size', value: formatGb(row.bytes) }],
      })),
      issues:
        failures > 0
          ? [
              {
                level: 'warn',
                message: `${failures} item(s) failed — check Plex "Allow media deletion" and the logs.`,
              },
            ]
          : [],
      raw: {
        ratingKeys: ratingKeys.length,
        deleted,
        wouldDelete,
        failures,
        freedBytes,
      },
    };
    return { summary: report as unknown as JsonObject };
  }
}

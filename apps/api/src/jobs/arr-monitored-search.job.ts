import { Injectable } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { RadarrService } from '../radarr/radarr.service';
import { SonarrService } from '../sonarr/sonarr.service';
import type { JobContext, JobRunResult, JsonObject } from './jobs.types';
import type { JobReportV1 } from './job-report-v1';
import { issue, metricRow } from './job-report-v1';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function pick(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function pickString(obj: Record<string, unknown>, path: string): string | null {
  const v = pick(obj, path);
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

const pickBool = (obj: Record<string, unknown>, path: string): boolean | null => {
  const v = pick(obj, path);
  return typeof v === 'boolean' ? v : null;
};

const normalizeHttpUrl = (raw: string): string => {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

const sleep = async (ms: number) => {
  if (!Number.isFinite(ms) || ms <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, Math.trunc(ms)));
};

@Injectable()
export class ArrMonitoredSearchJob {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly radarr: RadarrService,
    private readonly sonarr: SonarrService,
  ) {}

  async run(ctx: JobContext): Promise<JobRunResult> {
    const startedAtMs = Date.now();

    const setProgress = async (step: string, message: string, context?: JsonObject) => {
      await ctx.patchSummary({
        phase: 'running',
        progress: {
          step,
          message,
          updatedAt: new Date().toISOString(),
          ...(context ?? {}),
        },
      });
    };

    await ctx.info('arrMonitoredSearch: start', {
      trigger: ctx.trigger,
      dryRun: ctx.dryRun,
    });

    await setProgress('load_settings', 'Loading settings…');

    const { settings, secrets } = await this.settingsService.getInternalSettings(
      ctx.userId,
    );

    const includeRadarr =
      pickBool(settings, 'jobs.arrMonitoredSearch.includeRadarr') ?? true;
    const includeSonarr =
      pickBool(settings, 'jobs.arrMonitoredSearch.includeSonarr') ?? true;

    const issues = [];
    const tasks: JobReportV1['tasks'] = [];

    const raw: JsonObject = {
      includeRadarr,
      includeSonarr,
    };

    if (!includeRadarr && !includeSonarr) {
      issues.push(issue('warn', 'Both Radarr and Sonarr are disabled; nothing to do.'));
    }

    const radarrBaseUrlRaw =
      pickString(settings, 'radarr.baseUrl') ?? pickString(settings, 'radarr.url');
    const radarrApiKey =
      pickString(secrets, 'radarr.apiKey') ?? pickString(secrets, 'radarrApiKey');
    const radarrEnabledSetting = pickBool(settings, 'radarr.enabled');
    const radarrIntegrationEnabled =
      (radarrEnabledSetting ?? Boolean(radarrApiKey)) === true;
    const radarrConfigured =
      radarrIntegrationEnabled && Boolean(radarrBaseUrlRaw && radarrApiKey);
    const radarrBaseUrl = radarrBaseUrlRaw ? normalizeHttpUrl(radarrBaseUrlRaw) : null;

    const sonarrBaseUrlRaw =
      pickString(settings, 'sonarr.baseUrl') ?? pickString(settings, 'sonarr.url');
    const sonarrApiKey =
      pickString(secrets, 'sonarr.apiKey') ?? pickString(secrets, 'sonarrApiKey');
    const sonarrEnabledSetting = pickBool(settings, 'sonarr.enabled');
    const sonarrIntegrationEnabled =
      (sonarrEnabledSetting ?? Boolean(sonarrApiKey)) === true;
    const sonarrConfigured =
      sonarrIntegrationEnabled && Boolean(sonarrBaseUrlRaw && sonarrApiKey);
    const sonarrBaseUrl = sonarrBaseUrlRaw ? normalizeHttpUrl(sonarrBaseUrlRaw) : null;

    raw['radarr'] = {
      enabled: includeRadarr,
      integrationEnabled: radarrIntegrationEnabled,
      configured: radarrConfigured,
      baseUrl: radarrBaseUrl,
    };
    raw['sonarr'] = {
      enabled: includeSonarr,
      integrationEnabled: sonarrIntegrationEnabled,
      configured: sonarrConfigured,
      baseUrl: sonarrBaseUrl,
    };

    if (includeRadarr && !radarrConfigured && radarrIntegrationEnabled) {
      issues.push(issue('warn', 'Radarr is enabled but not configured.'));
    }
    if (includeSonarr && !sonarrConfigured && sonarrIntegrationEnabled) {
      issues.push(issue('warn', 'Sonarr is enabled but not configured.'));
    }

    const effectiveRadarr = includeRadarr && radarrConfigured;
    const effectiveSonarr = includeSonarr && sonarrConfigured;

    const shouldDelaySonarr =
      ctx.trigger === 'schedule' && effectiveRadarr && effectiveSonarr;

    const plannedSonarrAtMs = startedAtMs + 60 * 60 * 1000;

    let radarrQueued = 0;
    let sonarrQueued = 0;
    let waitedMs = 0;

    // --- Radarr step
    if (!includeRadarr) {
      tasks.push({
        id: 'radarr',
        title: 'Radarr: MissingMoviesSearch (monitored)',
        status: 'skipped',
        issues: [],
        facts: [{ label: 'Enabled', value: false }],
      });
    } else if (!radarrConfigured) {
      tasks.push({
        id: 'radarr',
        title: 'Radarr: MissingMoviesSearch (monitored)',
        status: 'skipped',
        facts: [
          { label: 'Enabled', value: true },
          { label: 'Configured', value: false },
          {
            label: 'Result',
            value: radarrIntegrationEnabled
              ? 'Skipped: not configured.'
              : 'Skipped: integration disabled in Vault.',
          },
        ],
      });
    } else if (ctx.dryRun) {
      tasks.push({
        id: 'radarr',
        title: 'Radarr: MissingMoviesSearch (monitored)',
        status: 'skipped',
        facts: [
          { label: 'Enabled', value: true },
          { label: 'Dry run', value: true },
        ],
      });
    } else {
      await setProgress('radarr', 'Triggering Radarr MissingMoviesSearch…', {
        integration: 'radarr',
      });
      try {
        await this.radarr.searchMonitoredMovies({
          baseUrl: radarrBaseUrl as string,
          apiKey: radarrApiKey as string,
        });
        radarrQueued = 1;
        tasks.push({
          id: 'radarr',
          title: 'Radarr: MissingMoviesSearch (monitored)',
          status: 'success',
          rows: [metricRow({ label: 'Queued', start: 0, changed: 1, end: 1, unit: 'cmd' })],
          facts: [{ label: 'Base URL', value: radarrBaseUrl as string }],
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        issues.push(issue('warn', `Radarr trigger failed: ${msg}`));
        tasks.push({
          id: 'radarr',
          title: 'Radarr: MissingMoviesSearch (monitored)',
          status: 'failed',
          issues: [issue('warn', msg)],
          facts: [{ label: 'Base URL', value: radarrBaseUrl as string }],
        });
      }
    }

    // --- Optional delay before Sonarr
    if (shouldDelaySonarr && !ctx.dryRun) {
      const now = Date.now();
      const remaining = Math.max(0, plannedSonarrAtMs - now);
      waitedMs = remaining;

      await setProgress('wait', 'Waiting before starting Sonarr…', {
        integration: 'sonarr',
        plannedSonarrAt: new Date(plannedSonarrAtMs).toISOString(),
      });

      if (remaining > 0) {
        await sleep(remaining);
      }

      tasks.push({
        id: 'wait',
        title: 'Delay before Sonarr',
        status: 'success',
        rows: [
          metricRow({
            label: 'Waited',
            start: 0,
            changed: Math.round(waitedMs / 60000),
            end: Math.round(waitedMs / 60000),
            unit: 'min',
          }),
        ],
        facts: [
          { label: 'Planned Sonarr start', value: new Date(plannedSonarrAtMs).toISOString() },
        ],
      });
    } else {
      tasks.push({
        id: 'wait',
        title: 'Delay before Sonarr',
        status: 'skipped',
        facts: [
          { label: 'Applied', value: false },
          { label: 'Reason', value: shouldDelaySonarr ? 'dryRun' : 'not_required' },
        ],
      });
    }

    // --- Sonarr step
    if (!includeSonarr) {
      tasks.push({
        id: 'sonarr',
        title: 'Sonarr: MissingEpisodeSearch (monitored)',
        status: 'skipped',
        facts: [{ label: 'Enabled', value: false }],
      });
    } else if (!sonarrConfigured) {
      tasks.push({
        id: 'sonarr',
        title: 'Sonarr: MissingEpisodeSearch (monitored)',
        status: 'skipped',
        facts: [
          { label: 'Enabled', value: true },
          { label: 'Configured', value: false },
          {
            label: 'Result',
            value: sonarrIntegrationEnabled
              ? 'Skipped: not configured.'
              : 'Skipped: integration disabled in Vault.',
          },
        ],
      });
    } else if (ctx.dryRun) {
      tasks.push({
        id: 'sonarr',
        title: 'Sonarr: MissingEpisodeSearch (monitored)',
        status: 'skipped',
        facts: [
          { label: 'Enabled', value: true },
          { label: 'Dry run', value: true },
        ],
      });
    } else {
      await setProgress('sonarr', 'Triggering Sonarr MissingEpisodeSearch…', {
        integration: 'sonarr',
      });
      try {
        await this.sonarr.searchMonitoredEpisodes({
          baseUrl: sonarrBaseUrl as string,
          apiKey: sonarrApiKey as string,
        });
        sonarrQueued = 1;
        tasks.push({
          id: 'sonarr',
          title: 'Sonarr: MissingEpisodeSearch (monitored)',
          status: 'success',
          rows: [metricRow({ label: 'Queued', start: 0, changed: 1, end: 1, unit: 'cmd' })],
          facts: [{ label: 'Base URL', value: sonarrBaseUrl as string }],
        });
      } catch (err) {
        const msg = (err as Error)?.message ?? String(err);
        issues.push(issue('warn', `Sonarr trigger failed: ${msg}`));
        tasks.push({
          id: 'sonarr',
          title: 'Sonarr: MissingEpisodeSearch (monitored)',
          status: 'failed',
          issues: [issue('warn', msg)],
          facts: [{ label: 'Base URL', value: sonarrBaseUrl as string }],
        });
      }
    }

    const headline = (() => {
      if (ctx.dryRun) return 'Dry run: no commands were queued.';
      if (radarrQueued && sonarrQueued) return 'Queued Radarr + Sonarr monitored missing searches.';
      if (radarrQueued) return 'Queued Radarr monitored missing search.';
      if (sonarrQueued) return 'Queued Sonarr monitored missing search.';
      if (!includeRadarr && !includeSonarr) return 'Nothing to do.';
      return 'No commands were queued.';
    })();

    raw['results'] = {
      radarrQueued,
      sonarrQueued,
      waitedMs,
    };

    const report: JobReportV1 = {
      template: 'jobReportV1',
      version: 1,
      jobId: ctx.jobId,
      dryRun: ctx.dryRun,
      trigger: ctx.trigger,
      headline,
      sections: [
        {
          id: 'commands',
          title: 'Queued commands',
          rows: [
            metricRow({
              label: 'Radarr: MissingMoviesSearch (monitored)',
              start: 0,
              changed: radarrQueued,
              end: radarrQueued,
              unit: 'cmd',
            }),
            metricRow({
              label: 'Sonarr: MissingEpisodeSearch (monitored)',
              start: 0,
              changed: sonarrQueued,
              end: sonarrQueued,
              unit: 'cmd',
            }),
          ],
        },
        {
          id: 'timing',
          title: 'Timing',
          rows: [
            metricRow({
              label: 'Sonarr delay',
              start: 0,
              changed: Math.round(waitedMs / 60000),
              end: Math.round(waitedMs / 60000),
              unit: 'min',
              note: shouldDelaySonarr
                ? 'Applied on scheduled runs when both integrations are enabled.'
                : 'Not applied.',
            }),
          ],
        },
      ],
      tasks,
      issues,
      raw,
    };

    await setProgress('done', 'Done.', { finishedAt: new Date().toISOString() });
    await ctx.info('arrMonitoredSearch: done', {
      radarrQueued,
      sonarrQueued,
      waitedMs,
      durationMs: Date.now() - startedAtMs,
    });

    return { summary: report as unknown as JsonObject };
  }
}


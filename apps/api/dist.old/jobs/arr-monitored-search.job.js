"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArrMonitoredSearchJob = void 0;
const common_1 = require("@nestjs/common");
const settings_service_1 = require("../settings/settings.service");
const radarr_service_1 = require("../radarr/radarr.service");
const sonarr_service_1 = require("../sonarr/sonarr.service");
const job_report_v1_1 = require("./job-report-v1");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pick(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) {
        if (!isPlainObject(cur))
            return undefined;
        cur = cur[part];
    }
    return cur;
}
function pickString(obj, path) {
    const v = pick(obj, path);
    if (typeof v !== 'string')
        return null;
    const s = v.trim();
    return s ? s : null;
}
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}
async function sleep(ms) {
    if (!Number.isFinite(ms) || ms <= 0)
        return;
    await new Promise((resolve) => setTimeout(resolve, Math.trunc(ms)));
}
let ArrMonitoredSearchJob = class ArrMonitoredSearchJob {
    settingsService;
    radarr;
    sonarr;
    constructor(settingsService, radarr, sonarr) {
        this.settingsService = settingsService;
        this.radarr = radarr;
        this.sonarr = sonarr;
    }
    async run(ctx) {
        const startedAtMs = Date.now();
        const setProgress = async (step, message, context) => {
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
        const { settings, secrets } = await this.settingsService.getInternalSettings(ctx.userId);
        const includeRadarr = pickBool(settings, 'jobs.arrMonitoredSearch.includeRadarr') ?? true;
        const includeSonarr = pickBool(settings, 'jobs.arrMonitoredSearch.includeSonarr') ?? true;
        const issues = [];
        const tasks = [];
        const raw = {
            includeRadarr,
            includeSonarr,
        };
        if (!includeRadarr && !includeSonarr) {
            issues.push((0, job_report_v1_1.issue)('warn', 'Both Radarr and Sonarr are disabled; nothing to do.'));
        }
        const radarrBaseUrlRaw = pickString(settings, 'radarr.baseUrl') ?? pickString(settings, 'radarr.url');
        const radarrApiKey = pickString(secrets, 'radarr.apiKey') ?? pickString(secrets, 'radarrApiKey');
        const radarrConfigured = Boolean(radarrBaseUrlRaw && radarrApiKey);
        const radarrBaseUrl = radarrBaseUrlRaw ? normalizeHttpUrl(radarrBaseUrlRaw) : null;
        const sonarrBaseUrlRaw = pickString(settings, 'sonarr.baseUrl') ?? pickString(settings, 'sonarr.url');
        const sonarrApiKey = pickString(secrets, 'sonarr.apiKey') ?? pickString(secrets, 'sonarrApiKey');
        const sonarrConfigured = Boolean(sonarrBaseUrlRaw && sonarrApiKey);
        const sonarrBaseUrl = sonarrBaseUrlRaw ? normalizeHttpUrl(sonarrBaseUrlRaw) : null;
        raw['radarr'] = {
            enabled: includeRadarr,
            configured: radarrConfigured,
            baseUrl: radarrBaseUrl,
        };
        raw['sonarr'] = {
            enabled: includeSonarr,
            configured: sonarrConfigured,
            baseUrl: sonarrBaseUrl,
        };
        if (includeRadarr && !radarrConfigured) {
            issues.push((0, job_report_v1_1.issue)('warn', 'Radarr is enabled but not configured.'));
        }
        if (includeSonarr && !sonarrConfigured) {
            issues.push((0, job_report_v1_1.issue)('warn', 'Sonarr is enabled but not configured.'));
        }
        const effectiveRadarr = includeRadarr && radarrConfigured;
        const effectiveSonarr = includeSonarr && sonarrConfigured;
        const shouldDelaySonarr = ctx.trigger === 'schedule' && effectiveRadarr && effectiveSonarr;
        const plannedSonarrAtMs = startedAtMs + 60 * 60 * 1000;
        let radarrQueued = 0;
        let sonarrQueued = 0;
        let waitedMs = 0;
        if (!includeRadarr) {
            tasks.push({
                id: 'radarr',
                title: 'Radarr: MissingMoviesSearch (monitored)',
                status: 'skipped',
                issues: [],
                facts: [{ label: 'Enabled', value: false }],
            });
        }
        else if (!radarrConfigured) {
            tasks.push({
                id: 'radarr',
                title: 'Radarr: MissingMoviesSearch (monitored)',
                status: 'failed',
                issues: [(0, job_report_v1_1.issue)('warn', 'Radarr not configured (missing baseUrl and/or apiKey).')],
                facts: [{ label: 'Enabled', value: true }],
            });
        }
        else if (ctx.dryRun) {
            tasks.push({
                id: 'radarr',
                title: 'Radarr: MissingMoviesSearch (monitored)',
                status: 'skipped',
                facts: [
                    { label: 'Enabled', value: true },
                    { label: 'Dry run', value: true },
                ],
            });
        }
        else {
            await setProgress('radarr', 'Triggering Radarr MissingMoviesSearch…', {
                integration: 'radarr',
            });
            try {
                await this.radarr.searchMonitoredMovies({
                    baseUrl: radarrBaseUrl,
                    apiKey: radarrApiKey,
                });
                radarrQueued = 1;
                tasks.push({
                    id: 'radarr',
                    title: 'Radarr: MissingMoviesSearch (monitored)',
                    status: 'success',
                    rows: [(0, job_report_v1_1.metricRow)({ label: 'Queued', start: 0, changed: 1, end: 1, unit: 'cmd' })],
                    facts: [{ label: 'Base URL', value: radarrBaseUrl }],
                });
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                issues.push((0, job_report_v1_1.issue)('warn', `Radarr trigger failed: ${msg}`));
                tasks.push({
                    id: 'radarr',
                    title: 'Radarr: MissingMoviesSearch (monitored)',
                    status: 'failed',
                    issues: [(0, job_report_v1_1.issue)('warn', msg)],
                    facts: [{ label: 'Base URL', value: radarrBaseUrl }],
                });
            }
        }
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
                    (0, job_report_v1_1.metricRow)({
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
        }
        else {
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
        if (!includeSonarr) {
            tasks.push({
                id: 'sonarr',
                title: 'Sonarr: MissingEpisodeSearch (monitored)',
                status: 'skipped',
                facts: [{ label: 'Enabled', value: false }],
            });
        }
        else if (!sonarrConfigured) {
            tasks.push({
                id: 'sonarr',
                title: 'Sonarr: MissingEpisodeSearch (monitored)',
                status: 'failed',
                issues: [(0, job_report_v1_1.issue)('warn', 'Sonarr not configured (missing baseUrl and/or apiKey).')],
                facts: [{ label: 'Enabled', value: true }],
            });
        }
        else if (ctx.dryRun) {
            tasks.push({
                id: 'sonarr',
                title: 'Sonarr: MissingEpisodeSearch (monitored)',
                status: 'skipped',
                facts: [
                    { label: 'Enabled', value: true },
                    { label: 'Dry run', value: true },
                ],
            });
        }
        else {
            await setProgress('sonarr', 'Triggering Sonarr MissingEpisodeSearch…', {
                integration: 'sonarr',
            });
            try {
                await this.sonarr.searchMonitoredEpisodes({
                    baseUrl: sonarrBaseUrl,
                    apiKey: sonarrApiKey,
                });
                sonarrQueued = 1;
                tasks.push({
                    id: 'sonarr',
                    title: 'Sonarr: MissingEpisodeSearch (monitored)',
                    status: 'success',
                    rows: [(0, job_report_v1_1.metricRow)({ label: 'Queued', start: 0, changed: 1, end: 1, unit: 'cmd' })],
                    facts: [{ label: 'Base URL', value: sonarrBaseUrl }],
                });
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                issues.push((0, job_report_v1_1.issue)('warn', `Sonarr trigger failed: ${msg}`));
                tasks.push({
                    id: 'sonarr',
                    title: 'Sonarr: MissingEpisodeSearch (monitored)',
                    status: 'failed',
                    issues: [(0, job_report_v1_1.issue)('warn', msg)],
                    facts: [{ label: 'Base URL', value: sonarrBaseUrl }],
                });
            }
        }
        const headline = (() => {
            if (ctx.dryRun)
                return 'Dry run: no commands were queued.';
            if (radarrQueued && sonarrQueued)
                return 'Queued Radarr + Sonarr monitored missing searches.';
            if (radarrQueued)
                return 'Queued Radarr monitored missing search.';
            if (sonarrQueued)
                return 'Queued Sonarr monitored missing search.';
            if (!includeRadarr && !includeSonarr)
                return 'Nothing to do.';
            return 'No commands were queued.';
        })();
        raw['results'] = {
            radarrQueued,
            sonarrQueued,
            waitedMs,
        };
        const report = {
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
                        (0, job_report_v1_1.metricRow)({
                            label: 'Radarr: MissingMoviesSearch (monitored)',
                            start: 0,
                            changed: radarrQueued,
                            end: radarrQueued,
                            unit: 'cmd',
                        }),
                        (0, job_report_v1_1.metricRow)({
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
                        (0, job_report_v1_1.metricRow)({
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
        return { summary: report };
    }
};
exports.ArrMonitoredSearchJob = ArrMonitoredSearchJob;
exports.ArrMonitoredSearchJob = ArrMonitoredSearchJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        radarr_service_1.RadarrService,
        sonarr_service_1.SonarrService])
], ArrMonitoredSearchJob);
//# sourceMappingURL=arr-monitored-search.job.js.map
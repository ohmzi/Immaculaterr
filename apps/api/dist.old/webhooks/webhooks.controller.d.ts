import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';
import { PlexAnalyticsService } from '../plex/plex-analytics.service';
import { PlexUsersService } from '../plex/plex-users.service';
import { SettingsService } from '../settings/settings.service';
import { WebhooksService } from './webhooks.service';
export declare class WebhooksController {
    private readonly webhooksService;
    private readonly jobsService;
    private readonly authService;
    private readonly settingsService;
    private readonly plexUsers;
    private readonly plexAnalytics;
    constructor(webhooksService: WebhooksService, jobsService: JobsService, authService: AuthService, settingsService: SettingsService, plexUsers: PlexUsersService, plexAnalytics: PlexAnalyticsService);
    plexWebhook(req: Request, body: Record<string, unknown>, files: Array<Express.Multer.File>): Promise<{
        errors?: Record<string, string> | undefined;
        skipped?: Record<string, string> | undefined;
        triggered: boolean;
        runs: Record<string, string>;
        path: string;
        ok: boolean;
    } | {
        triggered: boolean;
        error: string;
        path: string;
        ok: boolean;
    } | {
        triggered: boolean;
        skipped: {
            mediaAddedCleanup: string;
        };
        path: string;
        ok: boolean;
    } | {
        triggered: boolean;
        runs: {
            mediaAddedCleanup: any;
        };
        path: string;
        ok: boolean;
    } | {
        triggered: boolean;
        path: string;
        ok: boolean;
    }>;
}

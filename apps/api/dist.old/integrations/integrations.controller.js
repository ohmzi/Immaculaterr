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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const google_service_1 = require("../google/google.service");
const openai_service_1 = require("../openai/openai.service");
const plex_library_selection_utils_1 = require("../plex/plex-library-selection.utils");
const plex_server_service_1 = require("../plex/plex-server.service");
const radarr_service_1 = require("../radarr/radarr.service");
const settings_service_1 = require("../settings/settings.service");
const sonarr_service_1 = require("../sonarr/sonarr.service");
const tmdb_service_1 = require("../tmdb/tmdb.service");
function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
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
    return asString(pick(obj, path));
}
function pickBool(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'boolean' ? v : null;
}
function normalizeHttpUrl(raw) {
    const trimmed = raw.trim();
    const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const parsed = new URL(baseUrl);
        if (!/^https?:$/i.test(parsed.protocol))
            throw new Error('Unsupported protocol');
    }
    catch {
        throw new common_1.BadRequestException('baseUrl must be a valid http(s) URL');
    }
    return baseUrl;
}
let IntegrationsController = class IntegrationsController {
    settingsService;
    plexServer;
    radarr;
    sonarr;
    tmdb;
    google;
    openai;
    constructor(settingsService, plexServer, radarr, sonarr, tmdb, google, openai) {
        this.settingsService = settingsService;
        this.plexServer = plexServer;
        this.radarr = radarr;
        this.sonarr = sonarr;
        this.tmdb = tmdb;
        this.google = google;
        this.openai = openai;
    }
    async radarrOptions(req) {
        const userId = req.user.id;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const radarrEnabledFlag = pickBool(settings, 'radarr.enabled');
        const baseUrlRaw = pickString(settings, 'radarr.baseUrl');
        const apiKey = pickString(secrets, 'radarr.apiKey');
        const enabledFlag = radarrEnabledFlag ?? Boolean(apiKey);
        const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);
        if (!enabled) {
            throw new common_1.BadRequestException('Radarr is not enabled or not configured');
        }
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const [rootFolders, qualityProfiles, tags] = await Promise.all([
            this.radarr.listRootFolders({ baseUrl, apiKey }),
            this.radarr.listQualityProfiles({ baseUrl, apiKey }),
            this.radarr.listTags({ baseUrl, apiKey }),
        ]);
        rootFolders.sort((a, b) => a.path.localeCompare(b.path));
        qualityProfiles.sort((a, b) => a.name.localeCompare(b.name));
        tags.sort((a, b) => a.label.localeCompare(b.label));
        return { ok: true, rootFolders, qualityProfiles, tags };
    }
    async sonarrOptions(req) {
        const userId = req.user.id;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const sonarrEnabledFlag = pickBool(settings, 'sonarr.enabled');
        const baseUrlRaw = pickString(settings, 'sonarr.baseUrl');
        const apiKey = pickString(secrets, 'sonarr.apiKey');
        const enabledFlag = sonarrEnabledFlag ?? Boolean(apiKey);
        const enabled = enabledFlag && Boolean(baseUrlRaw) && Boolean(apiKey);
        if (!enabled) {
            throw new common_1.BadRequestException('Sonarr is not enabled or not configured');
        }
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const [rootFolders, qualityProfiles, tags] = await Promise.all([
            this.sonarr.listRootFolders({ baseUrl, apiKey }),
            this.sonarr.listQualityProfiles({ baseUrl, apiKey }),
            this.sonarr.listTags({ baseUrl, apiKey }),
        ]);
        rootFolders.sort((a, b) => a.path.localeCompare(b.path));
        qualityProfiles.sort((a, b) => a.name.localeCompare(b.name));
        tags.sort((a, b) => a.label.localeCompare(b.label));
        return { ok: true, rootFolders, qualityProfiles, tags };
    }
    async plexLibraries(req) {
        const userId = req.user.id;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const baseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!baseUrlRaw || !token) {
            throw new common_1.BadRequestException('Plex is not configured');
        }
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const sections = await this.plexServer.getSections({ baseUrl, token });
        const selection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({ settings, sections });
        const selectedSet = new Set(selection.selectedSectionKeys);
        const libraries = selection.eligibleLibraries.map((lib) => ({
            key: lib.key,
            title: lib.title,
            type: lib.type,
            selected: selectedSet.has(lib.key),
        }));
        return {
            ok: true,
            libraries,
            selectedSectionKeys: selection.selectedSectionKeys,
            excludedSectionKeys: selection.excludedSectionKeys,
            minimumRequired: plex_library_selection_utils_1.PLEX_LIBRARY_SELECTION_MIN_SELECTED,
            autoIncludeNewLibraries: true,
        };
    }
    async savePlexLibraries(req, body) {
        const bodyObj = isPlainObject(body) ? body : {};
        if (!Array.isArray(bodyObj['selectedSectionKeys'])) {
            throw new common_1.BadRequestException('selectedSectionKeys must be an array');
        }
        const selectedSectionKeys = (0, plex_library_selection_utils_1.sanitizeSectionKeys)(bodyObj['selectedSectionKeys']);
        const userId = req.user.id;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const baseUrlRaw = pickString(settings, 'plex.baseUrl') || pickString(settings, 'plex.url');
        const token = pickString(secrets, 'plex.token') || pickString(secrets, 'plexToken');
        if (!baseUrlRaw || !token) {
            throw new common_1.BadRequestException('Plex is not configured');
        }
        const baseUrl = normalizeHttpUrl(baseUrlRaw);
        const sections = await this.plexServer.getSections({ baseUrl, token });
        const selection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({ settings, sections });
        if (!selection.eligibleLibraries.length) {
            throw new common_1.BadRequestException('No Plex movie/TV libraries found');
        }
        if (selectedSectionKeys.length < plex_library_selection_utils_1.PLEX_LIBRARY_SELECTION_MIN_SELECTED) {
            throw new common_1.BadRequestException(`At least ${plex_library_selection_utils_1.PLEX_LIBRARY_SELECTION_MIN_SELECTED} library must be selected`);
        }
        const eligibleKeys = new Set(selection.eligibleLibraries.map((lib) => lib.key));
        const unknownKeys = selectedSectionKeys.filter((key) => !eligibleKeys.has(key));
        if (unknownKeys.length) {
            throw new common_1.BadRequestException(`Unknown library section keys: ${unknownKeys.join(', ')}`);
        }
        const excludedSectionKeys = (0, plex_library_selection_utils_1.buildExcludedSectionKeysFromSelected)({
            eligibleLibraries: selection.eligibleLibraries,
            selectedSectionKeys,
        });
        const nextSettings = await this.settingsService.updateSettings(userId, {
            plex: {
                librarySelection: {
                    excludedSectionKeys,
                },
            },
        });
        const nextSelection = (0, plex_library_selection_utils_1.resolvePlexLibrarySelection)({
            settings: nextSettings,
            sections,
        });
        const selectedSet = new Set(nextSelection.selectedSectionKeys);
        const libraries = nextSelection.eligibleLibraries.map((lib) => ({
            key: lib.key,
            title: lib.title,
            type: lib.type,
            selected: selectedSet.has(lib.key),
        }));
        return {
            ok: true,
            libraries,
            selectedSectionKeys: nextSelection.selectedSectionKeys,
            excludedSectionKeys: nextSelection.excludedSectionKeys,
            minimumRequired: plex_library_selection_utils_1.PLEX_LIBRARY_SELECTION_MIN_SELECTED,
            autoIncludeNewLibraries: true,
        };
    }
    async testSaved(req, integrationId, body) {
        const userId = req.user.id;
        const { settings, secrets } = await this.settingsService.getInternalSettings(userId);
        const bodyObj = isPlainObject(body) ? body : {};
        const id = integrationId.toLowerCase();
        if (id === 'plex') {
            const baseUrlRaw = pickString(bodyObj, 'baseUrl') || pickString(settings, 'plex.baseUrl');
            const token = pickString(secrets, 'plex.token');
            if (!baseUrlRaw)
                throw new common_1.BadRequestException('Plex baseUrl is not set');
            if (!token)
                throw new common_1.BadRequestException('Plex token is not set');
            const baseUrl = normalizeHttpUrl(baseUrlRaw);
            const machineIdentifier = await this.plexServer.getMachineIdentifier({
                baseUrl,
                token,
            });
            return {
                ok: true,
                summary: {
                    machineIdentifier,
                },
            };
        }
        if (id === 'radarr') {
            const baseUrlRaw = pickString(bodyObj, 'baseUrl') ||
                pickString(settings, 'radarr.baseUrl');
            const apiKey = pickString(secrets, 'radarr.apiKey');
            if (!baseUrlRaw)
                throw new common_1.BadRequestException('Radarr baseUrl is not set');
            if (!apiKey)
                throw new common_1.BadRequestException('Radarr apiKey is not set');
            const baseUrl = normalizeHttpUrl(baseUrlRaw);
            const result = await this.radarr.testConnection({ baseUrl, apiKey });
            return { ok: true, result };
        }
        if (id === 'sonarr') {
            const baseUrlRaw = pickString(bodyObj, 'baseUrl') ||
                pickString(settings, 'sonarr.baseUrl');
            const apiKey = pickString(secrets, 'sonarr.apiKey');
            if (!baseUrlRaw)
                throw new common_1.BadRequestException('Sonarr baseUrl is not set');
            if (!apiKey)
                throw new common_1.BadRequestException('Sonarr apiKey is not set');
            const baseUrl = normalizeHttpUrl(baseUrlRaw);
            const result = await this.sonarr.testConnection({ baseUrl, apiKey });
            return { ok: true, result };
        }
        if (id === 'tmdb') {
            const apiKey = pickString(secrets, 'tmdb.apiKey');
            if (!apiKey)
                throw new common_1.BadRequestException('TMDB apiKey is not set');
            const result = await this.tmdb.testConnection({ apiKey });
            return { ok: true, result };
        }
        if (id === 'google') {
            const apiKey = pickString(secrets, 'google.apiKey');
            const cseId = pickString(bodyObj, 'cseId') ||
                pickString(bodyObj, 'searchEngineId') ||
                pickString(settings, 'google.searchEngineId');
            if (!apiKey)
                throw new common_1.BadRequestException('Google apiKey is not set');
            if (!cseId)
                throw new common_1.BadRequestException('Google searchEngineId is not set');
            const result = await this.google.testConnection({
                apiKey,
                cseId,
                query: 'tautulli curated plex',
                numResults: 3,
            });
            return { ok: true, result };
        }
        if (id === 'openai') {
            const apiKey = pickString(secrets, 'openai.apiKey');
            if (!apiKey)
                throw new common_1.BadRequestException('OpenAI apiKey is not set');
            const result = await this.openai.testConnection({ apiKey });
            return { ok: true, result };
        }
        throw new common_1.BadRequestException(`Unknown integrationId: ${integrationId}`);
    }
};
exports.IntegrationsController = IntegrationsController;
__decorate([
    (0, common_1.Get)('radarr/options'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "radarrOptions", null);
__decorate([
    (0, common_1.Get)('sonarr/options'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "sonarrOptions", null);
__decorate([
    (0, common_1.Get)('plex/libraries'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "plexLibraries", null);
__decorate([
    (0, common_1.Put)('plex/libraries'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "savePlexLibraries", null);
__decorate([
    (0, common_1.Post)('test/:integrationId'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('integrationId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "testSaved", null);
exports.IntegrationsController = IntegrationsController = __decorate([
    (0, common_1.Controller)('integrations'),
    (0, swagger_1.ApiTags)('integrations'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService,
        plex_server_service_1.PlexServerService,
        radarr_service_1.RadarrService,
        sonarr_service_1.SonarrService,
        tmdb_service_1.TmdbService,
        google_service_1.GoogleService,
        openai_service_1.OpenAiService])
], IntegrationsController);
//# sourceMappingURL=integrations.controller.js.map
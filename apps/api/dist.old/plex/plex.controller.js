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
exports.PlexController = void 0;
const common_1 = require("@nestjs/common");
const plex_service_1 = require("./plex.service");
const plex_server_service_1 = require("./plex-server.service");
const plex_analytics_service_1 = require("./plex-analytics.service");
let PlexController = class PlexController {
    plexService;
    plexServerService;
    plexAnalytics;
    constructor(plexService, plexServerService, plexAnalytics) {
        this.plexService = plexService;
        this.plexServerService = plexServerService;
        this.plexAnalytics = plexAnalytics;
    }
    createPin() {
        return this.plexService.createPin();
    }
    checkPin(id) {
        const pinId = Number.parseInt(id, 10);
        if (!Number.isFinite(pinId) || pinId <= 0) {
            throw new common_1.BadRequestException('Invalid pin id');
        }
        return this.plexService.checkPin(pinId);
    }
    whoami(plexToken) {
        if (!plexToken) {
            throw new common_1.BadRequestException('Missing header: X-Plex-Token');
        }
        return this.plexService.whoami(plexToken);
    }
    async test(body) {
        const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
        const token = typeof body.token === 'string' ? body.token.trim() : '';
        if (!baseUrlRaw)
            throw new common_1.BadRequestException('baseUrl is required');
        if (!token)
            throw new common_1.BadRequestException('token is required');
        const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
            ? baseUrlRaw
            : `http://${baseUrlRaw}`;
        const baseUrlHost = (() => {
            try {
                return new URL(baseUrl).hostname;
            }
            catch {
                return '';
            }
        })();
        const dockerLocalhostHint = baseUrlHost === 'localhost' || baseUrlHost === '127.0.0.1'
            ? " In Docker bridge networking, `localhost` points to the container. Use your Plex server's LAN IP (recommended) or switch Immaculaterr to Docker host networking so `localhost` works."
            : '';
        try {
            const parsed = new URL(baseUrl);
            if (!/^https?:$/i.test(parsed.protocol)) {
                throw new Error('Unsupported protocol');
            }
        }
        catch {
            throw new common_1.BadRequestException('baseUrl must be a valid http(s) URL');
        }
        try {
            const sections = await this.plexServerService.getSections({ baseUrl, token });
            if (!sections.length) {
                throw new common_1.BadGatewayException(`Plex responded but returned no library sections.${dockerLocalhostHint}`.trim());
            }
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            if (/HTTP\\s+401\\b/.test(msg) || msg.includes('401 Unauthorized')) {
                throw new common_1.BadRequestException(`Plex token was rejected by the server (401 Unauthorized).${dockerLocalhostHint}`.trim());
            }
            throw new common_1.BadGatewayException(`Could not connect to Plex at ${baseUrl}.${dockerLocalhostHint}`.trim());
        }
        const machineIdentifier = await this.plexServerService
            .getMachineIdentifier({ baseUrl, token })
            .catch(() => null);
        return { ok: true, machineIdentifier };
    }
    async libraryGrowth(req) {
        return await this.plexAnalytics.getLibraryGrowth(req.user.id);
    }
    async libraryGrowthVersion(req) {
        return await this.plexAnalytics.getLibraryGrowthVersion(req.user.id);
    }
};
exports.PlexController = PlexController;
__decorate([
    (0, common_1.Post)('pin'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlexController.prototype, "createPin", null);
__decorate([
    (0, common_1.Get)('pin/:id'),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PlexController.prototype, "checkPin", null);
__decorate([
    (0, common_1.Get)('whoami'),
    __param(0, (0, common_1.Headers)('x-plex-token')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], PlexController.prototype, "whoami", null);
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlexController.prototype, "test", null);
__decorate([
    (0, common_1.Get)('library-growth'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlexController.prototype, "libraryGrowth", null);
__decorate([
    (0, common_1.Get)('library-growth/version'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlexController.prototype, "libraryGrowthVersion", null);
exports.PlexController = PlexController = __decorate([
    (0, common_1.Controller)('plex'),
    __metadata("design:paramtypes", [plex_service_1.PlexService,
        plex_server_service_1.PlexServerService,
        plex_analytics_service_1.PlexAnalyticsService])
], PlexController);
//# sourceMappingURL=plex.controller.js.map
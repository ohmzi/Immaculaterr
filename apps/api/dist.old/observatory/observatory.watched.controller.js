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
exports.WatchedObservatoryController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const observatory_service_1 = require("./observatory.service");
let WatchedObservatoryController = class WatchedObservatoryController {
    observatory;
    constructor(observatory) {
        this.observatory = observatory;
    }
    async listMovies(req, librarySectionKeyRaw, modeRaw, collectionKindRaw) {
        const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
        const mode = String(modeRaw ?? '').trim() || 'review';
        const collectionKind = String(collectionKindRaw ?? '').trim() || '';
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mode !== 'pendingApproval' && mode !== 'review')
            throw new common_1.BadRequestException('mode must be pendingApproval|review');
        if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
            throw new common_1.BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');
        return await this.observatory.listWatchedMovies({
            userId: req.user.id,
            librarySectionKey,
            mode,
            collectionKind,
        });
    }
    async listTv(req, librarySectionKeyRaw, modeRaw, collectionKindRaw) {
        const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
        const mode = String(modeRaw ?? '').trim() || 'review';
        const collectionKind = String(collectionKindRaw ?? '').trim() || '';
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mode !== 'pendingApproval' && mode !== 'review')
            throw new common_1.BadRequestException('mode must be pendingApproval|review');
        if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
            throw new common_1.BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');
        return await this.observatory.listWatchedTv({
            userId: req.user.id,
            librarySectionKey,
            mode,
            collectionKind,
        });
    }
    async recordDecisions(req, body) {
        const librarySectionKey = typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
        const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
        const collectionKind = typeof body.collectionKind === 'string' ? body.collectionKind.trim() : '';
        const decisions = Array.isArray(body.decisions) ? body.decisions : [];
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mediaType !== 'movie' && mediaType !== 'tv')
            throw new common_1.BadRequestException('mediaType must be movie|tv');
        if (collectionKind !== 'recentlyWatched' && collectionKind !== 'changeOfTaste')
            throw new common_1.BadRequestException('collectionKind must be recentlyWatched|changeOfTaste');
        return await this.observatory.recordWatchedDecisions({
            userId: req.user.id,
            librarySectionKey,
            mediaType,
            collectionKind: collectionKind,
            decisions,
        });
    }
    async apply(req, body) {
        const librarySectionKey = typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
        const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mediaType !== 'movie' && mediaType !== 'tv')
            throw new common_1.BadRequestException('mediaType must be movie|tv');
        return await this.observatory.applyWatched({
            userId: req.user.id,
            librarySectionKey,
            mediaType,
        });
    }
};
exports.WatchedObservatoryController = WatchedObservatoryController;
__decorate([
    (0, common_1.Get)('movies'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('librarySectionKey')),
    __param(2, (0, common_1.Query)('mode')),
    __param(3, (0, common_1.Query)('collectionKind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], WatchedObservatoryController.prototype, "listMovies", null);
__decorate([
    (0, common_1.Get)('tv'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('librarySectionKey')),
    __param(2, (0, common_1.Query)('mode')),
    __param(3, (0, common_1.Query)('collectionKind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", Promise)
], WatchedObservatoryController.prototype, "listTv", null);
__decorate([
    (0, common_1.Post)('decisions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WatchedObservatoryController.prototype, "recordDecisions", null);
__decorate([
    (0, common_1.Post)('apply'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WatchedObservatoryController.prototype, "apply", null);
exports.WatchedObservatoryController = WatchedObservatoryController = __decorate([
    (0, common_1.Controller)('observatory/watched'),
    (0, swagger_1.ApiTags)('observatory'),
    __metadata("design:paramtypes", [observatory_service_1.ObservatoryService])
], WatchedObservatoryController);
//# sourceMappingURL=observatory.watched.controller.js.map
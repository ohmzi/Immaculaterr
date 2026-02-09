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
exports.ObservatoryController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const observatory_service_1 = require("./observatory.service");
let ObservatoryController = class ObservatoryController {
    observatory;
    constructor(observatory) {
        this.observatory = observatory;
    }
    async listMovies(req, librarySectionKeyRaw, modeRaw) {
        const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
        const mode = String(modeRaw ?? '').trim() || 'review';
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mode !== 'pendingApproval' && mode !== 'review')
            throw new common_1.BadRequestException('mode must be pendingApproval|review');
        return await this.observatory.listMovies({
            userId: req.user.id,
            librarySectionKey,
            mode,
        });
    }
    async listTv(req, librarySectionKeyRaw, modeRaw) {
        const librarySectionKey = String(librarySectionKeyRaw ?? '').trim();
        const mode = String(modeRaw ?? '').trim() || 'review';
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mode !== 'pendingApproval' && mode !== 'review')
            throw new common_1.BadRequestException('mode must be pendingApproval|review');
        return await this.observatory.listTv({
            userId: req.user.id,
            librarySectionKey,
            mode,
        });
    }
    async recordDecisions(req, body) {
        const librarySectionKey = typeof body.librarySectionKey === 'string' ? body.librarySectionKey.trim() : '';
        const mediaType = typeof body.mediaType === 'string' ? body.mediaType.trim() : '';
        const decisions = Array.isArray(body.decisions) ? body.decisions : [];
        if (!librarySectionKey)
            throw new common_1.BadRequestException('librarySectionKey is required');
        if (mediaType !== 'movie' && mediaType !== 'tv')
            throw new common_1.BadRequestException('mediaType must be movie|tv');
        return await this.observatory.recordDecisions({
            userId: req.user.id,
            librarySectionKey,
            mediaType,
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
        return await this.observatory.apply({
            userId: req.user.id,
            librarySectionKey,
            mediaType,
        });
    }
    async resetRejected(req) {
        return await this.observatory.resetRejectedSuggestions({ userId: req.user.id });
    }
    async listRejected(req) {
        return await this.observatory.listRejectedSuggestions({ userId: req.user.id });
    }
    async deleteRejected(req, idRaw) {
        const id = String(idRaw ?? '').trim();
        if (!id)
            throw new common_1.BadRequestException('id is required');
        return await this.observatory.deleteRejectedSuggestion({
            userId: req.user.id,
            id,
        });
    }
};
exports.ObservatoryController = ObservatoryController;
__decorate([
    (0, common_1.Get)('movies'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('librarySectionKey')),
    __param(2, (0, common_1.Query)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "listMovies", null);
__decorate([
    (0, common_1.Get)('tv'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Query)('librarySectionKey')),
    __param(2, (0, common_1.Query)('mode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "listTv", null);
__decorate([
    (0, common_1.Post)('decisions'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "recordDecisions", null);
__decorate([
    (0, common_1.Post)('apply'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "apply", null);
__decorate([
    (0, common_1.Delete)('rejected/reset'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "resetRejected", null);
__decorate([
    (0, common_1.Get)('rejected'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "listRejected", null);
__decorate([
    (0, common_1.Delete)('rejected/:id'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ObservatoryController.prototype, "deleteRejected", null);
exports.ObservatoryController = ObservatoryController = __decorate([
    (0, common_1.Controller)('observatory/immaculate-taste'),
    (0, swagger_1.ApiTags)('observatory'),
    __metadata("design:paramtypes", [observatory_service_1.ObservatoryService])
], ObservatoryController);
//# sourceMappingURL=observatory.controller.js.map
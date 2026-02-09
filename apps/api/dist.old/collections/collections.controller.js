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
exports.CollectionsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const collections_service_1 = require("./collections.service");
let CollectionsController = class CollectionsController {
    collections;
    constructor(collections) {
        this.collections = collections;
    }
    async list() {
        return { collections: await this.collections.listCollections() };
    }
    async create(body) {
        const name = typeof body?.name === 'string' ? body.name : '';
        return {
            ok: true,
            collection: await this.collections.createCollection(name),
        };
    }
    async seedDefaults() {
        return { ok: true, collections: await this.collections.seedDefaults() };
    }
    async delete(collectionId) {
        await this.collections.deleteCollection(collectionId);
        return { ok: true };
    }
    async listItems(collectionId) {
        return { items: await this.collections.listItems(collectionId) };
    }
    async addItem(req, collectionId, body) {
        const userId = req.user.id;
        const title = typeof body?.title === 'string' ? body.title : undefined;
        const ratingKey = typeof body?.ratingKey === 'string' ? body.ratingKey : undefined;
        const item = await this.collections.addItem({
            userId,
            collectionId,
            title,
            ratingKey,
        });
        return { ok: true, item };
    }
    async deleteItem(collectionId, itemIdRaw) {
        const itemId = Number.parseInt(itemIdRaw, 10);
        await this.collections.deleteItem({ collectionId, itemId });
        return { ok: true };
    }
    async importJson(req, collectionId, body) {
        const userId = req.user.id;
        const json = typeof body?.json === 'string' ? body.json : '';
        const result = await this.collections.importFromJson({
            userId,
            collectionId,
            json,
        });
        return { ok: true, result };
    }
    async exportJson(collectionId) {
        return {
            ok: true,
            items: await this.collections.exportToJson(collectionId),
        };
    }
};
exports.CollectionsController = CollectionsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "create", null);
__decorate([
    (0, common_1.Post)('seed-defaults'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "seedDefaults", null);
__decorate([
    (0, common_1.Delete)(':collectionId'),
    __param(0, (0, common_1.Param)('collectionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "delete", null);
__decorate([
    (0, common_1.Get)(':collectionId/items'),
    __param(0, (0, common_1.Param)('collectionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "listItems", null);
__decorate([
    (0, common_1.Post)(':collectionId/items'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('collectionId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "addItem", null);
__decorate([
    (0, common_1.Delete)(':collectionId/items/:itemId'),
    __param(0, (0, common_1.Param)('collectionId')),
    __param(1, (0, common_1.Param)('itemId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "deleteItem", null);
__decorate([
    (0, common_1.Post)(':collectionId/import-json'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Param)('collectionId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "importJson", null);
__decorate([
    (0, common_1.Get)(':collectionId/export-json'),
    __param(0, (0, common_1.Param)('collectionId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], CollectionsController.prototype, "exportJson", null);
exports.CollectionsController = CollectionsController = __decorate([
    (0, common_1.Controller)('collections'),
    (0, swagger_1.ApiTags)('collections'),
    __metadata("design:paramtypes", [collections_service_1.CollectionsService])
], CollectionsController);
//# sourceMappingURL=collections.controller.js.map
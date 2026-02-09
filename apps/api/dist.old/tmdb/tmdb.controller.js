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
exports.TmdbController = void 0;
const common_1 = require("@nestjs/common");
const tmdb_service_1 = require("./tmdb.service");
let TmdbController = class TmdbController {
    tmdbService;
    constructor(tmdbService) {
        this.tmdbService = tmdbService;
    }
    test(body) {
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (!apiKey)
            throw new common_1.BadRequestException('TMDB_API_KEY is required');
        return this.tmdbService.testConnection({ apiKey });
    }
};
exports.TmdbController = TmdbController;
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], TmdbController.prototype, "test", null);
exports.TmdbController = TmdbController = __decorate([
    (0, common_1.Controller)('tmdb'),
    __metadata("design:paramtypes", [tmdb_service_1.TmdbService])
], TmdbController);
//# sourceMappingURL=tmdb.controller.js.map
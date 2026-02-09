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
exports.GoogleController = void 0;
const common_1 = require("@nestjs/common");
const google_service_1 = require("./google.service");
let GoogleController = class GoogleController {
    googleService;
    constructor(googleService) {
        this.googleService = googleService;
    }
    test(body) {
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        const cseId = typeof body.cseId === 'string' ? body.cseId.trim() : '';
        const query = typeof body.query === 'string' ? body.query.trim() : 'imdb the matrix';
        let numResults = 15;
        if (typeof body.numResults === 'number' &&
            Number.isFinite(body.numResults)) {
            numResults = Math.trunc(body.numResults);
        }
        else if (typeof body.numResults === 'string' && body.numResults.trim()) {
            const parsed = Number.parseInt(body.numResults.trim(), 10);
            if (Number.isFinite(parsed))
                numResults = parsed;
        }
        if (!apiKey)
            throw new common_1.BadRequestException('GOOGLE_API_KEY is required');
        if (!cseId)
            throw new common_1.BadRequestException('GOOGLE_CSE_ID (cx) is required for Google Programmable Search');
        if (!query)
            throw new common_1.BadRequestException('query is required');
        return this.googleService.testConnection({
            apiKey,
            cseId,
            query,
            numResults,
        });
    }
};
exports.GoogleController = GoogleController;
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GoogleController.prototype, "test", null);
exports.GoogleController = GoogleController = __decorate([
    (0, common_1.Controller)('google'),
    __metadata("design:paramtypes", [google_service_1.GoogleService])
], GoogleController);
//# sourceMappingURL=google.controller.js.map
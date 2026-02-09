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
exports.SonarrController = void 0;
const common_1 = require("@nestjs/common");
const sonarr_service_1 = require("./sonarr.service");
let SonarrController = class SonarrController {
    sonarrService;
    constructor(sonarrService) {
        this.sonarrService = sonarrService;
    }
    test(body) {
        const baseUrlRaw = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (!baseUrlRaw)
            throw new common_1.BadRequestException('baseUrl is required');
        if (!apiKey)
            throw new common_1.BadRequestException('apiKey is required');
        const baseUrl = /^https?:\/\//i.test(baseUrlRaw)
            ? baseUrlRaw
            : `http://${baseUrlRaw}`;
        try {
            const parsed = new URL(baseUrl);
            if (!/^https?:$/i.test(parsed.protocol)) {
                throw new Error('Unsupported protocol');
            }
        }
        catch {
            throw new common_1.BadRequestException('baseUrl must be a valid http(s) URL');
        }
        return this.sonarrService.testConnection({ baseUrl, apiKey });
    }
};
exports.SonarrController = SonarrController;
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SonarrController.prototype, "test", null);
exports.SonarrController = SonarrController = __decorate([
    (0, common_1.Controller)('sonarr'),
    __metadata("design:paramtypes", [sonarr_service_1.SonarrService])
], SonarrController);
//# sourceMappingURL=sonarr.controller.js.map
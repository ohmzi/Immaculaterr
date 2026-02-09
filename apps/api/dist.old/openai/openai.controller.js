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
exports.OpenAiController = void 0;
const common_1 = require("@nestjs/common");
const openai_service_1 = require("./openai.service");
let OpenAiController = class OpenAiController {
    openAiService;
    constructor(openAiService) {
        this.openAiService = openAiService;
    }
    test(body) {
        const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
        if (!apiKey)
            throw new common_1.BadRequestException('OPENAI_API_KEY is required');
        return this.openAiService.testConnection({ apiKey });
    }
};
exports.OpenAiController = OpenAiController;
__decorate([
    (0, common_1.Post)('test'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], OpenAiController.prototype, "test", null);
exports.OpenAiController = OpenAiController = __decorate([
    (0, common_1.Controller)('openai'),
    __metadata("design:paramtypes", [openai_service_1.OpenAiService])
], OpenAiController);
//# sourceMappingURL=openai.controller.js.map
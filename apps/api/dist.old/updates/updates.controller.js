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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatesController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const public_decorator_1 = require("../auth/public.decorator");
const updates_dto_1 = require("./updates.dto");
const updates_service_1 = require("./updates.service");
let UpdatesController = class UpdatesController {
    updates;
    constructor(updates) {
        this.updates = updates;
    }
    async getUpdates() {
        return await this.updates.getUpdates();
    }
};
exports.UpdatesController = UpdatesController;
__decorate([
    (0, common_1.Get)(),
    (0, public_decorator_1.Public)(),
    (0, swagger_1.ApiOkResponse)({ type: updates_dto_1.UpdatesResponseDto }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], UpdatesController.prototype, "getUpdates", null);
exports.UpdatesController = UpdatesController = __decorate([
    (0, common_1.Controller)('updates'),
    (0, swagger_1.ApiTags)('updates'),
    __metadata("design:paramtypes", [updates_service_1.UpdatesService])
], UpdatesController);
//# sourceMappingURL=updates.controller.js.map
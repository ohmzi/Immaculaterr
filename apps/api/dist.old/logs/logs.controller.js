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
exports.LogsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const server_logs_store_1 = require("./server-logs.store");
let LogsController = class LogsController {
    getLogs(afterIdRaw, limitRaw) {
        const afterId = afterIdRaw ? Number.parseInt(afterIdRaw, 10) : undefined;
        const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
        const data = (0, server_logs_store_1.listServerLogs)({
            afterId: Number.isFinite(afterId) ? afterId : undefined,
            limit: Number.isFinite(limit) ? limit : undefined,
        });
        return { ok: true, ...data };
    }
    clear() {
        (0, server_logs_store_1.clearServerLogs)();
        return { ok: true };
    }
};
exports.LogsController = LogsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Query)('afterId')),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], LogsController.prototype, "getLogs", null);
__decorate([
    (0, common_1.Delete)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], LogsController.prototype, "clear", null);
exports.LogsController = LogsController = __decorate([
    (0, common_1.Controller)('logs'),
    (0, swagger_1.ApiTags)('logs')
], LogsController);
//# sourceMappingURL=logs.controller.js.map
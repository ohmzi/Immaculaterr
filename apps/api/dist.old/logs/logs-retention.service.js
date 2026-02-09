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
var LogsRetentionService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogsRetentionService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const server_logs_store_1 = require("./server-logs.store");
let LogsRetentionService = class LogsRetentionService {
    static { LogsRetentionService_1 = this; }
    logger = new common_1.Logger(LogsRetentionService_1.name);
    static RETENTION_DAYS = 15;
    static INTERVAL_MS = 24 * 60 * 60_000;
    onModuleInit() {
        setTimeout(() => void this.cleanupOnce(), 15_000);
    }
    async poll() {
        this.cleanupOnce();
    }
    cleanupOnce() {
        const cutoff = new Date(Date.now() - LogsRetentionService_1.RETENTION_DAYS * 24 * 60 * 60_000);
        const res = (0, server_logs_store_1.pruneServerLogsOlderThan)(cutoff);
        if (res.removed > 0) {
            this.logger.log(`Server logs retention: removed=${res.removed} kept=${res.kept} cutoff=${cutoff.toISOString()}`);
        }
    }
};
exports.LogsRetentionService = LogsRetentionService;
__decorate([
    (0, schedule_1.Interval)(LogsRetentionService.INTERVAL_MS),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], LogsRetentionService.prototype, "poll", null);
exports.LogsRetentionService = LogsRetentionService = LogsRetentionService_1 = __decorate([
    (0, common_1.Injectable)()
], LogsRetentionService);
//# sourceMappingURL=logs-retention.service.js.map
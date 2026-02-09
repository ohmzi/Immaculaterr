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
exports.AppService = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const prisma_service_1 = require("./db/prisma.service");
const app_meta_1 = require("./app.meta");
let AppService = class AppService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    getHealth() {
        return {
            status: 'ok',
            time: new Date().toISOString(),
        };
    }
    getMeta() {
        return (0, app_meta_1.readAppMeta)();
    }
    async getReadiness() {
        const time = new Date().toISOString();
        const checks = {
            db: { ok: true },
            dataDir: { ok: true },
        };
        try {
            await this.prisma.$queryRaw `SELECT 1`;
            checks.db = { ok: true };
        }
        catch (err) {
            checks.db = {
                ok: false,
                error: err?.message ?? String(err),
            };
        }
        const dataDir = process.env.APP_DATA_DIR?.trim();
        if (!dataDir) {
            checks.dataDir = { ok: false, error: 'APP_DATA_DIR is not set' };
        }
        else {
            try {
                const s = await (0, promises_1.stat)(dataDir);
                if (!s.isDirectory()) {
                    checks.dataDir = { ok: false, error: 'APP_DATA_DIR is not a directory' };
                }
                else {
                    await (0, promises_1.access)(dataDir, node_fs_1.constants.W_OK | node_fs_1.constants.X_OK);
                    checks.dataDir = { ok: true };
                }
            }
            catch (err) {
                checks.dataDir = {
                    ok: false,
                    error: err?.message ?? String(err),
                };
            }
        }
        const status = checks.db.ok && checks.dataDir.ok ? 'ready' : 'not_ready';
        return { status, time, checks };
    }
};
exports.AppService = AppService;
exports.AppService = AppService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AppService);
//# sourceMappingURL=app.service.js.map
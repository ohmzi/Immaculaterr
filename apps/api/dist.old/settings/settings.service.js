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
var SettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SettingsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_service_1 = require("../crypto/crypto.service");
const prisma_service_1 = require("../db/prisma.service");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function deepMerge(target, source) {
    for (const [key, value] of Object.entries(source)) {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }
        if (value === undefined)
            continue;
        if (value === null) {
            target[key] = null;
            continue;
        }
        if (isPlainObject(value) && isPlainObject(target[key])) {
            target[key] = deepMerge(target[key], value);
            continue;
        }
        target[key] = value;
    }
    return target;
}
let SettingsService = SettingsService_1 = class SettingsService {
    prisma;
    crypto;
    logger = new common_1.Logger(SettingsService_1.name);
    constructor(prisma, crypto) {
        this.prisma = prisma;
        this.crypto = crypto;
    }
    async getPublicSettings(userId) {
        const settings = await this.getSettingsDoc(userId);
        const secrets = await this.getSecretsDoc(userId);
        const secretsPresent = Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, Boolean(v)]));
        return {
            settings,
            secretsPresent,
            meta: {
                dataDir: process.env.APP_DATA_DIR ?? null,
            },
        };
    }
    async getInternalSettings(userId) {
        return {
            settings: await this.getSettingsDoc(userId),
            secrets: await this.getSecretsDoc(userId),
        };
    }
    async updateSettings(userId, patch) {
        const current = await this.getSettingsDoc(userId);
        const next = deepMerge({ ...current }, patch);
        await this.prisma.userSettings.upsert({
            where: { userId },
            update: { value: JSON.stringify(next) },
            create: { userId, value: JSON.stringify(next) },
        });
        this.logger.log(`Updated settings userId=${userId}`);
        return next;
    }
    async updateSecrets(userId, patch) {
        const current = await this.getSecretsDoc(userId);
        const merged = deepMerge({ ...current }, patch);
        for (const [k, v] of Object.entries(merged)) {
            if (v === null) {
                delete merged[k];
            }
        }
        const encrypted = this.crypto.encryptString(JSON.stringify(merged));
        await this.prisma.userSecrets.upsert({
            where: { userId },
            update: { value: encrypted },
            create: { userId, value: encrypted },
        });
        this.logger.log(`Updated secrets userId=${userId}`);
        return Object.fromEntries(Object.entries(merged).map(([k]) => [k, true]));
    }
    async enforceAutomationConstraints(userId) {
        const settings = await this.getSettingsDoc(userId);
        const secrets = await this.getSecretsDoc(userId);
        const readBool = (obj, path) => {
            const parts = path.split('.');
            let cur = obj;
            for (const p of parts) {
                if (!cur || typeof cur !== 'object' || Array.isArray(cur))
                    return null;
                cur = cur[p];
            }
            return typeof cur === 'boolean' ? cur : null;
        };
        const radarrEnabledSetting = readBool(settings, 'radarr.enabled');
        const sonarrEnabledSetting = readBool(settings, 'sonarr.enabled');
        const radarrSecretsPresent = Boolean(secrets['radarr']);
        const sonarrSecretsPresent = Boolean(secrets['sonarr']);
        const radarrEnabled = (radarrEnabledSetting ?? radarrSecretsPresent) === true;
        const sonarrEnabled = (sonarrEnabledSetting ?? sonarrSecretsPresent) === true;
        if (radarrEnabled || sonarrEnabled)
            return;
        const res = await this.prisma.jobSchedule.updateMany({
            where: {
                jobId: { in: ['monitorConfirm', 'arrMonitoredSearch'] },
                enabled: true,
            },
            data: { enabled: false },
        });
        if (res.count > 0) {
            this.logger.log(`Disabled ARR-dependent schedules (Radarr+Sonarr disabled) userId=${userId} count=${res.count}`);
        }
    }
    async getSettingsDoc(userId) {
        const row = await this.prisma.userSettings.findUnique({
            where: { userId },
        });
        if (!row?.value)
            return { onboarding: { completed: false } };
        try {
            const parsed = JSON.parse(row.value);
            return isPlainObject(parsed)
                ? parsed
                : { onboarding: { completed: false } };
        }
        catch {
            return { onboarding: { completed: false } };
        }
    }
    async getSecretsDoc(userId) {
        const row = await this.prisma.userSecrets.findUnique({ where: { userId } });
        if (!row?.value)
            return {};
        try {
            const raw = this.crypto.isEncrypted(row.value)
                ? this.crypto.decryptString(row.value)
                : row.value;
            if (!raw.trim())
                return {};
            const parsed = JSON.parse(raw);
            return isPlainObject(parsed) ? parsed : {};
        }
        catch {
            return {};
        }
    }
};
exports.SettingsService = SettingsService;
exports.SettingsService = SettingsService = SettingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        crypto_service_1.CryptoService])
], SettingsService);
//# sourceMappingURL=settings.service.js.map
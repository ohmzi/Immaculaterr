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
exports.SettingsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const settings_service_1 = require("./settings.service");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
let SettingsController = class SettingsController {
    settingsService;
    constructor(settingsService) {
        this.settingsService = settingsService;
    }
    get(req) {
        return this.settingsService.getPublicSettings(req.user.id);
    }
    backupInfo() {
        const appDataDir = process.env.APP_DATA_DIR?.trim() || null;
        const databaseUrl = process.env.DATABASE_URL?.trim() || null;
        const envMasterKeySet = Boolean(process.env.APP_MASTER_KEY?.trim());
        const envMasterKeyFilePath = process.env.APP_MASTER_KEY_FILE?.trim() || null;
        const envMasterKeyFileExists = envMasterKeyFilePath
            ? (0, node_fs_1.existsSync)(envMasterKeyFilePath)
            : false;
        const keyFilePath = appDataDir ? (0, node_path_1.join)(appDataDir, 'app-master.key') : null;
        const keyFileExists = keyFilePath ? (0, node_fs_1.existsSync)(keyFilePath) : false;
        const dbFilePath = databaseUrl && databaseUrl.startsWith('file:')
            ? databaseUrl.slice('file:'.length)
            : null;
        const masterKeySource = envMasterKeySet
            ? 'env'
            : envMasterKeyFilePath
                ? 'file'
                : 'dataDirFile';
        const whatToBackup = [
            ...(appDataDir ? [appDataDir] : []),
            ...(dbFilePath ? [dbFilePath] : []),
            ...(masterKeySource === 'dataDirFile' && keyFilePath ? [keyFilePath] : []),
        ];
        return {
            appDataDir,
            databaseUrl,
            masterKey: {
                source: masterKeySource,
                envSet: envMasterKeySet,
                envFilePath: envMasterKeyFilePath,
                envFileExists: envMasterKeyFileExists,
                dataDirKeyFilePath: keyFilePath,
                dataDirKeyFileExists: keyFileExists,
            },
            whatToBackup,
        };
    }
    async put(req, body) {
        const userId = req.user.id;
        const settingsPatch = body?.settings;
        const secretsPatch = body?.secrets;
        if (settingsPatch !== undefined && !isPlainObject(settingsPatch)) {
            throw new common_1.BadRequestException('settings must be an object');
        }
        if (secretsPatch !== undefined && !isPlainObject(secretsPatch)) {
            throw new common_1.BadRequestException('secrets must be an object');
        }
        if (settingsPatch) {
            await this.settingsService.updateSettings(userId, settingsPatch);
        }
        if (secretsPatch) {
            await this.settingsService.updateSecrets(userId, secretsPatch);
        }
        await this.settingsService.enforceAutomationConstraints(userId);
        return await this.settingsService.getPublicSettings(userId);
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], SettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)('backup-info'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SettingsController.prototype, "backupInfo", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "put", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('settings'),
    (0, swagger_1.ApiTags)('settings'),
    __metadata("design:paramtypes", [settings_service_1.SettingsService])
], SettingsController);
//# sourceMappingURL=settings.controller.js.map
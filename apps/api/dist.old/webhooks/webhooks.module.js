"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksModule = void 0;
const common_1 = require("@nestjs/common");
const auth_module_1 = require("../auth/auth.module");
const jobs_module_1 = require("../jobs/jobs.module");
const plex_module_1 = require("../plex/plex.module");
const settings_module_1 = require("../settings/settings.module");
const webhooks_controller_1 = require("./webhooks.controller");
const plex_polling_service_1 = require("./plex-polling.service");
const webhooks_service_1 = require("./webhooks.service");
let WebhooksModule = class WebhooksModule {
};
exports.WebhooksModule = WebhooksModule;
exports.WebhooksModule = WebhooksModule = __decorate([
    (0, common_1.Module)({
        imports: [auth_module_1.AuthModule, jobs_module_1.JobsModule, settings_module_1.SettingsModule, plex_module_1.PlexModule],
        controllers: [webhooks_controller_1.WebhooksController],
        providers: [webhooks_service_1.WebhooksService, plex_polling_service_1.PlexPollingService],
    })
], WebhooksModule);
//# sourceMappingURL=webhooks.module.js.map
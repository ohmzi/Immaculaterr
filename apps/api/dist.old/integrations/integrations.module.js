"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegrationsModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const google_module_1 = require("../google/google.module");
const openai_module_1 = require("../openai/openai.module");
const plex_module_1 = require("../plex/plex.module");
const radarr_module_1 = require("../radarr/radarr.module");
const settings_module_1 = require("../settings/settings.module");
const sonarr_module_1 = require("../sonarr/sonarr.module");
const tmdb_module_1 = require("../tmdb/tmdb.module");
const integrations_controller_1 = require("./integrations.controller");
const integrations_connectivity_monitor_service_1 = require("./integrations-connectivity-monitor.service");
let IntegrationsModule = class IntegrationsModule {
};
exports.IntegrationsModule = IntegrationsModule;
exports.IntegrationsModule = IntegrationsModule = __decorate([
    (0, common_1.Module)({
        imports: [
            db_module_1.DbModule,
            settings_module_1.SettingsModule,
            plex_module_1.PlexModule,
            radarr_module_1.RadarrModule,
            sonarr_module_1.SonarrModule,
            tmdb_module_1.TmdbModule,
            google_module_1.GoogleModule,
            openai_module_1.OpenAiModule,
        ],
        controllers: [integrations_controller_1.IntegrationsController],
        providers: [integrations_connectivity_monitor_service_1.IntegrationsConnectivityMonitorService],
    })
], IntegrationsModule);
//# sourceMappingURL=integrations.module.js.map
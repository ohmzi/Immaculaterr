"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const settings_module_1 = require("../settings/settings.module");
const plex_controller_1 = require("./plex.controller");
const plex_analytics_service_1 = require("./plex-analytics.service");
const plex_curated_collections_service_1 = require("./plex-curated-collections.service");
const plex_service_1 = require("./plex.service");
const plex_server_service_1 = require("./plex-server.service");
const plex_watchlist_service_1 = require("./plex-watchlist.service");
const plex_duplicates_service_1 = require("./plex-duplicates.service");
const plex_connectivity_monitor_service_1 = require("./plex-connectivity-monitor.service");
const plex_activities_monitor_service_1 = require("./plex-activities-monitor.service");
const plex_users_service_1 = require("./plex-users.service");
let PlexModule = class PlexModule {
};
exports.PlexModule = PlexModule;
exports.PlexModule = PlexModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, settings_module_1.SettingsModule],
        controllers: [plex_controller_1.PlexController],
        providers: [
            plex_service_1.PlexService,
            plex_server_service_1.PlexServerService,
            plex_analytics_service_1.PlexAnalyticsService,
            plex_curated_collections_service_1.PlexCuratedCollectionsService,
            plex_users_service_1.PlexUsersService,
            plex_watchlist_service_1.PlexWatchlistService,
            plex_duplicates_service_1.PlexDuplicatesService,
            plex_connectivity_monitor_service_1.PlexConnectivityMonitorService,
            plex_activities_monitor_service_1.PlexActivitiesMonitorService,
        ],
        exports: [
            plex_service_1.PlexService,
            plex_server_service_1.PlexServerService,
            plex_analytics_service_1.PlexAnalyticsService,
            plex_curated_collections_service_1.PlexCuratedCollectionsService,
            plex_users_service_1.PlexUsersService,
            plex_watchlist_service_1.PlexWatchlistService,
            plex_duplicates_service_1.PlexDuplicatesService,
        ],
    })
], PlexModule);
//# sourceMappingURL=plex.module.js.map
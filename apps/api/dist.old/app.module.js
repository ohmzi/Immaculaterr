"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const serve_static_1 = require("@nestjs/serve-static");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const db_module_1 = require("./db/db.module");
const plex_module_1 = require("./plex/plex.module");
const webhooks_module_1 = require("./webhooks/webhooks.module");
const radarr_module_1 = require("./radarr/radarr.module");
const sonarr_module_1 = require("./sonarr/sonarr.module");
const google_module_1 = require("./google/google.module");
const tmdb_module_1 = require("./tmdb/tmdb.module");
const openai_module_1 = require("./openai/openai.module");
const crypto_module_1 = require("./crypto/crypto.module");
const settings_module_1 = require("./settings/settings.module");
const jobs_module_1 = require("./jobs/jobs.module");
const auth_module_1 = require("./auth/auth.module");
const core_1 = require("@nestjs/core");
const auth_guard_1 = require("./auth/auth.guard");
const integrations_module_1 = require("./integrations/integrations.module");
const collections_module_1 = require("./collections/collections.module");
const logs_module_1 = require("./logs/logs.module");
const updates_module_1 = require("./updates/updates.module");
const observatory_module_1 = require("./observatory/observatory.module");
const webDistPath = (0, node_path_1.join)(__dirname, '..', '..', 'web', 'dist');
const staticImports = (0, node_fs_1.existsSync)(webDistPath)
    ? [
        serve_static_1.ServeStaticModule.forRoot({
            rootPath: webDistPath,
            exclude: ['/api{/*path}'],
        }),
    ]
    : [];
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            ...staticImports,
            db_module_1.DbModule,
            crypto_module_1.CryptoModule,
            auth_module_1.AuthModule,
            settings_module_1.SettingsModule,
            integrations_module_1.IntegrationsModule,
            collections_module_1.CollectionsModule,
            logs_module_1.LogsModule,
            updates_module_1.UpdatesModule,
            observatory_module_1.ObservatoryModule,
            jobs_module_1.JobsModule,
            plex_module_1.PlexModule,
            webhooks_module_1.WebhooksModule,
            radarr_module_1.RadarrModule,
            sonarr_module_1.SonarrModule,
            google_module_1.GoogleModule,
            tmdb_module_1.TmdbModule,
            openai_module_1.OpenAiModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [
            app_service_1.AppService,
            {
                provide: core_1.APP_GUARD,
                useExisting: auth_guard_1.AuthGuard,
            },
        ],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map
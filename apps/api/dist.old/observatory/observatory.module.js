"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObservatoryModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const plex_module_1 = require("../plex/plex.module");
const radarr_module_1 = require("../radarr/radarr.module");
const sonarr_module_1 = require("../sonarr/sonarr.module");
const settings_module_1 = require("../settings/settings.module");
const tmdb_module_1 = require("../tmdb/tmdb.module");
const immaculate_taste_collection_module_1 = require("../immaculate-taste-collection/immaculate-taste-collection.module");
const watched_movie_recommendations_module_1 = require("../watched-movie-recommendations/watched-movie-recommendations.module");
const observatory_controller_1 = require("./observatory.controller");
const observatory_watched_controller_1 = require("./observatory.watched.controller");
const observatory_service_1 = require("./observatory.service");
let ObservatoryModule = class ObservatoryModule {
};
exports.ObservatoryModule = ObservatoryModule;
exports.ObservatoryModule = ObservatoryModule = __decorate([
    (0, common_1.Module)({
        imports: [
            db_module_1.DbModule,
            settings_module_1.SettingsModule,
            plex_module_1.PlexModule,
            tmdb_module_1.TmdbModule,
            radarr_module_1.RadarrModule,
            sonarr_module_1.SonarrModule,
            immaculate_taste_collection_module_1.ImmaculateTasteCollectionModule,
            watched_movie_recommendations_module_1.WatchedMovieRecommendationsModule,
        ],
        controllers: [observatory_controller_1.ObservatoryController, observatory_watched_controller_1.WatchedObservatoryController],
        providers: [observatory_service_1.ObservatoryService],
    })
], ObservatoryModule);
//# sourceMappingURL=observatory.module.js.map
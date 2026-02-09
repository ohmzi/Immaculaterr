"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WatchedMovieRecommendationsModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const plex_module_1 = require("../plex/plex.module");
const watched_collections_refresher_service_1 = require("./watched-collections-refresher.service");
let WatchedMovieRecommendationsModule = class WatchedMovieRecommendationsModule {
};
exports.WatchedMovieRecommendationsModule = WatchedMovieRecommendationsModule;
exports.WatchedMovieRecommendationsModule = WatchedMovieRecommendationsModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, plex_module_1.PlexModule],
        providers: [watched_collections_refresher_service_1.WatchedCollectionsRefresherService],
        exports: [watched_collections_refresher_service_1.WatchedCollectionsRefresherService],
    })
], WatchedMovieRecommendationsModule);
//# sourceMappingURL=watched-movie-recommendations.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImmaculateTasteCollectionModule = void 0;
const common_1 = require("@nestjs/common");
const db_module_1 = require("../db/db.module");
const tmdb_module_1 = require("../tmdb/tmdb.module");
const plex_module_1 = require("../plex/plex.module");
const settings_module_1 = require("../settings/settings.module");
const immaculate_taste_collection_service_1 = require("./immaculate-taste-collection.service");
const immaculate_taste_show_collection_service_1 = require("./immaculate-taste-show-collection.service");
const immaculate_taste_controller_1 = require("./immaculate-taste.controller");
let ImmaculateTasteCollectionModule = class ImmaculateTasteCollectionModule {
};
exports.ImmaculateTasteCollectionModule = ImmaculateTasteCollectionModule;
exports.ImmaculateTasteCollectionModule = ImmaculateTasteCollectionModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, tmdb_module_1.TmdbModule, settings_module_1.SettingsModule, plex_module_1.PlexModule],
        controllers: [immaculate_taste_controller_1.ImmaculateTasteController],
        providers: [immaculate_taste_collection_service_1.ImmaculateTasteCollectionService, immaculate_taste_show_collection_service_1.ImmaculateTasteShowCollectionService],
        exports: [immaculate_taste_collection_service_1.ImmaculateTasteCollectionService, immaculate_taste_show_collection_service_1.ImmaculateTasteShowCollectionService],
    })
], ImmaculateTasteCollectionModule);
//# sourceMappingURL=immaculate-taste-collection.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CollectionsModule = void 0;
const common_1 = require("@nestjs/common");
const plex_module_1 = require("../plex/plex.module");
const settings_module_1 = require("../settings/settings.module");
const db_module_1 = require("../db/db.module");
const collections_controller_1 = require("./collections.controller");
const collections_service_1 = require("./collections.service");
let CollectionsModule = class CollectionsModule {
};
exports.CollectionsModule = CollectionsModule;
exports.CollectionsModule = CollectionsModule = __decorate([
    (0, common_1.Module)({
        imports: [db_module_1.DbModule, settings_module_1.SettingsModule, plex_module_1.PlexModule],
        controllers: [collections_controller_1.CollectionsController],
        providers: [collections_service_1.CollectionsService],
    })
], CollectionsModule);
//# sourceMappingURL=collections.module.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecommendationsModule = void 0;
const common_1 = require("@nestjs/common");
const google_module_1 = require("../google/google.module");
const openai_module_1 = require("../openai/openai.module");
const tmdb_module_1 = require("../tmdb/tmdb.module");
const recommendations_service_1 = require("./recommendations.service");
let RecommendationsModule = class RecommendationsModule {
};
exports.RecommendationsModule = RecommendationsModule;
exports.RecommendationsModule = RecommendationsModule = __decorate([
    (0, common_1.Module)({
        imports: [google_module_1.GoogleModule, openai_module_1.OpenAiModule, tmdb_module_1.TmdbModule],
        providers: [recommendations_service_1.RecommendationsService],
        exports: [recommendations_service_1.RecommendationsService],
    })
], RecommendationsModule);
//# sourceMappingURL=recommendations.module.js.map
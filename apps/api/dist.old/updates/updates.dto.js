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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatesResponseDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const version_1 = require("../version");
class UpdatesResponseDto {
    currentVersion;
    latestVersion;
    updateAvailable;
    source;
    repo;
    latestUrl;
    checkedAt;
    error;
}
exports.UpdatesResponseDto = UpdatesResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: version_1.APP_VERSION }),
    __metadata("design:type", String)
], UpdatesResponseDto.prototype, "currentVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: version_1.APP_VERSION, nullable: true }),
    __metadata("design:type", Object)
], UpdatesResponseDto.prototype, "latestVersion", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: true }),
    __metadata("design:type", Boolean)
], UpdatesResponseDto.prototype, "updateAvailable", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'github-releases' }),
    __metadata("design:type", String)
], UpdatesResponseDto.prototype, "source", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ohmz/Immaculaterr', nullable: true }),
    __metadata("design:type", Object)
], UpdatesResponseDto.prototype, "repo", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: `https://github.com/ohmz/Immaculaterr/releases/tag/${version_1.APP_VERSION_TAG}`,
        nullable: true,
    }),
    __metadata("design:type", Object)
], UpdatesResponseDto.prototype, "latestUrl", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2026-01-09T16:05:00.000Z' }),
    __metadata("design:type", String)
], UpdatesResponseDto.prototype, "checkedAt", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: null, nullable: true }),
    __metadata("design:type", Object)
], UpdatesResponseDto.prototype, "error", void 0);
//# sourceMappingURL=updates.dto.js.map
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
exports.AppMetaResponseDto = exports.HealthResponseDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const version_1 = require("./version");
class HealthResponseDto {
    status;
    time;
}
exports.HealthResponseDto = HealthResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'ok' }),
    __metadata("design:type", String)
], HealthResponseDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2026-01-02T00:00:00.000Z' }),
    __metadata("design:type", String)
], HealthResponseDto.prototype, "time", void 0);
class AppMetaResponseDto {
    name;
    version;
    buildSha;
    buildTime;
}
exports.AppMetaResponseDto = AppMetaResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'immaculaterr' }),
    __metadata("design:type", String)
], AppMetaResponseDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: version_1.APP_VERSION }),
    __metadata("design:type", String)
], AppMetaResponseDto.prototype, "version", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '41fb2cb', nullable: true }),
    __metadata("design:type", Object)
], AppMetaResponseDto.prototype, "buildSha", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '2026-01-09T15:54:13.000Z', nullable: true }),
    __metadata("design:type", Object)
], AppMetaResponseDto.prototype, "buildTime", void 0);
//# sourceMappingURL=app.dto.js.map
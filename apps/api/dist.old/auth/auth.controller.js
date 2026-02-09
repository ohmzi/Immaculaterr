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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var AuthController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_service_1 = require("./auth.service");
const public_decorator_1 = require("./public.decorator");
let AuthController = AuthController_1 = class AuthController {
    authService;
    logger = new common_1.Logger(AuthController_1.name);
    constructor(authService) {
        this.authService = authService;
    }
    async bootstrap() {
        const hasUser = await this.authService.hasAnyUser();
        if (!hasUser) {
            return { needsAdminSetup: true, onboardingComplete: false };
        }
        const onboardingComplete = await this.authService.isOnboardingComplete();
        return { needsAdminSetup: false, onboardingComplete };
    }
    async register(body, req, res) {
        const username = typeof body?.username === 'string' ? body.username : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        const ip = req.ip ?? null;
        const ua = typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent']
            : null;
        this.logger.log(`auth: register attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`);
        await this.authService.registerAdmin({ username, password });
        const login = await this.authService.login({ username, password });
        this.setSessionCookie(req, res, login.sessionId);
        this.logger.log(`auth: register success userId=${login.user.id} username=${JSON.stringify(login.user.username)} ip=${JSON.stringify(ip)}`);
        return { ok: true, user: login.user };
    }
    async login(body, req, res) {
        const username = typeof body?.username === 'string' ? body.username : '';
        const password = typeof body?.password === 'string' ? body.password : '';
        const ip = req.ip ?? null;
        const ua = typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent']
            : null;
        this.logger.log(`auth: login attempt username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} ua=${JSON.stringify(ua)}`);
        try {
            const result = await this.authService.login({ username, password });
            this.setSessionCookie(req, res, result.sessionId);
            this.logger.log(`auth: login success userId=${result.user.id} username=${JSON.stringify(result.user.username)} ip=${JSON.stringify(ip)}`);
            return { ok: true, user: result.user };
        }
        catch (err) {
            const msg = err?.message ?? String(err);
            this.logger.warn(`auth: login failed username=${JSON.stringify(username.trim())} ip=${JSON.stringify(ip)} error=${JSON.stringify(msg)}`);
            throw err;
        }
    }
    async logout(req, res) {
        const sid = this.authService.readSessionIdFromRequest(req);
        if (sid)
            await this.authService.logout(sid);
        this.clearSessionCookie(req, res);
        const ip = req.ip ?? null;
        this.logger.log(`auth: logout ip=${JSON.stringify(ip)} hadSession=${Boolean(sid)}`);
        return { ok: true };
    }
    me(req) {
        return { user: req.user };
    }
    async resetDev(req, res) {
        await this.authService.resetAllData();
        const sid = this.authService.readSessionIdFromRequest(req);
        if (sid)
            await this.authService.logout(sid).catch(() => undefined);
        this.clearSessionCookie(req, res);
        return { ok: true };
    }
    setSessionCookie(req, res, sessionId) {
        res.cookie(this.authService.getSessionCookieName(), sessionId, {
            ...this.getSessionCookieOptions(req),
        });
    }
    clearSessionCookie(req, res) {
        res.clearCookie(this.authService.getSessionCookieName(), {
            ...this.getSessionCookieOptions(req),
        });
    }
    getSessionCookieOptions(req) {
        const raw = process.env.COOKIE_SECURE?.trim().toLowerCase();
        const secure = raw === 'true'
            ? true
            : raw === 'false'
                ? false
                : Boolean(req.secure);
        return {
            httpOnly: true,
            sameSite: 'lax',
            secure,
            path: '/',
        };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('bootstrap'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "bootstrap", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Post)('reset-dev'),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "resetDev", null);
exports.AuthController = AuthController = AuthController_1 = __decorate([
    (0, common_1.Controller)('auth'),
    (0, swagger_1.ApiTags)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map
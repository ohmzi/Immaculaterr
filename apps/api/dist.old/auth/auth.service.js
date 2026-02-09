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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var AuthService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const argon2_1 = __importDefault(require("argon2"));
const prisma_service_1 = require("../db/prisma.service");
const SESSION_COOKIE = 'tcp_session';
function sha256Hex(input) {
    return (0, node_crypto_1.createHash)('sha256').update(input).digest('hex');
}
let AuthService = AuthService_1 = class AuthService {
    prisma;
    logger = new common_1.Logger(AuthService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    getSessionCookieName() {
        return SESSION_COOKIE;
    }
    readSessionIdFromRequest(req) {
        const cookieName = this.getSessionCookieName();
        const cookies = req.cookies;
        if (!cookies || typeof cookies !== 'object')
            return null;
        const v = cookies[cookieName];
        return typeof v === 'string' && v.trim() ? v : null;
    }
    async hasAnyUser() {
        const count = await this.prisma.user.count();
        return count > 0;
    }
    async registerAdmin(params) {
        const { username, password } = params;
        const normalized = username.trim();
        if (!normalized)
            throw new common_1.BadRequestException('username is required');
        if (normalized.length < 3)
            throw new common_1.BadRequestException('username must be at least 3 chars');
        if (!password || password.length < 10) {
            throw new common_1.BadRequestException('password must be at least 10 chars');
        }
        const existing = await this.prisma.user.findUnique({
            where: { username: normalized },
        });
        if (existing)
            throw new common_1.BadRequestException('username already exists');
        const any = await this.hasAnyUser();
        if (any) {
            throw new common_1.BadRequestException('admin already exists');
        }
        const passwordHash = await argon2_1.default.hash(password, {
            type: argon2_1.default.argon2id,
        });
        const user = await this.prisma.user.create({
            data: {
                username: normalized,
                passwordHash,
            },
            select: { id: true, username: true },
        });
        const defaultUserSettings = {
            onboarding: { completed: false },
            jobs: {
                webhookEnabled: {
                    watchedMovieRecommendations: false,
                    immaculateTastePoints: false,
                    mediaAddedCleanup: false,
                },
            },
        };
        await this.prisma.userSettings.create({
            data: {
                userId: user.id,
                value: JSON.stringify(defaultUserSettings),
            },
        });
        await this.prisma.userSecrets.create({
            data: { userId: user.id, value: '' },
        });
        await this.prisma.jobSchedule.updateMany({ data: { enabled: false } });
        this.logger.log(`Created admin user=${user.username}`);
        return user;
    }
    async login(params) {
        const { username, password } = params;
        const normalized = username.trim();
        if (!normalized || !password)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const user = (await this.prisma.user.findUnique({
            where: { username: normalized },
        })) ??
            (await this.prisma.$queryRaw `SELECT "id", "username", "passwordHash" FROM "User" WHERE "username" = ${normalized} COLLATE NOCASE LIMIT 1`)[0];
        if (!user)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const ok = await argon2_1.default.verify(user.passwordHash, password);
        if (!ok)
            throw new common_1.UnauthorizedException('Invalid credentials');
        const sessionId = this.createSessionId();
        await this.prisma.session.create({
            data: { id: sha256Hex(sessionId), userId: user.id },
        });
        return {
            sessionId,
            user: { id: user.id, username: user.username },
        };
    }
    async logout(sessionId) {
        const hashed = sha256Hex(sessionId);
        await this.prisma.session
            .delete({ where: { id: hashed } })
            .catch(() => undefined);
    }
    async getUserForSession(sessionId) {
        const hashed = sha256Hex(sessionId);
        const session = await this.prisma.session.findUnique({
            where: { id: hashed },
            include: { user: { select: { id: true, username: true } } },
        });
        if (!session)
            return null;
        await this.prisma.session
            .update({ where: { id: hashed }, data: {} })
            .catch(() => undefined);
        return session.user;
    }
    async getFirstAdminUserId() {
        const user = await this.prisma.user.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });
        return user?.id ?? null;
    }
    async isOnboardingComplete() {
        const userId = await this.getFirstAdminUserId();
        if (!userId)
            return false;
        const settings = await this.prisma.userSettings.findUnique({
            where: { userId },
        });
        if (!settings?.value)
            return false;
        try {
            const parsed = JSON.parse(settings.value);
            if (parsed &&
                typeof parsed === 'object' &&
                'onboarding' in parsed &&
                parsed.onboarding &&
                typeof parsed.onboarding === 'object' &&
                'completed' in parsed.onboarding) {
                return Boolean(parsed.onboarding.completed);
            }
            return false;
        }
        catch {
            return false;
        }
    }
    async resetAllData() {
        await this.prisma.jobLogLine.deleteMany();
        await this.prisma.jobRun.deleteMany();
        await this.prisma.jobSchedule.deleteMany();
        await this.prisma.curatedCollectionItem.deleteMany();
        await this.prisma.curatedCollection.deleteMany();
        await this.prisma.session.deleteMany();
        await this.prisma.userSecrets.deleteMany();
        await this.prisma.userSettings.deleteMany();
        await this.prisma.user.deleteMany();
        await this.prisma.setting.deleteMany();
    }
    createSessionId() {
        return (0, node_crypto_1.randomBytes)(32).toString('base64url');
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = AuthService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuthService);
//# sourceMappingURL=auth.service.js.map
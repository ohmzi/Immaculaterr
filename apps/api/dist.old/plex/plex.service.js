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
var PlexService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlexService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
function sanitizeUrlForLogs(raw) {
    try {
        const u = new URL(raw);
        u.username = '';
        u.password = '';
        for (const k of [
            'X-Plex-Token',
            'x-plex-token',
            'token',
            'authToken',
            'auth_token',
            'plexToken',
            'plex_token',
        ]) {
            if (u.searchParams.has(k))
                u.searchParams.set(k, 'REDACTED');
        }
        return u.toString();
    }
    catch {
        return raw;
    }
}
let PlexService = PlexService_1 = class PlexService {
    logger = new common_1.Logger(PlexService_1.name);
    clientIdentifier;
    constructor() {
        this.clientIdentifier = process.env.PLEX_CLIENT_IDENTIFIER ?? (0, node_crypto_1.randomUUID)();
    }
    async createPin() {
        const url = 'https://plex.tv/api/v2/pins?strong=true';
        const safeUrl = sanitizeUrlForLogs(url);
        const startedAt = Date.now();
        const res = await fetch(url, {
            method: 'POST',
            headers: this.getPlexHeaders(),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const ms = Date.now() - startedAt;
            this.logger.warn(`Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim());
            throw new common_1.BadGatewayException(`Plex PIN create failed: HTTP ${res.status} ${body}`.trim());
        }
        const data = (await res.json());
        const ms = Date.now() - startedAt;
        this.logger.log(`Plex.tv HTTP POST ${safeUrl} -> ${res.status} (${ms}ms)`);
        this.logger.log(`Created Plex PIN id=${data.id}`);
        const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(this.clientIdentifier)}&code=${encodeURIComponent(data.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent('Immaculaterr')}`;
        return {
            id: data.id,
            expiresAt: data.expiresAt ?? null,
            authUrl,
            clientIdentifier: this.clientIdentifier,
        };
    }
    async checkPin(pinId) {
        const url = `https://plex.tv/api/v2/pins/${pinId}`;
        const safeUrl = sanitizeUrlForLogs(url);
        const startedAt = Date.now();
        const res = await fetch(url, {
            method: 'GET',
            headers: this.getPlexHeaders(),
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const ms = Date.now() - startedAt;
            this.logger.warn(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim());
            throw new common_1.BadGatewayException(`Plex PIN check failed: HTTP ${res.status} ${body}`.trim());
        }
        const data = (await res.json());
        const ms = Date.now() - startedAt;
        this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
        if (data.authToken) {
            this.logger.log(`Plex PIN authorized id=${data.id}`);
        }
        return {
            id: data.id,
            authToken: data.authToken ?? null,
            expiresAt: data.expiresAt ?? null,
        };
    }
    async whoami(plexToken) {
        const url = 'https://plex.tv/api/v2/user';
        const safeUrl = sanitizeUrlForLogs(url);
        const startedAt = Date.now();
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                ...this.getPlexHeaders(),
                'X-Plex-Token': plexToken,
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            const ms = Date.now() - startedAt;
            this.logger.warn(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms) ${body}`.trim());
            throw new common_1.BadGatewayException(`Plex whoami failed: HTTP ${res.status} ${body}`.trim());
        }
        const data = (await res.json());
        const ms = Date.now() - startedAt;
        this.logger.log(`Plex.tv HTTP GET ${safeUrl} -> ${res.status} (${ms}ms)`);
        return {
            id: data['id'] ?? null,
            uuid: data['uuid'] ?? null,
            username: data['username'] ?? null,
            title: data['title'] ?? null,
        };
    }
    getPlexHeaders() {
        return {
            Accept: 'application/json',
            'X-Plex-Client-Identifier': this.clientIdentifier,
            'X-Plex-Product': 'Immaculaterr',
            'X-Plex-Version': '0.0.0',
            'X-Plex-Device': 'Server',
            'X-Plex-Device-Name': 'Immaculaterr',
            'X-Plex-Platform': 'Web',
            'X-Plex-Platform-Version': process.version,
        };
    }
};
exports.PlexService = PlexService;
exports.PlexService = PlexService = PlexService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], PlexService);
//# sourceMappingURL=plex.service.js.map
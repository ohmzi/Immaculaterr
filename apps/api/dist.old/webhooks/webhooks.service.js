"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var WebhooksService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhooksService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function pick(obj, path) {
    const parts = path.split('.');
    let cur = obj;
    for (const part of parts) {
        if (!isPlainObject(cur))
            return undefined;
        cur = cur[part];
    }
    return cur;
}
function pickString(obj, path) {
    const v = pick(obj, path);
    return typeof v === 'string' ? v.trim() : '';
}
function pickNumber(obj, path) {
    const v = pick(obj, path);
    if (typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string' && v.trim()) {
        const n = Number.parseInt(v.trim(), 10);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}
function truncate(value, max) {
    const s = value.trim();
    if (s.length <= max)
        return s;
    return `${s.slice(0, Math.max(0, max - 1))}…`;
}
let WebhooksService = WebhooksService_1 = class WebhooksService {
    logger = new common_1.Logger(WebhooksService_1.name);
    async persistPlexWebhookEvent(event) {
        const baseDir = (0, node_path_1.join)(this.getDataDir(), 'webhooks', 'plex');
        await node_fs_1.promises.mkdir(baseDir, { recursive: true });
        const filename = `${new Date().toISOString().replace(/[:.]/g, '-')}-${(0, node_crypto_1.randomUUID)()}.json`;
        const path = (0, node_path_1.join)(baseDir, filename);
        await node_fs_1.promises.writeFile(path, JSON.stringify(event, null, 2), 'utf8');
        this.logger.log(`Persisted Plex webhook event: ${path}`);
        return { path };
    }
    logPlexWebhookSummary(params) {
        const payloadObj = isPlainObject(params.payload) ? params.payload : null;
        const plexEvent = payloadObj ? pickString(payloadObj, 'event') : '';
        const mediaType = payloadObj ? pickString(payloadObj, 'Metadata.type') : '';
        const title = payloadObj ? pickString(payloadObj, 'Metadata.title') : '';
        const year = payloadObj ? pickNumber(payloadObj, 'Metadata.year') : null;
        const ratingKey = payloadObj ? pickString(payloadObj, 'Metadata.ratingKey') : '';
        const guid = payloadObj ? pickString(payloadObj, 'Metadata.guid') : '';
        const libraryTitle = payloadObj
            ? pickString(payloadObj, 'Metadata.librarySectionTitle')
            : '';
        const libraryId = payloadObj ? pickNumber(payloadObj, 'Metadata.librarySectionID') : null;
        const grandparentTitle = payloadObj
            ? pickString(payloadObj, 'Metadata.grandparentTitle')
            : '';
        const parentIndex = payloadObj ? pickNumber(payloadObj, 'Metadata.parentIndex') : null;
        const index = payloadObj ? pickNumber(payloadObj, 'Metadata.index') : null;
        const accountTitle = payloadObj
            ? pickString(payloadObj, 'Account.title') ||
                pickString(payloadObj, 'Account.name') ||
                pickString(payloadObj, 'user') ||
                pickString(payloadObj, 'owner')
            : '';
        const serverTitle = payloadObj ? pickString(payloadObj, 'Server.title') : '';
        const serverUuid = payloadObj ? pickString(payloadObj, 'Server.uuid') : '';
        const playerTitle = payloadObj ? pickString(payloadObj, 'Player.title') : '';
        const playerProduct = payloadObj ? pickString(payloadObj, 'Player.product') : '';
        const playerPlatform = payloadObj ? pickString(payloadObj, 'Player.platform') : '';
        const playerState = payloadObj ? pickString(payloadObj, 'Player.state') : '';
        const viewOffset = payloadObj ? pickNumber(payloadObj, 'Metadata.viewOffset') : null;
        const duration = payloadObj ? pickNumber(payloadObj, 'Metadata.duration') : null;
        const fileCount = params.files?.length ?? 0;
        const fileSummary = fileCount > 0
            ? ` files=${fileCount}`
            : '';
        const srcIp = (params.source?.ip ?? '').trim();
        const src = srcIp ? ` ip=${srcIp}` : '';
        const base = [
            'Plex webhook:',
            plexEvent || '(unknown)',
            mediaType ? `type=${mediaType}` : null,
            serverTitle ? `server=${JSON.stringify(truncate(serverTitle, 60))}` : null,
            serverUuid ? `uuid=${serverUuid}` : null,
            accountTitle ? `user=${JSON.stringify(truncate(accountTitle, 40))}` : null,
            playerTitle || playerProduct || playerPlatform
                ? `player=${JSON.stringify(truncate([playerTitle, playerProduct, playerPlatform]
                    .filter(Boolean)
                    .join(' / '), 60))}`
                : null,
            playerState ? `state=${playerState}` : null,
            libraryTitle
                ? `library=${JSON.stringify(truncate(libraryTitle, 60))}`
                : libraryId !== null
                    ? `libraryId=${libraryId}`
                    : null,
        ]
            .filter(Boolean)
            .join(' ');
        const meta = title || grandparentTitle
            ? (() => {
                if (mediaType.toLowerCase() === 'episode') {
                    const show = grandparentTitle || '(show)';
                    const s = parentIndex !== null ? `S${parentIndex}` : '';
                    const e = index !== null ? `E${index}` : '';
                    const se = s || e ? ` ${[s, e].filter(Boolean).join('')}` : '';
                    return ` • ${truncate(show, 60)}${se} — ${truncate(title || '(episode)', 80)}`;
                }
                const t = truncate(title || grandparentTitle, 90);
                const y = year ? ` (${year})` : '';
                return ` • ${t}${y}`;
            })()
            : '';
        const ids = [
            ratingKey ? `ratingKey=${ratingKey}` : null,
            guid ? `guid=${truncate(guid, 120)}` : null,
            typeof viewOffset === 'number' ? `viewOffsetMs=${viewOffset}` : null,
            typeof duration === 'number' ? `durationMs=${duration}` : null,
        ]
            .filter(Boolean)
            .join(' ');
        const tail = [
            ids ? ` ${ids}` : '',
            fileSummary,
            src,
            ` persisted=${JSON.stringify(params.persistedPath)}`,
        ].join('');
        const eventLower = plexEvent.toLowerCase();
        const level = eventLower === 'media.scrobble' || eventLower === 'library.new'
            ? 'info'
            : 'debug';
        const msg = `${base}${meta}${tail}`.trim();
        if (level === 'info')
            this.logger.log(msg);
        else
            this.logger.debug(msg);
    }
    logPlexWebhookAutomation(params) {
        const ev = (params.plexEvent || '').trim() || '(unknown)';
        const type = (params.mediaType || '').trim();
        const seed = (params.seedTitle || '').trim();
        const plexUserId = (params.plexUserId || '').trim();
        const plexUserTitle = (params.plexUserTitle || '').trim();
        const runs = params.runs ?? {};
        const skipped = params.skipped ?? {};
        const errors = params.errors ?? {};
        const parts = [];
        parts.push(`Plex automation: ${ev}${type ? ` type=${type}` : ''}`);
        if (seed)
            parts.push(`seed=${JSON.stringify(truncate(seed, 80))}`);
        if (plexUserTitle)
            parts.push(`user=${JSON.stringify(truncate(plexUserTitle, 40))}`);
        if (plexUserId)
            parts.push(`plexUserId=${plexUserId}`);
        if (Object.keys(runs).length) {
            parts.push(`runs=${JSON.stringify(runs)}`);
        }
        if (Object.keys(skipped).length) {
            parts.push(`skipped=${JSON.stringify(skipped)}`);
        }
        if (Object.keys(errors).length) {
            parts.push(`errors=${JSON.stringify(errors)}`);
        }
        const msg = parts.join(' ');
        if (Object.keys(errors).length)
            this.logger.warn(msg);
        else
            this.logger.log(msg);
    }
    getDataDir() {
        const repoRoot = (0, node_path_1.join)(__dirname, '..', '..', '..', '..');
        return process.env.APP_DATA_DIR ?? (0, node_path_1.join)(repoRoot, 'data');
    }
};
exports.WebhooksService = WebhooksService;
exports.WebhooksService = WebhooksService = WebhooksService_1 = __decorate([
    (0, common_1.Injectable)()
], WebhooksService);
//# sourceMappingURL=webhooks.service.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UpdatesService = void 0;
const common_1 = require("@nestjs/common");
const app_meta_1 = require("../app.meta");
const DEFAULT_UPDATE_REPO = 'ohmzi/Immaculaterr';
function normalizeVersion(raw) {
    const s = raw.trim();
    if (!s)
        return null;
    return s.replace(/^[vV]/, '');
}
function parseVersionToParts(raw) {
    const norm = normalizeVersion(raw);
    if (!norm)
        return null;
    const parts = norm.split('.');
    if (parts.length < 3 || parts.length > 4)
        return null;
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => !Number.isFinite(n) || n < 0))
        return null;
    if (nums.length === 3)
        nums.push(0);
    return nums;
}
function compareVersions(a, b) {
    const ap = parseVersionToParts(a);
    const bp = parseVersionToParts(b);
    if (!ap || !bp)
        return null;
    for (let i = 0; i < 4; i += 1) {
        const d = (ap[i] ?? 0) - (bp[i] ?? 0);
        if (d !== 0)
            return d;
    }
    return 0;
}
function readUpdateCheckEnabled() {
    const raw = (process.env.UPDATE_CHECK_ENABLED ?? '').trim().toLowerCase();
    if (!raw)
        return true;
    return !['0', 'false', 'no', 'off'].includes(raw);
}
function readUpdateRepoEnv() {
    const raw = (process.env.UPDATE_CHECK_REPO ?? process.env.GITHUB_REPOSITORY ?? '').trim();
    if (!raw)
        return DEFAULT_UPDATE_REPO;
    if (!/^[^/]+\/[^/]+$/.test(raw))
        return null;
    return raw;
}
function readUpdateCheckTtlMs() {
    const raw = Number.parseInt(process.env.UPDATE_CHECK_TTL_MS ?? '60000', 10);
    return Number.isFinite(raw) && raw > 5_000 ? raw : 60_000;
}
function readGitHubToken() {
    const v = (process.env.UPDATE_CHECK_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN ?? '').trim() || null;
    return v;
}
let UpdatesService = class UpdatesService {
    cache = null;
    async fetchLatestFromGitHubReleases(repo) {
        const url = `https://api.github.com/repos/${repo}/releases/latest`;
        const token = readGitHubToken();
        const meta = (0, app_meta_1.readAppMeta)();
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                'User-Agent': `immaculaterr/${meta.version}`,
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                'X-GitHub-Api-Version': '2022-11-28',
            },
            signal: AbortSignal.timeout(6_000),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`GitHub API ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = (await res.json());
        const tagName = typeof json.tag_name === 'string' ? json.tag_name : '';
        const htmlUrl = typeof json.html_url === 'string' ? json.html_url : null;
        const version = normalizeVersion(tagName);
        if (!version)
            throw new Error('GitHub latest release missing tag_name');
        return { version, url: htmlUrl };
    }
    async getCachedLatest() {
        if (!readUpdateCheckEnabled()) {
            return { latest: null, error: null };
        }
        const repo = readUpdateRepoEnv();
        if (!repo) {
            return { latest: null, error: 'UPDATE_CHECK_REPO is invalid (expected "owner/repo")' };
        }
        const ttlMs = readUpdateCheckTtlMs();
        const now = Date.now();
        if (this.cache && now - this.cache.fetchedAtMs < ttlMs)
            return this.cache.value;
        try {
            const latest = await this.fetchLatestFromGitHubReleases(repo);
            const value = { latest, error: null };
            this.cache = { value, fetchedAtMs: now };
            return value;
        }
        catch (err) {
            const value = { latest: null, error: err?.message ?? String(err) };
            this.cache = { value, fetchedAtMs: now };
            return value;
        }
    }
    async getUpdates() {
        const meta = (0, app_meta_1.readAppMeta)();
        const repo = readUpdateRepoEnv();
        const { latest, error } = await this.getCachedLatest();
        const latestVersion = latest?.version ?? null;
        const cmp = latestVersion && meta.version ? compareVersions(latestVersion, meta.version) : null;
        const updateAvailable = typeof cmp === 'number' ? cmp > 0 : false;
        return {
            currentVersion: meta.version,
            latestVersion,
            updateAvailable,
            source: 'github-releases',
            repo,
            latestUrl: latest?.url ?? null,
            checkedAt: new Date().toISOString(),
            error,
        };
    }
};
exports.UpdatesService = UpdatesService;
exports.UpdatesService = UpdatesService = __decorate([
    (0, common_1.Injectable)()
], UpdatesService);
//# sourceMappingURL=updates.service.js.map
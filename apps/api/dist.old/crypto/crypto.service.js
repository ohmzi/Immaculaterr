"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CryptoService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const ENCRYPTED_PREFIX = 'enc:v1:';
function decodeMasterKey(input) {
    const raw = input.trim();
    if (!raw)
        throw new Error('Empty master key');
    if (/^[0-9a-f]{64}$/i.test(raw)) {
        return Buffer.from(raw, 'hex');
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length !== 32) {
        throw new Error('APP_MASTER_KEY must decode to 32 bytes (base64) or be a 64-char hex string.');
    }
    return buf;
}
let CryptoService = class CryptoService {
    masterKey;
    async onModuleInit() {
        this.masterKey = await this.loadOrCreateMasterKey();
    }
    encryptString(plaintext) {
        const iv = (0, node_crypto_1.randomBytes)(12);
        const cipher = (0, node_crypto_1.createCipheriv)('aes-256-gcm', this.masterKey, iv);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        return (ENCRYPTED_PREFIX +
            [
                iv.toString('base64'),
                tag.toString('base64'),
                ciphertext.toString('base64'),
            ].join(':'));
    }
    decryptString(payload) {
        if (!payload.startsWith(ENCRYPTED_PREFIX)) {
            throw new Error('Unsupported encrypted payload format');
        }
        const parts = payload.slice(ENCRYPTED_PREFIX.length).split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted payload format');
        }
        const [ivB64, tagB64, dataB64] = parts;
        const iv = Buffer.from(ivB64, 'base64');
        const tag = Buffer.from(tagB64, 'base64');
        const data = Buffer.from(dataB64, 'base64');
        const decipher = (0, node_crypto_1.createDecipheriv)('aes-256-gcm', this.masterKey, iv);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
        return plaintext.toString('utf8');
    }
    isEncrypted(value) {
        return value.startsWith(ENCRYPTED_PREFIX);
    }
    async loadOrCreateMasterKey() {
        const envKey = process.env.APP_MASTER_KEY?.trim();
        if (envKey) {
            return decodeMasterKey(envKey);
        }
        const envKeyFile = process.env.APP_MASTER_KEY_FILE?.trim();
        if (envKeyFile) {
            try {
                const raw = await (0, promises_1.readFile)(envKeyFile, 'utf8');
                return decodeMasterKey(raw);
            }
            catch (err) {
                const msg = err?.message ?? String(err);
                throw new Error(`Failed to read APP_MASTER_KEY_FILE (${envKeyFile}): ${msg}`);
            }
        }
        const dataDir = process.env.APP_DATA_DIR?.trim();
        if (!dataDir) {
            throw new Error('APP_DATA_DIR must be set before CryptoService initializes.');
        }
        const keyPath = (0, node_path_1.join)(dataDir, 'app-master.key');
        try {
            const existing = await (0, promises_1.readFile)(keyPath, 'utf8');
            await (0, promises_1.chmod)(keyPath, 0o600).catch(() => undefined);
            return decodeMasterKey(existing);
        }
        catch (err) {
            const code = err?.code;
            if (code && code !== 'ENOENT') {
                throw err;
            }
        }
        const key = (0, node_crypto_1.randomBytes)(32);
        const keyB64 = key.toString('base64');
        await (0, promises_1.writeFile)(keyPath, keyB64, { encoding: 'utf8', mode: 0o600 });
        await (0, promises_1.chmod)(keyPath, 0o600).catch(() => undefined);
        return key;
    }
};
exports.CryptoService = CryptoService;
exports.CryptoService = CryptoService = __decorate([
    (0, common_1.Injectable)()
], CryptoService);
//# sourceMappingURL=crypto.service.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_APP_VERSION = void 0;
exports.readAppMeta = readAppMeta;
const version_1 = require("./version");
exports.DEFAULT_APP_VERSION = version_1.APP_VERSION;
function readAppMeta() {
    const allowOverride = (process.env.ALLOW_APP_VERSION_OVERRIDE ?? '').trim() === 'true';
    const envVersion = (process.env.APP_VERSION ?? '').trim();
    const version = allowOverride && envVersion ? envVersion : exports.DEFAULT_APP_VERSION;
    const buildSha = (process.env.APP_BUILD_SHA ?? '').trim() || null;
    const buildTime = (process.env.APP_BUILD_TIME ?? '').trim() || null;
    return {
        name: 'immaculaterr',
        version,
        buildSha,
        buildTime,
    };
}
//# sourceMappingURL=app.meta.js.map